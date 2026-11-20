// Side panel page: renders the Sidebar's rows and turns clicks and keys into its commands.
// Rendering only — what rows exist and what a key does live in sidebar.ts.
import { COLOUR_TREATMENT_KEY, EXPAND_ALL_KEY, NEW_BOOKMARKS_KEY, SITE_ICONS_KEY, SITE_MEMORY_PREFIX, colourTreatment, expandAllMode, newBookmarksAt, siteIcons, type ExpandAll, type NewBookmarksAt } from "./settings";
import { FOLDER_COLOURS, NO_GROUP, OPEN_ALL_ASK_FROM, addPlace, canSplitWith, openAllUrls, stripDrop, dropPlace, folderColour, folderIcon, iconText, keyResult, siteIconUrls, openSidebar, rowCommand, sortable, type Command, type DragSource, type FolderColour, type FoldState, type OpenAllWhere, type StripMove, type WindowInfo, type DropZone, type KeyResult, type Place, type Row, type Sidebar } from "./sidebar";
import { chromeSidebar } from "./sidebar-chrome";

const app = document.getElementById("app")!;

// --- Icons: 16 px strokes that sit with Chrome's Material symbols. ---------------------------
const svg = (d: string, size = 16, cls = "") =>
  `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${cls && ` class="${cls}"`}>${d}</svg>`;
const ICON = {
  chev: svg('<path d="M4.5 2.5 8 6l-3.5 3.5"/>', 12, "chev"),
  folder: svg('<path d="M2 4.6c0-.6.5-1.1 1.1-1.1h3l1.4 1.4h5.4c.6 0 1.1.5 1.1 1.1v5.4c0 .6-.5 1.1-1.1 1.1H3.1c-.6 0-1.1-.5-1.1-1.1z"/>'),
  globe: svg('<circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c1.6 1.6 2.3 3.5 2.3 5.5S9.6 11.9 8 13.5C6.4 11.9 5.7 10 5.7 8S6.4 4.1 8 2.5z"/>'),
  close: svg('<path d="M5 5l6 6M11 5l-6 6"/>'),
  plus: svg('<path d="M8 3.5v9M3.5 8h9"/>'),
  // A broom: Tidy.
  tidy: svg('<path d="M13.5 2.5 8.6 7.4"/><path d="M6.6 6.9 9.1 9.4 8.2 13.5H2.5V8.6z"/><path d="M4.4 13.5 5.6 11M6.4 13.5 7.2 11.6"/>'),
  muted: svg('<path d="M3 6.5h2l3-2.5v8L5 9.5H3zM10.5 6.5l3 3M13.5 6.5l-3 3"/>', 14),
  // Two panes: a tab in a Split View.
  split: svg('<rect x="2.5" y="3.5" width="11" height="9" rx="1.5"/><path d="M8 3.5v9"/>', 14),
  audio: svg('<path d="M3 6.5h2l3-2.5v8L5 9.5H3zM10.5 6a2.5 2.5 0 0 1 0 4M12 4.5a4.6 4.6 0 0 1 0 7"/>', 14),
  pin: svg('<path d="M9.5 2.5 13.5 6.5 11 7.5 8.5 10l-.5 2.5L3.5 8 6 7.5 8.5 5zM5.75 10.25 2.5 13.5"/>', 14),
  // Expand all / collapse all groups: chevrons apart, chevrons together.
  unfold: svg('<path d="M5 6l3-3 3 3M5 10l3 3 3-3"/>'),
  fold: svg('<path d="M5 3l3 3 3-3M5 13l3-3 3 3"/>'),
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};
/** Site icons (GLOSSARY.md): Chrome's favicon cache by page URL. A page Chrome hasn't stored an
 *  icon for gets Chrome's default globe; then, if the setting allows, the icon is fetched from
 *  the page's own site (siteFallback below). Our own pages show the extension's icon. */
const OWN_PAGES = chrome.runtime.getURL("");
const cached = (url: string) => chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`);
/** `page`: check this page's cached icon (data-page); `siteOf`: a site icon shown for this page. */
const img = (src: string, page = "", siteOf = "") =>
  `<img class="ico" alt="" src="${esc(src)}"${page && ` data-page="${esc(page)}"`}${siteOf && ` data-site-of="${esc(siteOf)}"`}>`;
const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
};
/** By site (origin): the icon URL found on the site, or null when it has none. */
const siteFound = new Map<string, string | null>();
/** Pages whose cached icon is Chrome's default (`true`) or a real one (`false`), once checked.
 *  Only the former take the site's icon: a page Chrome knows keeps its own (Docs and Sheets
 *  share a site but not an icon). */
const pageDefault = new Map<string, boolean>();
let siteIconsOn = false; // until the stored switch is read
/** `fromSite`: may this row ask the page's site for its icon? Only bookmarks: a tab's site is
 *  open already, and the panel never contacts a site you haven't bookmarked. */
const favicon = (url: string, fromSite = false) => {
  if (url.startsWith(OWN_PAGES)) return img(chrome.runtime.getURL("icons/icon-32.png"));
  if (!/^https?:/.test(url)) return `<span class="ico">${ICON.globe}</span>`;
  if (!siteIconsOn || !fromSite) return img(cached(url));
  const isDefault = pageDefault.get(url);
  const found = isDefault ? siteFound.get(originOf(url)) : undefined;
  return found ? img(found, "", url) : img(cached(url), isDefault === undefined ? url : "");
};

// What site lookups found, remembered across panel opens (storage.local, one key per site): an
// icon for 7 days, "none" for 1 day. Opening the panel then makes no lookups; showing a found icon
// comes from the browser's cache when the site allows caching (most do).
const SITE_MEMORY = SITE_MEMORY_PREFIX;
const DAY = 86_400_000;
interface Remembered {
  url: string | null;
  at: number;
}
async function recallSites(): Promise<void> {
  const now = Date.now();
  const expired: string[] = [];
  for (const [key, value] of Object.entries(await chrome.storage.local.get(null))) {
    if (!key.startsWith(SITE_MEMORY)) continue;
    const origin = key.slice(SITE_MEMORY.length);
    const { url, at } = (value ?? {}) as Partial<Remembered>;
    // Only what a lookup could have found: one of the site's own two icon addresses, or none.
    const valid = (url === null || (typeof url === "string" && siteIconUrls(`${origin}/`).includes(url))) && typeof at === "number";
    if (valid && now - at < (url ? 7 : 1) * DAY) siteFound.set(origin, url);
    else expired.push(key);
  }
  if (expired.length > 0) await chrome.storage.local.remove(expired);
}
function rememberSite(origin: string, url: string | null): void {
  if (url === null && !navigator.onLine) return; // offline isn't "no icon"
  void chrome.storage.local.set({ [SITE_MEMORY + origin]: { url, at: Date.now() } satisfies Remembered }).catch(report);
}
// (Switching site icons off forgets every site: background.ts, so it works with no panel open.)
const forgetSite = (origin: string) => chrome.storage.local.remove(SITE_MEMORY + origin);

/** Tidy on the Tabs heading, when there's something to close; reachable with Tab (deliberately
 *  no key on the heading itself: one stray Delete would close the window's tabs). */
const tidyButton = (n: number) =>
  n > 0 ? `<button class="icon-btn tidy" data-tidy aria-label="Close ${n} ungrouped tab${n === 1 ? "" : "s"}" title="Close ungrouped tabs (${n})">${ICON.tidy}</button>` : "";
/** The Tabs heading's number is what Tidy would close; its tooltip and name say so, with the total. */
const tabsSummary = (tidy: number, total: number) =>
  `${tidy} ungrouped tab${tidy === 1 ? "" : "s"} Tidy would close · ${total} tab${total === 1 ? "" : "s"} in this window`;
/** Expand or collapse every group, beside Tidy, when the window has groups: collapses while any
 *  but the selected tab's group is expanded (and leaves that one open), else expands. */
const groupsButton = (groups: { total: number; open: number; selected?: true } | undefined) => {
  if (!groups) return "";
  const expand = groups.open === 0;
  const label = expand ? "Expand all groups" : groups.selected ? "Collapse other groups" : "Collapse all groups";
  return `<button class="icon-btn tidy" data-groups="${expand ? "expand" : "collapse"}" aria-label="${label}" title="${label}">${expand ? ICON.unfold : ICON.fold}</button>`;
};
/** Expand all (GLOSSARY.md) on the Bookmarks heading: opens the top-level folders (every level,
 *  if so set), or closes every folder. */
const foldersButton = (state: FoldState | undefined) => {
  if (!state) return "";
  const label = state === "collapse" ? "Collapse all folders" : expandAll === "every" ? "Expand all folders" : "Expand top-level folders";
  return `<button class="icon-btn tidy" data-folders="${state}" aria-label="${label}" title="${label}">${state === "expand" ? ICON.unfold : ICON.fold}</button>`;
};
/** Expand all on a folder with subfolders, where its count was: opens its subfolders (every level
 *  below, if so set), or closes every folder below it. Not a Tab stop (Shift+→ / Shift+← on the row). */
const foldButton = (row: Extract<Row, { kind: "folder" }>) => {
  if (!row.fold) return "";
  const title = row.fold === "collapse" ? "Collapse subfolders" : expandAll === "every" ? "Expand all subfolders" : "Expand subfolders";
  return `<button class="icon-btn fold" tabindex="-1" data-fold="${esc(row.id)}" data-state="${row.fold}" aria-label="${esc(`${title} of ${row.title || "folder"}`)}" title="${title}">${row.fold === "expand" ? ICON.unfold : ICON.fold}</button>`;
};
const emoji = (icon: string) => `<span class="emoji" aria-hidden="true">${esc(icon)}</span>`;
const FOLDER_FILLED = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true"><path d="M2 4.6c0-.6.5-1.1 1.1-1.1h3l1.4 1.4h5.4c.6 0 1.1.5 1.1 1.1v5.4c0 .6-.5 1.1-1.1 1.1H3.1c-.6 0-1.1-.5-1.1-1.1z"/></svg>`;
/** A Bookmark icon: a coloured folder (folder:<colour>) or an emoji. */
const iconHtml = (icon: string) => {
  const colour = folderColour(icon);
  return colour ? `<span class="folder-colour" data-colour="${colour}">${FOLDER_FILLED}</span>` : emoji(icon);
};

// --- Rows to HTML. ---------------------------------------------------------------------------
function rowHtml(row: Row): string {
  const draggable = row.kind === "tab" || row.kind === "group" || ((row.kind === "folder" || row.kind === "bookmark") && !row.locked);
  const attrs = `data-key="${esc(row.key)}" tabindex="-1"${draggable ? ' draggable="true"' : ""}`;
  switch (row.kind) {
    case "section": {
      const summary = row.section === "tabs" ? tabsSummary(row.count ?? 0, row.total ?? 0) : undefined;
      const named = summary === undefined ? "" : ` aria-label="${esc(`${row.label}: ${summary}`)}"`;
      return `<div class="section-head${row.section === "tabs" ? " sticky" : ""}" role="button" aria-expanded="${row.open}"${named} ${attrs}>
        ${ICON.chev}<span>${row.label}</span><span class="grow"></span>${foldersButton(row.folders)}${groupsButton(row.groups)}${tidyButton(row.tidy ?? 0)}<span class="count"${summary === undefined ? "" : ` title="${esc(summary)}"`}>${row.count ?? ""}</span></div>`;
    }
    case "group": {
      // A coloured pill, as on Chrome's tab strip; an untitled one shows no name, just its count.
      const name = row.title || "Unnamed group";
      const tabs = `${row.count} tab${row.count === 1 ? "" : "s"}`;
      const hidden = !row.open && row.selected ? '<span class="sel-dot" title="The selected tab is in this group"></span>' : "";
      return `<div class="row group" role="treeitem" aria-level="1" aria-expanded="${row.open}" aria-label="${esc(`${name}, ${tabs}`)}" data-colour="${row.colour}" title="${esc(`${name} · ${tabs}`)}" ${attrs}>
        <span class="label">${esc(row.title)}</span>${hidden}<span class="folder-count">${row.count}</span>${ICON.chev}</div>`;
    }
    case "folder":
      return `<div class="row folder" role="treeitem" aria-level="${row.depth + 1}" aria-expanded="${row.open}" style="--depth:${row.depth}" title="${esc(`${row.title}\n${row.count} item${row.count === 1 ? "" : "s"}`)}" ${attrs}>
        ${ICON.chev}<span class="ico">${row.icon !== undefined ? iconHtml(row.icon) : ICON.folder}</span><span class="label">${esc(row.title)}</span>${foldButton(row)}</div>`;
    case "bookmark":
      return `<div class="row bookmark" role="treeitem" aria-level="${row.depth + 1}" style="--depth:${row.depth}" title="${esc(`${row.title}\n${host(row.url)}`)}" ${attrs}>
        <span class="leaf-pad"></span>${row.icon !== undefined ? `<span class="ico">${iconHtml(row.icon)}</span>` : favicon(row.url, true)}<span class="label">${esc(row.title)}</span></div>`;
    case "tab": {
      const grouped = row.colour !== undefined;
      return `<div class="row tab${grouped ? " grouped" : ""}" role="treeitem" aria-level="${grouped ? 2 : 1}" aria-selected="${row.active}"${grouped ? ` data-colour="${row.colour}"` : ""} title="${esc(`${row.title}\n${host(row.url)}`)}" ${attrs}>
        ${favicon(row.url)}<span class="label">${esc(row.title)}</span>${row.pinned ? `<span class="state" title="Pinned">${ICON.pin}</span>` : ""}${row.split ? `<span class="state" title="In a split view">${ICON.split}</span>` : ""}${row.muted ? `<span class="state" title="Muted">${ICON.muted}</span>` : row.audible ? `<span class="state" title="Playing audio">${ICON.audio}</span>` : ""}
        <button class="icon-btn close" tabindex="-1" data-close="${row.id}" aria-label="Close ${esc(row.title)}">${ICON.close}</button></div>`;
    }
    case "newtab":
      return `<div class="row new-tab" role="treeitem" aria-level="1" aria-selected="false" ${attrs}><span class="ico">${ICON.plus}</span><span class="label">New tab</span></div>`;
  }
}

/** Section heads stand alone; the rows between them go into a tree each (bookmarks; tabs under their group headers). */
function pageHtml(rows: Row[]): string {
  let html = "";
  for (let i = 0; i < rows.length; ) {
    const head = rows[i++]!;
    html += (head.key === "s:tabs" ? '<div class="rule"></div>' : "") + rowHtml(head);
    let body = "";
    while (i < rows.length && rows[i]!.kind !== "section") body += rowHtml(rows[i++]!);
    if (head.kind !== "section" || !head.open) continue;
    if (head.section === "bookmarks") html += body ? `<div role="tree" aria-label="Bookmarks">${body}</div>` : '<div class="empty">No bookmarks</div>';
    else html += `<div role="tree" aria-label="Tabs in this window">${body}</div>`;
  }
  return html;
}

// --- Rendering with one roving tab stop. -------------------------------------------------------
let sidebar!: Sidebar; // set once openSidebar resolves; renders wait for it
let focusKey: string | undefined;
let focusIndex = 0;
let renders = 0;

const rowEl = (key: string) => app.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);

function render(): void {
  if (sidebar === undefined) return;
  renderFooter();
  // The inline editor and the menu hold DOM state a re-render would wipe, and a re-render while
  // a mouse button is down would swallow its click: catch up when they close or it's released.
  if (overlay || pressing) return void (deferred = true);
  deferred = false;
  const rows = sidebar.rows();
  const hadFocus = app.contains(document.activeElement);
  const scroll = app.scrollTop;
  app.innerHTML = pageHtml(rows);
  app.scrollTop = scroll;
  // Keep the stop on the same row; if it went away (a tab closed elsewhere), on its neighbour.
  const stop = rows.find((r) => r.key === focusKey) ?? (focusKey !== undefined ? rows[Math.min(focusIndex, rows.length - 1)] : undefined) ?? rows.find((r) => r.kind === "tab" && r.active) ?? rows[0];
  if (stop) moveStop(stop.key, hadFocus);
  app.dataset.renders = String(++renders); // read by the feasibility harness
  if (editAfterRender !== undefined && rowEl(editAfterRender)) {
    const key = editAfterRender;
    editAfterRender = undefined;
    openEditor(key);
  }
}

function moveStop(key: string, focus: boolean): void {
  app.querySelector('[tabindex="0"]')?.setAttribute("tabindex", "-1");
  const el = rowEl(key);
  if (!el) return;
  el.tabIndex = 0;
  focusKey = key;
  focusIndex = sidebar.rows().findIndex((r) => r.key === key);
  if (focus) {
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest" });
  }
}

let frame = 0;
let fallback: ReturnType<typeof setTimeout> | undefined;
/** Bursts of events render once per frame. A hidden panel (its window covered or minimised) gets
 *  no frames, so it renders at once instead and is current the moment it's shown again. A panel
 *  that counts as visible can still go without frames (a covered window when Chrome's occlusion
 *  tracking is off), so a 100 ms timer renders if no frame came. */
const scheduleRender = () => {
  cancelAnimationFrame(frame);
  clearTimeout(fallback);
  if (document.hidden) return render();
  const once = () => {
    cancelAnimationFrame(frame);
    clearTimeout(fallback);
    render();
  };
  frame = requestAnimationFrame(once);
  fallback = setTimeout(once, 100);
};

const report = (e: unknown) => console.warn("[sidebar]", e);

// --- Input. ------------------------------------------------------------------------------------
const rowOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>("[data-key]") : null);
const findRow = (key: string | undefined) => sidebar.rows().find((r) => r.key === key);

app.addEventListener("click", (e) => {
  const close = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-close]") : null;
  if (close) {
    e.stopPropagation();
    return void sidebar.run({ type: "closeTab", id: Number(close.dataset.close) }).catch(report);
  }
  if (e.target instanceof Element && e.target.closest("[data-tidy]")) {
    e.stopPropagation();
    return void sidebar.run({ type: "tidy" }).catch(report);
  }
  const folders = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-folders]") : null;
  if (folders) {
    e.stopPropagation();
    return void sidebar.run({ type: "foldFolders", open: folders.dataset.folders === "expand" }).catch(report);
  }
  const fold = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-fold]") : null;
  if (fold) {
    e.stopPropagation();
    return void sidebar.run({ type: "foldFolders", open: fold.dataset.state === "expand", id: fold.dataset.fold! }).catch(report);
  }
  const groups = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-groups]") : null;
  if (groups) {
    e.stopPropagation();
    return void sidebar.run({ type: "foldGroups", open: groups.dataset.groups === "expand" }).catch(report);
  }
  const row = findRow(rowOf(e.target)?.dataset.key);
  if (!row || (overlay?.kind === "editor" && overlay.key === row.key)) return;
  moveStop(row.key, true);
  void sidebar.run(rowCommand(row), { background: e.metaKey || e.ctrlKey }).catch(report);
});

// Middle click: a bookmark opens in the background, a tab closes (as on Chrome's tab strip).
app.addEventListener("auxclick", (e) => {
  if (e.button !== 1) return;
  const row = findRow(rowOf(e.target)?.dataset.key);
  if (row?.kind === "bookmark") void sidebar.run(rowCommand(row), { background: true }).catch(report);
  if (row?.kind === "tab") void sidebar.run({ type: "closeTab", id: row.id }).catch(report);
});
app.addEventListener("mousedown", (e) => {
  if (e.button === 1) e.preventDefault(); // no autoscroll cursor
});

// Focus that arrives any other way (a screen reader, a script) moves the roving stop too, so the
// next render keeps focus where it is instead of jumping back to the old stop.
app.addEventListener("focusin", (e) => {
  const key = rowOf(e.target)?.dataset.key;
  if (key !== undefined && key !== focusKey) moveStop(key, false);
});

app.addEventListener("keydown", (e) => {
  const key = rowOf(e.target)?.dataset.key;
  if (key === undefined || e.target instanceof HTMLInputElement) return;
  // A held Delete would move on to the next row and delete that too: one press, one delete.
  if (e.repeat && (e.key === "Delete" || e.key === "Backspace")) return void e.preventDefault();
  const result = keyResult(sidebar.rows(), key, e.key, { alt: e.altKey, meta: e.metaKey || e.ctrlKey, shift: e.shiftKey });
  if (Object.keys(result).length === 0) return;
  e.preventDefault();
  apply(result, e.metaKey || e.ctrlKey);
});

function apply(result: KeyResult, background = false): void {
  if (result.focus) moveStop(result.focus, true);
  if (result.command) void sidebar.run(result.command, { background }).catch(report);
  if (result.edit) openEditor(result.edit);
  if (result.menu) showMenu(result.menu);
}

app.addEventListener("contextmenu", (e) => {
  const key = rowOf(e.target)?.dataset.key;
  if (key === undefined || !menuItems(key).length) return; // the New tab row and the Tabs heading keep the page's own menu
  e.preventDefault();
  moveStop(key, true);
  showMenu(key, e.clientX, e.clientY);
});

// --- Bookmark edits: the row menu, the inline editor and the footer notice. -------------------
let overlay: { kind: "editor" | "menu"; key: string } | undefined;
let pressing = false;
app.addEventListener("pointerdown", () => void (pressing = true), true);
for (const ev of ["pointerup", "pointercancel"]) {
  // After the click this press makes (click follows pointerup in the same task).
  addEventListener(ev, () => {
    if (!pressing) return;
    pressing = false;
    setTimeout(() => deferred && render(), 0);
  }, true);
}
let deferred = false;
/** A new folder's row: open its editor as soon as Chrome's event has rendered it. */
let editAfterRender: string | undefined;

type Editable = Extract<Row, { kind: "folder" | "bookmark" }>;
const editable = (row: Row | undefined): row is Editable => (row?.kind === "folder" || row?.kind === "bookmark") && !row.locked;
type GroupRow = Extract<Row, { kind: "group" }>;
type TabRow = Extract<Row, { kind: "tab" }>;

function closeOverlay(refocus: string | undefined): void {
  overlay = undefined; // first: removing a focused menu can fire its focusout
  document.querySelector(".menu")?.remove();
  if (deferred) render();
  if (refocus !== undefined && rowEl(refocus)) moveStop(refocus, true);
}

/** The new node's folder (and a folded Bookmarks section) opens first, so you see where it went. */
async function openParent(at: Place): Promise<void> {
  const head = sidebar.rows().find((r) => r.kind === "section" && r.section === "bookmarks");
  if (head?.kind === "section" && !head.open) await sidebar.run({ type: "foldSection", section: "bookmarks", open: true });
  const parent = sidebar.rows().find((r) => r.kind === "folder" && r.id === at.parentId);
  if (parent?.kind === "folder" && !parent.open) await sidebar.run({ type: "toggleFolder", id: parent.id, open: true });
}

/** A row menu entry, or "-" between groups of them. `editor`: it opens the inline editor, which
 *  takes the focus. `sub`: a submenu instead of an action, shown in the menu's place. `colour`: a
 *  tab group's, as a dot before the label. `checked`: a checkbox item, ✓ when on. */
type MenuEntry = { label: string; run?: () => void; editor?: true; sub?: MenuEntry[]; colour?: FolderColour; checked?: boolean } | "-";
/** No separator first, last or twice in a row. */
const separated = (entries: MenuEntry[]) =>
  entries.filter((e, i, all) => e !== "-" || (i > 0 && i < all.length - 1 && all[i - 1] !== "-" && all.slice(i + 1).some((x) => x !== "-")));

function menuItems(key: string, windows: WindowInfo[] = []): MenuEntry[] {
  const rows = sidebar.rows();
  const row = rows.find((r) => r.key === key);
  if (row?.kind === "group") return groupMenu(row, rows);
  if (row?.kind === "tab") return tabMenu(row, rows, windows);
  const items: MenuEntry[] = row?.kind === "folder" ? [...openAllMenu(row.id), "-"] : [];
  if (editable(row)) {
    items.push({ label: "Edit…", run: () => openEditor(key), editor: true });
    items.push({ label: "Delete", run: () => apply(keyResult(sidebar.rows(), key, "Delete")) });
  }
  const at = addPlace(rows, key, newAt);
  if (at) {
    if (items.length > 0 && items.at(-1) !== "-") items.push("-");
    items.push({ label: "New folder", run: () => void openParent(at).then(() => sidebar.run({ type: "newFolder", at, title: "New folder" })).then((id) => {
      if (id === undefined) return;
      editAfterRender = `b:${id}`;
      scheduleRender();
    }).catch(report) });
    items.push({ label: "Add current tab", run: () => void openParent(at).then(() => sidebar.run({ type: "addCurrentTab", at })).catch(report) });
  }
  if (row?.kind === "folder") {
    const skip = row.skip === true;
    items.push("-", { label: "Don't expand with Expand all", checked: skip, run: () => void sidebar.run({ type: "skipFolder", id: row.id, skip: !skip }).catch(report) });
  }
  if (sortable(row)) {
    const id = row?.kind === "section" ? row.barId! : (row as Editable).id;
    items.push("-", { label: "Sort by name", run: () => void sidebar.run({ type: "sortFolder", id }).catch(report) });
  }
  return separated(items);
}

/** A folder's Open All items, as on Chrome's bookmark bar (when it has bookmarks of its own to
 *  open). From OPEN_ALL_ASK_FROM bookmarks on, each asks first, in place of the menu, as Chrome
 *  asks "Open all N?". In a new group, the group's name editor opens, as Chrome's does. */
function openAllMenu(id: string): MenuEntry[] {
  const tree = sidebar.tree();
  const n = openAllUrls(tree, id).length;
  const nPrivate = openAllUrls(tree, id, true).length;
  const open = (where: OpenAllWhere) => () =>
    void sidebar.run({ type: "openFolder", id, where }).then((group) => {
      if (where !== "group" || group === undefined) return;
      editAfterRender = `g:${group}`;
      scheduleRender();
    }).catch(report);
  const item = (label: string, count: number, where: OpenAllWhere): MenuEntry[] => {
    if (count === 0) return [];
    const run = open(where);
    if (count < OPEN_ALL_ASK_FROM) return [{ label, run }];
    return [{ label, sub: [{ label: `Open ${count} tabs`, run }, { label: "Cancel", run: () => {} }] }];
  };
  return [
    ...item(`Open All (${n})`, n, "here"),
    ...item(`Open All (${n}) in New Window`, n, "window"),
    ...item(`Open All (${nPrivate}) in Incognito Window`, nPrivate, "incognito"),
    ...item(`Open All (${n}) in New Tab Group`, n, "group"),
  ];
}

/** Chrome's own group menu, as far as extensions can reach it. Close group keeps it in Chrome's
 *  saved tab groups; Ungroup and Delete group take it out, as in Chrome. Save group to bookmarks
 *  puts it in the bookmarks bar, first or last as New bookmarks go (as the Bookmarks heading's Add
 *  current tab does). */
function groupMenu(row: GroupRow, rows: Row[]): MenuEntry[] {
  const run = (command: Command) => () => void sidebar.run(command).catch(report);
  const id = row.id;
  const head = rows.find((r) => r.key === "s:tabs");
  const whole = head?.kind === "section" && head.total === row.count; // Chrome can't move all of a window's tabs out
  const bar = addPlace(rows, "s:bookmarks", newAt);
  return [
    { label: "Name and colour…", run: () => openEditor(row.key), editor: true },
    "-",
    { label: "New tab in group", run: run({ type: "newTabInGroup", id }) },
    ...(whole ? [] : [{ label: "Move group to new window", run: run({ type: "moveGroupToNewWindow", id }) }]),
    ...(bar ? ["-" as const, { label: "Save group to bookmarks", run: () => void openParent(bar).then(() => sidebar.run({ type: "saveGroup", id, at: bar })).catch(report) }] : []),
    "-",
    { label: "Close group", run: run({ type: "closeGroup", id }) },
    { label: "Ungroup", run: run({ type: "ungroup", id }) },
    { label: "Delete group", run: run({ type: "deleteGroup", id }) },
  ];
}

/** Chrome's own tab menu, as far as extensions can reach it (see README). Below = Chrome's "to
 *  the right". Close other tabs and Close tabs below are offered when they'd close something. */
function tabMenu(row: TabRow, rows: Row[], windows: WindowInfo[]): MenuEntry[] {
  const tabs = sidebar.tabs();
  const i = tabs.findIndex((t) => t.id === row.id);
  const tab = tabs[i];
  if (!tab) return [];
  const id = tab.id;
  const run = (command: Command) => () => void sidebar.run(command).catch(report);
  const alone = tabs.length === 1; // moving it would close the window
  const grouped = tab.groupId !== NO_GROUP;
  const intoGroups = rows.flatMap((r) => (r.kind === "group" && r.id !== tab.groupId ? [r] : []));
  const newGroup = () =>
    void sidebar.run({ type: "groupTab", id }).then((group) => {
      if (group === undefined) return;
      editAfterRender = `g:${group}`; // name it, as Chrome's own new-group bubble asks
      scheduleRender();
    }).catch(report);
  const others = (from: number) => tabs.some((t, j) => j >= from && t.id !== id && !t.pinned && !(tab.splitViewId !== undefined && t.splitViewId === tab.splitViewId));
  const active = tabs.find((t) => t.active);
  const bar = addPlace(rows, "s:bookmarks", newAt);
  const tabsLabel = (n: number) => (n > 1 ? ` and ${n - 1} more tab${n === 2 ? "" : "s"}` : "");
  return separated([
    { label: "New tab below", run: run({ type: "newTabBelow", id }) },
    "-",
    intoGroups.length === 0
      ? { label: "Add tab to new group", run: newGroup }
      : { label: "Add tab to group", sub: [{ label: "New group", run: newGroup }, "-", ...intoGroups.map((g) => ({ label: g.title || "Unnamed group", colour: g.colour, run: run({ type: "groupTab", id, groupId: g.id }) }))] },
    ...(grouped ? [{ label: "Remove from group", run: run({ type: "ungroupTab", id }) }] : []),
    ...(alone ? [] : [{ label: "Move tab to new window", run: run({ type: "moveTabToNewWindow", id }) }]),
    ...(alone || windows.length === 0 ? [] : [{ label: "Move tab to another window", sub: windows.map((w) => ({ label: `${w.title}${tabsLabel(w.tabs)}`, run: run({ type: "moveTabToWindow", id, windowId: w.id }) })) }]),
    "-",
    { label: "Reload", run: run({ type: "reloadTab", id }) },
    { label: "Duplicate", run: run({ type: "duplicateTab", id }) },
    { label: tab.pinned ? "Unpin" : "Pin", run: run({ type: "pinTab", id, pinned: !tab.pinned }) },
    { label: tab.muted ? "Unmute tab" : "Mute tab", run: run({ type: "muteTab", id, muted: !tab.muted }) },
    ...(!sidebar.canSplit ? [] : tab.splitViewId !== undefined ? [{ label: "Exit split view", run: run({ type: "unsplitTab", id }) }]
      : active && canSplitWith(tab, active) ? [{ label: tab.active ? "New split view" : "Split view with selected tab", run: run({ type: "splitTab", id }) }] : []),
    "-",
    { label: "Close", run: run({ type: "closeTab", id }) },
    ...(others(0) ? [{ label: "Close other tabs", run: run({ type: "closeOthers", id }) }] : []),
    ...(others(i + 1) ? [{ label: "Close tabs below", run: run({ type: "closeBelow", id }) }] : []),
    "-",
    ...(bar && tab.url ? [{ label: "Bookmark tab", run: () => void openParent(bar).then(() => sidebar.run({ type: "addBookmark", at: bar, title: row.title, url: tab.url })).catch(report) }] : []),
    ...(bar ? [{ label: "Bookmark all tabs", run: () => void openParent(bar).then(() => sidebar.run({ type: "saveTabs", at: bar, title: "All tabs" })).then((folder) => {
      if (folder === undefined) return;
      editAfterRender = `b:${folder}`; // name it, as Chrome's own dialog asks
      scheduleRender();
    }).catch(report) }] : []),
    ...(tab.url ? [{ label: "Copy link", run: () => void copyText(tab.url) }] : []),
  ]);
}

/** The clipboard, from the menu click (a user gesture, so no clipboardWrite permission is needed). */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field = Object.assign(document.createElement("textarea"), { value: text });
    document.body.append(field);
    field.select();
    document.execCommand("copy");
    field.remove();
  }
}

/** A row's menu; a tab's lists the other windows, so they're read first. */
function showMenu(key: string, x?: number, y?: number): void {
  if (findRow(key)?.kind !== "tab") return openMenu(key, x, y);
  void sidebar.otherWindows().then((windows) => openMenu(key, x, y, windows), () => openMenu(key, x, y));
}

function openMenu(key: string, x?: number, y?: number, windows: WindowInfo[] = []): void {
  const items = menuItems(key, windows);
  if (!items.length || !rowEl(key)) return;
  closeOverlay(undefined);
  overlay = { kind: "menu", key };
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");
  let buttons: HTMLButtonElement[] = [];
  let filling = false; // swapping the items drops the focused one: not a focus leaving the menu
  /** Shows `entries`; a submenu (`parent` set) starts with a back item. */
  const fill = (entries: MenuEntry[], parent?: { label: string; entries: MenuEntry[] }) => {
    filling = true;
    menu.replaceChildren();
    const button = (label: string, act: () => void, extra = "") => {
      const item = Object.assign(document.createElement("button"), { tabIndex: -1 });
      item.innerHTML = extra;
      item.append(Object.assign(document.createElement("span"), { className: "menu-label", textContent: label }));
      item.setAttribute("role", "menuitem");
      item.addEventListener("click", act);
      menu.append(item);
      return item;
    };
    if (parent) {
      const back = button(parent.label, () => fill(parent.entries), '<span class="menu-back" aria-hidden="true">‹</span>');
      back.dataset.back = "";
      back.setAttribute("aria-label", `Back from ${parent.label}`);
      menu.append(Object.assign(document.createElement("div"), { className: "menu-sep", role: "separator" }));
    }
    for (const entry of entries) {
      if (entry === "-") {
        menu.append(Object.assign(document.createElement("div"), { className: "menu-sep", role: "separator" }));
        continue;
      }
      const dot = entry.colour
        ? `<span class="menu-dot" data-colour="${entry.colour}" aria-hidden="true"></span>`
        : entry.checked !== undefined ? `<span class="menu-check" aria-hidden="true">${entry.checked ? "✓" : ""}</span>` : "";
      const item = button(entry.label, () => {
        if (entry.sub) return fill(entry.sub, { label: entry.label, entries });
        closeOverlay(entry.editor ? undefined : key);
        entry.run?.();
      }, dot);
      if (entry.checked !== undefined) {
        item.setAttribute("role", "menuitemcheckbox");
        item.setAttribute("aria-checked", String(entry.checked));
      }
      if (entry.sub) {
        item.setAttribute("aria-haspopup", "menu");
        item.insertAdjacentHTML("beforeend", '<span class="menu-more" aria-hidden="true">›</span>');
        item.dataset.sub = "";
      }
    }
    buttons = [...menu.querySelectorAll<HTMLButtonElement>("button")];
    buttons[parent ? Math.min(1, buttons.length - 1) : 0]!.focus();
    filling = false;
  };
  fill(items);
  document.body.append(menu);
  const at = rowEl(key)!.getBoundingClientRect();
  const left = Math.min(x ?? at.left + 24, innerWidth - menu.offsetWidth - 4);
  const top = y ?? at.bottom;
  menu.style.left = `${Math.max(4, left)}px`;
  menu.style.top = `${top + menu.offsetHeight > innerHeight - 4 ? Math.max(4, top - menu.offsetHeight) : top}px`;
  buttons[0]!.focus();
  menu.addEventListener("keydown", (e) => {
    const current = document.activeElement as HTMLButtonElement;
    const i = buttons.indexOf(current);
    const back = menu.querySelector<HTMLButtonElement>("[data-back]");
    const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: buttons.length - 1 }[e.key];
    if (to !== undefined) buttons[(to + buttons.length) % buttons.length]!.focus();
    else if (e.key === "ArrowRight" && current?.dataset.sub !== undefined) current.click();
    else if ((e.key === "ArrowLeft" || e.key === "Escape") && back) back.click();
    else if (e.key === "Escape" || e.key === "Tab") closeOverlay(key);
    else return;
    e.preventDefault();
  });
  menu.addEventListener("focusout", (e) => {
    if (!filling && !menu.contains(e.relatedTarget as Node | null) && overlay?.kind === "menu") closeOverlay(undefined);
  });
}

const validUrl = (url: string) => {
  try {
    return Boolean(new URL(url));
  } catch {
    return false;
  }
};

/** Edits a folder's title, a bookmark's title and URL, or a tab group's title and colour, in
 *  place. Enter or leaving the row saves, Escape cancels; an unusable URL keeps the editor open
 *  (or, on leaving, is dropped). */
function openEditor(key: string): void {
  const row = findRow(key);
  const el = rowEl(key);
  if (!(editable(row) || row?.kind === "group") || !el) return;
  closeOverlay(undefined);
  overlay = { kind: "editor", key };
  el.classList.add("editing");
  el.draggable = false; // so the mouse selects text in the fields
  const fields = document.createElement("span");
  fields.className = "fields";
  const field = (label: string, value: string) => {
    const input = Object.assign(document.createElement("input"), { value, spellcheck: false });
    input.setAttribute("aria-label", label);
    fields.append(input);
    return input;
  };
  const title = field(row.kind === "group" ? "Group name" : row.kind === "folder" ? "Folder name" : "Name", row.kind === "bookmark" ? row.savedTitle : row.title);
  const url = row.kind === "bookmark" ? field("URL", row.url) : undefined;
  el.querySelector(".label")!.replaceWith(fields);
  el.querySelector(".folder-count")?.remove();
  el.querySelector(".sel-dot")?.remove();

  // The icon slot becomes a button that opens the icon picker (a group's: its colour). `chosen`:
  // undefined = unchanged, null = back to the default (site or folder) icon.
  let chosen: string | null | undefined;
  const slot = el.querySelector<HTMLElement>(".ico");
  // Resolved each time it's shown, so a site-icons switch-off while editing is respected.
  const defaultIcon = () => (row.kind === "bookmark" ? favicon(row.url, true) : ICON.folder);
  const current = row.kind === "group" ? folderIcon(row.colour) : row.icon;
  const what = row.kind === "group" ? "colour" : "icon";
  const iconButton = Object.assign(document.createElement("button"), { className: "icon-pick", type: "button" });
  iconButton.setAttribute("aria-label", `Choose ${what}`);
  iconButton.setAttribute("aria-haspopup", "dialog");
  iconButton.title = `Choose ${what}`;
  const showIcon = () => {
    const icon = chosen === undefined ? current : chosen ?? undefined;
    iconButton.innerHTML = icon !== undefined ? iconHtml(icon) : defaultIcon();
  };
  showIcon();
  if (slot) slot.replaceWith(iconButton);
  else fields.before(iconButton);
  let picker: HTMLElement | undefined;
  const inside = (node: Node | null) => !!node && (el.contains(node) || !!picker?.contains(node));
  const closePicker = (focus: HTMLElement | undefined) => {
    const box = picker;
    picker = undefined;
    focus?.focus(); // first, so focus never leaves the editor while the picker goes
    box?.remove();
  };
  iconButton.addEventListener("click", (e) => {
    e.stopPropagation();
    if (picker) return closePicker(iconButton);
    picker = iconPicker((icon) => {
      chosen = icon;
      showIcon();
      closePicker(title);
    }, () => closePicker(iconButton), row.kind === "group" ? "colours" : row.kind);
    picker.addEventListener("focusout", (ev) => {
      if (!inside(ev.relatedTarget as Node | null)) finish(true, true);
    });
    document.body.append(picker);
    const at = iconButton.getBoundingClientRect();
    picker.style.left = `${Math.max(4, Math.min(at.left, innerWidth - picker.offsetWidth - 4))}px`;
    picker.style.top = `${at.bottom + picker.offsetHeight > innerHeight - 4 ? Math.max(4, at.top - picker.offsetHeight - 2) : at.bottom + 2}px`;
    picker.querySelector<HTMLElement>("button")!.focus();
  });
  title.focus();
  title.select();

  const finish = (save: boolean, leaving: boolean) => {
    if (overlay?.kind !== "editor" || overlay.key !== key) return;
    const t = title.value.trim();
    const u = url?.value.trim();
    if (save && u !== undefined && !validUrl(u)) {
      if (!leaving) {
        url!.setAttribute("aria-invalid", "true");
        return url!.focus();
      }
      save = false;
    }
    closePicker(undefined);
    if (row.kind === "group") {
      const colour = folderColour(chosen ?? undefined);
      const recoloured = colour !== undefined && colour !== row.colour;
      if (save && (recoloured || t !== row.title)) void sidebar.run({ type: "editGroup", id: row.id, title: t, ...(recoloured && { colour }) }).catch(report);
      deferred = true; // Chrome's group event brings the new values
      return closeOverlay(leaving ? undefined : key);
    }
    const iconChanged = chosen !== undefined && chosen !== (row.icon ?? null);
    const changed = iconChanged || t !== (row.kind === "bookmark" ? row.savedTitle : row.title) || (u !== undefined && row.kind === "bookmark" && u !== row.url);
    if (save && changed) {
      void sidebar.run({ type: "editBookmark", id: row.id, title: t, ...(u !== undefined && { url: u }), ...(iconChanged && { icon: chosen as string | null }) }).catch(report);
    }
    deferred = true; // the row goes back to plain text now; Chrome's event brings the new values
    closeOverlay(leaving ? undefined : key);
  };
  el.addEventListener("keydown", (e) => {
    if (overlay?.kind !== "editor" || overlay.key !== key) return;
    e.stopPropagation();
    if (e.key === "Enter" && e.target !== iconButton) finish(true, false);
    else if (e.key === "Escape") finish(false, false);
    else return;
    e.preventDefault();
  });
  el.addEventListener("focusout", (e) => {
    if (overlay?.kind === "editor" && overlay.key === key && !inside(e.relatedTarget as Node | null)) finish(true, true);
  });
  for (const ev of ["click", "dblclick", "auxclick"]) fields.addEventListener(ev, (e) => e.stopPropagation());
}

/** Common Bookmark icons; every other emoji comes from the system picker in the field below. */
const ICON_CHOICES = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment("⭐📌📁📚📖📝📅📬💬📞👥🏠🏢💼💰🧾📊📈🛒🎵🎬📷🎮🚗🍳☕🏃❤️🔧💡🔒🌐🔥✅🧪🤖🎓🧠📰🗺️")].map((g) => g.segment);
const SYSTEM_PICKER = /Mac/.test(navigator.platform) ? "⌃⌘Space" : "Win+.";

/** The editor's icon picker: for a folder, a row of folder colours; a grid of common emoji; a
 *  field for any other emoji (where the system's emoji picker works); and Default icon. For a
 *  tab group (`colours`), the row of colours alone. Escape closes it without a choice. */
function iconPicker(choose: (icon: string | null) => void, cancel: () => void, kind: "bookmark" | "folder" | "colours"): HTMLElement {
  const box = document.createElement("div");
  box.className = `icon-picker${kind === "colours" ? " colours-only" : ""}`;
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", kind === "colours" ? "Choose colour" : "Choose icon");
  if (kind !== "bookmark") {
    const colours = document.createElement("div");
    colours.className = "colour-row";
    for (const colour of FOLDER_COLOURS) {
      const name = `${colour[0]!.toUpperCase()}${colour.slice(1)}`;
      const b = Object.assign(document.createElement("button"), { type: "button", title: kind === "colours" ? name : `${name} folder` });
      b.setAttribute("aria-label", b.title);
      b.dataset.colour = colour;
      b.innerHTML = iconHtml(folderIcon(colour));
      b.addEventListener("click", () => choose(folderIcon(colour)));
      colours.append(b);
    }
    box.append(colours);
  }
  box.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key !== "Escape") return;
    e.preventDefault();
    cancel();
  });
  if (kind === "colours") return box;
  const grid = document.createElement("div");
  grid.className = "icon-grid";
  for (const icon of ICON_CHOICES) {
    const b = Object.assign(document.createElement("button"), { type: "button", textContent: icon, title: icon });
    b.addEventListener("click", () => choose(icon));
    grid.append(b);
  }
  const other = Object.assign(document.createElement("input"), { placeholder: `Any emoji: ${SYSTEM_PICKER}`, spellcheck: false });
  other.setAttribute("aria-label", "Any emoji");
  other.addEventListener("input", () => {
    const icon = iconText(other.value);
    if (icon !== undefined) choose(icon);
  });
  const reset = Object.assign(document.createElement("button"), { type: "button", className: "text-btn", textContent: "Default icon" });
  reset.addEventListener("click", () => choose(null));
  const foot = document.createElement("div");
  foot.className = "icon-foot";
  foot.append(other, reset);
  box.append(grid, foot);
  return box;
}

// --- Drag and drop: bookmarks and folders move, a tab or group dropped in Bookmarks is saved there,
// and tabs and groups move on the tab strip when dropped among the tabs.
const DRAG_TYPE = "application/x-sidebar-row"; // only our own drags; links from pages are ignored
let dragSource: DragSource | undefined;
let dropMark: HTMLElement | undefined;
let expandTimer: ReturnType<typeof setTimeout> | undefined;
let expandKey: string | undefined;

/** `end`: a drop into a folder or the bar that isn't empty says whether it lands first or last. */
function markDrop(el: HTMLElement | undefined, zone?: DropZone, end?: "top" | "bottom"): void {
  dropMark?.classList.remove("drop-before", "drop-after", "drop-inside");
  if (dropMark) delete dropMark.dataset.dropEnd;
  dropMark = el;
  if (el && zone) el.classList.add(`drop-${zone}`);
  if (el && end) el.dataset.dropEnd = end;
}
function stopExpand(): void {
  clearTimeout(expandTimer);
  expandKey = undefined;
}
function endDrag(): void {
  dragSource = undefined;
  markDrop(undefined);
  stopExpand();
}

app.addEventListener("dragstart", (e) => {
  const row = findRow(rowOf(e.target)?.dataset.key);
  if (!row || !e.dataTransfer || (overlay?.kind === "editor" && overlay.key === row.key)) return;
  if (row.kind === "tab") dragSource = { kind: "tab", id: row.id };
  else if (row.kind === "group") dragSource = { kind: "group", id: row.id };
  else if (editable(row)) dragSource = { kind: "bookmark", key: row.key };
  else return void e.preventDefault();
  e.dataTransfer.setData(DRAG_TYPE, row.key);
  if (row.kind === "tab" || row.kind === "bookmark") {
    // Dropped on Chrome's tab strip or a page, a bookmark or tab opens like a link.
    e.dataTransfer.setData("text/uri-list", row.url);
    e.dataTransfer.setData("text/plain", row.url);
  }
  // A tab or group copies into Bookmarks, moves on the strip; a tab also drops elsewhere as a link.
  e.dataTransfer.effectAllowed = row.kind === "tab" ? "all" : "copyMove";
  // A render during the drag (a folder opening on hover) replaces this row; its dragend then
  // never bubbles to #app, so listen on the row itself.
  rowOf(e.target)!.addEventListener("dragend", endDrag, { once: true });
});

/** The row under the pointer and which part of it: a folder's or group header's middle half means "inside". */
function dropAt(e: DragEvent): { key: string; el: HTMLElement; zone: DropZone } | undefined {
  const el = rowOf(e.target);
  const row = findRow(el?.dataset.key);
  if (!el || !row) return undefined;
  if (row.kind === "section") return { key: row.key, el, zone: "after" };
  const r = el.getBoundingClientRect();
  const y = (e.clientY - r.top) / r.height;
  const zone: DropZone = row.kind === "folder" || row.kind === "group" ? (y < 0.25 ? "before" : y > 0.75 ? "after" : "inside") : y < 0.5 ? "before" : "after";
  return { key: row.key, el, zone };
}

/** What a drop at `at` does: a Bookmarks place (a move, or a tab or group saved there), or a Strip
 *  move among the tabs; the same drag picks by where it ends. */
function dropTarget(source: DragSource, at: { key: string; zone: DropZone }): { place: Place } | { move: StripMove } | undefined {
  const rows = sidebar.rows();
  const place = dropPlace(rows, source, at.key, at.zone, newAt);
  if (place) return { place };
  const move = stripDrop(rows, sidebar.tabs(), source, at.key, at.zone);
  return move && { move };
}

app.addEventListener("dragover", (e) => {
  if (!dragSource || !e.dataTransfer?.types.includes(DRAG_TYPE)) return;
  const at = dropAt(e);
  const target = at && dropTarget(dragSource, at);
  if (!at || !target) {
    markDrop(undefined);
    return stopExpand();
  }
  e.preventDefault();
  e.dataTransfer.dropEffect = dragSource.kind === "bookmark" || "move" in target ? "move" : "copy";
  // Into a folder or the bar (the heading): first or last, as dropPlace chose.
  const row = findRow(at.key);
  const size = row?.kind === "section" ? row.barCount ?? 0 : row?.kind === "folder" && at.zone === "inside" ? row.count : 0;
  const end = "place" in target && size > 0 ? (target.place.index === 0 ? "top" : "bottom") : undefined;
  markDrop(at.el, row?.kind === "section" ? (end ? "inside" : "after") : at.zone, end);
  // Hovering inside a closed folder opens it, so you can drop deeper.
  if (at.zone === "inside" && row?.kind === "folder" && !row.open) {
    if (expandKey !== at.key) {
      stopExpand();
      expandKey = at.key;
      expandTimer = setTimeout(() => void sidebar.run({ type: "toggleFolder", id: row.id, open: true }).catch(report), 700);
    }
  } else stopExpand();
});

app.addEventListener("dragleave", (e) => {
  if (!app.contains(e.relatedTarget as Node | null)) {
    markDrop(undefined);
    stopExpand();
  }
});

app.addEventListener("drop", (e) => {
  const source = dragSource;
  const at = dropAt(e);
  endDrag();
  if (!source || !at || !e.dataTransfer?.types.includes(DRAG_TYPE)) return;
  const target = dropTarget(source, at);
  if (!target) return;
  e.preventDefault();
  if ("move" in target) return void sidebar.run({ type: "moveInStrip", move: target.move }).catch(report);
  const { place } = target;
  if (source.kind === "bookmark") {
    const row = findRow(source.key);
    if (row?.kind === "folder" || row?.kind === "bookmark") void sidebar.run({ type: "moveBookmark", id: row.id, to: place }).catch(report);
  } else if (source.kind === "group") {
    void sidebar.run({ type: "saveGroup", id: source.id, at: place }).catch(report);
  } else {
    const row = findRow(`t:${source.id}`);
    if (row?.kind === "tab") void sidebar.run({ type: "addBookmark", at: place, title: row.title, url: row.url }).catch(report);
  }
});

// The footer says what the last Bookmark edit did, with Undo, for about 10 s.
const noticeBox = document.getElementById("notice")!;
let noticeHidden = 0;
let noticeShown = 0;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function renderFooter(): void {
  const n = sidebar.notice();
  if (!n || n.id <= noticeHidden) return void noticeBox.replaceChildren();
  if (n.id !== noticeShown) {
    noticeShown = n.id;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      noticeHidden = n.id;
      renderFooter();
    }, 10_000);
  }
  noticeBox.innerHTML = `<span class="notice-text" title="${esc(n.text)}">${esc(n.text)}</span>${n.undo ? '<button class="text-btn" id="undo">Undo</button>' : ""}`;
}
noticeBox.addEventListener("click", (e) => {
  if (e.target instanceof Element && e.target.closest("#undo")) void sidebar.run({ type: "undo" }).catch(report);
});

document.getElementById("options")!.addEventListener("click", () => void chrome.runtime.openOptionsPage().catch(report));

// --- Site icons from the site itself, when Chrome's cache has none. ---------------------------
/** Pixels of an image at 32 × 32, to tell Chrome's default icon from a real one. */
function pixels(image: HTMLImageElement): string {
  const canvas = Object.assign(document.createElement("canvas"), { width: 32, height: 32 });
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, 32, 32);
  return ctx.getImageData(0, 0, 32, 32).data.join(",");
}
/** What Chrome's cache returns for a page it knows nothing about. */
const defaultIcon = new Promise<string>((resolve) => {
  const probe = new Image();
  probe.onload = () => resolve(pixels(probe));
  probe.onerror = () => resolve("");
  probe.src = cached("https://never-visited.invalid/");
});

/** Whether an image URL loads (off screen; gives up after 8 s). */
const imageLoads = (src: string) =>
  new Promise<boolean>((resolve) => {
    const probe = new Image();
    const timer = setTimeout(() => resolve(false), 8000);
    probe.onload = () => (clearTimeout(timer), resolve(probe.naturalWidth > 0));
    probe.onerror = () => (clearTimeout(timer), resolve(false));
    probe.src = src;
  });

/** Whether a site serves an icon at `src`. An image request follows redirects, as on a visit:
 *  Chrome refuses every redirect-refusing request an extension can make without site permissions
 *  (learnings 2026-11-19 · no-cors-redirect-modes). */
const loads = imageLoads;

/** Asks a site for its icon once per panel: its own icon files in turn, the first that loads. The
 *  row keeps Chrome's default icon until one does, then the next render shows it. */
const siteProbes = new Map<string, Promise<string | null | undefined>>();
/** Bumped when site icons are switched off: probes under way stop before their next request. */
let probeRound = 0;
function probeSite(page: string): Promise<string | null | undefined> {
  const origin = originOf(page);
  let probe = siteProbes.get(origin);
  if (!probe) {
    const round = probeRound;
    probe = (async () => {
      for (const url of siteIconUrls(page)) {
        if (round !== probeRound || !siteIconsOn) return undefined; // switched off meanwhile
        if (await loads(url)) return url;
      }
      return null;
    })();
    siteProbes.set(origin, probe);
    void probe.then((found) => {
      if (found === undefined || round !== probeRound) return;
      siteFound.set(origin, found);
      rememberSite(origin, found);
      if (found) scheduleRender();
    });
  }
  return probe;
}

// A remembered site icon that no longer loads is forgotten; the row goes back to Chrome's icon,
// and the next panel open asks the site again.
app.addEventListener(
  "error",
  (e) => {
    const image = e.target;
    if (!(image instanceof HTMLImageElement) || image.dataset.siteOf === undefined) return;
    const page = image.dataset.siteOf;
    image.removeAttribute("data-site-of");
    const origin = originOf(page);
    if (siteFound.get(origin) === image.getAttribute("src")) {
      siteFound.set(origin, null); // for this panel's life
      void forgetSite(origin).catch(report);
    }
    image.src = cached(page);
  },
  true, // error doesn't bubble
);

// A page visited since gets its own icon in Chrome's cache: check it again.
chrome.tabs.onUpdated.addListener((_id, change, tab) => {
  if (change.favIconUrl === undefined || tab.url === undefined || !pageDefault.get(tab.url)) return;
  pageDefault.delete(tab.url);
  scheduleRender();
});

app.addEventListener(
  "load",
  (e) => {
    const image = e.target;
    if (!(image instanceof HTMLImageElement) || !siteIconsOn) return;
    const page = image.dataset.page;
    if (page === undefined) return;
    image.removeAttribute("data-page"); // checked once per page
    void defaultIcon.then((fallback) => {
      if (fallback === "" || !image.isConnected || pageDefault.has(page)) return;
      const isDefault = pixels(image) === fallback;
      pageDefault.set(page, isDefault);
      if (!isDefault) return;
      const found = siteFound.get(originOf(page));
      if (found) scheduleRender(); // the site was asked already, for another page
      else if (found === undefined) void probeSite(page);
    });
  },
  true, // load doesn't bubble
);

const applySiteIcons = (stored: unknown) => {
  const on = siteIcons(stored);
  if (on === siteIconsOn) return;
  siteIconsOn = on;
  probeRound++;
  siteProbes.clear();
  siteFound.clear();
  pageDefault.clear(); // switched back on, every page is checked again
  scheduleRender();
};

// --- Colour treatment, live from the options page. ----------------------------------------------
const applyTreatment = (stored: unknown) => {
  document.documentElement.dataset.treatment = colourTreatment(stored);
};
/** New bookmarks go (settings.ts), live from the options page. */
let newAt: NewBookmarksAt = "bottom";
/** Expand all opens (settings.ts), live from the options page; the session's rows follow it too. */
let expandAll: ExpandAll = "level";
const applyExpandAll = (stored: unknown) => {
  expandAll = expandAllMode(stored);
  sidebar?.setExpandAll(expandAll);
};
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const change = changes[COLOUR_TREATMENT_KEY];
  if (change) applyTreatment(change.newValue);
  const icons = changes[SITE_ICONS_KEY];
  if (icons) applySiteIcons(icons.newValue);
  if (changes[NEW_BOOKMARKS_KEY]) newAt = newBookmarksAt(changes[NEW_BOOKMARKS_KEY].newValue);
  if (changes[EXPAND_ALL_KEY]) applyExpandAll(changes[EXPAND_ALL_KEY].newValue);
});

void (async () => {
  const stored = await chrome.storage.local.get([COLOUR_TREATMENT_KEY, SITE_ICONS_KEY, NEW_BOOKMARKS_KEY, EXPAND_ALL_KEY]);
  applyTreatment(stored[COLOUR_TREATMENT_KEY]);
  newAt = newBookmarksAt(stored[NEW_BOOKMARKS_KEY]);
  siteIconsOn = siteIcons(stored[SITE_ICONS_KEY]);
  if (siteIconsOn) await recallSites().catch(report);
  sidebar = await openSidebar(chromeSidebar, scheduleRender);
  applyExpandAll(stored[EXPAND_ALL_KEY]);
  render();
})();
