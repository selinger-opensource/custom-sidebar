// MV3 service worker: records last use and runs the nightly sweep when due, and lets the toolbar
// icon (and its keyboard shortcut) toggle the Sidebar. Event wiring only; the sweep's behavior
// lives in sweep.ts, the Sidebar's in sidebar.ts.
import { LAST_USE_KEY, chromeBrowser } from "./chrome-browser";
import { SWEEP_ENABLED_KEY, sweepEnabled, sweepSwitchedOn } from "./settings";
import { isSweepDue, runSweep, type Browser, type LastUseRecords, type SweepReceipt } from "./sweep";

const ALARM = "sweep-check";
const CHECK_EVERY_MINUTES = 5;
const RECEIPTS_KEPT = 14;

// --- Sidebar: the toolbar icon and the _execute_action shortcut open and close the side panel.
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

/** Sweep settings in chrome.storage.local. `enabled` is the options page's switch; the rest are
 *  operator knobs set from the service-worker console. */
interface Settings {
  enabled: boolean; // off by default (settings.ts); switching on waits for the next 03:00
  dryRun: boolean; // true: plan and log receipts, close nothing
  lastSweepAt?: number;
  sweepReceipts: SweepReceipt[];
  /** Feasibility testing only: shorter guard, and a sweep on the next check regardless of time. */
  testGuardMs?: number;
  testForceDue?: boolean;
}
const DEFAULTS: Settings = { enabled: false, dryRun: false, sweepReceipts: [] };

// --- Two independent queues: last-use writes must never wait behind a (possibly slow) sweep. --
function queue(): <T>(job: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (job) => {
    const next = tail.then(job, job);
    tail = next.catch((e) => console.error("[sweep]", e));
    return next;
  };
}
const recordSerial = queue();
const sweepSerial = queue();

// --- Chrome's session restore. --------------------------------------------------------------
// On browser start Chrome recreates, activates and loads restored tabs. That is not use, so
// activity is ignored after onStartup until tab creation has been quiet for 2 s. Independently,
// a sweep never starts within 5 s of the worker starting or 2 s of a tab being created, so it
// never plans against a half-restored window (event order at startup is not guaranteed).
let restoringUntil = 0;
let sweepNotBefore = Date.now() + 5_000;
const restoring = () => Date.now() < restoringUntil;
async function settled(): Promise<void> {
  for (let wait = sweepNotBefore - Date.now(); wait > 0; wait = sweepNotBefore - Date.now()) {
    await new Promise((r) => setTimeout(r, wait));
  }
}
chrome.runtime.onStartup.addListener(() => {
  restoringUntil = Date.now() + 5_000;
  void maybeSweep();
});
chrome.tabs.onCreated.addListener(() => {
  const now = Date.now();
  if (restoring()) restoringUntil = now + 2_000;
  sweepNotBefore = Math.max(sweepNotBefore, now + 2_000);
});

// --- Last use. ------------------------------------------------------------------------------
// Uses seen by this worker, visible to a running sweep immediately (before the storage write).
const seenUses: LastUseRecords = {};
function updateRecords(change: (records: LastUseRecords) => void): Promise<void> {
  return recordSerial(async () => {
    const records = await chromeBrowser.lastUseRecords();
    change(records);
    await chrome.storage.session.set({ [LAST_USE_KEY]: records });
  });
}
function recordUse(tabId: number): void {
  if (restoring()) return;
  const now = Date.now();
  seenUses[tabId] = now;
  void updateRecords((r) => {
    r[tabId] = Math.max(r[tabId] ?? 0, now);
  });
}

chrome.tabs.onActivated.addListener(({ tabId }) => recordUse(tabId));

const NOT_USE = new Set(["reload", "auto_toplevel", "start_page", "auto_subframe", "manual_subframe"]);
chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId !== 0 || NOT_USE.has(d.transitionType)) return;
  if (d.transitionQualifiers.includes("client_redirect")) return;
  recordUse(d.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete seenUses[tabId];
  void updateRecords((r) => {
    delete r[tabId];
  });
});
chrome.tabs.onReplaced.addListener((added, removed) => {
  if (seenUses[removed] !== undefined) seenUses[added] = seenUses[removed];
  delete seenUses[removed];
  void updateRecords((r) => {
    if (r[removed] !== undefined) r[added] = r[removed];
    delete r[removed];
  });
});

// --- Sweep scheduling. ----------------------------------------------------------------------
/** The Chrome adapter, with uses this worker has seen but not yet stored merged in. */
const browser: Browser = {
  ...chromeBrowser,
  async lastUseRecords() {
    const records = await chromeBrowser.lastUseRecords();
    for (const [id, at] of Object.entries(seenUses)) records[+id] = Math.max(records[+id] ?? 0, at);
    return records;
  },
};

async function readSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(null)) as Partial<Settings>;
  return { ...DEFAULTS, ...stored, enabled: sweepEnabled(stored[SWEEP_ENABLED_KEY]) };
}

function maybeSweep(): Promise<void> {
  const due = (s: Settings, now: number) =>
    s.enabled && s.lastSweepAt !== undefined && (s.testForceDue === true || isSweepDue(now, s.lastSweepAt));
  return sweepSerial(async () => {
    const first = await readSettings();
    if (first.lastSweepAt === undefined) {
      // First run after install (or lost state): the first sweep is the next 03:00.
      await chrome.storage.local.set({ lastSweepAt: Date.now() });
      return;
    }
    if (!due(first, Date.now())) return; // cheap path for the frequent checks
    await settled();
    const s = await readSettings();
    const now = Date.now();
    if (!due(s, now)) return;
    const receipt = await runSweep(browser, now, {
      dryRun: s.dryRun,
      stopped: async () => !sweepEnabled((await chrome.storage.local.get(SWEEP_ENABLED_KEY))[SWEEP_ENABLED_KEY]),
      ...(s.testGuardMs !== undefined && { guardMs: s.testGuardMs }),
    });
    console.info("[sweep]", receipt);
    await chrome.storage.local.set({
      lastSweepAt: now,
      testForceDue: false,
      sweepReceipts: [receipt, ...s.sweepReceipts].slice(0, RECEIPTS_KEPT),
    });
  });
}

// Switching on (from off, or from never set on a fresh install) restarts the baseline, so the
// first sweep after it is the next 03:00 rather than a catch-up for nights spent off.
// Serialized with sweep checks.
chrome.storage.onChanged.addListener((changes, area) => {
  const enabled = changes[SWEEP_ENABLED_KEY];
  if (area === "local" && enabled && sweepSwitchedOn(enabled.oldValue, enabled.newValue)) {
    void sweepSerial(() => chrome.storage.local.set({ lastSweepAt: Date.now() }));
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void maybeSweep();
});

// Every service-worker start (browser start, wake, update): make sure the check alarm exists,
// then check once. A missed alarm also fires once on wake.
void (async () => {
  if (!(await chrome.alarms.get(ALARM))) {
    await chrome.alarms.create(ALARM, { periodInMinutes: CHECK_EVERY_MINUTES, persistAcrossSessions: true });
  }
  await maybeSweep();
})();
