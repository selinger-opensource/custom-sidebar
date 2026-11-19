// Side panel page: renders the Sidebar's rows and turns clicks and keys into its commands.
// Rendering only — what rows exist and what a key does live in sidebar.ts.
import { COLOUR_TREATMENT_KEY, colourTreatment } from "./settings";
import { keyResult, openSidebar, rowCommand, type Row, type Sidebar } from "./sidebar";
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
/** Chrome's favicon cache by page URL; a never-visited page shows Chrome's default globe. Our own
 *  pages (options, the panel) aren't in that cache, so they show the extension's icon. */
const OWN_PAGES = chrome.runtime.getURL("");
const img = (src: string) => `<img class="ico" alt="" src="${esc(src)}">`;
const favicon = (url: string) =>
  url.startsWith(OWN_PAGES)
    ? img(chrome.runtime.getURL("icons/icon-32.png"))
    : /^https?:/.test(url)
      ? img(chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`))
      : `<span class="ico">${ICON.globe}</span>`;

// --- Rows to HTML. ---------------------------------------------------------------------------
function rowHtml(row: Row): string {
  const attrs = `data-key="${esc(row.key)}" tabindex="-1"`;
  switch (row.kind) {
    case "section":
      return `<div class="section-head${row.section === "tabs" ? " sticky" : ""}" role="button" aria-expanded="${row.open}" ${attrs}>
        ${ICON.chev}<span>${row.label}</span><span class="grow"></span><span class="count">${row.count ?? ""}</span></div>`;
    case "folder":
      return `<div class="row folder" role="treeitem" aria-level="${row.depth + 1}" aria-expanded="${row.open}" style="--depth:${row.depth}" title="${esc(row.title)}" ${attrs}>
        ${ICON.chev}<span class="ico">${ICON.folder}</span><span class="label">${esc(row.title)}</span><span class="folder-count">${row.count}</span></div>`;
    case "bookmark":
      return `<div class="row bookmark" role="treeitem" aria-level="${row.depth + 1}" style="--depth:${row.depth}" title="${esc(`${row.title}\n${host(row.url)}`)}" ${attrs}>
        <span class="leaf-pad"></span>${favicon(row.url)}<span class="label">${esc(row.title)}</span></div>`;
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
  const rows = sidebar.rows();
  const hadFocus = app.contains(document.activeElement);
  const scroll = app.scrollTop;
  app.innerHTML = pageHtml(rows);
  app.scrollTop = scroll;
  // Keep the stop on the same row; if it went away (a tab closed elsewhere), on its neighbour.
  const stop = rows.find((r) => r.key === focusKey) ?? (focusKey !== undefined ? rows[Math.min(focusIndex, rows.length - 1)] : undefined) ?? rows.find((r) => r.kind === "tab" && r.active) ?? rows[0];
  if (stop) moveStop(stop.key, hadFocus);
  app.dataset.renders = String(++renders); // read by the feasibility harness
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
/** Bursts of events render once per frame. A hidden panel (its window covered or minimised) gets
 *  no frames, so it renders at once instead and is current the moment it's shown again. */
const scheduleRender = () => {
  cancelAnimationFrame(frame);
  if (document.hidden) render();
  else frame = requestAnimationFrame(render);
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
  const row = findRow(rowOf(e.target)?.dataset.key);
  if (!row) return;
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
  if (key === undefined || e.altKey) return;
  const result = keyResult(sidebar.rows(), key, e.key);
  if (!result.focus && !result.command) return;
  e.preventDefault();
  if (result.focus) moveStop(result.focus, true);
  if (result.command) void sidebar.run(result.command, { background: e.metaKey || e.ctrlKey }).catch(report);
});

document.getElementById("options")!.addEventListener("click", () => void chrome.runtime.openOptionsPage().catch(report));

// --- Colour treatment, live from the options page. ----------------------------------------------
const applyTreatment = (stored: unknown) => {
  document.documentElement.dataset.treatment = colourTreatment(stored);
};
chrome.storage.onChanged.addListener((changes, area) => {
  const change = changes[COLOUR_TREATMENT_KEY];
  if (area === "local" && change) applyTreatment(change.newValue);
});

void (async () => {
  applyTreatment((await chrome.storage.local.get(COLOUR_TREATMENT_KEY))[COLOUR_TREATMENT_KEY]);
  sidebar = await openSidebar(chromeSidebar, scheduleRender);
  render();
})();
