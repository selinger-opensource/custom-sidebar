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
 *  icon). Off unless switched on: new installs never contact sites until someone chooses it. */
export const SITE_ICONS_KEY = "siteIcons";
export const siteIcons = (stored: unknown): boolean => stored === true;

/** Versions 0.4.0 and 0.5.0 had site icons on by default. An install updated from one of them
 *  whose switch was never set keeps them on: true means "write siteIcons: true". */
export function keepSiteIconsOnUpdate(previousVersion: string | undefined, stored: unknown): boolean {
  if (stored !== undefined || previousVersion === undefined) return false;
  const [major = 0, minor = 0] = previousVersion.split(".").map(Number);
  return major === 0 && minor >= 4 && minor < 6;
}

/** Where a new bookmark goes when the panel picks the place rather than the pointer (GLOSSARY.md:
 *  New bookmarks go): a tab or group dropped on a folder or the Bookmarks heading, and the menus'
 *  Bookmark tab, Bookmark all tabs, Save group to bookmarks, Add current tab and New folder. A
 *  drop between two bookmarks goes where it's pointed; moving a bookmark is unchanged. */
export type NewBookmarksAt = "top" | "bottom";
export const NEW_BOOKMARKS_KEY = "newBookmarks";
/** Bottom unless chosen: as Chrome adds bookmarks, and as a drop on a folder always did here. */
export const newBookmarksAt = (stored: unknown): NewBookmarksAt => (stored === "top" ? "top" : "bottom");

/** What site-icon lookups found, one storage key per site (`siteIcon:<origin>`). */
export const SITE_MEMORY_PREFIX = "siteIcon:";

/** Folding (GLOSSARY.md), shared by every window's Sidebar. */
export const FOLDING_KEY = "sidebarFolding";
/** One storage key per Bookmark icon: `icon:<bookmark id>`. */
export const ICON_KEY_PREFIX = "icon:";

/** Expand all opens (GLOSSARY.md: Expand all): one level at a time (the default) or every level. */
export type ExpandAll = "level" | "every";
export const EXPAND_ALL_KEY = "expandAll";
export const expandAllMode = (stored: unknown): ExpandAll => (stored === "every" ? "every" : "level");
/** One storage key per folder marked "Don't expand with Expand all": `noExpandAll:<bookmark id>`. */
export const NO_EXPAND_PREFIX = "noExpandAll:";
