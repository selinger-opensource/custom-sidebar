// Side panel page: renders the Sidebar's rows and turns clicks and keys into its commands.
// Rendering only — what rows exist and what a key does live in sidebar.ts.
import { COLOUR_TREATMENT_KEY, SITE_ICONS_KEY, SITE_MEMORY_PREFIX, colourTreatment, siteIcons } from "./settings";
import { FOLDER_COLOURS, addPlace, dropPlace, folderColour, folderIcon, iconText, keyResult, siteIconUrls, openSidebar, rowCommand, type DragSource, type DropZone, type KeyResult, type Place, type Row, type Sidebar } from "./sidebar";
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
  audio: svg('<path d="M3 6.5h2l3-2.5v8L5 9.5H3zM10.5 6a2.5 2.5 0 0 1 0 4M12 4.5a4.6 4.6 0 0 1 0 7"/>', 14),
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
  n > 0 ? `<button class="icon-btn tidy" data-tidy aria-label="Close ${n} other tab${n === 1 ? "" : "s"}" title="Close other tabs (${n})">${ICON.tidy}</button>` : "";
const emoji = (icon: string) => `<span class="emoji" aria-hidden="true">${esc(icon)}</span>`;
const FOLDER_FILLED = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true"><path d="M2 4.6c0-.6.5-1.1 1.1-1.1h3l1.4 1.4h5.4c.6 0 1.1.5 1.1 1.1v5.4c0 .6-.5 1.1-1.1 1.1H3.1c-.6 0-1.1-.5-1.1-1.1z"/></svg>`;
/** A Bookmark icon: a coloured folder (folder:<colour>) or an emoji. */
const iconHtml = (icon: string) => {
  const colour = folderColour(icon);
  return colour ? `<span class="folder-colour" data-colour="${colour}">${FOLDER_FILLED}</span>` : emoji(icon);
};

// --- Rows to HTML. ---------------------------------------------------------------------------
function rowHtml(row: Row): string {
  const draggable = row.kind === "tab" || ((row.kind === "folder" || row.kind === "bookmark") && !row.locked);
  const attrs = `data-key="${esc(row.key)}" tabindex="-1"${draggable ? ' draggable="true"' : ""}`;
  switch (row.kind) {
    case "section":
      return `<div class="section-head${row.section === "tabs" ? " sticky" : ""}" role="button" aria-expanded="${row.open}" ${attrs}>
        ${ICON.chev}<span>${row.label}</span><span class="grow"></span>${tidyButton(row.tidy ?? 0)}<span class="count">${row.count ?? ""}</span></div>`;
    case "folder":
      return `<div class="row folder" role="treeitem" aria-level="${row.depth + 1}" aria-expanded="${row.open}" style="--depth:${row.depth}" title="${esc(row.title)}" ${attrs}>
        ${ICON.chev}<span class="ico">${row.icon !== undefined ? iconHtml(row.icon) : ICON.folder}</span><span class="label">${esc(row.title)}</span><span class="folder-count">${row.count}</span></div>`;
    case "bookmark":
      return `<div class="row bookmark" role="treeitem" aria-level="${row.depth + 1}" style="--depth:${row.depth}" title="${esc(`${row.title}\n${host(row.url)}`)}" ${attrs}>
        <span class="leaf-pad"></span>${row.icon !== undefined ? `<span class="ico">${iconHtml(row.icon)}</span>` : favicon(row.url, true)}<span class="label">${esc(row.title)}</span></div>`;
    case "tab":
      return `<div class="row tab" role="option" aria-selected="${row.active}" title="${esc(`${row.title}\n${host(row.url)}`)}" ${attrs}>
        ${favicon(row.url)}<span class="label">${esc(row.title)}</span>${row.audible ? `<span class="state" title="Playing audio">${ICON.audio}</span>` : ""}
        <button class="icon-btn close" tabindex="-1" data-close="${row.id}" aria-label="Close ${esc(row.title)}">${ICON.close}</button></div>`;
    case "newtab":
      return `<div class="row new-tab" role="option" aria-selected="false" ${attrs}><span class="ico">${ICON.plus}</span><span class="label">New tab</span></div>`;
  }
}

/** Section heads stand alone; the rows between them go into a tree (bookmarks) or listbox (tabs). */
function pageHtml(rows: Row[]): string {
  let html = "";
  for (let i = 0; i < rows.length; ) {
    const head = rows[i++]!;
    html += (head.key === "s:tabs" ? '<div class="rule"></div>' : "") + rowHtml(head);
    let body = "";
    while (i < rows.length && rows[i]!.kind !== "section") body += rowHtml(rows[i++]!);
    if (head.kind !== "section" || !head.open) continue;
    if (head.section === "bookmarks") html += body ? `<div role="tree" aria-label="Bookmarks">${body}</div>` : '<div class="empty">No bookmarks</div>';
    else html += `<div role="listbox" aria-label="Tabs in this window">${body}</div>`;
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
    return void sidebar.run({ type: "closeOtherTabs" }).catch(report);
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
  if (result.menu) openMenu(result.menu);
}

app.addEventListener("contextmenu", (e) => {
  const key = rowOf(e.target)?.dataset.key;
  if (key === undefined || !menuItems(key).length) return; // tabs keep Chrome's own menu
  e.preventDefault();
  moveStop(key, true);
  openMenu(key, e.clientX, e.clientY);
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

function menuItems(key: string): [string, () => void][] {
  const rows = sidebar.rows();
  const row = rows.find((r) => r.key === key);
  const items: [string, () => void][] = [];
  if (editable(row)) {
    items.push(["Edit…", () => openEditor(key)]);
    items.push(["Delete", () => apply(keyResult(sidebar.rows(), key, "Delete"))]);
  }
  const at = addPlace(rows, key);
  if (at) {
    items.push(["New folder", () => void openParent(at).then(() => sidebar.run({ type: "newFolder", at, title: "New folder" })).then((id) => {
      if (id === undefined) return;
      editAfterRender = `b:${id}`;
      scheduleRender();
    }).catch(report)]);
    items.push(["Add current tab", () => void openParent(at).then(() => sidebar.run({ type: "addCurrentTab", at })).catch(report)]);
  }
  return items;
}

function openMenu(key: string, x?: number, y?: number): void {
  const items = menuItems(key);
  if (!items.length) return;
  closeOverlay(undefined);
  overlay = { kind: "menu", key };
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");
  items.forEach(([label, action], i) => {
    if (i === 2) menu.append(Object.assign(document.createElement("div"), { className: "menu-sep", role: "separator" }));
    const item = Object.assign(document.createElement("button"), { textContent: label, tabIndex: -1 });
    item.setAttribute("role", "menuitem");
    item.addEventListener("click", () => {
      closeOverlay(label === "Edit…" ? undefined : key);
      action();
    });
    menu.append(item);
  });
  document.body.append(menu);
  const at = rowEl(key)!.getBoundingClientRect();
  const left = Math.min(x ?? at.left + 24, innerWidth - menu.offsetWidth - 4);
  const top = y ?? at.bottom;
  menu.style.left = `${Math.max(4, left)}px`;
  menu.style.top = `${top + menu.offsetHeight > innerHeight - 4 ? Math.max(4, top - menu.offsetHeight) : top}px`;
  const buttons = [...menu.querySelectorAll<HTMLButtonElement>("button")];
  buttons[0]!.focus();
  menu.addEventListener("keydown", (e) => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: buttons.length - 1 }[e.key];
    if (to !== undefined) buttons[(to + buttons.length) % buttons.length]!.focus();
    else if (e.key === "Escape" || e.key === "Tab") closeOverlay(key);
    else return;
    e.preventDefault();
  });
  menu.addEventListener("focusout", (e) => {
    if (!menu.contains(e.relatedTarget as Node | null) && overlay?.kind === "menu") closeOverlay(undefined);
  });
}

const validUrl = (url: string) => {
  try {
    return Boolean(new URL(url));
  } catch {
    return false;
  }
};

/** Edits a folder's title, or a bookmark's title and URL, in place. Enter or leaving the row
 *  saves, Escape cancels; an unusable URL keeps the editor open (or, on leaving, is dropped). */
function openEditor(key: string): void {
  const row = findRow(key);
  const el = rowEl(key);
  if (!editable(row) || !el) return;
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
  const title = field(row.kind === "folder" ? "Folder name" : "Name", row.kind === "bookmark" ? row.savedTitle : row.title);
  const url = row.kind === "bookmark" ? field("URL", row.url) : undefined;
  el.querySelector(".label")!.replaceWith(fields);
  el.querySelector(".folder-count")?.remove();

  // The icon slot becomes a button that opens the icon picker. `chosen`: undefined = unchanged,
  // null = back to the default (site or folder) icon.
  let chosen: string | null | undefined;
  const slot = el.querySelector<HTMLElement>(".ico")!;
  // Resolved each time it's shown, so a site-icons switch-off while editing is respected.
  const defaultIcon = () => (row.kind === "folder" ? ICON.folder : favicon(row.url, true));
  const iconButton = Object.assign(document.createElement("button"), { className: "icon-pick", type: "button" });
  iconButton.setAttribute("aria-label", "Choose icon");
  iconButton.setAttribute("aria-haspopup", "dialog");
  iconButton.title = "Choose icon";
  const showIcon = () => {
    const icon = chosen === undefined ? row.icon : chosen ?? undefined;
    iconButton.innerHTML = icon !== undefined ? iconHtml(icon) : defaultIcon();
  };
  showIcon();
  slot.replaceWith(iconButton);
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
    }, () => closePicker(iconButton), row.kind === "folder");
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
 *  field for any other emoji (where the system's emoji picker works); and Default icon. Escape
 *  closes it without a choice. */
function iconPicker(choose: (icon: string | null) => void, cancel: () => void, forFolder: boolean): HTMLElement {
  const box = document.createElement("div");
  box.className = "icon-picker";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Choose icon");
  if (forFolder) {
    const colours = document.createElement("div");
    colours.className = "colour-row";
    for (const colour of FOLDER_COLOURS) {
      const b = Object.assign(document.createElement("button"), { type: "button", title: `${colour[0]!.toUpperCase()}${colour.slice(1)} folder` });
      b.setAttribute("aria-label", b.title);
      b.dataset.colour = colour;
      b.innerHTML = iconHtml(folderIcon(colour));
      b.addEventListener("click", () => choose(folderIcon(colour)));
      colours.append(b);
    }
    box.append(colours);
  }
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
  box.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key !== "Escape") return;
    e.preventDefault();
    cancel();
  });
  return box;
}

// --- Drag and drop: bookmarks and folders move, a tab dropped in Bookmarks is saved there. -------
const DRAG_TYPE = "application/x-sidebar-row"; // only our own drags; links from pages are ignored
let dragSource: DragSource | undefined;
let dropMark: HTMLElement | undefined;
let expandTimer: ReturnType<typeof setTimeout> | undefined;
let expandKey: string | undefined;

function markDrop(el: HTMLElement | undefined, zone?: DropZone): void {
  dropMark?.classList.remove("drop-before", "drop-after", "drop-inside");
  dropMark = el;
  if (el && zone) el.classList.add(`drop-${zone}`);
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
  else if (editable(row)) dragSource = { kind: "bookmark", key: row.key };
  else return void e.preventDefault();
  e.dataTransfer.setData(DRAG_TYPE, row.key);
  if (row.kind === "tab" || row.kind === "bookmark") {
    // Dropped on Chrome's tab strip or a page, a bookmark or tab opens like a link.
    e.dataTransfer.setData("text/uri-list", row.url);
    e.dataTransfer.setData("text/plain", row.url);
  }
  e.dataTransfer.effectAllowed = row.kind === "tab" ? "copyLink" : "copyMove";
  // A render during the drag (a folder opening on hover) replaces this row; its dragend then
  // never bubbles to #app, so listen on the row itself.
  rowOf(e.target)!.addEventListener("dragend", endDrag, { once: true });
});

/** The row under the pointer and which part of it: a folder's middle half means "inside". */
function dropAt(e: DragEvent): { key: string; el: HTMLElement; zone: DropZone } | undefined {
  const el = rowOf(e.target);
  const row = findRow(el?.dataset.key);
  if (!el || !row) return undefined;
  if (row.kind === "section") return { key: row.key, el, zone: "after" };
  const r = el.getBoundingClientRect();
  const y = (e.clientY - r.top) / r.height;
  const zone: DropZone = row.kind === "folder" ? (y < 0.25 ? "before" : y > 0.75 ? "after" : "inside") : y < 0.5 ? "before" : "after";
  return { key: row.key, el, zone };
}

app.addEventListener("dragover", (e) => {
  if (!dragSource || !e.dataTransfer?.types.includes(DRAG_TYPE)) return;
  const at = dropAt(e);
  const place = at && dropPlace(sidebar.rows(), dragSource, at.key, at.zone);
  if (!at || !place) {
    markDrop(undefined);
    return stopExpand();
  }
  e.preventDefault();
  e.dataTransfer.dropEffect = dragSource.kind === "tab" ? "copy" : "move";
  markDrop(at.el, at.key === "s:bookmarks" ? "after" : at.zone);
  // Hovering inside a closed folder opens it, so you can drop deeper.
  const row = findRow(at.key);
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
  const place = dropPlace(sidebar.rows(), source, at.key, at.zone);
  if (!place) return;
  e.preventDefault();
  if (source.kind === "bookmark") {
    const row = findRow(source.key);
    if (row?.kind === "folder" || row?.kind === "bookmark") void sidebar.run({ type: "moveBookmark", id: row.id, to: place }).catch(report);
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
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const change = changes[COLOUR_TREATMENT_KEY];
  if (change) applyTreatment(change.newValue);
  const icons = changes[SITE_ICONS_KEY];
  if (icons) applySiteIcons(icons.newValue);
});

void (async () => {
  const stored = await chrome.storage.local.get([COLOUR_TREATMENT_KEY, SITE_ICONS_KEY]);
  applyTreatment(stored[COLOUR_TREATMENT_KEY]);
  siteIconsOn = siteIcons(stored[SITE_ICONS_KEY]);
  if (siteIconsOn) await recallSites().catch(report);
  sidebar = await openSidebar(chromeSidebar, scheduleRender);
  render();
})();
