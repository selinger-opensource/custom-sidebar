// Nightly sweep: once a day, at 03:00 local or the first run after it, close every tab whose
// last use is older than the recent-use guard. Vocabulary: GLOSSARY.md (Last use, Nightly
// sweep, Recent-use guard, Placeholder tab).

export const SWEEP_HOUR = 3; // local time
export const RECENT_USE_GUARD_MS = 3 * 3600_000;

export interface TabSnapshot {
  id: number;
  active: boolean;
  audible: boolean;
  /** Chrome's own "last became active in its window", epoch ms. */
  lastAccessed: number | undefined;
  pinned?: boolean;
  /** In a tab group. */
  grouped?: boolean;
}

export interface WindowSnapshot {
  id: number;
  type: string;
  focused: boolean;
  incognito: boolean;
  tabs: TabSnapshot[];
}

/** In-session last-use records (activation or deliberate navigation), keyed by tab ID. */
export type LastUseRecords = Record<number, number>;

export interface SweepPlan {
  /** Tabs to close: unselected before selected, then oldest last use first. */
  close: number[];
  kept: { recent: number; audible: number; focused: number; pinned: number; grouped: number };
}

/** Most recent local SWEEP_HOUR:00 at or before `now`. */
function latestSweepTime(now: number): number {
  const d = new Date(now);
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate(), SWEEP_HOUR).getTime();
  if (today <= now) return today;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, SWEEP_HOUR).getTime();
}

export function isSweepDue(now: number, lastSweepAt: number | undefined): boolean {
  if (lastSweepAt === undefined) return true;
  return lastSweepAt < latestSweepTime(now);
}

export function lastUse(tab: TabSnapshot, records: LastUseRecords): number {
  return Math.max(tab.lastAccessed ?? 0, records[tab.id] ?? 0);
}

export function planSweep(
  windows: WindowSnapshot[],
  records: LastUseRecords,
  now: number,
  guardMs: number = RECENT_USE_GUARD_MS,
): SweepPlan {
  const plan: SweepPlan = { close: [], kept: { recent: 0, audible: 0, focused: 0, pinned: 0, grouped: 0 } };
  const closing: TabSnapshot[] = [];
  for (const win of windows) {
    if (win.type !== "normal" || win.incognito) continue;
    for (const tab of win.tabs) {
      if (win.focused && tab.active) plan.kept.focused++;
      else if (tab.audible) plan.kept.audible++;
      else if (tab.pinned) plan.kept.pinned++;
      else if (tab.grouped) plan.kept.grouped++;
      else if (now - lastUse(tab, records) <= guardMs) plan.kept.recent++;
      else closing.push(tab);
    }
  }
  // Selected tabs last: closing a window's selected tab makes Chrome select (and stamp
  // lastAccessed on) a neighbour, which would then look used (feasibility run, 2026-11-18).
  // Otherwise oldest first.
  closing.sort((a, b) => Number(a.active) - Number(b.active) || lastUse(a, records) - lastUse(b, records));
  plan.close = closing.map((t) => t.id);
  return plan;
}

/** The browser operations a sweep needs. Two adapters: Chrome (chrome-browser.ts) and the test fake. */
export interface Browser {
  windows(): Promise<WindowSnapshot[]>;
  lastUseRecords(): Promise<LastUseRecords>;
  /** Opens a background New Tab page in the window. */
  createPlaceholder(windowId: number): Promise<void>;
  /** Closes one tab; "gone" when it no longer existed. */
  closeTab(tabId: number): Promise<"closed" | "gone">;
}

/** What a sweep did, as counts only — never URLs or titles. */
export interface SweepReceipt {
  at: number;
  dryRun: boolean;
  wouldClose: number;
  closed: number;
  /** Planned for closing but closed by someone else first. */
  gone: number;
  /** Planned for closing but used, focused or audible again before its turn. */
  spared: number;
  placeholders: number;
  /** Switched off mid-run: the remaining planned closes were skipped. */
  stopped: boolean;
  kept: SweepPlan["kept"];
  errors: string[];
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runSweep(
  browser: Browser,
  now: number,
  options: { dryRun?: boolean; guardMs?: number; stopped?: () => Promise<boolean> } = {},
): Promise<SweepReceipt> {
  const dryRun = options.dryRun ?? false;
  const guardMs = options.guardMs ?? RECENT_USE_GUARD_MS;
  const plan = planSweep(await browser.windows(), await browser.lastUseRecords(), now, guardMs);
  const receipt: SweepReceipt = {
    at: now,
    dryRun,
    wouldClose: plan.close.length,
    closed: 0,
    gone: 0,
    spared: 0,
    placeholders: 0,
    stopped: false,
    kept: plan.kept,
    errors: [],
  };
  if (dryRun) return receipt;

  // Closes that errored may still be pending (a leave-site prompt answered later closes the
  // tab), so those tabs never count as a window's survivor.
  const pending = new Set<number>();
  const stillClosable = async (tabId: number) => {
    const windows = await browser.windows();
    const win = windows.find((w) => w.tabs.some((t) => t.id === tabId));
    if (!win) return "gone" as const;
    const closable = planSweep(windows, await browser.lastUseRecords(), now, guardMs).close.includes(tabId);
    return closable ? win : ("spared" as const);
  };

  for (const tabId of plan.close) {
    // A close can wait seconds on a leave-site prompt; switching the sweep off meanwhile stops it.
    if (await options.stopped?.()) {
      receipt.stopped = true;
      break;
    }
    // Recheck against current state right before each close: earlier closes can take seconds
    // (a leave-site prompt), and the tab may have been used, focused or started playing since.
    let check = await stillClosable(tabId);
    if (check === "gone" || check === "spared") {
      receipt[check]++;
      continue;
    }
    // Never close a window: before removing its last surviving tab, open a placeholder. If that
    // fails, the tab stays. Creating it takes time, so check the tab once more afterwards.
    if (check.tabs.every((t) => t.id === tabId || pending.has(t.id))) {
      try {
        await browser.createPlaceholder(check.id);
        receipt.placeholders++;
      } catch (e) {
        receipt.errors.push(message(e));
        continue;
      }
      check = await stillClosable(tabId);
      if (check === "gone" || check === "spared") {
        receipt[check]++;
        continue;
      }
    }
    try {
      receipt[(await browser.closeTab(tabId)) === "closed" ? "closed" : "gone"]++;
    } catch (e) {
      pending.add(tabId);
      receipt.errors.push(message(e));
    }
  }
  return receipt;
}
