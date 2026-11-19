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
  /** Set by Chrome on nodes nobody may change (e.g. "managed" for policy bookmarks). */
  unmodifiable?: string;
}

/** One tab instance of the Sidebar's window, in tab-strip order. */
export interface TabInfo {
  id: number;
  title: string;
  url: string;
  active: boolean;
  audible: boolean;
  pinned: boolean;
}

/** Expanded bookmark folders and folded sections, remembered per profile. */
export interface Folding {
  expanded: string[];
  folded: Section[];
}
export const NO_FOLDING: Folding = { expanded: [], folded: [] };

/** Bookmark icons (GLOSSARY.md) by bookmark ID, remembered per profile. */
export type BookmarkIcons = Record<string, string>;
/** Icons to set, or (null) remove, by bookmark ID. Stored one key per bookmark, so two windows
 *  changing different icons at once never overwrite each other. */
export type IconChanges = Record<string, string | null>;

const applyIcons = (icons: BookmarkIcons, changes: IconChanges): BookmarkIcons => {
  const next = { ...icons };
  for (const [id, icon] of Object.entries(changes)) {
    if (icon === null) delete next[id];
    else next[id] = icon;
  }
  return next;
};

/** Folder colours: Chrome's tab-group colours. A folder's Bookmark icon `folder:<colour>` shows
 *  the plain folder icon in that colour. */
export const FOLDER_COLOURS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"] as const;
export type FolderColour = (typeof FOLDER_COLOURS)[number];
export const folderIcon = (colour: FolderColour) => `folder:${colour}`;
/** The colour of a folder-colour icon, or undefined for an emoji (or nothing). */
export function folderColour(icon: string | undefined): FolderColour | undefined {
  const name = icon?.startsWith("folder:") ? icon.slice("folder:".length) : undefined;
  return FOLDER_COLOURS.find((c) => c === name);
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
/** A Bookmark icon from what someone typed or pasted: its first character (an emoji sequence
 *  such as 👩‍💻 or 🇩🇪 counts as one), or undefined when there's nothing. */
export function iconText(input: string): string | undefined {
  for (const { segment } of graphemes.segment(input.trim())) return segment;
  return undefined;
}

/** Where a page's site icon can be fetched from its own site, best first; none for non-web pages. */
export function siteIconUrls(pageUrl: string): string[] {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return [];
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return [];
  return [`${url.origin}/favicon.ico`, `${url.origin}/apple-touch-icon.png`];
}

export type Row =
  /** `tidy` (Tabs only): how many tabs Tidy would close. */
  | { kind: "section"; key: string; section: Section; label: string; open: boolean; count?: number; barId?: string; tidy?: number }
  | ({ kind: "folder"; key: string; id: string; title: string; depth: number; open: boolean; count: number; parent?: string; icon?: string } & Placed)
  | ({ kind: "bookmark"; key: string; id: string; title: string; url: string; depth: number; parent?: string; savedTitle: string; icon?: string } & Placed)
  | { kind: "tab"; key: string; id: number; title: string; url: string; active: boolean; audible: boolean }
  | { kind: "newtab"; key: string };

/** Where a bookmark or folder row sits in Chrome's tree: its parent folder, its position among
 *  that folder's children, and whether a Bookmark edit may touch it (root folders and
 *  Chrome-locked nodes may not). `parent` (above) is the row key focus steps out to. */
export interface Placed {
  parentId: string;
  index: number;
  locked: boolean;
  /** A root folder (Other bookmarks): locked itself, but takes drops inside. */
  root?: true;
}

/** A drop place: insert before the child now at `index` of `parentId` — the coordinates of
 *  chrome.bookmarks.move and create (a move within one folder skips the node's old slot). */
export interface Place {
  parentId: string;
  index: number;
}
export type DragSource = { kind: "bookmark"; key: string } | { kind: "tab"; id: number };
export type DropZone = "before" | "after" | "inside";

export type Command =
  | { type: "foldSection"; section: Section; open: boolean }
  | { type: "toggleFolder"; id: string; open: boolean }
  | { type: "openBookmark"; url: string }
  | { type: "selectTab"; id: number }
  | { type: "closeTab"; id: number }
  | { type: "newTab" }
  // Bookmark edits (GLOSSARY.md), and Undo of the last one.
  | { type: "moveBookmark"; id: string; to: Place }
  /** `icon`: a new Bookmark icon, null to remove it, absent to leave it. */
  | { type: "editBookmark"; id: string; title: string; url?: string; icon?: string | null }
  | { type: "removeBookmark"; id: string }
  | { type: "newFolder"; at: Place; title: string }
  | { type: "addBookmark"; at: Place; title: string; url: string }
  | { type: "addCurrentTab"; at: Place }
  /** Tidy (GLOSSARY.md): close every tab of this window but the selected one and pinned ones. */
  | { type: "closeOtherTabs" }
  | { type: "undo" };

/** What the footer says after a Bookmark edit; `id` changes with every new notice. */
export interface Notice {
  id: number;
  text: string;
  undo: boolean;
}

/** What a key press does: move focus (a row key), run a command, open the inline editor or the
 *  menu on a row, a combination, or nothing. */
export interface KeyResult {
  focus?: string;
  command?: Command;
  edit?: string;
  menu?: string;
}

/** Modifier keys held with a key press; `meta` is ⌘ on a Mac and Ctrl elsewhere. */
export interface KeyMods {
  alt?: boolean;
  meta?: boolean;
  shift?: boolean;
}

// --- Rows. ----------------------------------------------------------------------------------
const SECTION_LABEL: Record<Section, string> = { bookmarks: "Bookmarks", tabs: "Tabs" };

/** A top-level row-to-be: a node with its place in Chrome's tree. */
interface Rooted {
  node: BookmarkNode;
  place: Placed;
}

/** The bookmarks bar's children inline, then other non-empty roots (never mobile) as locked folders. */
function bookmarkRoots(tree: BookmarkNode[]): Rooted[] {
  const root = tree[0];
  const top = root?.children ?? [];
  const bar = top.find((n) => n.folderType === "bookmarks-bar");
  const inBar = (bar?.children ?? []).map((node, index) => ({ node, place: { parentId: bar!.id, index, locked: node.unmodifiable !== undefined } }));
  const rest = top.flatMap((node, index) =>
    node !== bar && node.folderType !== "mobile" && (node.children?.length ?? 0) > 0
      ? [{ node, place: { parentId: root!.id, index, locked: true, ...(node.unmodifiable === undefined && { root: true as const }) } }]
      : [],
  );
  return [...inBar, ...rest];
}

function bookmarkRows(nodes: Rooted[], depth: number, expanded: Set<string>, icons: BookmarkIcons, parent?: string): Row[] {
  const rows: Row[] = [];
  const within = parent === undefined ? {} : { parent };
  for (const { node: n, place: placed } of nodes) {
    const key = `b:${n.id}`;
    const icon = icons[n.id];
    const place = icon === undefined ? placed : { ...placed, icon };
    if (n.url !== undefined) {
      // `title` is what the row shows (the URL when untitled); `savedTitle` is what the editor edits.
      rows.push({ kind: "bookmark", key, id: n.id, title: n.title || n.url, url: n.url, savedTitle: n.title, depth, ...within, ...place });
      continue;
    }
    const children = n.children ?? [];
    const open = expanded.has(n.id);
    rows.push({ kind: "folder", key, id: n.id, title: n.title, depth, open, count: children.length, ...within, ...place });
    if (open) {
      // A Chrome-locked folder locks what's inside; a root folder's children are free.
      const lockedHere = n.unmodifiable !== undefined;
      const inside = children.map((node, index) => ({ node, place: { parentId: n.id, index, locked: lockedHere || node.unmodifiable !== undefined } }));
      rows.push(...bookmarkRows(inside, depth + 1, expanded, icons, key));
    }
  }
  return rows;
}

export function sidebarRows(tree: BookmarkNode[], tabs: TabInfo[], folding: Folding, icons: BookmarkIcons = {}): Row[] {
  const folded = new Set(folding.folded);
  const head = (section: Section, count?: number): Extract<Row, { kind: "section" }> => ({
    kind: "section",
    key: `s:${section}`,
    section,
    label: SECTION_LABEL[section],
    open: !folded.has(section),
    ...(count !== undefined && { count }),
  });
  const barId = tree[0]?.children?.find((n) => n.folderType === "bookmarks-bar")?.id;
  const rows: Row[] = [{ ...head("bookmarks"), ...(barId !== undefined && { barId }) }];
  if (!folded.has("bookmarks")) rows.push(...bookmarkRows(bookmarkRoots(tree), 0, new Set(folding.expanded), icons));
  rows.push({ ...head("tabs", tabs.length), tidy: tabs.filter((t) => !t.active && !t.pinned).length });
  if (!folded.has("tabs")) {
    for (const t of tabs) {
      rows.push({ kind: "tab", key: `t:${t.id}`, id: t.id, title: t.title || t.url || "New Tab", url: t.url, active: t.active, audible: t.audible });
    }
    rows.push({ kind: "newtab", key: "newtab" });
  }
  return rows;
}

// --- Drop places. ---------------------------------------------------------------------------
type PlacedRow = Extract<Row, { kind: "folder" | "bookmark" }>;
const isPlaced = (row: Row | undefined): row is PlacedRow => row?.kind === "folder" || row?.kind === "bookmark";

/** Where `source` lands when dropped on row `overKey` in `zone`, or undefined when it can't go
 *  there: into Tabs, beside a root folder, into a locked folder, a folder into itself or below
 *  it, a locked source, or a move that leaves it where it is. */
export function dropPlace(rows: Row[], source: DragSource, overKey: string, zone: DropZone): Place | undefined {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const target = byKey.get(overKey);
  let from: PlacedRow | undefined;
  if (source.kind === "bookmark") {
    const r = byKey.get(source.key);
    if (!isPlaced(r) || r.locked) return undefined;
    from = r;
    for (let k: string | undefined = overKey; k !== undefined; k = (byKey.get(k) as PlacedRow | undefined)?.parent) {
      if (k === source.key) return undefined; // onto itself, or somewhere inside it
    }
  }

  let place: Place | undefined;
  if (target?.kind === "section") {
    place = target.section === "bookmarks" && target.barId !== undefined ? { parentId: target.barId, index: 0 } : undefined;
  } else if (isPlaced(target)) {
    const takesDrops = target.kind === "folder" && (!target.locked || target.root === true);
    if (zone === "inside") place = takesDrops && target.kind === "folder" ? { parentId: target.id, index: target.count } : undefined;
    else if (target.locked) place = zone === "after" && takesDrops && target.kind === "folder" && target.open ? { parentId: target.id, index: 0 } : undefined;
    else if (zone === "before") place = { parentId: target.parentId, index: target.index };
    else if (target.kind === "folder" && target.open) place = { parentId: target.id, index: 0 };
    else place = { parentId: target.parentId, index: target.index + 1 };
  }
  if (place && from && from.parentId === place.parentId && (place.index === from.index || place.index === from.index + 1)) return undefined;
  return place;
}

/** Where the row menu's New folder and Add current tab put the new node: after a bookmark,
 *  at the end inside a folder, first in the bookmarks bar from the Bookmarks heading. */
export function addPlace(rows: Row[], key: string): Place | undefined {
  const row = rows.find((r) => r.key === key);
  if (row?.kind === "section") return row.section === "bookmarks" && row.barId !== undefined ? { parentId: row.barId, index: 0 } : undefined;
  if (!isPlaced(row)) return undefined;
  if (row.kind === "folder") return !row.locked || row.root ? { parentId: row.id, index: row.count } : undefined;
  return row.locked ? undefined : { parentId: row.parentId, index: row.index + 1 };
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

/** Bookmark-edit keys on an unlocked bookmark or folder: F2 edit, Delete/Backspace delete (focus
 *  to a sibling, else the parent), ⌥↑/⌥↓ move one slot within its folder. */
function editKey(rows: Row[], row: PlacedRow, key: string, mods: KeyMods): KeyResult | undefined {
  if (row.locked) return undefined;
  const siblings = rows.filter((r): r is PlacedRow => isPlaced(r) && r.parentId === row.parentId && !(r.kind === "folder" && r.root));
  const pos = siblings.indexOf(row);
  if (mods.alt && key === "ArrowUp") return pos > 0 ? { command: { type: "moveBookmark", id: row.id, to: { parentId: row.parentId, index: row.index - 1 } } } : {};
  if (mods.alt && key === "ArrowDown")
    return pos < siblings.length - 1 ? { command: { type: "moveBookmark", id: row.id, to: { parentId: row.parentId, index: row.index + 2 } } } : {};
  if (mods.alt) return undefined;
  if (key === "F2") return { edit: row.key };
  if (key === "Delete" || key === "Backspace") {
    const next = siblings[pos + 1] ?? siblings[pos - 1];
    return { focus: next?.key ?? row.parent ?? "s:bookmarks", command: { type: "removeBookmark", id: row.id } };
  }
  return undefined;
}

/** Tree/listbox keyboard: ↑/↓/Home/End move, →/← open or step in / close or step out,
 *  Enter/Space activate, Delete/Backspace close a tab; on bookmarks also the edit keys (editKey),
 *  ⌘Z/Ctrl+Z undo and Shift+F10 or the menu key for the row's menu. */
export function keyResult(rows: Row[], focusKey: string, key: string, mods: KeyMods = {}): KeyResult {
  const i = rows.findIndex((r) => r.key === focusKey);
  const row = rows[i];
  if (!row) return {};
  if (mods.meta && !mods.shift && !mods.alt && key.toLowerCase() === "z") return { command: { type: "undo" } };
  const inBookmarks = isPlaced(row) || (row.kind === "section" && row.section === "bookmarks");
  if (key === "ContextMenu" || (key === "F10" && mods.shift)) return inBookmarks ? { menu: row.key } : {};
  if (isPlaced(row)) {
    const edit = editKey(rows, row, key, mods);
    if (edit) return edit;
  }
  if (mods.alt) return {}; // ⌘/Ctrl still pass: ⌘↵ opens a bookmark in the background
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
  | { kind: "folding"; folding: Folding }
  /** Bookmark icons set (or, null, removed), by bookmark ID. */
  | { kind: "icons"; changes: IconChanges };

/** The browser operations the Sidebar needs. Two adapters: Chrome (sidebar-chrome.ts) and the test fake. */
export interface SidebarBrowser {
  currentWindowId(): Promise<number>;
  bookmarkTree(): Promise<BookmarkNode[]>;
  tabs(windowId: number): Promise<TabInfo[]>;
  loadFolding(): Promise<Folding | undefined>;
  saveFolding(folding: Folding): Promise<void>;
  loadIcons(): Promise<BookmarkIcons | undefined>;
  saveIcons(changes: IconChanges): Promise<void>;
  subscribe(listener: (event: SidebarEvent) => void): void;
  openBookmark(windowId: number, url: string, background: boolean): Promise<void>;
  selectTab(tabId: number): Promise<void>;
  closeTab(tabId: number): Promise<void>;
  newTab(windowId: number): Promise<void>;
  /** Closes tabs one by one; resolves to the IDs that did close. */
  closeTabs(tabIds: number[]): Promise<number[]>;
  /** Opens tabs again, in the background, at their old positions (ascending `index`), each on its
   *  own; resolves to the ones that couldn't be opened. */
  reopenTabs(windowId: number, tabs: ReopenedTab[]): Promise<ReopenedTab[]>;
  // Bookmark writes, in chrome.bookmarks' coordinates (see Place). All throw if a node is gone.
  moveBookmark(id: string, to: Place): Promise<void>;
  updateBookmark(id: string, changes: BookmarkFields): Promise<void>;
  /** Removes a bookmark or folder and resolves to it as Chrome had it just before. A folder with
   *  anything in it goes only when `whole` (Chrome refuses otherwise). */
  removeBookmark(id: string, whole: boolean): Promise<BookmarkNode>;
  /** A bookmark with `url`, else a folder; resolves to its id. */
  createBookmark(at: Place, node: { title: string; url?: string }): Promise<string>;
}

export interface Sidebar {
  rows(): Row[];
  /** `background`: open a bookmark without selecting it (⌘/Ctrl-click, middle click).
   *  Resolves to the new node's id for newFolder, addBookmark and addCurrentTab. A Bookmark edit
   *  that Chrome refuses (its node changed elsewhere) doesn't throw: it sets the notice. */
  run(command: Command, options?: { background?: boolean }): Promise<string | undefined>;
  /** The latest Bookmark edit notice, if any. */
  notice(): Notice | undefined;
}

/** A bookmark's editable fields; a missing one isn't changed. */
export interface BookmarkFields {
  title?: string;
  url?: string;
}

/** A tab Tidy closed: where it was and what it showed. */
export interface ReopenedTab {
  url: string;
  index: number;
}

/** How to reverse the last Bookmark edit (or Tidy). An edit keeps only the fields it changed, before and after. */
type UndoRecord =
  | { kind: "tabs"; tabs: ReopenedTab[] }
  | { kind: "move"; id: string; from: Place }
  | { kind: "edit"; id: string; before: BookmarkFields; after: BookmarkFields; icon?: { before: string | null; after: string | null } }
  | { kind: "remove"; node: BookmarkNode; at: Place; icons: BookmarkIcons }
  | { kind: "create"; id: string };

/** How many children folder `id` has now; undefined when it's gone. */
function childCount(nodes: BookmarkNode[], id: string): number | undefined {
  for (const n of nodes) {
    if (n.id === id) return n.children?.length;
    const deeper = childCount(n.children ?? [], id);
    if (deeper !== undefined) return deeper;
  }
  return undefined;
}

function locate(nodes: BookmarkNode[], id: string): { node: BookmarkNode; parentId: string; index: number } | undefined {
  for (const n of nodes) {
    const kids = n.children ?? [];
    const index = kids.findIndex((c) => c.id === id);
    if (index >= 0) return { node: kids[index]!, parentId: n.id, index };
    const deeper = locate(kids, id);
    if (deeper) return deeper;
  }
  return undefined;
}

/** Tab fields a row shows (the favicon is looked up by URL, so its change matters too). */
const SHOWN_TAB_FIELDS = new Set(["title", "url", "audible", "favIconUrl", "pinned"]);

/** Starts a Sidebar for the current window. `onChange` runs whenever rows() changed. */
export async function openSidebar(browser: SidebarBrowser, onChange: () => void): Promise<Sidebar> {
  const windowId = await browser.currentWindowId();
  let tree: BookmarkNode[] = [];
  let tabs: TabInfo[] = [];
  let folding: Folding = NO_FOLDING;
  let icons: BookmarkIcons = {};
  let rows: Row[] = [];
  let started = false; // the caller renders once openSidebar resolves; no change calls before
  const rebuild = () => {
    rows = sidebarRows(tree, tabs, folding, icons);
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
  let iconsLoaded = false;
  let iconsSeen: IconChanges = {}; // icon changes seen during startup, removals included
  browser.subscribe((event) => {
    if (event.kind === "bookmarks") return void reread("bookmarks");
    if (event.kind === "icons") {
      if (!iconsLoaded) iconsSeen = { ...iconsSeen, ...event.changes };
      icons = applyIcons(icons, event.changes);
      return rebuild();
    }
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
    browser.loadIcons().then((stored) => {
      icons = applyIcons(stored ?? {}, iconsSeen); // changes seen meanwhile win
      iconsLoaded = true;
    }),
  ]);
  rows = sidebarRows(tree, tabs, folding, icons);
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

  // --- Bookmark edits. Chrome is the only copy: rows follow from its bookmark events. ---------
  let undoRecord: UndoRecord | undefined;
  let notice: Notice | undefined;
  let notices = 0;
  const say = (text: string, undo: boolean) => {
    notice = { id: ++notices, text, undo };
    if (started) onChange();
  };
  const nameOf = (n: BookmarkNode) => n.title || n.url || "bookmark";

  // Edits and Undo run one at a time, in the order given: ⌘Z right after an edit undoes that edit.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const done = queue.then(work, work);
    queue = done.catch(() => {});
    return done;
  };

  /** Runs one Bookmark edit against a fresh read of the tree (the rows may lag Chrome's events);
   *  a refusal (its node changed elsewhere) becomes a notice. */
  type Done = { record: UndoRecord; text: string; id?: string } | undefined; // undefined: nothing to do
  /** An edit that failed half-way and couldn't be rolled back: what Undo can still reverse. */
  class PartialEdit extends Error {
    constructor(readonly record: UndoRecord, readonly text: string) {
      super(text);
    }
  }
  function edit(write: (fresh: BookmarkNode[]) => Promise<Done>): Promise<string | undefined> {
    return serial(() => runEdit(write));
  }
  async function runEdit(write: (fresh: BookmarkNode[]) => Promise<Done>): Promise<string | undefined> {
    try {
      const done = await write(await browser.bookmarkTree());
      if (!done) return undefined;
      undoRecord = done.record;
      say(done.text, true);
      return done.id;
    } catch (error) {
      if (error instanceof PartialEdit) {
        undoRecord = error.record;
        say(error.text, true);
        return undefined;
      }
      undoRecord = undefined;
      say("Couldn't change it: it changed elsewhere", false);
      return undefined;
    }
  }

  /** Sets or (null) removes Bookmark icons; the rows show them once they're stored. */
  async function writeIcons(changes: IconChanges): Promise<void> {
    if (Object.keys(changes).length === 0) return;
    await browser.saveIcons(changes);
    icons = applyIcons(icons, changes);
    rebuild();
  }
  /** Writes the icon first, then the bookmark's fields; if those fail, the icon goes back. */
  async function writeEdit(id: string, fields: BookmarkFields, icon: { now: string | null; was: string | null } | undefined): Promise<void> {
    if (icon) await writeIcons({ [id]: icon.now });
    try {
      if (Object.keys(fields).length > 0) await browser.updateBookmark(id, fields);
    } catch (error) {
      if (!icon) throw error;
      try {
        await writeIcons({ [id]: icon.was });
      } catch {
        // The icon stays changed: say so, and let Undo take it back.
        throw new PartialEdit({ kind: "edit", id, before: {}, after: {}, icon: { before: icon.was, after: icon.now } }, "Couldn't save the name or URL; the icon changed");
      }
      throw error;
    }
  }
  /** Every ID in a subtree. */
  const idsIn = (node: BookmarkNode): string[] => [node.id, ...(node.children ?? []).flatMap(idsIn)];

  /** Recreates a removed subtree depth-first; fills `ids` with old → new ids. */
  async function recreate(node: BookmarkNode, at: Place, ids: Map<string, string>): Promise<void> {
    const id = await browser.createBookmark(at, { title: node.title, ...(node.url !== undefined && { url: node.url }) });
    ids.set(node.id, id);
    if (node.url !== undefined) return;
    for (const [index, child] of (node.children ?? []).entries()) await recreate(child, { parentId: id, index }, ids);
  }

  async function undo(): Promise<void> {
    const record = undoRecord;
    if (!record) return;
    undoRecord = undefined;
    try {
      switch (record.kind) {
        case "move": {
          // Back to its old slot, in Chrome's coordinates for the tree as it is now.
          const fresh = await browser.bookmarkTree();
          const now = locate(fresh, record.id);
          const size = childCount(fresh, record.from.parentId);
          if (!now || size === undefined) throw new Error("gone");
          const later = now.parentId === record.from.parentId && record.from.index > now.index;
          await browser.moveBookmark(record.id, { ...record.from, index: Math.min(record.from.index + (later ? 1 : 0), size) });
          break;
        }
        case "edit": {
          // Only if what this edit wrote is still there: a newer change elsewhere wins.
          const now = locate(await browser.bookmarkTree(), record.id)?.node;
          if (!now || Object.entries(record.after).some(([field, value]) => now[field as keyof BookmarkFields] !== value)) throw new Error("changed");
          if (record.icon && ((await browser.loadIcons()) ?? {})[record.id] !== (record.icon.after ?? undefined)) throw new Error("changed");
          await writeEdit(record.id, record.before, record.icon && { now: record.icon.before, was: record.icon.after });
          break;
        }
        case "remove": {
          // Its folder may have fewer items by now; Chrome refuses an index past the end.
          const parent = record.at.parentId;
          const size = childCount(await browser.bookmarkTree(), parent);
          if (size === undefined) throw new Error("gone");
          const ids = new Map<string, string>();
          await recreate(record.node, { parentId: parent, index: Math.min(record.at.index, size) }, ids);
          const reopened = folding.expanded.flatMap((id) => (ids.has(id) ? [ids.get(id)!] : []));
          if (reopened.length > 0) await refold({ ...folding, expanded: [...folding.expanded, ...reopened] });
          await writeIcons(Object.fromEntries(Object.entries(record.icons).flatMap(([old, icon]) => (ids.has(old) ? [[ids.get(old)!, icon]] : []))));
          break;
        }
        case "create":
          await browser.removeBookmark(record.id, false); // never what was put into it since
          break;
        case "tabs": {
          const failed = await browser.reopenTabs(windowId, record.tabs);
          if (failed.length > 0) return say(`Couldn't reopen ${failed.length} tab${failed.length === 1 ? "" : "s"}`, false);
          break;
        }
      }
      say("Undone", false);
    } catch {
      say("Couldn't undo: it changed elsewhere", false);
    }
  }

  return {
    rows: () => rows,
    notice: () => notice,
    async run(command, options = {}) {
      switch (command.type) {
        case "moveBookmark":
          return edit(async (fresh) => {
            const from = locate(fresh, command.id);
            if (!from) throw new Error("gone");
            await browser.moveBookmark(command.id, command.to);
            return { record: { kind: "move", id: command.id, from: { parentId: from.parentId, index: from.index } }, text: `Moved ‘${nameOf(from.node)}’` };
          });
        case "editBookmark":
          return edit(async (fresh) => {
            const found = locate(fresh, command.id)?.node;
            if (!found) throw new Error("gone");
            const before: BookmarkFields = {};
            const after: BookmarkFields = {};
            if (command.title !== found.title) [before.title, after.title] = [found.title, command.title];
            if (command.url !== undefined && found.url !== undefined && command.url !== found.url) [before.url, after.url] = [found.url, command.url];
            const iconWas = ((await browser.loadIcons()) ?? {})[command.id] ?? null;
            const icon = command.icon !== undefined && command.icon !== iconWas ? { before: iconWas, after: command.icon } : undefined;
            if (Object.keys(after).length === 0 && !icon) return undefined;
            await writeEdit(command.id, after, icon && { now: icon.after, was: icon.before });
            return { record: { kind: "edit", id: command.id, before, after, ...(icon && { icon }) }, text: `Edited ‘${command.title || command.url || "bookmark"}’` };
          });
        case "removeBookmark":
          return edit(async (fresh) => {
            const was = locate(fresh, command.id);
            if (!was) throw new Error("gone");
            const stored = (await browser.loadIcons()) ?? {}; // before: nothing is deleted if this fails
            const node = await browser.removeBookmark(command.id, true); // Chrome's own copy, for Undo
            // The deleted bookmarks' icons leave storage and wait in the Undo record.
            const gone = Object.fromEntries(idsIn(node).flatMap((id) => (stored[id] !== undefined ? [[id, stored[id]!]] : [])));
            await writeIcons(Object.fromEntries(Object.keys(gone).map((id) => [id, null]))).catch(() => {});
            return { record: { kind: "remove", node, at: { parentId: was.parentId, index: was.index }, icons: gone }, text: `Deleted ‘${nameOf(node)}’` };
          });
        case "newFolder":
        case "addBookmark":
        case "addCurrentTab":
          return edit(async () => {
            let node: { title: string; url?: string };
            if (command.type === "newFolder") node = { title: command.title };
            else if (command.type === "addBookmark") node = { title: command.title, url: command.url };
            else {
              const active = (await browser.tabs(windowId)).find((t) => t.active);
              if (!active?.url) throw new Error("no tab");
              node = { title: active.title || active.url, url: active.url };
            }
            const id = await browser.createBookmark(command.at, node);
            return { id, record: { kind: "create", id }, text: `Added ‘${node.title}’` };
          });
        case "closeOtherTabs":
          return serial(async () => {
            const candidates = (await browser.tabs(windowId)).flatMap((t, index) => (t.active || t.pinned ? [] : [{ id: t.id, url: t.url, index }]));
            if (candidates.length === 0) return undefined;
            // Read again right before closing: a tab selected, pinned or moved away meanwhile stays.
            const still = new Set((await browser.tabs(windowId)).filter((t) => !t.active && !t.pinned).map((t) => t.id));
            const closing = candidates.filter((t) => still.has(t.id));
            if (closing.length === 0) return undefined;
            const closed = new Set(await browser.closeTabs(closing.map((t) => t.id)));
            const gone = closing.filter((t) => closed.has(t.id));
            if (gone.length === 0) return void say("Couldn't close the tabs", false);
            undoRecord = { kind: "tabs", tabs: gone.map(({ url, index }) => ({ url, index })) };
            say(`Closed ${gone.length} tab${gone.length === 1 ? "" : "s"}`, true);
            return undefined;
          });
        case "undo":
          return void (await serial(undo));
        case "foldSection":
          return void await refold({ ...folding, folded: toggled(folding.folded, command.section, !command.open) });
        case "toggleFolder":
          return void await refold({ ...folding, expanded: toggled(folding.expanded, command.id, command.open) });
        case "openBookmark":
          return void (await browser.openBookmark(windowId, command.url, options.background ?? false));
        case "selectTab":
          if (await ownTabs(command.id)) await browser.selectTab(command.id);
          return;
        case "closeTab": {
          // Rows can be a moment stale: act only on a tab still in this window. Closing its last
          // tab would close the window (and its name and this panel), so open a New Tab first.
          const current = await ownTabs(command.id);
          if (!current) return;
          if (current.length === 1) await browser.newTab(windowId);
          return void (await browser.closeTab(command.id));
        }
        case "newTab":
          return void (await browser.newTab(windowId));
      }
    },
  };
}
