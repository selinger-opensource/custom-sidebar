import { describe, expect, test } from "vitest";
import {
  NO_FOLDING,
  keyResult,
  openSidebar,
  rowCommand,
  sidebarRows,
  type BookmarkNode,
  type Folding,
  type Row,
  type SidebarBrowser,
  type SidebarEvent,
  type TabInfo,
} from "../extension/src/sidebar";

// --- Synthetic data. ----------------------------------------------------------------------------
const link = (id: string, title: string, url = `https://example.test/${id}`): BookmarkNode => ({ id, title, url });
const folder = (id: string, title: string, children: BookmarkNode[]): BookmarkNode => ({ id, title, children });

function tree(opts: { bar?: BookmarkNode[]; other?: BookmarkNode[]; mobile?: BookmarkNode[] } = {}): BookmarkNode[] {
  return [
    {
      id: "0",
      title: "",
      children: [
        { id: "1", title: "Bookmarks bar", folderType: "bookmarks-bar", children: opts.bar ?? [] },
        { id: "2", title: "Other bookmarks", folderType: "other", children: opts.other ?? [] },
        { id: "3", title: "Mobile bookmarks", folderType: "mobile", children: opts.mobile ?? [] },
      ],
    },
  ];
}

const BAR = [
  link("10", "Mail"),
  folder("11", "Everyday", [link("12", "Chat"), folder("13", "Deep", [link("14", "Deeper")])]),
  folder("15", "Empty", []),
];

const tab = (id: number, over: Partial<TabInfo> = {}): TabInfo => ({
  id,
  title: `Tab ${id}`,
  url: `https://example.test/t${id}`,
  active: false,
  audible: false,
  ...over,
});

const keys = (rows: Row[]) => rows.map((r) => r.key);
const folding = (over: Partial<Folding> = {}): Folding => ({ ...NO_FOLDING, ...over });

// --- Rows. ----------------------------------------------------------------------------------------
describe("sidebarRows", () => {
  test("bookmarks bar inline, then this window's tabs and a New tab row", () => {
    const rows = sidebarRows(tree({ bar: BAR }), [tab(1, { active: true }), tab(2)], NO_FOLDING);
    expect(keys(rows)).toEqual(["s:bookmarks", "b:10", "b:11", "b:15", "s:tabs", "t:1", "t:2", "newtab"]);
    expect(rows.find((r) => r.key === "s:tabs")).toMatchObject({ kind: "section", count: 2, open: true });
    expect(rows.find((r) => r.key === "b:11")).toMatchObject({ kind: "folder", depth: 0, open: false, count: 2 });
  });

  test("Other bookmarks appears as a folder only when it isn't empty", () => {
    expect(keys(sidebarRows(tree({ bar: BAR }), [], NO_FOLDING))).not.toContain("b:2");
    const rows = sidebarRows(tree({ bar: BAR, other: [link("20", "Recipes")] }), [], NO_FOLDING);
    expect(rows.find((r) => r.key === "b:2")).toMatchObject({ kind: "folder", title: "Other bookmarks", depth: 0 });
    expect(keys(rows).indexOf("b:2")).toBe(keys(rows).indexOf("b:15") + 1);
  });

  test("mobile bookmarks are never shown", () => {
    const rows = sidebarRows(tree({ mobile: [link("30", "Phone link")] }), [], NO_FOLDING);
    expect(keys(rows)).toEqual(["s:bookmarks", "s:tabs", "newtab"]);
  });

  test("expanded folders show their children one level deeper", () => {
    const rows = sidebarRows(tree({ bar: BAR }), [], folding({ expanded: ["11", "13"] }));
    expect(keys(rows)).toEqual(["s:bookmarks", "b:10", "b:11", "b:12", "b:13", "b:14", "b:15", "s:tabs", "newtab"]);
    expect(rows.find((r) => r.key === "b:14")).toMatchObject({ depth: 2 });
  });

  test("an empty folder shows a zero count and no children when expanded", () => {
    const rows = sidebarRows(tree({ bar: BAR }), [], folding({ expanded: ["15"] }));
    expect(rows.find((r) => r.key === "b:15")).toMatchObject({ kind: "folder", open: true, count: 0 });
    expect(keys(rows).slice(-3)).toEqual(["b:15", "s:tabs", "newtab"]);
  });

  test("a folded section keeps its heading and hides its rows", () => {
    const rows = sidebarRows(tree({ bar: BAR }), [tab(1)], folding({ folded: ["bookmarks"] }));
    expect(keys(rows)).toEqual(["s:bookmarks", "s:tabs", "t:1", "newtab"]);
    expect(rows[0]).toMatchObject({ open: false });
    const tabsFolded = sidebarRows(tree({ bar: BAR }), [tab(1)], folding({ folded: ["tabs"] }));
    expect(keys(tabsFolded).slice(-1)).toEqual(["s:tabs"]);
    expect(tabsFolded.at(-1)).toMatchObject({ count: 1, open: false });
  });

  test("long titles pass through whole (the page truncates); blank titles fall back", () => {
    const long = "A very long title ".repeat(20);
    const rows = sidebarRows(
      tree({ bar: [link("10", long), link("16", "", "https://blank.test/page")] }),
      [tab(1, { title: "", url: "https://untitled.test/x" }), tab(2, { title: "", url: "" })],
      NO_FOLDING,
    );
    expect(rows.find((r) => r.key === "b:10")).toMatchObject({ title: long });
    expect(rows.find((r) => r.key === "b:16")).toMatchObject({ title: "https://blank.test/page" });
    expect(rows.find((r) => r.key === "t:1")).toMatchObject({ title: "https://untitled.test/x" });
    expect(rows.find((r) => r.key === "t:2")).toMatchObject({ title: "New Tab" });
  });
});

// --- Commands and keyboard. -------------------------------------------------------------------
describe("rowCommand and keyResult", () => {
  const rows = sidebarRows(
    tree({ bar: BAR }),
    [tab(1), tab(2, { active: true }), tab(3)],
    folding({ expanded: ["11"] }),
  );

  test("activating each kind of row", () => {
    const at = (key: string) => rows.find((r) => r.key === key)!;
    expect(rowCommand(at("s:tabs"))).toEqual({ type: "foldSection", section: "tabs", open: false });
    expect(rowCommand(at("b:11"))).toEqual({ type: "toggleFolder", id: "11", open: false });
    expect(rowCommand(at("b:10"))).toEqual({ type: "openBookmark", url: "https://example.test/10" });
    expect(rowCommand(at("t:3"))).toEqual({ type: "selectTab", id: 3 });
    expect(rowCommand(at("newtab"))).toEqual({ type: "newTab" });
  });

  test("arrows, Home and End move focus and stop at the ends", () => {
    expect(keyResult(rows, "b:10", "ArrowDown")).toEqual({ focus: "b:11" });
    expect(keyResult(rows, "b:10", "ArrowUp")).toEqual({ focus: "s:bookmarks" });
    expect(keyResult(rows, "s:bookmarks", "ArrowUp")).toEqual({ focus: "s:bookmarks" });
    expect(keyResult(rows, "b:10", "End")).toEqual({ focus: "newtab" });
    expect(keyResult(rows, "t:2", "Home")).toEqual({ focus: "s:bookmarks" });
  });

  test("Right opens a folder, then steps into it; Left closes it, then steps out", () => {
    const closed = sidebarRows(tree({ bar: BAR }), [], NO_FOLDING);
    expect(keyResult(closed, "b:11", "ArrowRight")).toEqual({ command: { type: "toggleFolder", id: "11", open: true } });
    expect(keyResult(rows, "b:11", "ArrowRight")).toEqual({ focus: "b:12" });
    expect(keyResult(rows, "b:12", "ArrowLeft")).toEqual({ focus: "b:11" });
    expect(keyResult(rows, "b:11", "ArrowLeft")).toEqual({ command: { type: "toggleFolder", id: "11", open: false } });
    expect(keyResult(rows, "s:tabs", "ArrowLeft")).toEqual({ command: { type: "foldSection", section: "tabs", open: false } });
    expect(keyResult(rows, "b:10", "ArrowLeft")).toEqual({});
  });

  test("Enter and Space activate the focused row", () => {
    expect(keyResult(rows, "t:3", "Enter")).toEqual({ command: { type: "selectTab", id: 3 } });
    expect(keyResult(rows, "b:11", " ")).toEqual({ command: { type: "toggleFolder", id: "11", open: false } });
  });

  test("Delete closes a tab and moves focus to the next one, or back from the last", () => {
    expect(keyResult(rows, "t:2", "Delete")).toEqual({ focus: "t:3", command: { type: "closeTab", id: 2 } });
    expect(keyResult(rows, "t:3", "Backspace")).toEqual({ focus: "t:2", command: { type: "closeTab", id: 3 } });
    expect(keyResult(rows, "b:10", "Delete")).toEqual({});
  });

  test("closing the only tab moves focus to New tab", () => {
    const one = sidebarRows(tree(), [tab(7, { active: true })], NO_FOLDING);
    expect(keyResult(one, "t:7", "Delete")).toEqual({ focus: "newtab", command: { type: "closeTab", id: 7 } });
  });

  test("an unknown focus or key does nothing", () => {
    expect(keyResult(rows, "t:99", "ArrowDown")).toEqual({});
    expect(keyResult(rows, "t:1", "x")).toEqual({});
  });
});

// --- Session over the SidebarBrowser seam (fake adapter). -------------------------------------
class FakeBrowser implements SidebarBrowser {
  bookmarks = tree({ bar: BAR });
  tabsByWindow = new Map<number, TabInfo[]>([
    [1, [tab(1, { active: true }), tab(2)]],
    [2, [tab(5, { active: true })]],
  ]);
  stored: Folding | undefined;
  calls: string[] = [];
  reads = 0;
  private listener: ((e: SidebarEvent) => void) | undefined;

  async currentWindowId() {
    return 1;
  }
  async bookmarkTree() {
    return this.bookmarks;
  }
  async tabs(windowId: number) {
    this.reads++;
    return this.tabsByWindow.get(windowId) ?? [];
  }
  async loadFolding() {
    return this.stored;
  }
  async saveFolding(f: Folding) {
    this.stored = f;
  }
  subscribe(listener: (e: SidebarEvent) => void) {
    this.listener = listener;
  }
  async openBookmark(windowId: number, url: string, background: boolean) {
    this.calls.push(`open ${windowId} ${url}${background ? " background" : ""}`);
  }
  async selectTab(id: number) {
    this.calls.push(`select ${id}`);
  }
  async closeTab(id: number) {
    this.calls.push(`close ${id}`);
  }
  async newTab(windowId: number) {
    this.calls.push(`new ${windowId}`);
  }
  emit(e: SidebarEvent) {
    this.listener!(e);
  }
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("openSidebar", () => {
  test("shows its own window's tabs and acts in its own window", async () => {
    const browser = new FakeBrowser();
    const sidebar = await openSidebar(browser, () => {});
    expect(keys(sidebar.rows()).filter((k) => k.startsWith("t:"))).toEqual(["t:1", "t:2"]);
    await sidebar.run({ type: "openBookmark", url: "https://example.test/10" });
    await sidebar.run({ type: "openBookmark", url: "https://example.test/12" }, { background: true });
    await sidebar.run({ type: "newTab" });
    await sidebar.run({ type: "selectTab", id: 2 });
    await sidebar.run({ type: "closeTab", id: 2 });
    expect(browser.calls).toEqual([
      "open 1 https://example.test/10",
      "open 1 https://example.test/12 background",
      "new 1",
      "select 2",
      "close 2",
    ]);
  });

  test("tab events from another window are ignored; this window's re-read and re-render", async () => {
    const browser = new FakeBrowser();
    let renders = 0;
    await openSidebar(browser, () => renders++);
    const before = browser.reads;
    browser.emit({ kind: "tabs", windowId: 2 });
    await settle();
    expect([browser.reads - before, renders]).toEqual([0, 0]);
    browser.tabsByWindow.get(1)!.push(tab(3));
    browser.emit({ kind: "tabs", windowId: 1 });
    await settle();
    expect(browser.reads - before).toBe(1);
    expect(renders).toBe(1);
  });

  test("a tab update re-renders only when something shown changed", async () => {
    const browser = new FakeBrowser();
    let renders = 0;
    await openSidebar(browser, () => renders++);
    browser.emit({ kind: "tabs", windowId: 1, changed: ["status"] });
    browser.emit({ kind: "tabs", windowId: 1, changed: ["discarded", "lastAccessed"] });
    await settle();
    expect(renders).toBe(0);
    browser.emit({ kind: "tabs", windowId: 1, changed: ["status", "title"] });
    await settle();
    expect(renders).toBe(1);
  });

  test("bookmark events re-read the tree, whichever window caused them", async () => {
    const browser = new FakeBrowser();
    const sidebar = await openSidebar(browser, () => {});
    browser.bookmarks = tree({ bar: [link("40", "Fresh")] });
    browser.emit({ kind: "bookmarks" });
    await settle();
    expect(keys(sidebar.rows())).toContain("b:40");
  });

  test("folding is remembered: restored on open, saved on change", async () => {
    const browser = new FakeBrowser();
    browser.stored = folding({ expanded: ["11"], folded: ["tabs"] });
    const sidebar = await openSidebar(browser, () => {});
    expect(keys(sidebar.rows())).toEqual(["s:bookmarks", "b:10", "b:11", "b:12", "b:13", "b:15", "s:tabs"]);
    await sidebar.run({ type: "toggleFolder", id: "11", open: false });
    await sidebar.run({ type: "foldSection", section: "tabs", open: true });
    expect(browser.stored).toEqual(folding({ expanded: [], folded: [] }));
  });

  test("folding changed by another window's Sidebar is picked up", async () => {
    const browser = new FakeBrowser();
    const sidebar = await openSidebar(browser, () => {});
    browser.emit({ kind: "folding", folding: folding({ expanded: ["11"] }) });
    await settle();
    expect(keys(sidebar.rows())).toContain("b:12");
  });

  test("closing the window's only tab opens a New Tab first, so the window stays", async () => {
    const browser = new FakeBrowser();
    browser.tabsByWindow.set(1, [tab(1, { active: true })]);
    const sidebar = await openSidebar(browser, () => {});
    await sidebar.run({ type: "closeTab", id: 1 });
    expect(browser.calls).toEqual(["new 1", "close 1"]);
  });

  test("a tab that moved to another window is neither selected nor closed from this one", async () => {
    const browser = new FakeBrowser();
    const sidebar = await openSidebar(browser, () => {});
    browser.tabsByWindow.set(1, [tab(1, { active: true })]);
    browser.tabsByWindow.get(2)!.push(tab(2));
    await sidebar.run({ type: "selectTab", id: 2 });
    await sidebar.run({ type: "closeTab", id: 2 });
    expect(browser.calls).toEqual([]);
  });

  test("events during startup aren't overwritten by the startup reads", async () => {
    const browser = new FakeBrowser();
    let releaseFolding!: () => void;
    browser.stored = folding({ expanded: ["13"] });
    const slowLoad = browser.loadFolding.bind(browser);
    browser.loadFolding = () => new Promise((r) => (releaseFolding = () => void slowLoad().then(r)));
    const opening = openSidebar(browser, () => {});
    await settle();
    browser.tabsByWindow.get(1)!.push(tab(3));
    browser.emit({ kind: "tabs", windowId: 1 });
    browser.emit({ kind: "folding", folding: folding({ expanded: ["11"] }) });
    await settle();
    releaseFolding();
    const sidebar = await opening;
    expect(keys(sidebar.rows())).toContain("t:3");
    expect(keys(sidebar.rows())).toContain("b:12");
  });

  test("a fresh profile starts with every folder closed and both sections open", async () => {
    const sidebar = await openSidebar(new FakeBrowser(), () => {});
    expect(keys(sidebar.rows())).toEqual(["s:bookmarks", "b:10", "b:11", "b:15", "s:tabs", "t:1", "t:2", "newtab"]);
  });
});
