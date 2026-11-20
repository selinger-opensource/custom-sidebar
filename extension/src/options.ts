// Options page: the Sidebar's colour treatment, where new bookmarks go, what Expand all opens, site icons, the nightly sweep's switch, and Backup.
import { MAX_BACKUP_BYTES, backupFileName, buildBackup, checkBackup, importReport, planImport } from "./backup";
import type { BookmarkNode } from "./sidebar";
import { COLOUR_TREATMENT_KEY, EXPAND_ALL_KEY, NEW_BOOKMARKS_KEY, expandAllMode, SITE_ICONS_KEY, SWEEP_ENABLED_KEY, colourTreatment, newBookmarksAt, siteIcons, sweepEnabled, sweepSwitch } from "./settings";

// The tab title names the extension: "<name> options", from the manifest so builds can differ.
document.title = `${chrome.runtime.getManifest().name} options`;

const sweep = document.getElementById("sweep") as HTMLInputElement;
const icons = document.getElementById("siteIcons") as HTMLInputElement;
const treatments = [...document.querySelectorAll<HTMLInputElement>('input[name="colourTreatment"]')];
const placings = [...document.querySelectorAll<HTMLInputElement>('input[name="newBookmarks"]')];
const expanding = [...document.querySelectorAll<HTMLInputElement>('input[name="expandAll"]')];

async function show(): Promise<void> {
  const stored = await chrome.storage.local.get([COLOUR_TREATMENT_KEY, SWEEP_ENABLED_KEY, SITE_ICONS_KEY, NEW_BOOKMARKS_KEY, EXPAND_ALL_KEY]);
  const treatment = colourTreatment(stored[COLOUR_TREATMENT_KEY]);
  for (const t of treatments) t.checked = t.value === treatment;
  const placing = newBookmarksAt(stored[NEW_BOOKMARKS_KEY]);
  for (const p of placings) p.checked = p.value === placing;
  const mode = expandAllMode(stored[EXPAND_ALL_KEY]);
  for (const x of expanding) x.checked = x.value === mode;
  sweep.checked = sweepEnabled(stored[SWEEP_ENABLED_KEY]);
  icons.checked = siteIcons(stored[SITE_ICONS_KEY]);
}

for (const t of treatments) {
  t.addEventListener("change", () => void chrome.storage.local.set({ [COLOUR_TREATMENT_KEY]: t.value }));
}
for (const p of placings) {
  p.addEventListener("change", () => void chrome.storage.local.set({ [NEW_BOOKMARKS_KEY]: p.value }));
}
for (const x of expanding) {
  x.addEventListener("change", () => void chrome.storage.local.set({ [EXPAND_ALL_KEY]: x.value }));
}
sweep.addEventListener("change", () => void chrome.storage.local.set(sweepSwitch(sweep.checked, Date.now())));
icons.addEventListener("change", () => void chrome.storage.local.set({ [SITE_ICONS_KEY]: icons.checked }));
document.getElementById("shortcuts")!.addEventListener("click", () => void chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));
// Backup (GLOSSARY.md): a plain download, so no downloads permission; Import merges (backup.ts).
const status = document.getElementById("backupStatus")!;
const say = (text: string) => void (status.textContent = text);
document.getElementById("export")!.addEventListener("click", () => {
  void (async () => {
    const { name, version } = chrome.runtime.getManifest();
    const now = new Date();
    const backup = buildBackup(await chrome.storage.local.get(null), (await chrome.bookmarks.getTree()) as BookmarkNode[], { name, version }, now);
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(backup, null, 2)}\n`], { type: "application/json" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: backupFileName(name, now) });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    say(`Exported ${backup.icons.length} icon${backup.icons.length === 1 ? "" : "s"} and your settings.`);
  })().catch(() => say("Couldn't export."));
});
const picker = document.getElementById("importFile") as HTMLInputElement;
document.getElementById("import")!.addEventListener("click", () => picker.click());
picker.addEventListener("change", () => {
  const file = picker.files?.[0];
  picker.value = ""; // the same file again is a new choice
  if (!file) return;
  void (async () => {
    if (file.size > MAX_BACKUP_BYTES) return say("That file is too large to be a backup.");
    const checked = checkBackup(await file.text());
    if (typeof checked === "string") return say(checked);
    const plan = planImport(checked, await chrome.storage.local.get(null), (await chrome.bookmarks.getTree()) as BookmarkNode[], Date.now());
    if (Object.keys(plan.write).length > 0) await chrome.storage.local.set(plan.write);
    say(importReport(plan));
  })().catch(() => say("Couldn't import that file."));
});

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") void show();
});
void show();
