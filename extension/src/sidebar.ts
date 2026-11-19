// Sidebar: native bookmarks (read-only) above the tabs of the window it sits in, as one flat
// list of rows with a single keyboard focus. Vocabulary: GLOSSARY.md (Sidebar, Folding).
//
// Two halves behind one interface: pure row building and keyboard handling, and a session
// (openSidebar) that keeps those rows current from browser events and runs commands through
// the SidebarBrowser seam. Rendering lives in panel.ts; Chrome lives in sidebar-chrome.ts.

export type Section = "bookmarks" | "tabs";

/** A node of the native bookmark tree, as chrome.bookmarks.getTree returns it. */
export interface BookmarkNode {
  id: string;
  title: string;
  url?: string;
  children?: BookmarkNode[];
  folderType?: string;
}

/** One tab instance of the Sidebar's window, in tab-strip order. */
export interface TabInfo {
  id: number;
  title: string;
  url: string;
  active: boolean;
  audible: boolean;
}

/** Expanded bookmark folders and folded sections, remembered per profile. */
export interface Folding {
  expanded: string[];
  folded: Section[];
}
export const NO_FOLDING: Folding = { expanded: [], folded: [] };

export type Row =
  | { kind: "section"; key: string; section: Section; label: string; open: boolean; count?: number }
  | { kind: "folder"; key: string; id: string; title: string; depth: number; open: boolean; count: number; parent?: string }
  | { kind: "bookmark"; key: string; id: string; title: string; url: string; depth: number; parent?: string }
  | { kind: "tab"; key: string; id: number; title: string; url: string; active: boolean; audible: boolean }
  | { kind: "newtab"; key: string };

export type Command =
  | { type: "foldSection"; section: Section; open: boolean }
  | { type: "toggleFolder"; id: string; open: boolean }
  | { type: "openBookmark"; url: string }
  | { type: "selectTab"; id: number }
  | { type: "closeTab"; id: number }
  | { type: "newTab" };

/** What a key press does: move focus (a row key), run a command, both, or nothing. */
export interface KeyResult {
  focus?: string;
  command?: Command;
}

// --- Rows. ----------------------------------------------------------------------------------
const SECTION_LABEL: Record<Section, string> = { bookmarks: "Bookmarks", tabs: "Tabs" };

/** The bookmarks bar's children inline, then other non-empty roots (never mobile) as folders. */
function bookmarkRoots(tree: BookmarkNode[]): BookmarkNode[] {
  const top = tree[0]?.children ?? [];
  const bar = top.find((n) => n.folderType === "bookmarks-bar");
  const rest = top.filter((n) => n !== bar && n.folderType !== "mobile" && (n.children?.length ?? 0) > 0);
  return [...(bar?.children ?? []), ...rest];
}

function bookmarkRows(nodes: BookmarkNode[], depth: number, expanded: Set<string>, parent?: string): Row[] {
  const rows: Row[] = [];
  const within = parent === undefined ? {} : { parent };
  for (const n of nodes) {
    const key = `b:${n.id}`;
    if (n.url !== undefined) {
      rows.push({ kind: "bookmark", key, id: n.id, title: n.title || n.url, url: n.url, depth, ...within });
      continue;
    }
    const children = n.children ?? [];
    const open = expanded.has(n.id);
    rows.push({ kind: "folder", key, id: n.id, title: n.title, depth, open, count: children.length, ...within });
    if (open) rows.push(...bookmarkRows(children, depth + 1, expanded, key));
  }
  return rows;
}

export function sidebarRows(tree: BookmarkNode[], tabs: TabInfo[], folding: Folding): Row[] {
  const folded = new Set(folding.folded);
  const head = (section: Section, count?: number): Row => ({
    kind: "section",
    key: `s:${section}`,
    section,
    label: SECTION_LABEL[section],
    open: !folded.has(section),
    ...(count !== undefined && { count }),
  });
  const rows: Row[] = [head("bookmarks")];
  if (!folded.has("bookmarks")) rows.push(...bookmarkRows(bookmarkRoots(tree), 0, new Set(folding.expanded)));
  rows.push(head("tabs", tabs.length));
  if (!folded.has("tabs")) {
    for (const t of tabs) {
      rows.push({ kind: "tab", key: `t:${t.id}`, id: t.id, title: t.title || t.url || "New Tab", url: t.url, active: t.active, audible: t.audible });
    }
    rows.push({ kind: "newtab", key: "newtab" });
  }
  return rows;
}

// --- Commands and keyboard. -----------------------------------------------------------------
/** What clicking a row, or pressing Enter on it, does. */
export function rowCommand(row: Row): Command {
  switch (row.kind) {
    case "section":
      return { type: "foldSection", section: row.section, open: !row.open };
    case "folder":
      return { type: "toggleFolder", id: row.id, open: !row.open };
    case "bookmark":
      return { type: "openBookmark", url: row.url };
    case "tab":
      return { type: "selectTab", id: row.id };
    case "newtab":
      return { type: "newTab" };
  }
}

/** Tree/listbox keyboard: ↑/↓/Home/End move, →/← open or step in / close or step out,
 *  Enter/Space activate, Delete/Backspace close a tab. */
export function keyResult(rows: Row[], focusKey: string, key: string): KeyResult {
  const i = rows.findIndex((r) => r.key === focusKey);
  const row = rows[i];
  if (!row) return {};
  const at = (j: number) => ({ focus: rows[Math.max(0, Math.min(rows.length - 1, j))]!.key });
  switch (key) {
    case "ArrowDown":
      return at(i + 1);
    case "ArrowUp":
      return at(i - 1);
    case "Home":
      return at(0);
    case "End":
      return at(rows.length - 1);
    case "Enter":
    case " ":
      return { command: rowCommand(row) };
    case "ArrowRight":
      if (row.kind === "section" && !row.open) return { command: rowCommand(row) };
      if (row.kind !== "folder") return {};
      if (!row.open) return { command: rowCommand(row) };
      {
        const child = rows[i + 1];
        const inside = (child?.kind === "folder" || child?.kind === "bookmark") && child.depth > row.depth;
        return inside ? { focus: child.key } : {};
      }
    case "ArrowLeft":
      if ((row.kind === "section" || row.kind === "folder") && row.open) return { command: rowCommand(row) };
      if ((row.kind === "folder" || row.kind === "bookmark") && row.parent !== undefined) return { focus: row.parent };
      return {};
    case "Delete":
    case "Backspace": {
      if (row.kind !== "tab") return {};
      const next = rows[i + 1]?.kind === "tab" ? rows[i + 1] : rows[i - 1]?.kind === "tab" ? rows[i - 1] : rows[i + 1];
      return { ...(next && { focus: next.key }), command: { type: "closeTab", id: row.id } };
    }
    default:
      return {};
  }
}

// --- Session. -------------------------------------------------------------------------------
/** A browser change the Sidebar may need to show. `windowId` undefined: can't tell, re-read. */
export type SidebarEvent =
  | { kind: "bookmarks" }
  | { kind: "tabs"; windowId?: number; changed?: string[] }
  | { kind: "folding"; folding: Folding };

/** The browser operations the Sidebar needs. Two adapters: Chrome (sidebar-chrome.ts) and the test fake. */
export interface SidebarBrowser {
  currentWindowId(): Promise<number>;
  bookmarkTree(): Promise<BookmarkNode[]>;
  tabs(windowId: number): Promise<TabInfo[]>;
  loadFolding(): Promise<Folding | undefined>;
  saveFolding(folding: Folding): Promise<void>;
  subscribe(listener: (event: SidebarEvent) => void): void;
  openBookmark(windowId: number, url: string, background: boolean): Promise<void>;
  selectTab(tabId: number): Promise<void>;
  closeTab(tabId: number): Promise<void>;
  newTab(windowId: number): Promise<void>;
}

export interface Sidebar {
  rows(): Row[];
  /** `background`: open a bookmark without selecting it (⌘/Ctrl-click, middle click). */
  run(command: Command, options?: { background?: boolean }): Promise<void>;
}

/** Tab fields a row shows (the favicon is looked up by URL, so its change matters too). */
const SHOWN_TAB_FIELDS = new Set(["title", "url", "audible", "favIconUrl", "pinned"]);

/** Starts a Sidebar for the current window. `onChange` runs whenever rows() changed. */
export async function openSidebar(browser: SidebarBrowser, onChange: () => void): Promise<Sidebar> {
  const windowId = await browser.currentWindowId();
  let tree: BookmarkNode[] = [];
  let tabs: TabInfo[] = [];
  let folding: Folding = NO_FOLDING;
  let rows: Row[] = [];
  let started = false; // the caller renders once openSidebar resolves; no change calls before
  const rebuild = () => {
    rows = sidebarRows(tree, tabs, folding);
    if (started) onChange();
  };

  // Events can arrive faster than reads finish; only the latest read of each kind is applied.
  const latest = { bookmarks: 0, tabs: 0 };
  async function reread(kind: "bookmarks" | "tabs"): Promise<void> {
    const n = ++latest[kind];
    if (kind === "bookmarks") {
      const t = await browser.bookmarkTree();
      if (n === latest.bookmarks) tree = t;
    } else {
      const t = await browser.tabs(windowId);
      if (n === latest.tabs) tabs = t;
    }
    if (n === latest[kind]) rebuild();
  }

  let foldingFromEvent = false; // a Folding change seen during startup beats the startup read
  browser.subscribe((event) => {
    if (event.kind === "bookmarks") return void reread("bookmarks");
    if (event.kind === "folding") {
      foldingFromEvent = true;
      folding = event.folding;
      return rebuild();
    }
    if (event.windowId !== undefined && event.windowId !== windowId) return;
    if (event.changed && !event.changed.some((f) => SHOWN_TAB_FIELDS.has(f))) return;
    void reread("tabs");
  });

  // Startup reads go through the same freshness check as event-driven ones.
  await Promise.all([
    reread("bookmarks"),
    reread("tabs"),
    browser.loadFolding().then((f) => {
      if (!foldingFromEvent) folding = f ?? NO_FOLDING;
    }),
  ]);
  rows = sidebarRows(tree, tabs, folding);
  started = true;

  /** Fresh tabs of this window, or undefined when `tabId` is no longer one of them. */
  const ownTabs = async (tabId: number) => {
    const current = await browser.tabs(windowId);
    return current.some((t) => t.id === tabId) ? current : undefined;
  };

  const refold = async (next: Folding) => {
    folding = next;
    rebuild();
    await browser.saveFolding(folding);
  };
  const toggled = <T>(list: T[], item: T, on: boolean) => (on ? [...new Set([...list, item])] : list.filter((x) => x !== item));

  return {
    rows: () => rows,
    async run(command, options = {}) {
      switch (command.type) {
        case "foldSection":
          return refold({ ...folding, folded: toggled(folding.folded, command.section, !command.open) });
        case "toggleFolder":
          return refold({ ...folding, expanded: toggled(folding.expanded, command.id, command.open) });
        case "openBookmark":
          return browser.openBookmark(windowId, command.url, options.background ?? false);
        case "selectTab":
          if (await ownTabs(command.id)) await browser.selectTab(command.id);
          return;
        case "closeTab": {
          // Rows can be a moment stale: act only on a tab still in this window. Closing its last
          // tab would close the window (and its name and this panel), so open a New Tab first.
          const current = await ownTabs(command.id);
          if (!current) return;
          if (current.length === 1) await browser.newTab(windowId);
          return browser.closeTab(command.id);
        }
        case "newTab":
          return browser.newTab(windowId);
      }
    },
  };
}
