// Options page: the Sidebar's colour treatment and the nightly sweep's switch.
import { COLOUR_TREATMENT_KEY, SWEEP_ENABLED_KEY, colourTreatment, sweepEnabled, sweepSwitch } from "./settings";

const sweep = document.getElementById("sweep") as HTMLInputElement;
const treatments = [...document.querySelectorAll<HTMLInputElement>('input[name="colourTreatment"]')];

async function show(): Promise<void> {
  const stored = await chrome.storage.local.get([COLOUR_TREATMENT_KEY, SWEEP_ENABLED_KEY]);
  const treatment = colourTreatment(stored[COLOUR_TREATMENT_KEY]);
  for (const t of treatments) t.checked = t.value === treatment;
  sweep.checked = sweepEnabled(stored[SWEEP_ENABLED_KEY]);
}

for (const t of treatments) {
  t.addEventListener("change", () => void chrome.storage.local.set({ [COLOUR_TREATMENT_KEY]: t.value }));
}
sweep.addEventListener("change", () => void chrome.storage.local.set(sweepSwitch(sweep.checked, Date.now())));
document.getElementById("shortcuts")!.addEventListener("click", () => void chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") void show();
});
void show();
