// Sidebar: native bookmarks (read-only) above the tabs of the window it sits in, grouped as on
// Chrome's tab strip, as one flat list of rows with a single keyboard focus. Vocabulary:
// GLOSSARY.md (Sidebar, Folding, Group header, Loose tab).
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
  /** Its tab group, or NO_GROUP. */
  groupId: number;
  /** Muted by Chrome's tab mute (not a site setting). */
  muted?: boolean;
  /** The Split View it's half of, if any. */
  splitViewId?: number;
}

/** Another normal window, as the tab menu's Move tab to another window lists it: named after its
 *  selected tab, as Chrome's own menu does. */
export interface WindowInfo {
  id: number;
  title: string;
  tabs: number;
}

/** A tab in no group (chrome.tabGroups.TAB_GROUP_ID_NONE). */
export const NO_GROUP = -1;
/** What a tab group without a title is called where a name is needed (a saved folder, a notice). */
export const UNTITLED_GROUP = "Untitled group";

/** One open tab group of the Sidebar's window. Its colours are the folder colours. */
export interface TabGroupInfo {
  id: number;
  title: string;
  colour: FolderColour;
  collapsed: boolean;
}

/** A Loose tab (GLOSSARY.md): in no group and not pinned. */
export const isLoose = (t: TabInfo) => t.groupId === NO_GROUP && !t.pinned;

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
  /** `tidy` (Tabs only): how many tabs Tidy would close. `groups` (Tabs only, when the window has
   *  any): how many group headers, and how many of them are expanded. */
  | { kind: "section"; key: string; section: Section; label: string; open: boolean; count?: number; barId?: string; tidy?: number; groups?: { total: number; open: number }; folders?: { total: number; open: number } }
  | ({ kind: "folder"; key: string; id: string; title: string; depth: number; open: boolean; count: number; parent?: string; icon?: string } & Placed)
  | ({ kind: "bookmark"; key: string; id: string; title: string; url: string; depth: number; parent?: string; savedTitle: string; icon?: string } & Placed)
  /** A Group header (GLOSSARY.md): `open` is Chrome's own expanded state; `selected`: the
   *  window's selected tab is one of its `count` tabs. */
  | { kind: "group"; key: string; id: number; title: string; colour: FolderColour; open: boolean; count: number; selected: boolean }
  /** `group`/`colour`/`parent`: the group it's in, its colour and its header's row key. */
  | { kind: "tab"; key: string; id: number; title: string; url: string; active: boolean; audible: boolean; pinned: boolean; muted: boolean; split: boolean; group?: number; colour?: FolderColour; parent?: string }
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
/** A group header dropped in Bookmarks saves the group there as a folder (saveGroup). */
export type OpenAllWhere = "here" | "group" | "window" | "incognito";
/** Open All asks first from this many bookmarks on (Chromium's kNumBookmarkUrlsBeforePrompting). */
export const OPEN_ALL_ASK_FROM = 15;

/** Open All's bookmarks, as Chromium's GetURLsToOpen: the folder's own bookmarks, not those in
 *  its subfolders, in order; for an incognito window only pages incognito can show. */
export function openAllUrls(tree: BookmarkNode[], folderId: string, incognito = false): string[] {
  const folder = findNode(tree, folderId);
  const urls = (folder?.children ?? []).flatMap((n) => (n.url !== undefined ? [n.url] : []));
  return incognito ? urls.filter(allowedInIncognito) : urls;
}
/** Chrome keeps its own pages (settings, extensions, …) and extension pages out of incognito. */
const allowedInIncognito = (url: string) => !/^(chrome|chrome-extension|chrome-untrusted|javascript):/i.test(url);
/** What a new tab can open: like Chrome, a javascript: bookmark is counted but not opened. */
const openable = (url: string) => !/^javascript:/i.test(url);

/** A group title not yet used by an open group: `title`, else `title (1)`, `(2)`, … as Chromium's
 *  SuggestUniqueTabGroupName (which also sees closed saved groups; extensions can't). */
export function uniqueGroupTitle(title: string, taken: string[]): string {
  const used = new Set(taken);
  if (!used.has(title)) return title;
  for (let i = 1; i < 100; i++) if (!used.has(`${title} (${i})`)) return `${title} (${i})`;
  return `${title} (100)`;
}

function findNode(nodes: BookmarkNode[], id: string): BookmarkNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const deeper = findNode(n.children ?? [], id);
    if (deeper) return deeper;
  }
  return undefined;
}

export type DragSource = { kind: "bookmark"; key: string } | { kind: "tab"; id: number } | { kind: "group"; id: number };
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
  /** A tab group as a new folder at `at`: its title (or UNTITLED_GROUP), its tabs as bookmarks
   *  in tab-strip order, its colour as the folder's Bookmark icon. One Bookmark edit. */
  | { type: "saveGroup"; id: number; at: Place }
  /** A tab's folder in Bookmarks: every tab of this window, in tab-strip order (Bookmark all tabs). */
  | { type: "saveTabs"; at: Place; title: string }
  /** Tidy (GLOSSARY.md): close this window's Loose tabs but the selected one. */
  | { type: "tidy" }
  // The Tab menu (GLOSSARY.md), on one tab of this window.
  /** Right after it on the strip, in its group if it has one; selected. */
  | { type: "newTabBelow"; id: number }
  /** Into the group `groupId`, or a new one (resolves to its id); a pinned tab is unpinned first. */
  | { type: "groupTab"; id: number; groupId?: number }
  | { type: "ungroupTab"; id: number }
  | { type: "moveTabToNewWindow"; id: number }
  | { type: "moveTabToWindow"; id: number; windowId: number }
  | { type: "reloadTab"; id: number }
  | { type: "duplicateTab"; id: number }
  | { type: "pinTab"; id: number; pinned: boolean }
  | { type: "muteTab"; id: number; muted: boolean }
  /** A Split View of the selected tab and this one (moved beside it), or, on the selected tab
   *  itself, of it and a new tab beside it. */
  | { type: "splitTab"; id: number }
  | { type: "unsplitTab"; id: number }
  /** Close other tabs / Close tabs below (GLOSSARY.md), as Chrome's own. */
  /** Open All (GLOSSARY.md) of folder `id`: here, in a new group (resolves to its id), in a new
   *  window, or in a new incognito window. */
  | { type: "openFolder"; id: string; where: OpenAllWhere }
  | { type: "closeOthers"; id: number }
  | { type: "closeBelow"; id: number }
  // Tab groups, through Chrome's own group state: the rows follow from its events.
  | { type: "toggleGroup"; id: number; open: boolean }
  /** Expand every group of the window, or collapse every one. */
  | { type: "foldGroups"; open: boolean }
  /** Expand (every folder that has bookmarks, nested ones too) or collapse all Bookmark folders. */
  | { type: "foldFolders"; open: boolean }
  | { type: "editGroup"; id: number; title: string; colour?: FolderColour }
  | { type: "newTabInGroup"; id: number }
  | { type: "moveGroupToNewWindow"; id: number }
  /** Close group: it stays in Chrome's saved tab groups. Delete group: it leaves them (Undo
   *  reopens it as a new group). Ungroup: its tabs stay, loose, and it leaves them too. */
  | { type: "closeGroup"; id: number }
  | { type: "deleteGroup"; id: number }
  | { type: "ungroup"; id: number }
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

/** Every folder with something inside, at any depth: what "expand all" opens. */
function folderIds(nodes: BookmarkNode[]): string[] {
  return nodes.flatMap((n) => (n.url === undefined && (n.children?.length ?? 0) > 0 ? [n.id, ...folderIds(n.children ?? [])] : []));
}

const tabRow = (t: TabInfo, group?: TabGroupInfo): Row => ({
  kind: "tab",
  key: `t:${t.id}`,
  id: t.id,
  title: t.title || t.url || "New Tab",
  url: t.url,
  active: t.active,
  audible: t.audible,
  pinned: t.pinned,
  muted: t.muted ?? false,
  split: t.splitViewId !== undefined,
  ...(group && { group: group.id, colour: group.colour, parent: `g:${group.id}` }),
});

/** The window's tabs as the tab strip shows them, in its order: a group's tabs (contiguous on the
 *  strip) under their Group header, hidden while it's collapsed; pinned (always first) and Loose
 *  tabs on their own. A tab whose group Chrome hasn't reported yet shows as loose until it does. */
function tabRows(tabs: TabInfo[], groups: TabGroupInfo[]): Row[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const rows: Row[] = [];
  for (let i = 0; i < tabs.length; ) {
    const t = tabs[i]!;
    const group = t.groupId === NO_GROUP ? undefined : byId.get(t.groupId);
    if (!group) {
      rows.push(tabRow(t));
      i++;
      continue;
    }
    let end = i;
    while (end < tabs.length && tabs[end]!.groupId === group.id) end++;
    const members = tabs.slice(i, end);
    const open = !group.collapsed;
    rows.push({ kind: "group", key: `g:${group.id}`, id: group.id, title: group.title, colour: group.colour, open, count: members.length, selected: members.some((m) => m.active) });
    if (open) rows.push(...members.map((m) => tabRow(m, group)));
    i = end;
  }
  return rows;
}

export function sidebarRows(tree: BookmarkNode[], tabs: TabInfo[], folding: Folding, icons: BookmarkIcons = {}, groups: TabGroupInfo[] = []): Row[] {
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
  const roots = bookmarkRoots(tree);
  const folderList = folderIds(roots.map((r) => r.node));
  const expandedNow = new Set(folding.expanded);
  const rows: Row[] = [
    {
      ...head("bookmarks"),
      ...(barId !== undefined && { barId }),
      ...(folderList.length > 0 && { folders: { total: folderList.length, open: folderList.filter((id) => expandedNow.has(id)).length } }),
    },
  ];
  if (!folded.has("bookmarks")) rows.push(...bookmarkRows(roots, 0, expandedNow, icons));
  const strip = tabRows(tabs, groups);
  const headers = strip.filter((r) => r.kind === "group");
  rows.push({
    ...head("tabs", tabs.length),
    tidy: tabs.filter((t) => isLoose(t) && !t.active).length,
    ...(headers.length > 0 && { groups: { total: headers.length, open: headers.filter((r) => r.open).length } }),
  });
  if (!folded.has("tabs")) rows.push(...strip, { kind: "newtab", key: "newtab" });
  return rows;
}

// --- Drop places. ---------------------------------------------------------------------------
type PlacedRow = Extract<Row, { kind: "folder" | "bookmark" }>;
const isPlaced = (row: Row | undefined): row is PlacedRow => row?.kind === "folder" || row?.kind === "bookmark";

/** Where `source` lands when dropped on row `overKey` in `zone`, or undefined when it can't go
 *  there: into Tabs, beside a root folder, into a locked folder, a folder into itself or below
 *  it, a locked source, or a move that leaves it where it is. A tab or group header lands like a
 *  bookmark (as a new bookmark or folder, so without the same-slot rule). */
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
    case "group":
      return { type: "toggleGroup", id: row.id, open: !row.open };
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

/** Tree keyboard: ↑/↓/Home/End move, →/← open or step in / close or step out (a group header
 *  expands or collapses its group), Enter/Space activate, Delete/Backspace close a tab; on
 *  bookmarks also the edit keys (editKey), on a group header F2 to rename it; ⌘Z/Ctrl+Z undo and
 *  Shift+F10 or the menu key for the row's menu. */
export function keyResult(rows: Row[], focusKey: string, key: string, mods: KeyMods = {}): KeyResult {
  const i = rows.findIndex((r) => r.key === focusKey);
  const row = rows[i];
  if (!row) return {};
  if (mods.meta && !mods.shift && !mods.alt && key.toLowerCase() === "z") return { command: { type: "undo" } };
  const hasMenu = isPlaced(row) || row.kind === "group" || row.kind === "tab" || (row.kind === "section" && row.section === "bookmarks");
  if (key === "ContextMenu" || (key === "F10" && mods.shift)) return hasMenu ? { menu: row.key } : {};
  if (isPlaced(row)) {
    const edit = editKey(rows, row, key, mods);
    if (edit) return edit;
  }
  if (row.kind === "group" && key === "F2" && !mods.alt) return { edit: row.key };
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
      if (row.kind === "group") {
        if (!row.open) return { command: rowCommand(row) };
        const child = rows[i + 1];
        return child?.kind === "tab" && child.group === row.id ? { focus: child.key } : {};
      }
      if (row.kind !== "folder") return {};
      if (!row.open) return { command: rowCommand(row) };
      {
        const child = rows[i + 1];
        const inside = (child?.kind === "folder" || child?.kind === "bookmark") && child.depth > row.depth;
        return inside ? { focus: child.key } : {};
      }
    case "ArrowLeft":
      if ((row.kind === "section" || row.kind === "folder" || row.kind === "group") && row.open) return { command: rowCommand(row) };
      if ((row.kind === "folder" || row.kind === "bookmark" || row.kind === "tab") && row.parent !== undefined) return { focus: row.parent };
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

/** Collapsing a group leaves the selected tab in it selected but hidden (Chrome's API allows it;
 *  its tab strip doesn't). So, as the tab strip does: before groups collapse, the tab to select —
 *  the nearest one still shown after the selected tab, else before it — or null when none is
 *  shown (a New Tab then opens), or undefined when the selected tab stays shown. `hidden`: the
 *  groups collapsed once done. */
export function selectionAfterCollapse(tabs: TabInfo[], hidden: Set<number>): number | null | undefined {
  const i = tabs.findIndex((t) => t.active);
  const shown = (t: TabInfo) => !hidden.has(t.groupId);
  if (i < 0 || shown(tabs[i]!)) return undefined;
  const next = tabs.slice(i + 1).find(shown) ?? tabs.slice(0, i).reverse().find(shown);
  return next ? next.id : null;
}

/** Whether splitTab can pair `tab` with the selected tab `active`: neither in a Split View, and
 *  (for another tab) the same pinned and group state, as chrome.tabs.createSplit requires. */
export function canSplitWith(tab: TabInfo, active: TabInfo): boolean {
  if (tab.splitViewId !== undefined || active.splitViewId !== undefined) return false;
  return tab === active || tab.id === active.id || (tab.pinned === active.pinned && tab.groupId === active.groupId);
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
  tabGroups(windowId: number): Promise<TabGroupInfo[]>;
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
   *  own, back into their group (its old one if still open, else one new group per old one, with
   *  its title and colour); resolves to the ones that couldn't be opened. */
  reopenTabs(windowId: number, tabs: ReopenedTab[]): Promise<ReopenedTab[]>;
  // One tab (the Tab menu). All throw if the tab is gone.
  /** A new selected tab at `index`, in group `groupId` if given; resolves to its id. */
  newTabAt(windowId: number, index: number, groupId?: number): Promise<number>;
  /** Into group `groupId`, or a new group; resolves to the group's id. */
  groupTab(tabId: number, groupId?: number): Promise<number>;
  moveTab(tabId: number, windowId: number, index: number): Promise<void>;
  moveTabToNewWindow(tabId: number): Promise<void>;
  reloadTab(tabId: number): Promise<void>;
  duplicateTab(tabId: number): Promise<void>;
  updateTab(tabId: number, changes: { pinned?: boolean; muted?: boolean }): Promise<void>;
  /** Whether this Chrome has Split View for extensions (chrome.tabs.createSplit, Chrome 155). */
  readonly canSplit: boolean;
  /** Two adjacent tabs with the same pinned and group state into a Split View. */
  createSplit(tabIds: [number, number]): Promise<void>;
  unsplit(splitViewId: number): Promise<void>;
  /** The other normal windows of this profile. */
  otherWindows(windowId: number): Promise<WindowInfo[]>;
  // Open All.
  /** Background tabs at the end of the window, in order; resolves to the ones that opened. */
  openTabs(windowId: number, urls: string[]): Promise<number[]>;
  /** One new group of `tabIds`, titled; `colour` if given, else Chrome's own pick. */
  groupTabs(windowId: number, tabIds: number[], title: string, colour?: FolderColour): Promise<number>;
  /** A new focused window with `urls` as its tabs, the first selected; incognito if asked. */
  openWindow(urls: string[], incognito: boolean): Promise<void>;
  /** The titles of every open tab group, in any window. */
  groupTitles(): Promise<string[]>;
  // Tab groups. All throw if the group is gone.
  updateGroup(groupId: number, changes: { title?: string; colour?: FolderColour; collapsed?: boolean }): Promise<void>;
  /** The group into a new window of its own, selected. */
  moveGroupToNewWindow(groupId: number): Promise<void>;
  /** Closes the groups' tabs so that Chrome keeps them in its saved tab groups (closing the tabs
   *  one by one would delete them from there). */
  closeGroups(groupIds: number[]): Promise<void>;
  ungroupTabs(tabIds: number[]): Promise<void>;
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
   *  Resolves to the new node's id for newFolder, addBookmark, addCurrentTab and saveGroup. A Bookmark edit
   *  that Chrome refuses (its node changed elsewhere) doesn't throw: it sets the notice. */
  run(command: Command, options?: { background?: boolean }): Promise<string | undefined>;
  /** The latest Bookmark edit notice, if any. */
  notice(): Notice | undefined;
  /** This window's tabs as last read, collapsed groups' included (for the Tab menu). */
  tabs(): TabInfo[];
  otherWindows(): Promise<WindowInfo[]>;
  readonly canSplit: boolean;
  /** The bookmark tree as last read (for the folder menu's Open All counts). */
  tree(): BookmarkNode[];
}

/** A bookmark's editable fields; a missing one isn't changed. */
export interface BookmarkFields {
  title?: string;
  url?: string;
}

/** A tab Tidy (or another close) closed: where it was, what it showed, and its group if it had one. */
export interface ReopenedTab {
  url: string;
  index: number;
  group?: { id: number; title: string; colour: FolderColour };
}

/** How to reverse the last Bookmark edit (or a close of several tabs: Tidy, Close other tabs,
 *  Close tabs below, Delete group). An edit keeps only the
 *  fields it changed, before and after. A saved group's folder (`folder`) goes whole, but only
 *  while it holds exactly the bookmarks it was made with. */
type UndoRecord =
  | { kind: "tabs"; tabs: ReopenedTab[] }
  | { kind: "move"; id: string; from: Place }
  | { kind: "edit"; id: string; before: BookmarkFields; after: BookmarkFields; icon?: { before: string | null; after: string | null } }
  | { kind: "remove"; node: BookmarkNode; at: Place; icons: BookmarkIcons }
  | { kind: "create"; id: string }
  | { kind: "folder"; id: string; children: string[] };

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
const SHOWN_TAB_FIELDS = new Set(["title", "url", "audible", "favIconUrl", "pinned", "groupId", "mutedInfo", "splitViewId"]);

/** Starts a Sidebar for the current window. `onChange` runs whenever rows() changed. */
export async function openSidebar(browser: SidebarBrowser, onChange: () => void): Promise<Sidebar> {
  const windowId = await browser.currentWindowId();
  let tree: BookmarkNode[] = [];
  let tabs: TabInfo[] = [];
  let groups: TabGroupInfo[] = [];
  let folding: Folding = NO_FOLDING;
  let icons: BookmarkIcons = {};
  let rows: Row[] = [];
  let started = false; // the caller renders once openSidebar resolves; no change calls before
  const rebuild = () => {
    rows = sidebarRows(tree, tabs, folding, icons, groups);
    if (started) onChange();
  };

  /** This window's tabs and tab groups, read together. */
  const strip = () => Promise.all([browser.tabs(windowId), browser.tabGroups(windowId)]);

  // Events can arrive faster than reads finish; only the latest read of each kind is applied.
  // Tabs and groups are one kind: a group event re-reads both.
  const latest = { bookmarks: 0, tabs: 0 };
  async function reread(kind: "bookmarks" | "tabs"): Promise<void> {
    const n = ++latest[kind];
    if (kind === "bookmarks") {
      const t = await browser.bookmarkTree();
      if (n === latest.bookmarks) tree = t;
    } else {
      const [t, g] = await strip();
      if (n === latest.tabs) [tabs, groups] = [t, g];
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
  rows = sidebarRows(tree, tabs, folding, icons, groups);
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
        case "folder": {
          const now = locate(await browser.bookmarkTree(), record.id)?.node;
          const inside = (now?.children ?? []).map((c) => c.id);
          if (!now || inside.length !== record.children.length || inside.some((id) => !record.children.includes(id))) throw new Error("changed");
          await browser.removeBookmark(record.id, true);
          await writeIcons({ [record.id]: null }).catch(() => {}); // an orphan icon is harmless
          break;
        }
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

  // --- Tab groups. Chrome is the only copy: rows follow from its tab and group events. ---------
  /** Collapses (or expands) the given groups that aren't already; before collapsing, moves the
   *  selection out of them as the tab strip does (selectionAfterCollapse). */
  async function setCollapsed(ids: number[], collapsed: boolean): Promise<void> {
    const [now, all] = await strip();
    const changing = all.filter((g) => ids.includes(g.id) && g.collapsed !== collapsed);
    if (changing.length === 0) return;
    if (collapsed) {
      const hidden = new Set([...all.filter((g) => g.collapsed), ...changing].map((g) => g.id));
      const next = selectionAfterCollapse(now, hidden);
      if (next === null) await browser.newTab(windowId);
      else if (next !== undefined) await browser.selectTab(next);
    }
    await Promise.all(changing.map((g) => browser.updateGroup(g.id, { collapsed })));
  }
  /** Closes a group of this window with `close`; when it holds every tab, opens a New Tab first,
   *  so the window (and this panel) stays. */
  async function closingGroup(id: number, close: () => Promise<void>): Promise<void> {
    const now = await browser.tabs(windowId);
    const n = now.filter((t) => t.groupId === id).length;
    if (n === 0) return;
    if (n === now.length) await browser.newTab(windowId);
    await close();
  }

  // --- Folders of tabs, and the Tab menu. ------------------------------------------------------
  /** A new folder at `at` with `tabs` as bookmarks in order (ones with no address yet left out),
   *  and `icon` as its Bookmark icon; one Bookmark edit, whose Undo removes the folder whole. */
  async function saveFolder(at: Place, title: string, tabs: TabInfo[], icon?: string): Promise<Done> {
    const pages = tabs.filter((t) => t.url !== "");
    if (pages.length === 0) throw new Error("gone");
    const id = await browser.createBookmark(at, { title });
    const children: string[] = [];
    try {
      for (const [index, t] of pages.entries()) children.push(await browser.createBookmark({ parentId: id, index }, { title: t.title || t.url, url: t.url }));
    } catch (error) {
      try {
        await browser.removeBookmark(id, true);
      } catch {
        throw new PartialEdit({ kind: "folder", id, children }, `Saved only part of ‘${title}’`);
      }
      throw error;
    }
    const iconed = icon === undefined || (await writeIcons({ [id]: icon }).then(() => true, () => false));
    const n = `${children.length} tab${children.length === 1 ? "" : "s"}`;
    return { id, record: { kind: "folder", id, children }, text: `Saved ‘${title}’, ${n}${iconed ? "" : ", without its colour"}` };
  }

  /** Close other tabs (or, `below`, Close tabs below) as Chrome's tab strip does
   *  (TabStripModel::GetTabsClosedByCommand): every other tab of the window (below it), except
   *  pinned tabs and its Split View partner; grouped tabs too. A group all of whose tabs go is
   *  closed whole and stays in Chrome's saved tab groups, as there; the other tabs close one by
   *  one and Undo reopens them in place, back in their groups. The tab itself stays, so the
   *  window does. */
  async function closeAround(id: number, below: boolean): Promise<undefined> {
    const [now, all] = await strip();
    const i = now.findIndex((t) => t.id === id);
    const me = now[i];
    if (!me) return undefined;
    const closing = new Set(
      now.filter((t, j) => (below ? j > i : j !== i) && !t.pinned && !(me.splitViewId !== undefined && t.splitViewId === me.splitViewId)).map((t) => t.id),
    );
    if (closing.size === 0) return undefined;
    const whole = all.filter((g) => {
      const members = now.filter((t) => t.groupId === g.id);
      return members.length > 0 && members.every((t) => closing.has(t.id));
    });
    const wholeIds = new Set(whole.map((g) => g.id));
    // Positions as Undo will find them: with the whole groups gone, not reopened.
    const staying = now.filter((t) => !wholeIds.has(t.groupId));
    const groupOf = new Map(all.map((g) => [g.id, { id: g.id, title: g.title, colour: g.colour }]));
    const single = staying.flatMap((t, index) => {
      if (!closing.has(t.id)) return [];
      const group = groupOf.get(t.groupId);
      return [{ id: t.id, url: t.url, index, ...(group && { group }) }];
    });
    if (whole.length > 0) await browser.closeGroups(whole.map((g) => g.id));
    const closed = new Set(single.length > 0 ? await browser.closeTabs(single.map((t) => t.id)) : []);
    const gone = single.filter((t) => closed.has(t.id));
    const tabsText = gone.length > 0 ? `Closed ${gone.length} tab${gone.length === 1 ? "" : "s"}` : "";
    const groupsText = whole.length > 0 ? `${whole.length} group${whole.length === 1 ? "" : "s"} to Chrome's saved groups` : "";
    if (gone.length > 0) undoRecord = { kind: "tabs", tabs: gone.map(({ url, index, group }) => ({ url, index, ...(group && { group }) })) };
    if (!tabsText && !groupsText) say("Couldn't close the tabs", false);
    else say(tabsText && groupsText ? `${tabsText}; ${groupsText}` : tabsText || `Closed ${groupsText}`, gone.length > 0);
    return undefined;
  }

  /** splitTab: the selected tab and `id`, which moves beside it first (Chrome's API takes only
   *  adjacent tabs with the same pinned and group state, so other tabs aren't offered); on the
   *  selected tab itself, it and a new tab beside it. */
  async function split(id: number): Promise<void> {
    const now = await ownTabs(id);
    const tab = now?.find((t) => t.id === id);
    const active = now?.find((t) => t.active);
    if (!now || !tab || !active || !canSplitWith(tab, active)) return;
    const at = now.indexOf(active);
    if (tab === active) {
      const fresh = await browser.newTabAt(windowId, at + 1, tab.groupId === NO_GROUP ? undefined : tab.groupId);
      if (tab.pinned) await browser.updateTab(fresh, { pinned: true });
      return void (await browser.createSplit([active.id, fresh]));
    }
    const from = now.indexOf(tab);
    await browser.moveTab(id, windowId, from < at ? at : at + 1);
    await browser.createSplit(from < at ? [id, active.id] : [active.id, id]);
  }

  return {
    rows: () => rows,
    notice: () => notice,
    tabs: () => tabs,
    tree: () => tree,
    otherWindows: () => browser.otherWindows(windowId),
    canSplit: browser.canSplit,
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
        case "saveGroup":
          return edit(async () => {
            const [now, all] = await strip();
            const group = all.find((g) => g.id === command.id);
            if (!group) throw new Error("gone");
            return saveFolder(command.at, group.title || UNTITLED_GROUP, now.filter((t) => t.groupId === command.id), folderIcon(group.colour));
          });
        case "saveTabs":
          return edit(async () => saveFolder(command.at, command.title, await browser.tabs(windowId)));
        case "tidy":
          return serial(async () => {
            const candidates = (await browser.tabs(windowId)).flatMap((t, index) => (isLoose(t) && !t.active ? [{ id: t.id, url: t.url, index }] : []));
            if (candidates.length === 0) return undefined;
            // Read again right before closing: a tab selected, pinned, grouped or moved away meanwhile stays.
            const still = new Set((await browser.tabs(windowId)).filter((t) => isLoose(t) && !t.active).map((t) => t.id));
            const closing = candidates.filter((t) => still.has(t.id));
            if (closing.length === 0) return undefined;
            const closed = new Set(await browser.closeTabs(closing.map((t) => t.id)));
            const gone = closing.filter((t) => closed.has(t.id));
            if (gone.length === 0) return void say("Couldn't close the tabs", false);
            undoRecord = { kind: "tabs", tabs: gone.map(({ url, index }) => ({ url, index })) };
            say(`Closed ${gone.length} tab${gone.length === 1 ? "" : "s"}`, true);
            return undefined;
          });
        case "openFolder": {
          const fresh = await browser.bookmarkTree();
          const urls = openAllUrls(fresh, command.id, command.where === "incognito").filter(openable);
          if (urls.length === 0) return undefined;
          if (command.where === "window" || command.where === "incognito") return void (await browser.openWindow(urls, command.where === "incognito"));
          const opened = await browser.openTabs(windowId, urls);
          if (command.where === "here" || opened.length === 0) return undefined;
          const folder = findNode(fresh, command.id);
          const title = uniqueGroupTitle(folder?.title ?? "", await browser.groupTitles());
          const colour = folderColour(icons[command.id]);
          return String(await browser.groupTabs(windowId, opened, title, colour));
        }
        case "closeOthers":
        case "closeBelow":
          return serial(() => closeAround(command.id, command.type === "closeBelow"));
        case "newTabBelow": {
          const now = await ownTabs(command.id);
          const i = now?.findIndex((t) => t.id === command.id) ?? -1;
          if (!now || i < 0) return;
          const groupId = now[i]!.groupId;
          return void (await browser.newTabAt(windowId, i + 1, groupId === NO_GROUP ? undefined : groupId));
        }
        case "groupTab": {
          const tab = (await ownTabs(command.id))?.find((t) => t.id === command.id);
          if (!tab) return undefined;
          if (tab.pinned) await browser.updateTab(tab.id, { pinned: false }); // as Chrome's menu does: groups hold no pinned tabs
          return String(await browser.groupTab(tab.id, command.groupId));
        }
        case "ungroupTab":
          if (await ownTabs(command.id)) await browser.ungroupTabs([command.id]);
          return;
        case "moveTabToNewWindow":
        case "moveTabToWindow": {
          // Never this window's last tab: moving it would close the window.
          const now = await ownTabs(command.id);
          if (!now || now.length === 1) return;
          if (command.type === "moveTabToNewWindow") return void (await browser.moveTabToNewWindow(command.id));
          return void (await browser.moveTab(command.id, command.windowId, -1));
        }
        case "reloadTab":
        case "duplicateTab":
        case "pinTab":
        case "muteTab": {
          if (!(await ownTabs(command.id))) return;
          if (command.type === "reloadTab") return void (await browser.reloadTab(command.id));
          if (command.type === "duplicateTab") return void (await browser.duplicateTab(command.id));
          return void (await browser.updateTab(command.id, command.type === "pinTab" ? { pinned: command.pinned } : { muted: command.muted }));
        }
        case "splitTab":
          return void (await split(command.id));
        case "unsplitTab": {
          const id = (await ownTabs(command.id))?.find((t) => t.id === command.id)?.splitViewId;
          if (id !== undefined) await browser.unsplit(id);
          return;
        }
        case "toggleGroup":
          return void (await setCollapsed([command.id], !command.open));
        case "foldFolders":
          return void (await refold({ ...folding, expanded: command.open ? folderIds(bookmarkRoots(tree).map((r) => r.node)) : [] }));
        case "foldGroups":
          return void (await setCollapsed((await browser.tabGroups(windowId)).map((g) => g.id), !command.open));
        case "editGroup":
          return void (await browser.updateGroup(command.id, { title: command.title, ...(command.colour && { colour: command.colour }) }));
        case "newTabInGroup": {
          const [now, all] = await strip();
          const last = now.map((t) => t.groupId).lastIndexOf(command.id);
          if (last < 0) return;
          if (all.find((g) => g.id === command.id)?.collapsed) await browser.updateGroup(command.id, { collapsed: false });
          return void (await browser.newTabAt(windowId, last + 1, command.id));
        }
        case "moveGroupToNewWindow": {
          // As on Chrome's tab strip, not a group that is the whole window: that would close it.
          const now = await browser.tabs(windowId);
          const n = now.filter((t) => t.groupId === command.id).length;
          if (n > 0 && n < now.length) await browser.moveGroupToNewWindow(command.id);
          return;
        }
        case "ungroup": {
          const ids = (await browser.tabs(windowId)).filter((t) => t.groupId === command.id).map((t) => t.id);
          if (ids.length > 0) await browser.ungroupTabs(ids);
          return;
        }
        case "closeGroup":
          return void (await closingGroup(command.id, () => browser.closeGroups([command.id])));
        case "deleteGroup":
          return serial(async () => {
            const [now, all] = await strip();
            const group = all.find((g) => g.id === command.id);
            const members = now.flatMap((t, index) => (t.groupId === command.id ? [{ id: t.id, url: t.url, index }] : []));
            if (!group || members.length === 0) return undefined;
            let closed = new Set<number>();
            await closingGroup(command.id, async () => {
              closed = new Set(await browser.closeTabs(members.map((t) => t.id)));
            });
            const gone = members.filter((t) => closed.has(t.id));
            if (gone.length === 0) return void say("Couldn't close the group", false);
            const was = { id: group.id, title: group.title, colour: group.colour };
            undoRecord = { kind: "tabs", tabs: gone.map(({ url, index }) => ({ url, index, group: was })) };
            say(`Deleted group ‘${group.title || UNTITLED_GROUP}’`, true);
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
