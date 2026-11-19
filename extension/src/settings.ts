// Settings the options page writes and the service worker and Sidebar read, in storage.local.
// Missing values mean the defaults: a fresh install has the Neutral treatment and the sweep off.

/** Vocabulary: GLOSSARY.md (Colour treatment). */
export type ColourTreatment = "neutral" | "warm";

export const COLOUR_TREATMENT_KEY = "colourTreatment";
/** The nightly sweep's switch. Kept as "enabled" so earlier installs and console notes still apply. */
export const SWEEP_ENABLED_KEY = "enabled";

export const colourTreatment = (stored: unknown): ColourTreatment => (stored === "warm" ? "warm" : "neutral");

/** Off unless switched on: new installs never sweep until someone chooses it. */
export const sweepEnabled = (stored: unknown): boolean => stored === true;

/** The storage write for the options page's sweep switch. Switching on writes the new baseline
 *  in the same write, so no sweep check can ever see "on" with an old baseline. */
export const sweepSwitch = (on: boolean, now: number): Record<string, unknown> =>
  on ? { [SWEEP_ENABLED_KEY]: true, lastSweepAt: now } : { [SWEEP_ENABLED_KEY]: false };

/** True when a storage change switches the sweep on, from off or from never set, however it was
 *  written (the console, say). The sweep's baseline then restarts, so the first sweep is the
 *  next 03:00, never a catch-up. */
export const sweepSwitchedOn = (oldValue: unknown, newValue: unknown): boolean =>
  sweepEnabled(newValue) && !sweepEnabled(oldValue);

/** Fetch a site icon from the bookmark's own site when Chrome has none cached (GLOSSARY.md: Site
 *  icon). On unless switched off. */
export const SITE_ICONS_KEY = "siteIcons";
export const siteIcons = (stored: unknown): boolean => stored !== false;

/** What site-icon lookups found, one storage key per site (`siteIcon:<origin>`). */
export const SITE_MEMORY_PREFIX = "siteIcon:";
