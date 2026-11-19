// Options page: the Sidebar's colour treatment, site icons, and the nightly sweep's switch.
import { COLOUR_TREATMENT_KEY, SITE_ICONS_KEY, SWEEP_ENABLED_KEY, colourTreatment, siteIcons, sweepEnabled, sweepSwitch } from "./settings";

// The tab title names the extension: "<name> options", from the manifest so builds can differ.
document.title = `${chrome.runtime.getManifest().name} options`;

const sweep = document.getElementById("sweep") as HTMLInputElement;
const icons = document.getElementById("siteIcons") as HTMLInputElement;
const treatments = [...document.querySelectorAll<HTMLInputElement>('input[name="colourTreatment"]')];

async function show(): Promise<void> {
  const stored = await chrome.storage.local.get([COLOUR_TREATMENT_KEY, SWEEP_ENABLED_KEY, SITE_ICONS_KEY]);
  const treatment = colourTreatment(stored[COLOUR_TREATMENT_KEY]);
  for (const t of treatments) t.checked = t.value === treatment;
  sweep.checked = sweepEnabled(stored[SWEEP_ENABLED_KEY]);
  icons.checked = siteIcons(stored[SITE_ICONS_KEY]);
}

for (const t of treatments) {
  t.addEventListener("change", () => void chrome.storage.local.set({ [COLOUR_TREATMENT_KEY]: t.value }));
}
sweep.addEventListener("change", () => void chrome.storage.local.set(sweepSwitch(sweep.checked, Date.now())));
icons.addEventListener("change", () => void chrome.storage.local.set({ [SITE_ICONS_KEY]: icons.checked }));
document.getElementById("shortcuts")!.addEventListener("click", () => void chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") void show();
});
void show();
