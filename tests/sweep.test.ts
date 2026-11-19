import { describe, expect, test } from "vitest";
import {
  RECENT_USE_GUARD_MS,
  isSweepDue,
  planSweep,
  runSweep,
  type Browser,
  type LastUseRecords,
  type TabSnapshot,
  type WindowSnapshot,
} from "../extension/src/sweep";

// Tests run with TZ=Europe/Berlin (see package.json), so local times below are Berlin times.
const local = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).getTime();
const HOUR = 3600_000;

describe("isSweepDue", () => {
  const yesterdaySweep = local(2026, 11, 17, 3, 5);

  test("not due before 03:00 when yesterday's sweep ran", () => {
    expect(isSweepDue(local(2026, 11, 18, 2, 59), yesterdaySweep)).toBe(false);
  });

  test("due at exactly 03:00", () => {
    expect(isSweepDue(local(2026, 11, 18, 3, 0), yesterdaySweep)).toBe(true);
  });

  test("not due again once today's sweep ran", () => {
    expect(isSweepDue(local(2026, 11, 18, 9, 0), local(2026, 11, 18, 3, 1))).toBe(false);
  });

  test("due on first wake at 08:00 when the Mac slept through 03:00", () => {
    expect(isSweepDue(local(2026, 11, 18, 8, 0), yesterdaySweep)).toBe(true);
  });

  test("due after several days without Chrome running", () => {
    expect(isSweepDue(local(2026, 11, 21, 10, 0), yesterdaySweep)).toBe(true);
  });

  test("due when no sweep was ever recorded", () => {
    expect(isSweepDue(local(2026, 11, 18, 12, 0), undefined)).toBe(true);
  });

  test("not due when the clock moved backwards past the last sweep", () => {
    expect(isSweepDue(local(2026, 11, 18, 4, 0), local(2026, 11, 18, 6, 0))).toBe(false);
  });

  test("spring-forward day: 03:00 still triggers", () => {
    // 2026-03-29: Berlin clocks jump from 02:00 to 03:00.
    const lastSweep = local(2026, 3, 28, 3, 0);
    expect(isSweepDue(local(2026, 3, 29, 3, 0) - 60_000, lastSweep)).toBe(false);
    expect(isSweepDue(local(2026, 3, 29, 3, 0), lastSweep)).toBe(true);
  });

  test("fall-back day: one sweep, at 03:00 after the repeated hour", () => {
    // 2026-10-25: Berlin clocks fall back from 03:00 to 02:00.
    const lastSweep = local(2026, 10, 24, 3, 0);
    const threeAm = local(2026, 10, 25, 3, 0);
    expect(isSweepDue(threeAm - 60_000, lastSweep)).toBe(false);
    expect(isSweepDue(threeAm, lastSweep)).toBe(true);
    expect(isSweepDue(threeAm + HOUR, threeAm)).toBe(false);
  });
});

describe("planSweep", () => {
  const now = local(2026, 11, 18, 3, 0);
  let nextId = 1;
  const tab = (over: Partial<TabSnapshot> = {}): TabSnapshot => ({
    id: nextId++,
    active: false,
    audible: false,
    lastAccessed: now - 10 * HOUR,
    ...over,
  });
  const win = (tabs: TabSnapshot[], over: Partial<WindowSnapshot> = {}): WindowSnapshot => ({
    id: nextId++,
    type: "normal",
    focused: false,
    incognito: false,
    tabs,
    ...over,
  });

  test("guard boundary: just inside 3 h is kept, just outside is closed", () => {
    const inside = tab({ lastAccessed: now - RECENT_USE_GUARD_MS + 1 });
    const outside = tab({ lastAccessed: now - RECENT_USE_GUARD_MS - 1 });
    const plan = planSweep([win([inside, outside])], {}, now);
    expect(plan.close).toEqual([outside.id]);
    expect(plan.kept.recent).toBe(1);
  });

  test("last use is the later of lastAccessed and the in-session record", () => {
    const navigatedRecently = tab({ lastAccessed: now - 10 * HOUR });
    const recordOlder = tab({ lastAccessed: now - HOUR });
    const plan = planSweep(
      [win([navigatedRecently, recordOlder, tab({ lastAccessed: now - 10 * HOUR })])],
      { [navigatedRecently.id]: now - HOUR, [recordOlder.id]: now - 10 * HOUR },
      now,
    );
    expect(plan.close).not.toContain(navigatedRecently.id);
    expect(plan.close).not.toContain(recordOlder.id);
    expect(plan.close).toHaveLength(1);
  });

  test("a tab with no known use at all is closed", () => {
    const restored = tab({ lastAccessed: undefined });
    const keep = tab({ lastAccessed: now - HOUR });
    expect(planSweep([win([restored, keep])], {}, now).close).toEqual([restored.id]);
  });

  test("audible tabs survive", () => {
    const audible = tab({ audible: true });
    const stale = tab();
    const plan = planSweep([win([audible, stale])], {}, now);
    expect(plan.close).toEqual([stale.id]);
    expect(plan.kept.audible).toBe(1);
  });

  test("only the focused window's selected tab is protected as in use", () => {
    const focusedActive = tab({ active: true });
    const unfocusedActive = tab({ active: true });
    const plan = planSweep(
      [win([focusedActive, tab()], { focused: true }), win([unfocusedActive, tab()])],
      {},
      now,
    );
    expect(plan.close).not.toContain(focusedActive.id);
    expect(plan.close).toContain(unfocusedActive.id);
    expect(plan.kept.focused).toBe(1);
  });

  test("incognito and non-normal windows are ignored", () => {
    const plan = planSweep(
      [win([tab()], { incognito: true }), win([tab()], { type: "popup" })],
      {},
      now,
    );
    expect(plan.close).toEqual([]);
      });

  test("closes unselected tabs before selected ones, then oldest first", () => {
    const selected = tab({ lastAccessed: now - 30 * HOUR, active: true });
    const older = tab({ lastAccessed: now - 20 * HOUR });
    const newer = tab({ lastAccessed: now - 5 * HOUR });
    expect(planSweep([win([selected, newer, older])], {}, now).close).toEqual([older.id, newer.id, selected.id]);
  });
});

describe("runSweep", () => {
  const now = local(2026, 11, 18, 3, 0);
  const stale = now - 10 * HOUR;
  const fresh = now - HOUR;

  /** Deterministic stand-in for Chrome; records every call in order. */
  class FakeBrowser implements Browser {
    calls: string[] = [];
    reads = 0;
    failPlaceholderFor = new Set<number>();
    failClose = new Set<number>();
    /** Closes that stay pending (leave-site prompt): the tab remains and may close later. */
    blockClose = new Set<number>();
    /** Runs during createPlaceholder, to simulate activity while it is pending. */
    duringPlaceholder: (() => void) | undefined;
    /** Runs once the sweep has read its planning state, to simulate activity mid-sweep. */
    afterFirstRead: (() => void) | undefined;
    /** Runs while a tab is being closed (e.g. a slow leave-site prompt). */
    duringClose: ((tabId: number) => void) | undefined;
    nextTabId = 1000;
    constructor(
      public wins: WindowSnapshot[],
      public records: LastUseRecords = {},
    ) {}
    async windows() {
      return structuredClone(this.wins);
    }
    async lastUseRecords() {
      this.reads++;
      const snapshot = { ...this.records };
      if (this.reads === 1) this.afterFirstRead?.();
      return snapshot;
    }
    async createPlaceholder(windowId: number) {
      this.calls.push(`placeholder:${windowId}`);
      this.duringPlaceholder?.();
      if (this.failPlaceholderFor.has(windowId)) throw new Error("create failed");
      this.find(windowId).tabs.push(t(this.nextTabId++, undefined));
    }
    async closeTab(tabId: number) {
      this.calls.push(`close:${tabId}`);
      this.duringClose?.(tabId);
      if (this.failClose.has(tabId)) throw new Error("close failed");
      if (this.blockClose.has(tabId)) throw new Error("close waiting on the page's leave-site prompt");
      const before = this.wins.flatMap((x) => x.tabs).length;
      for (const x of this.wins) {
        const closing = x.tabs.find((tb) => tb.id === tabId);
        x.tabs = x.tabs.filter((tb) => tb.id !== tabId);
        // Like Chrome: closing the selected tab selects a neighbour and stamps its lastAccessed.
        const neighbour = x.tabs[0];
        if (closing?.active && neighbour) Object.assign(neighbour, { active: true, lastAccessed: now + 1 });
      }
      return this.wins.flatMap((x) => x.tabs).length < before ? ("closed" as const) : ("gone" as const);
    }
    find(windowId: number) {
      return this.wins.find((x) => x.id === windowId)!;
    }
    tab(tabId: number) {
      return this.wins.flatMap((x) => x.tabs).find((tb) => tb.id === tabId)!;
    }
  }
  const t = (id: number, lastAccessed: number | undefined, over: Partial<TabSnapshot> = {}): TabSnapshot => ({
    id,
    active: false,
    audible: false,
    lastAccessed,
    ...over,
  });
  const w = (id: number, tabs: TabSnapshot[]): WindowSnapshot => ({
    id,
    type: "normal",
    focused: false,
    incognito: false,
    tabs,
  });

  test("opens a placeholder before closing a window's last tab", async () => {
    const browser = new FakeBrowser([w(1, [t(11, stale - HOUR), t(12, stale)])]);
    const receipt = await runSweep(browser, now);
    expect(browser.calls).toEqual(["close:11", "placeholder:1", "close:12"]);
    expect(browser.find(1).tabs).toHaveLength(1);
    expect(receipt).toMatchObject({ at: now, closed: 2, placeholders: 1, spared: 0, gone: 0, errors: [], dryRun: false });
  });

  test("closes a window's selected tab last, so Chrome's re-selection doesn't spare a neighbour", async () => {
    const browser = new FakeBrowser([w(1, [t(11, stale - HOUR, { active: true }), t(12, stale)])]);
    const receipt = await runSweep(browser, now);
    expect(browser.calls).toEqual(["close:12", "placeholder:1", "close:11"]);
    expect(receipt).toMatchObject({ closed: 2, spared: 0 });
  });

  test("if the placeholder fails, the window keeps its last tab", async () => {
    const browser = new FakeBrowser([w(1, [t(12, stale), t(11, stale - HOUR)])]);
    browser.failPlaceholderFor.add(1);
    const receipt = await runSweep(browser, now);
    expect(browser.calls).toEqual(["close:11", "placeholder:1"]);
    expect(browser.find(1).tabs.map((x) => x.id)).toEqual([12]);
    expect(receipt.closed).toBe(1);
    expect(receipt.errors).toEqual(["create failed"]);
  });

  test("a tab stuck on a leave-site prompt doesn't count as the window's survivor", async () => {
    const browser = new FakeBrowser([w(1, [t(11, stale - HOUR), t(12, stale)])]);
    browser.blockClose.add(11);
    const receipt = await runSweep(browser, now);
    expect(browser.calls).toEqual(["close:11", "placeholder:1", "close:12"]);
    expect(receipt.errors).toHaveLength(1);
  });

  test("a tab used while its placeholder is being created is spared", async () => {
    const browser = new FakeBrowser([w(1, [t(11, stale)])]);
    browser.duringPlaceholder = () => {
      browser.tab(11).audible = true;
    };
    const receipt = await runSweep(browser, now);
    expect(browser.calls).toEqual(["placeholder:1"]);
    expect(receipt).toMatchObject({ closed: 0, spared: 1, placeholders: 1 });
  });

  test("a window emptied by someone else mid-sweep still gets a placeholder", async () => {
    const browser = new FakeBrowser([w(1, [t(11, stale), t(12, fresh)])]);
    browser.afterFirstRead = () => {
      browser.find(1).tabs = browser.find(1).tabs.filter((x) => x.id !== 12);
    };
    await runSweep(browser, now);
    expect(browser.calls).toEqual(["placeholder:1", "close:11"]);
    expect(browser.find(1).tabs).toHaveLength(1);
  });

  test("a tab used between planning and closing is spared", async () => {
    const browser = new FakeBrowser([w(1, [t(11, stale), t(12, stale), t(13, fresh)])]);
    browser.afterFirstRead = () => {
      browser.records[12] = now - 60_000;
    };
    const receipt = await runSweep(browser, now);
    expect(browser.calls).toEqual(["close:11"]);
    expect(receipt.spared).toBe(1);
  });

  test("a tab that starts playing audio during an earlier close is spared", async () => {
    const browser = new FakeBrowser([w(1, [t(11, stale - HOUR), t(12, stale), t(13, fresh)])]);
    browser.duringClose = (id) => {
      if (id === 11) browser.tab(12).audible = true;
    };
    const receipt = await runSweep(browser, now);
    expect(browser.calls).toEqual(["close:11"]);
    expect(receipt.spared).toBe(1);
  });

  test("a tab closed by someone else before its turn counts as gone", async () => {
    const browser = new FakeBrowser([w(1, [t(11, stale), t(12, fresh)])]);
    browser.afterFirstRead = () => {
      browser.find(1).tabs = browser.find(1).tabs.filter((x) => x.id !== 11);
    };
    const receipt = await runSweep(browser, now);
    expect(browser.calls).toEqual([]);
    expect(receipt).toMatchObject({ closed: 0, gone: 1 });
  });

  test("one failed close does not stop the others", async () => {
    const browser = new FakeBrowser([w(1, [t(11, stale - HOUR), t(12, fresh)]), w(2, [t(21, stale), t(22, fresh)])]);
    browser.failClose.add(11);
    const receipt = await runSweep(browser, now);
    expect(browser.calls).toEqual(["close:11", "close:21"]);
    expect(receipt.closed).toBe(1);
    expect(receipt.errors).toEqual(["close failed"]);
  });

  test("in-session records protect tabs Chrome thinks are stale", async () => {
    const browser = new FakeBrowser([w(1, [t(11, stale), t(12, stale)])], { 12: fresh });
    await runSweep(browser, now);
    expect(browser.calls).toEqual(["close:11"]);
  });

  test("dry run plans but changes nothing", async () => {
    const browser = new FakeBrowser([w(1, [t(11, stale), t(12, stale)])]);
    const receipt = await runSweep(browser, now, { dryRun: true });
    expect(browser.calls).toEqual([]);
    expect(receipt).toMatchObject({ closed: 0, wouldClose: 2, placeholders: 0, dryRun: true });
  });

  test("switching the sweep off mid-run stops it before the next close", async () => {
    const browser = new FakeBrowser([w(1, [t(11, stale), t(12, stale), t(13, stale), t(14, fresh)])]);
    let off = false;
    browser.duringClose = () => (off = true);
    const receipt = await runSweep(browser, now, { stopped: async () => off });
    expect(browser.calls).toEqual(["close:11"]);
    expect(receipt).toMatchObject({ closed: 1, wouldClose: 3, stopped: true });
  });

  test("guard override shortens the recent-use window", async () => {
    const browser = new FakeBrowser([w(1, [t(11, now - 2 * 60_000), t(12, now - 30_000)])]);
    await runSweep(browser, now, { guardMs: 60_000 });
    expect(browser.calls).toEqual(["close:11"]);
  });
});
