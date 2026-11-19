import { describe, expect, test } from "vitest";
import {
  NO_FOLDING,
  addPlace,
  dropPlace,
  iconText,
  siteIconUrls,
  keyResult,
  openSidebar,
  rowCommand,
  sidebarRows,
  type BookmarkNode,
  type Folding,
  type Place,
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

  test("bookmark and folder rows know their place; root and managed folders are locked", () => {
    const managed: BookmarkNode = { id: "50", title: "Work", unmodifiable: "managed", children: [link("51", "Intranet")] };
    const rows = sidebarRows(tree({ bar: BAR, other: [link("20", "Recipes")] }), [], folding({ expanded: ["11", "2"] }));
    const at = (key: string) => rows.find((r) => r.key === key)!;
    expect(at("b:10")).toMatchObject({ parentId: "1", index: 0, locked: false });
    expect(at("b:11")).toMatchObject({ parentId: "1", index: 1, locked: false });
    expect(at("b:13")).toMatchObject({ parentId: "11", index: 1, locked: false });
    expect(at("b:15")).toMatchObject({ parentId: "1", index: 2 });
    expect(at("b:2")).toMatchObject({ parentId: "0", index: 1, locked: true });
    expect(at("b:20")).toMatchObject({ parentId: "2", index: 0, locked: false });
    const withManaged = sidebarRows(tree({ bar: [managed] }), [], folding({ expanded: ["50"] }));
    expect(withManaged.find((r) => r.key === "b:50")).toMatchObject({ locked: true });
    expect(withManaged.find((r) => r.key === "b:51")).toMatchObject({ locked: true });
  });

  test("long titles pass through whole (the page truncates); blank titles fall back", () => {
    const long = "A very long title ".repeat(20);
    const rows = sidebarRows(
      tree({ bar: [link("10", long), link("16", "", "https://blank.test/page")] }),
      [tab(1, { title: "", url: "https://untitled.test/x" }), tab(2, { title: "", url: "" })],
      NO_FOLDING,
    );
    expect(rows.find((r) => r.key === "b:10")).toMatchObject({ title: long });
    expect(rows.find((r) => r.key === "b:16")).toMatchObject({ title: "https://blank.test/page", savedTitle: "" });
    expect(rows.find((r) => r.key === "b:10")).toMatchObject({ savedTitle: long });
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
    expect(keyResult(rows, "b:10", "Enter", { meta: true })).toEqual({ command: { type: "openBookmark", url: "https://example.test/10" } });
  });

  test("Delete closes a tab and moves focus to the next one, or back from the last", () => {
    expect(keyResult(rows, "t:2", "Delete")).toEqual({ focus: "t:3", command: { type: "closeTab", id: 2 } });
    expect(keyResult(rows, "t:3", "Backspace")).toEqual({ focus: "t:2", command: { type: "closeTab", id: 3 } });
  });

  test("closing the only tab moves focus to New tab", () => {
    const one = sidebarRows(tree(), [tab(7, { active: true })], NO_FOLDING);
    expect(keyResult(one, "t:7", "Delete")).toEqual({ focus: "newtab", command: { type: "closeTab", id: 7 } });
  });

  test("editing keys on bookmarks and folders: F2 edits, Delete deletes, ⌥↑/⌥↓ move, ⌘Z undoes, Shift+F10 opens the menu", () => {
    // rows: s:bookmarks, b:10, b:11 (open: b:12, b:13), b:15, s:tabs, t:1..3, newtab
    expect(keyResult(rows, "b:12", "F2")).toEqual({ edit: "b:12" });
    expect(keyResult(rows, "b:10", "Delete")).toEqual({ focus: "b:11", command: { type: "removeBookmark", id: "10" } });
    expect(keyResult(rows, "b:11", "Backspace")).toEqual({ focus: "b:15", command: { type: "removeBookmark", id: "11" } });
    expect(keyResult(rows, "b:15", "Delete")).toEqual({ focus: "b:11", command: { type: "removeBookmark", id: "15" } });
    expect(keyResult(rows, "b:13", "Delete")).toEqual({ focus: "b:12", command: { type: "removeBookmark", id: "13" } });
    expect(keyResult(rows, "b:15", "ArrowUp", { alt: true })).toEqual({ command: { type: "moveBookmark", id: "15", to: { parentId: "1", index: 1 } } });
    expect(keyResult(rows, "b:10", "ArrowDown", { alt: true })).toEqual({ command: { type: "moveBookmark", id: "10", to: { parentId: "1", index: 2 } } });
    expect(keyResult(rows, "b:10", "ArrowUp", { alt: true })).toEqual({});
    expect(keyResult(rows, "b:13", "ArrowDown", { alt: true })).toEqual({});
    expect(keyResult(rows, "t:1", "z", { meta: true })).toEqual({ command: { type: "undo" } });
    expect(keyResult(rows, "b:10", "z")).toEqual({});
    expect(keyResult(rows, "b:12", "F10", { shift: true })).toEqual({ menu: "b:12" });
    expect(keyResult(rows, "s:bookmarks", "ContextMenu")).toEqual({ menu: "s:bookmarks" });
  });

  test("locked rows, tabs and headings ignore the editing keys", () => {
    const withOther = sidebarRows(tree({ bar: BAR, other: [link("20", "Recipes")] }), [tab(1)], NO_FOLDING);
    expect(keyResult(withOther, "b:2", "F2")).toEqual({});
    expect(keyResult(withOther, "b:2", "Delete")).toEqual({});
    expect(keyResult(withOther, "b:2", "ArrowUp", { alt: true })).toEqual({});
    expect(keyResult(withOther, "t:1", "F2")).toEqual({});
    expect(keyResult(withOther, "s:tabs", "Delete")).toEqual({});
  });

  test("an unknown focus or key does nothing", () => {
    expect(keyResult(rows, "t:99", "ArrowDown")).toEqual({});
    expect(keyResult(rows, "t:1", "x")).toEqual({});
  });
});

// --- Drop places. --------------------------------------------------------------------------------
describe("dropPlace", () => {
  // Bar: Mail(10) · Everyday(11, open: Chat 12, Deep 13) · Empty(15); Other bookmarks(2): Recipes(20).
  const rows = sidebarRows(tree({ bar: BAR, other: [link("20", "Recipes")] }), [tab(1)], folding({ expanded: ["11"] }));
  const mark = (key: string) => ({ kind: "bookmark" as const, key });

  test("before and after a bookmark: its folder, at or after its position", () => {
    expect(dropPlace(rows, mark("b:15"), "b:12", "before")).toEqual({ parentId: "11", index: 0 });
    expect(dropPlace(rows, mark("b:15"), "b:12", "after")).toEqual({ parentId: "11", index: 1 });
    expect(dropPlace(rows, mark("b:12"), "b:15", "after")).toEqual({ parentId: "1", index: 3 });
  });

  test("into a folder appends; after an open folder lands first inside it", () => {
    expect(dropPlace(rows, mark("b:10"), "b:11", "inside")).toEqual({ parentId: "11", index: 2 });
    expect(dropPlace(rows, mark("b:10"), "b:15", "inside")).toEqual({ parentId: "15", index: 0 });
    expect(dropPlace(rows, mark("b:10"), "b:11", "after")).toEqual({ parentId: "11", index: 0 });
    expect(dropPlace(rows, mark("b:10"), "b:13", "after")).toEqual({ parentId: "11", index: 2 });
  });

  test("onto the Bookmarks heading: first in the bookmarks bar", () => {
    expect(dropPlace(rows, mark("b:15"), "s:bookmarks", "after")).toEqual({ parentId: "1", index: 0 });
  });

  test("a root folder takes drops inside, never beside it, and never moves", () => {
    expect(dropPlace(rows, mark("b:10"), "b:2", "inside")).toEqual({ parentId: "2", index: 1 });
    expect(dropPlace(rows, mark("b:10"), "b:2", "before")).toBeUndefined();
    expect(dropPlace(rows, mark("b:10"), "b:2", "after")).toBeUndefined();
    expect(dropPlace(rows, mark("b:2"), "b:10", "before")).toBeUndefined();
  });

  test("a folder can't go into itself or anything inside it", () => {
    expect(dropPlace(rows, mark("b:11"), "b:11", "inside")).toBeUndefined();
    expect(dropPlace(rows, mark("b:11"), "b:13", "inside")).toBeUndefined();
    expect(dropPlace(rows, mark("b:11"), "b:12", "before")).toBeUndefined();
    expect(dropPlace(rows, mark("b:11"), "b:11", "after")).toBeUndefined();
  });

  test("a drop that leaves the bookmark where it is gives no place", () => {
    expect(dropPlace(rows, mark("b:12"), "b:12", "before")).toBeUndefined();
    expect(dropPlace(rows, mark("b:12"), "b:12", "after")).toBeUndefined();
    expect(dropPlace(rows, mark("b:12"), "b:13", "before")).toBeUndefined();
    expect(dropPlace(rows, mark("b:13"), "b:12", "before")).toEqual({ parentId: "11", index: 0 });
  });

  test("a bookmark is never placed on a bookmark (inside), in Tabs, or from a locked folder", () => {
    expect(dropPlace(rows, mark("b:10"), "b:12", "inside")).toBeUndefined();
    expect(dropPlace(rows, mark("b:10"), "t:1", "before")).toBeUndefined();
    expect(dropPlace(rows, mark("b:10"), "s:tabs", "after")).toBeUndefined();
    const managed = sidebarRows(
      tree({ bar: [link("10", "Mail"), { id: "50", title: "Work", unmodifiable: "managed", children: [link("51", "Intranet")] }] }),
      [],
      folding({ expanded: ["50"] }),
    );
    expect(dropPlace(managed, mark("b:51"), "b:10", "before")).toBeUndefined();
    expect(dropPlace(managed, mark("b:10"), "b:50", "inside")).toBeUndefined();
    expect(dropPlace(managed, mark("b:10"), "b:51", "after")).toBeUndefined();
  });

  test("a Chrome-managed top-level folder takes no drops", () => {
    const managedRoot = [{ id: "0", title: "", children: [
      { id: "1", title: "Bookmarks bar", folderType: "bookmarks-bar", children: [link("10", "Mail")] },
      { id: "4", title: "Managed", folderType: "managed", unmodifiable: "managed", children: [link("41", "Intranet")] },
    ] }];
    const r = sidebarRows(managedRoot, [], NO_FOLDING);
    expect(dropPlace(r, mark("b:10"), "b:4", "inside")).toBeUndefined();
    expect(addPlace(r, "b:4")).toBeUndefined();
  });

  test("a tab lands like a bookmark, without the same-slot rule", () => {
    expect(dropPlace(rows, { kind: "tab", id: 1 }, "b:12", "after")).toEqual({ parentId: "11", index: 1 });
    expect(dropPlace(rows, { kind: "tab", id: 1 }, "b:2", "inside")).toEqual({ parentId: "2", index: 1 });
    expect(dropPlace(rows, { kind: "tab", id: 1 }, "t:1", "after")).toBeUndefined();
  });
});

describe("addPlace (the menu's New folder and Add current tab)", () => {
  const rows = sidebarRows(tree({ bar: BAR, other: [link("20", "Recipes")] }), [tab(1)], folding({ expanded: ["11"] }));
  test("after a bookmark; at the end inside a folder or root folder; first in the bar from the heading", () => {
    expect(addPlace(rows, "b:12")).toEqual({ parentId: "11", index: 1 });
    expect(addPlace(rows, "b:11")).toEqual({ parentId: "11", index: 2 });
    expect(addPlace(rows, "b:2")).toEqual({ parentId: "2", index: 1 });
    expect(addPlace(rows, "s:bookmarks")).toEqual({ parentId: "1", index: 0 });
  });
  test("nowhere from tabs or inside a locked folder", () => {
    expect(addPlace(rows, "t:1")).toBeUndefined();
    expect(addPlace(rows, "s:tabs")).toBeUndefined();
    const managed = sidebarRows(tree({ bar: [{ id: "50", title: "Work", unmodifiable: "managed", children: [link("51", "Intranet")] }] }), [], folding({ expanded: ["50"] }));
    expect(addPlace(managed, "b:50")).toBeUndefined();
    expect(addPlace(managed, "b:51")).toBeUndefined();
  });
});

// --- Session over the SidebarBrowser seam (fake adapter). -------------------------------------
/** Finds a node and where it sits; undefined when it's gone. */
function locate(nodes: BookmarkNode[], id: string): { node: BookmarkNode; siblings: BookmarkNode[]; index: number } | undefined {
  for (const n of nodes) {
    const kids = n.children ?? [];
    const index = kids.findIndex((c) => c.id === id);
    if (index >= 0) return { node: kids[index]!, siblings: kids, index };
    const deeper = locate(kids, id);
    if (deeper) return deeper;
  }
  return undefined;
}
const titlesIn = (b: FakeBrowser, folderId: string) => (locate(b.bookmarks, folderId)?.node.children ?? []).map((n) => n.title);

class FakeBrowser implements SidebarBrowser {
  bookmarks: BookmarkNode[] = structuredClone(tree({ bar: BAR }));
  private nextId = 100;
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
  icons: Record<string, string> | undefined;
  /** Makes the next icon write fail (storage refusing); `failIconWriteNumber` picks a later one. */
  failIconWrite = false;
  failIconWriteNumber = 0;
  private iconWrites = 0;
  failUpdate = false;
  failIconRead = false;
  async loadIcons() {
    if (this.failIconRead) throw new Error("storage unavailable");
    return this.icons && { ...this.icons };
  }
  async saveIcons(changes: Record<string, string | null>) {
    this.iconWrites++;
    if (this.failIconWrite || this.iconWrites === this.failIconWriteNumber) {
      this.failIconWrite = false;
      throw new Error("QUOTA_BYTES quota exceeded");
    }
    const next = { ...this.icons };
    for (const [id, icon] of Object.entries(changes)) {
      if (icon === null) delete next[id];
      else next[id] = icon;
    }
    this.icons = next;
    this.listener?.({ kind: "icons", changes });
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
  // Bookmark writes, with chrome.bookmarks' rules: `index` is a slot in the folder as it is now,
  // and a move within one folder to a later slot lands one earlier (its old slot is gone).
  private found(id: string) {
    const at = locate(this.bookmarks, id);
    if (!at) throw new Error(`Can't find bookmark for id.`);
    return at;
  }
  private changed() {
    this.listener?.({ kind: "bookmarks" });
  }
  async moveBookmark(id: string, to: Place) {
    const from = this.found(id);
    const parent = this.found(to.parentId).node;
    if (locate([from.node], to.parentId) || to.parentId === id) throw new Error("Can't move a folder into itself.");
    if (to.index > parent.children!.length) throw new Error("Index out of bounds.");
    const index = from.siblings === parent.children && to.index > from.index ? to.index - 1 : to.index;
    from.siblings.splice(from.index, 1);
    parent.children!.splice(index, 0, from.node);
    this.calls.push(`move ${id} ${to.parentId}/${to.index}`);
    this.changed();
  }
  async updateBookmark(id: string, changes: { title?: string; url?: string }) {
    await this.slow();
    if (this.failUpdate) {
      this.failUpdate = false;
      throw new Error("Can't update");
    }
    Object.assign(this.found(id).node, changes);
    this.calls.push(`update ${id}`);
    this.changed();
  }
  /** Delay for the next writes (a slow Chrome), to test ordering. */
  writeDelay = 0;
  private async slow() {
    if (this.writeDelay) await new Promise((r) => setTimeout(r, this.writeDelay));
  }
  async removeBookmark(id: string, whole: boolean) {
    await this.slow();
    const at = this.found(id);
    if (!whole && at.node.url === undefined && at.node.children!.length > 0) throw new Error("Can't remove non-empty folder (use recursive to force).");
    at.siblings.splice(at.index, 1);
    this.calls.push(`remove ${id}`);
    this.changed();
    return structuredClone(at.node); // what Chrome had, not what the panel last read
  }
  async createBookmark(at: Place, node: { title: string; url?: string }) {
    const parent = this.found(at.parentId).node;
    if (at.index > parent.children!.length) throw new Error("Index out of bounds.");
    const id = String(this.nextId++);
    parent.children!.splice(at.index, 0, { id, title: node.title, ...(node.url !== undefined ? { url: node.url } : { children: [] }) });
    this.calls.push(`create ${id} in ${at.parentId}/${at.index}`);
    this.changed();
    return id;
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

// --- Bookmark edits and Undo. ---------------------------------------------------------------------
describe("the fake follows chrome.bookmarks' move rule", () => {
  // Matches Chromium's BookmarkModel::Move; the check against real Chrome is the feasibility
  // harness's job (bookmark-editing plan, step 9; pending).
  test("index is a slot in the folder as it is now; moving later skips the old slot", async () => {
    const b = new FakeBrowser();
    await b.moveBookmark("10", { parentId: "1", index: 3 });
    expect(titlesIn(b, "1")).toEqual(["Everyday", "Empty", "Mail"]);
    await b.moveBookmark("15", { parentId: "1", index: 0 });
    expect(titlesIn(b, "1")).toEqual(["Empty", "Everyday", "Mail"]);
    await b.moveBookmark("11", { parentId: "1", index: 2 });
    expect(titlesIn(b, "1")).toEqual(["Empty", "Everyday", "Mail"]);
  });
});

describe("Bookmark edits", () => {
  const open = async (b = new FakeBrowser()) => ({ b, sidebar: await openSidebar(b, () => {}) });

  test("a move goes to Chrome; rows follow its event; Undo puts it back (both directions, across folders)", async () => {
    const { b, sidebar } = await open();
    await sidebar.run({ type: "moveBookmark", id: "10", to: { parentId: "1", index: 3 } });
    await settle();
    expect(keys(sidebar.rows()).slice(0, 4)).toEqual(["s:bookmarks", "b:11", "b:15", "b:10"]);
    expect(sidebar.notice()).toMatchObject({ text: "Moved ‘Mail’", undo: true });
    await sidebar.run({ type: "undo" });
    await settle();
    expect(titlesIn(b, "1")).toEqual(["Mail", "Everyday", "Empty"]);
    await sidebar.run({ type: "moveBookmark", id: "15", to: { parentId: "1", index: 0 } });
    await settle();
    await sidebar.run({ type: "undo" });
    await settle();
    expect(titlesIn(b, "1")).toEqual(["Mail", "Everyday", "Empty"]);
    await sidebar.run({ type: "moveBookmark", id: "12", to: { parentId: "1", index: 1 } });
    await settle();
    expect(titlesIn(b, "11")).toEqual(["Deep"]);
    await sidebar.run({ type: "undo" });
    await settle();
    expect(titlesIn(b, "11")).toEqual(["Chat", "Deep"]);
    expect(titlesIn(b, "1")).toEqual(["Mail", "Everyday", "Empty"]);
  });

  test("an edit changes title and URL; Undo restores both", async () => {
    const { b, sidebar } = await open();
    await sidebar.run({ type: "editBookmark", id: "10", title: "Post", url: "https://post.test/" });
    await settle();
    expect(sidebar.rows().find((r) => r.key === "b:10")).toMatchObject({ title: "Post", url: "https://post.test/" });
    await sidebar.run({ type: "undo" });
    await settle();
    expect(locate(b.bookmarks, "10")!.node).toMatchObject({ title: "Mail", url: "https://example.test/10" });
  });

  test("deleting a folder removes it whole; Undo rebuilds it in order, with new IDs and its folding", async () => {
    const b = new FakeBrowser();
    b.stored = folding({ expanded: ["11", "13"] });
    const sidebar = await openSidebar(b, () => {});
    await sidebar.run({ type: "removeBookmark", id: "11" });
    await settle();
    expect(titlesIn(b, "1")).toEqual(["Mail", "Empty"]);
    expect(sidebar.notice()).toMatchObject({ text: "Deleted ‘Everyday’", undo: true });
    await sidebar.run({ type: "undo" });
    await settle();
    expect(titlesIn(b, "1")).toEqual(["Mail", "Everyday", "Empty"]);
    const everyday = locate(b.bookmarks, "1")!.node.children![1]!;
    expect(everyday.id).not.toBe("11");
    expect(everyday.children!.map((n) => n.title)).toEqual(["Chat", "Deep"]);
    expect(everyday.children![0]).toMatchObject({ url: "https://example.test/12" });
    expect(everyday.children![1]!.children!.map((n) => n.title)).toEqual(["Deeper"]);
    // The rebuilt folders are open again, as they were.
    expect(b.stored!.expanded).toEqual(expect.arrayContaining([everyday.id, everyday.children![1]!.id]));
    expect(keys(sidebar.rows())).toContain(`b:${everyday.children![1]!.children![0]!.id}`);
  });

  test("new folder and added bookmarks return their id; Undo removes them", async () => {
    const { b, sidebar } = await open();
    const folderId = await sidebar.run({ type: "newFolder", at: { parentId: "1", index: 1 }, title: "New folder" });
    await settle();
    expect(titlesIn(b, "1")).toEqual(["Mail", "New folder", "Everyday", "Empty"]);
    expect(typeof folderId).toBe("string");
    await sidebar.run({ type: "undo" });
    await settle();
    expect(titlesIn(b, "1")).toEqual(["Mail", "Everyday", "Empty"]);
    await sidebar.run({ type: "addBookmark", at: { parentId: "15", index: 0 }, title: "Tab 2", url: "https://example.test/t2" });
    await settle();
    expect(titlesIn(b, "15")).toEqual(["Tab 2"]);
  });

  test("Add current tab bookmarks this window's selected tab", async () => {
    const { b, sidebar } = await open();
    b.tabsByWindow.set(1, [tab(1), tab(2, { active: true, title: "Spec", url: "https://spec.test/" })]);
    await sidebar.run({ type: "addCurrentTab", at: { parentId: "11", index: 2 } });
    await settle();
    expect(locate(b.bookmarks, "11")!.node.children![2]).toMatchObject({ title: "Spec", url: "https://spec.test/" });
  });

  test("Undo reverses only the last edit", async () => {
    const { b, sidebar } = await open();
    await sidebar.run({ type: "editBookmark", id: "10", title: "Post", url: "https://example.test/10" });
    await settle();
    await sidebar.run({ type: "moveBookmark", id: "15", to: { parentId: "1", index: 0 } });
    await settle();
    await sidebar.run({ type: "undo" });
    await settle();
    await sidebar.run({ type: "undo" }); // nothing left to undo
    await settle();
    expect(titlesIn(b, "1")).toEqual(["Post", "Everyday", "Empty"]);
  });

  test("an edit of a bookmark removed elsewhere says so instead of throwing, and leaves nothing to undo", async () => {
    const { b, sidebar } = await open();
    await sidebar.run({ type: "moveBookmark", id: "15", to: { parentId: "1", index: 0 } });
    await settle();
    // 12 is removed behind the Sidebar's back (another window, Bookmark Manager, sync).
    const at = locate(b.bookmarks, "12")!;
    at.siblings.splice(at.index, 1);
    await expect(sidebar.run({ type: "editBookmark", id: "12", title: "Gone" })).resolves.toBeUndefined();
    expect(sidebar.notice()).toMatchObject({ text: "Couldn't change it: it changed elsewhere", undo: false });
    await sidebar.run({ type: "undo" });
    await settle();
    expect(titlesIn(b, "1")).toEqual(["Empty", "Mail", "Everyday"]);
  });

  test("Undo of a delete still works when its folder has fewer items by then", async () => {
    const { b, sidebar } = await open();
    await sidebar.run({ type: "removeBookmark", id: "15" }); // Empty, last in the bar (index 2)
    await settle();
    const mail = locate(b.bookmarks, "10")!;
    mail.siblings.splice(mail.index, 1); // the bar shrinks elsewhere
    b.emit({ kind: "bookmarks" });
    await settle();
    await sidebar.run({ type: "undo" });
    await settle();
    expect(titlesIn(b, "1")).toEqual(["Everyday", "Empty"]);
  });

  test("Undo of a new folder never deletes what was put into it since", async () => {
    const { b, sidebar } = await open();
    const id = (await sidebar.run({ type: "newFolder", at: { parentId: "1", index: 0 }, title: "New folder" }))!;
    await settle();
    await b.moveBookmark("10", { parentId: id, index: 0 }); // from another window
    await settle();
    await sidebar.run({ type: "undo" });
    expect(titlesIn(b, id)).toEqual(["Mail"]);
    expect(sidebar.notice()).toMatchObject({ text: "Couldn't undo: it changed elsewhere" });
  });

  test("Undo of a delete restores what Chrome removed, including what the panel hadn't seen yet", async () => {
    const { b, sidebar } = await open();
    locate(b.bookmarks, "15")!.node.children!.push(link("60", "Just synced")); // no event yet
    await sidebar.run({ type: "removeBookmark", id: "15" });
    await settle();
    await sidebar.run({ type: "undo" });
    await settle();
    expect(locate(b.bookmarks, "1")!.node.children![2]!.children!.map((n) => n.title)).toEqual(["Just synced"]);
  });

  test("edits and Undo run in the order given, even while Chrome is slow", async () => {
    const { b, sidebar } = await open();
    const id = (await sidebar.run({ type: "newFolder", at: { parentId: "1", index: 0 }, title: "New folder" }))!;
    await settle();
    b.writeDelay = 5;
    const renaming = sidebar.run({ type: "editBookmark", id, title: "Recipes" });
    const undoing = sidebar.run({ type: "undo" }); // meant for the rename
    await Promise.all([renaming, undoing]);
    await settle();
    expect(titlesIn(b, "1")[0]).toBe("New folder");
  });

  test("Undo of an edit restores only what that edit changed", async () => {
    const { b, sidebar } = await open();
    await sidebar.run({ type: "editBookmark", id: "10", title: "Post", url: "https://example.test/10" });
    await settle();
    locate(b.bookmarks, "10")!.node.url = "https://newer.test/"; // Bookmark Manager, meanwhile
    await sidebar.run({ type: "undo" });
    await settle();
    expect(locate(b.bookmarks, "10")!.node).toMatchObject({ title: "Mail", url: "https://newer.test/" });
  });

  test("Undo of an edit whose field was changed again elsewhere leaves it and says so", async () => {
    const { b, sidebar } = await open();
    await sidebar.run({ type: "editBookmark", id: "10", title: "Post" });
    await settle();
    locate(b.bookmarks, "10")!.node.title = "Letters";
    await sidebar.run({ type: "undo" });
    expect(locate(b.bookmarks, "10")!.node.title).toBe("Letters");
    expect(sidebar.notice()).toMatchObject({ text: "Couldn't undo: it changed elsewhere" });
  });

  test("Undo of something removed elsewhere since says so", async () => {
    const { b, sidebar } = await open();
    await sidebar.run({ type: "editBookmark", id: "10", title: "Post" });
    await settle();
    const at = locate(b.bookmarks, "10")!;
    at.siblings.splice(at.index, 1);
    await sidebar.run({ type: "undo" });
    expect(sidebar.notice()).toMatchObject({ text: "Couldn't undo: it changed elsewhere", undo: false });
  });
});

// --- Bookmark icons and site icons. ---------------------------------------------------------------
describe("iconText and siteIconUrls", () => {
  test("an icon is the first character typed, emoji sequences intact", () => {
    expect(iconText("🍳")).toBe("🍳");
    expect(iconText("  👩‍💻 code")).toBe("👩‍💻");
    expect(iconText("🇩🇪")).toBe("🇩🇪");
    expect(iconText("AB")).toBe("A");
    expect(iconText("   ")).toBeUndefined();
    expect(iconText("")).toBeUndefined();
  });
  test("site icons come from the bookmark's own site; nothing for non-web pages", () => {
    expect(siteIconUrls("https://www.example.com/a/b?x=1#y")).toEqual([
      "https://www.example.com/favicon.ico",
      "https://www.example.com/apple-touch-icon.png",
    ]);
    expect(siteIconUrls("http://localhost:8080/x")).toEqual(["http://localhost:8080/favicon.ico", "http://localhost:8080/apple-touch-icon.png"]);
    expect(siteIconUrls("chrome://settings")).toEqual([]);
    expect(siteIconUrls("file:///tmp/x.html")).toEqual([]);
    expect(siteIconUrls("not a url")).toEqual([]);
  });
});

describe("Bookmark icons", () => {
  test("rows carry the icon chosen for them", () => {
    const rows = sidebarRows(tree({ bar: BAR }), [], folding({ expanded: ["11"] }), { "10": "📬", "11": "⭐" });
    expect(rows.find((r) => r.key === "b:10")).toMatchObject({ icon: "📬" });
    expect(rows.find((r) => r.key === "b:11")).toMatchObject({ icon: "⭐" });
    expect(rows.find((r) => r.key === "b:12")).not.toHaveProperty("icon");
  });

  test("an edit can set an icon alone, or with the title; Undo takes it back", async () => {
    const b = new FakeBrowser();
    const sidebar = await openSidebar(b, () => {});
    await sidebar.run({ type: "editBookmark", id: "10", title: "Mail", icon: "📬" });
    await settle();
    expect(b.icons).toEqual({ "10": "📬" });
    expect(sidebar.rows().find((r) => r.key === "b:10")).toMatchObject({ icon: "📬" });
    expect(sidebar.notice()).toMatchObject({ undo: true });
    await sidebar.run({ type: "editBookmark", id: "11", title: "Daily", icon: "⭐" });
    await settle();
    await sidebar.run({ type: "undo" });
    await settle();
    expect(b.icons).toEqual({ "10": "📬" });
    expect(locate(b.bookmarks, "11")!.node.title).toBe("Everyday");
  });

  test("null removes an icon; Undo puts it back", async () => {
    const b = new FakeBrowser();
    b.icons = { "10": "📬" };
    const sidebar = await openSidebar(b, () => {});
    expect(sidebar.rows().find((r) => r.key === "b:10")).toMatchObject({ icon: "📬" });
    await sidebar.run({ type: "editBookmark", id: "10", title: "Mail", icon: null });
    await settle();
    expect(b.icons).toEqual({});
    await sidebar.run({ type: "undo" });
    await settle();
    expect(b.icons).toEqual({ "10": "📬" });
  });

  test("icons chosen in another window's Sidebar show up", async () => {
    const b = new FakeBrowser();
    const sidebar = await openSidebar(b, () => {});
    b.emit({ kind: "icons", changes: { "15": "🗂️" } });
    await settle();
    expect(sidebar.rows().find((r) => r.key === "b:15")).toMatchObject({ icon: "🗂️" });
  });

  test("Undo of a delete brings the icons back on the recreated bookmarks", async () => {
    const b = new FakeBrowser();
    b.icons = { "11": "⭐", "12": "💬" };
    b.stored = folding({ expanded: ["11"] });
    const sidebar = await openSidebar(b, () => {});
    await sidebar.run({ type: "removeBookmark", id: "11" });
    await settle();
    await sidebar.run({ type: "undo" });
    await settle();
    const everyday = locate(b.bookmarks, "1")!.node.children![1]!;
    expect(b.icons![everyday.id]).toBe("⭐");
    expect(b.icons![everyday.children![0]!.id]).toBe("💬");
    expect(Object.keys(b.icons!)).toHaveLength(2); // the deleted IDs' icons are gone
  });

  test("deleting clears the deleted bookmarks' icons", async () => {
    const b = new FakeBrowser();
    b.icons = { "11": "⭐", "12": "💬", "10": "📬" };
    const sidebar = await openSidebar(b, () => {});
    await sidebar.run({ type: "removeBookmark", id: "11" });
    await settle();
    expect(b.icons).toEqual({ "10": "📬" });
  });

  test("two windows' Sidebars setting different icons at once both keep theirs", async () => {
    const b = new FakeBrowser();
    const one = await openSidebar(b, () => {});
    const two = await openSidebar(b, () => {});
    await Promise.all([
      one.run({ type: "editBookmark", id: "10", title: "Mail", icon: "📬" }),
      two.run({ type: "editBookmark", id: "15", title: "Empty", icon: "🗂️" }),
    ]);
    await settle();
    expect(b.icons).toEqual({ "10": "📬", "15": "🗂️" });
  });

  test("if the icon can't be saved, the title isn't changed either, and the panel says so", async () => {
    const b = new FakeBrowser();
    const sidebar = await openSidebar(b, () => {});
    b.failIconWrite = true;
    await sidebar.run({ type: "editBookmark", id: "10", title: "Post", icon: "📬" });
    await settle();
    expect(locate(b.bookmarks, "10")!.node.title).toBe("Mail");
    expect(b.icons ?? {}).toEqual({});
    expect(sidebar.rows().find((r) => r.key === "b:10")).not.toHaveProperty("icon");
    expect(sidebar.notice()).toMatchObject({ undo: false });
  });

  test("if the title can't be saved, the icon is put back", async () => {
    const b = new FakeBrowser();
    const sidebar = await openSidebar(b, () => {});
    b.failUpdate = true; // after the icon is written
    await sidebar.run({ type: "editBookmark", id: "10", title: "Post", icon: "📬" });
    await settle();
    expect(b.icons ?? {}).toEqual({});
    expect(locate(b.bookmarks, "10")!.node.title).toBe("Mail");
  });

  test("if the title fails and putting the icon back fails too, the panel says so and Undo removes the icon", async () => {
    const b = new FakeBrowser();
    const sidebar = await openSidebar(b, () => {});
    b.failUpdate = true;
    b.failIconWriteNumber = 2; // the rollback
    await sidebar.run({ type: "editBookmark", id: "10", title: "Post", icon: "📬" });
    await settle();
    expect(b.icons).toEqual({ "10": "📬" });
    expect(sidebar.notice()).toMatchObject({ text: "Couldn't save the name or URL; the icon changed", undo: true });
    await sidebar.run({ type: "undo" });
    await settle();
    expect(b.icons).toEqual({});
  });

  test("a delete whose icon cleanup fails still offers Undo", async () => {
    const b = new FakeBrowser();
    b.icons = { "11": "⭐" };
    const sidebar = await openSidebar(b, () => {});
    b.failIconWrite = true; // the cleanup after the delete
    await sidebar.run({ type: "removeBookmark", id: "11" });
    await settle();
    expect(titlesIn(b, "1")).toEqual(["Mail", "Empty"]);
    expect(sidebar.notice()).toMatchObject({ text: "Deleted ‘Everyday’", undo: true });
    await sidebar.run({ type: "undo" });
    await settle();
    expect(titlesIn(b, "1")).toEqual(["Mail", "Everyday", "Empty"]);
  });

  test("an icon removed elsewhere while the panel starts stays removed", async () => {
    const b = new FakeBrowser();
    b.icons = { "10": "📬" };
    let release!: () => void;
    const slowLoad = b.loadIcons.bind(b);
    b.loadIcons = () => new Promise((r) => (release = () => void slowLoad().then(r)));
    const opening = openSidebar(b, () => {});
    await settle();
    b.emit({ kind: "icons", changes: { "10": null } });
    release();
    const sidebar = await opening;
    expect(sidebar.rows().find((r) => r.key === "b:10")).not.toHaveProperty("icon");
  });

  test("Undo of an icon changed again elsewhere leaves it and says so", async () => {
    const b = new FakeBrowser();
    const sidebar = await openSidebar(b, () => {});
    await sidebar.run({ type: "editBookmark", id: "10", title: "Mail", icon: "📬" });
    await settle();
    b.icons = { "10": "✉️" };
    await sidebar.run({ type: "undo" });
    expect(b.icons).toEqual({ "10": "✉️" });
    expect(sidebar.notice()).toMatchObject({ text: "Couldn't undo: it changed elsewhere" });
  });
});
