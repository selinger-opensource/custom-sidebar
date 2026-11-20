// Backup (GLOSSARY.md): the options page's Export and Import of what a person set up — Bookmark
// icons, folders marked "Don't expand with Expand all", settings and Folding — as a JSON file, so an uninstall (which wipes storage.local) loses
// nothing. Pure: building the file, checking one, and matching its icons to today's bookmarks.
// Never exported: what the extension works out for itself (site-icon lookups, sweep receipts and
// baseline, test knobs) and session storage.
import { folderColour, iconText, type BookmarkNode, type Folding } from "./sidebar";
import { COLOUR_TREATMENT_KEY, EXPAND_ALL_KEY, FOLDING_KEY, ICON_KEY_PREFIX, NEW_BOOKMARKS_KEY, NO_EXPAND_PREFIX, expandAllMode, type ExpandAll, SITE_ICONS_KEY, SWEEP_ENABLED_KEY, colourTreatment, newBookmarksAt, siteIcons, sweepEnabled, sweepSwitch, type ColourTreatment, type NewBookmarksAt } from "./settings";

export const BACKUP_FORMAT = "compact-sidebar-backup";
export const BACKUP_VERSION = 1;
/** Larger files are refused before they're read. */
export const MAX_BACKUP_BYTES = 5_000_000;
const MAX_ITEMS = 50_000;
const MAX_TEXT = 4_096;
const MAX_PATH = 64;

/** A bookmark or folder as a backup recognises it on another day or machine, beside its ID: a
 *  bookmark by title and URL, a folder by title and the titles of the folders above it (from a
 *  root, e.g. "Bookmarks bar"). */
export interface Fingerprint {
  id: string;
  title: string;
  url?: string;
  path?: string[];
}
export interface BackupIcon extends Fingerprint {
  icon: string;
}
export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  /** The extension's version and name that wrote it, and when (ISO 8601). */
  extension: { name: string; version: string };
  exportedAt: string;
  settings: { colourTreatment: ColourTreatment; newBookmarks: NewBookmarksAt; expandAll: ExpandAll; siteIcons: boolean; nightlySweep: boolean };
  icons: BackupIcon[];
  /** Folders marked "Don't expand with Expand all". */
  noExpand: Fingerprint[];
  /** Expanded folders (as fingerprints) and folded sections. */
  folding: { expanded: Fingerprint[]; folded: string[] };
}

// --- Fingerprints. ----------------------------------------------------------------------------
interface Located {
  node: BookmarkNode;
  path: string[];
}
/** Every bookmark and folder under the root, with the titles of the folders above it. */
function index(tree: BookmarkNode[]): Map<string, Located> {
  const all = new Map<string, Located>();
  const walk = (nodes: BookmarkNode[], path: string[]) => {
    for (const node of nodes) {
      all.set(node.id, { node, path });
      if (node.children) walk(node.children, [...path, node.title]);
    }
  };
  for (const root of tree) walk(root.children ?? [], []); // the invisible root has no title
  return all;
}
const fingerprintOf = ({ node, path }: Located): Fingerprint =>
  node.url !== undefined ? { id: node.id, title: node.title, url: node.url } : { id: node.id, title: node.title, path };
const sameKey = (f: Omit<Fingerprint, "id">) => JSON.stringify(f.url !== undefined ? ["b", f.title, f.url] : ["f", f.title, ...(f.path ?? [])]);

/** Where each fingerprint lands today: the bookmark with its ID if that still matches it, else the
 *  one bookmark anywhere that does (if no other entry claimed it by ID). Undefined: not found, or
 *  more than one match — never a guess. */
function matchAll<T extends Fingerprint>(entries: T[], tree: BookmarkNode[]): (string | undefined)[] {
  const all = index(tree);
  const byKey = new Map<string, string[]>();
  for (const located of all.values()) {
    const key = sameKey(fingerprintOf(located));
    byKey.set(key, [...(byKey.get(key) ?? []), located.node.id]);
  }
  const taken = new Set<string>();
  const found: (string | undefined)[] = entries.map((e) => {
    const here = all.get(e.id);
    if (here && sameKey(fingerprintOf(here)) === sameKey(e) && !taken.has(e.id)) {
      taken.add(e.id);
      return e.id;
    }
    return undefined;
  });
  return entries.map((e, i) => {
    if (found[i] !== undefined) return found[i];
    const candidates = (byKey.get(sameKey(e)) ?? []).filter((id) => !taken.has(id));
    if (candidates.length !== 1 || (byKey.get(sameKey(e)) ?? []).length !== 1) return undefined;
    taken.add(candidates[0]!);
    return candidates[0];
  });
}

// --- Export. ----------------------------------------------------------------------------------
/** The backup of `stored` (all of storage.local) against today's bookmark `tree`. Icons on
 *  bookmarks that are gone are left out. */
export function buildBackup(stored: Record<string, unknown>, tree: BookmarkNode[], extension: { name: string; version: string }, now: Date): Backup {
  const all = index(tree);
  const icons: BackupIcon[] = [];
  for (const [key, value] of Object.entries(stored)) {
    const located = key.startsWith(ICON_KEY_PREFIX) ? all.get(key.slice(ICON_KEY_PREFIX.length)) : undefined;
    if (located && typeof value === "string") icons.push({ ...fingerprintOf(located), icon: value });
  }
  const noExpand = Object.entries(stored).flatMap(([key, value]) => {
    const located = key.startsWith(NO_EXPAND_PREFIX) && value === true ? all.get(key.slice(NO_EXPAND_PREFIX.length)) : undefined;
    return located && located.node.url === undefined ? [fingerprintOf(located)] : [];
  });
  const folding = (stored[FOLDING_KEY] ?? {}) as Partial<Folding>;
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    extension,
    exportedAt: now.toISOString(),
    settings: {
      colourTreatment: colourTreatment(stored[COLOUR_TREATMENT_KEY]),
      newBookmarks: newBookmarksAt(stored[NEW_BOOKMARKS_KEY]),
      expandAll: expandAllMode(stored[EXPAND_ALL_KEY]),
      siteIcons: siteIcons(stored[SITE_ICONS_KEY]),
      nightlySweep: sweepEnabled(stored[SWEEP_ENABLED_KEY]),
    },
    icons,
    noExpand,
    folding: {
      expanded: (Array.isArray(folding.expanded) ? folding.expanded : []).flatMap((id) => {
        const located = all.get(id);
        return located && located.node.url === undefined ? [fingerprintOf(located)] : [];
      }),
      folded: Array.isArray(folding.folded) ? folding.folded : [],
    },
  };
}

/** The file name: `<name>-backup-YYYY-MM-DD.json`, the name made file-safe, the date local. */
export function backupFileName(name: string, now: Date): string {
  const safe = name.replace(/[^\p{L}\p{N} _-]/gu, "").trim().replace(/\s+/g, "-") || "sidebar";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${safe}-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

// --- Checking a file. -------------------------------------------------------------------------
/** A file checked: what it holds that's usable, and how many icon entries were unusable. */
export interface CheckedBackup {
  settings: Partial<Backup["settings"]>;
  icons: BackupIcon[];
  noExpand: Fingerprint[];
  expanded: Fingerprint[];
  folded: ("bookmarks" | "tabs")[] | undefined;
  invalid: number;
}

const text = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_TEXT;
function fingerprint(v: unknown): Fingerprint | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const { id, title, url, path } = v as Record<string, unknown>;
  if (!text(id) || id === "" || !text(title)) return undefined;
  if (url !== undefined) return text(url) && path === undefined ? { id, title, url } : undefined;
  if (!Array.isArray(path) || path.length > MAX_PATH || !path.every(text)) return undefined;
  return { id, title, path };
}
/** A Bookmark icon as the editor makes them: a folder colour (on folders only) or one emoji. */
function validIcon(icon: unknown, folder: boolean): icon is string {
  if (typeof icon !== "string" || icon.length > 64) return false;
  if (folderColour(icon) !== undefined) return folder;
  return !icon.startsWith("folder:") && iconText(icon) === icon;
}

/** The backup in `json`, or a sentence saying why it can't be used. Bad entries are counted
 *  and dropped; a file that isn't a backup at all is refused. */
export function checkBackup(json: string): CheckedBackup | string {
  if (json.length > MAX_BACKUP_BYTES) return "That file is too large to be a backup.";
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return "That file isn't a backup (it isn't JSON).";
  }
  const file = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
  if (file.format !== BACKUP_FORMAT) return "That file isn't a backup of this extension.";
  if (typeof file.version !== "number" || file.version > BACKUP_VERSION) return "That backup comes from a newer version of the extension; update it first.";
  if (file.version !== BACKUP_VERSION) return "That backup's format isn't known.";
  const icons = Array.isArray(file.icons) ? file.icons : [];
  if (icons.length > MAX_ITEMS) return "That backup has too many icons to be real.";
  const checked: CheckedBackup = { settings: {}, icons: [], noExpand: [], expanded: [], folded: undefined, invalid: 0 };
  for (const entry of icons) {
    const f = fingerprint(entry);
    const icon = (entry as { icon?: unknown } | null)?.icon;
    if (f && validIcon(icon, f.url === undefined)) checked.icons.push({ ...f, icon });
    else checked.invalid++;
  }
  const s = (typeof file.settings === "object" && file.settings !== null ? file.settings : {}) as Record<string, unknown>;
  if (s.colourTreatment === "neutral" || s.colourTreatment === "warm") checked.settings.colourTreatment = s.colourTreatment;
  if (s.newBookmarks === "top" || s.newBookmarks === "bottom") checked.settings.newBookmarks = s.newBookmarks;
  if (s.expandAll === "level" || s.expandAll === "every") checked.settings.expandAll = s.expandAll;
  const marks = Array.isArray(file.noExpand) ? file.noExpand.slice(0, MAX_ITEMS) : [];
  checked.noExpand = marks.flatMap((e) => {
    const f = fingerprint(e);
    return f && f.url === undefined ? [f] : [];
  });
  if (typeof s.siteIcons === "boolean") checked.settings.siteIcons = s.siteIcons;
  if (typeof s.nightlySweep === "boolean") checked.settings.nightlySweep = s.nightlySweep;
  const folding = (typeof file.folding === "object" && file.folding !== null ? file.folding : {}) as Record<string, unknown>;
  const expanded = Array.isArray(folding.expanded) ? folding.expanded.slice(0, MAX_ITEMS) : [];
  checked.expanded = expanded.flatMap((e) => {
    const f = fingerprint(e);
    return f && f.url === undefined ? [f] : [];
  });
  if (Array.isArray(folding.folded)) checked.folded = folding.folded.filter((x): x is "bookmarks" | "tabs" => x === "bookmarks" || x === "tabs");
  return checked;
}

// --- Import. ----------------------------------------------------------------------------------
export interface ImportPlan {
  /** One storage.local write. */
  write: Record<string, unknown>;
  restored: number;
  /** Icons whose bookmark wasn't found (or wasn't unique), and unusable entries. */
  notFound: number;
  invalid: number;
  settings: boolean;
}

/** What importing `backup` writes, merged into `stored` (storage.local now) against today's
 *  `tree`: its icons on the bookmarks they match (other bookmarks' icons stay), its Expand all
 *  marks on the folders they match (others' marks stay), its settings, its
 *  expanded folders added to today's and its folded sections. Switching the sweep on writes its
 *  baseline too (sweepSwitch); a setting that's unchanged isn't written. */
export function planImport(backup: CheckedBackup, stored: Record<string, unknown>, tree: BookmarkNode[], now: number): ImportPlan {
  const write: Record<string, unknown> = {};
  const matched = matchAll(backup.icons, tree);
  backup.icons.forEach((entry, i) => {
    const id = matched[i];
    if (id !== undefined) write[ICON_KEY_PREFIX + id] = entry.icon;
  });
  const restored = matched.filter((id) => id !== undefined).length;

  for (const id of matchAll(backup.noExpand, tree)) if (id !== undefined) write[NO_EXPAND_PREFIX + id] = true;

  const { colourTreatment: treatment, newBookmarks, expandAll, siteIcons: icons, nightlySweep } = backup.settings;
  if (expandAll !== undefined && expandAll !== expandAllMode(stored[EXPAND_ALL_KEY])) write[EXPAND_ALL_KEY] = expandAll;
  if (treatment !== undefined && treatment !== colourTreatment(stored[COLOUR_TREATMENT_KEY])) write[COLOUR_TREATMENT_KEY] = treatment;
  if (newBookmarks !== undefined && newBookmarks !== newBookmarksAt(stored[NEW_BOOKMARKS_KEY])) write[NEW_BOOKMARKS_KEY] = newBookmarks;
  if (icons !== undefined && icons !== siteIcons(stored[SITE_ICONS_KEY])) write[SITE_ICONS_KEY] = icons;
  if (nightlySweep !== undefined && nightlySweep !== sweepEnabled(stored[SWEEP_ENABLED_KEY])) Object.assign(write, sweepSwitch(nightlySweep, now));

  const folding = (stored[FOLDING_KEY] ?? {}) as Partial<Folding>;
  const today = Array.isArray(folding.expanded) ? folding.expanded : [];
  const opened = matchAll(backup.expanded, tree).filter((id): id is string => id !== undefined);
  const expanded = [...new Set([...today, ...opened])];
  const folded = backup.folded ?? (Array.isArray(folding.folded) ? folding.folded : []);
  if (opened.some((id) => !today.includes(id)) || backup.folded !== undefined) write[FOLDING_KEY] = { expanded, folded } satisfies Folding;

  return { write, restored, notFound: backup.icons.length - restored, invalid: backup.invalid, settings: Object.keys(backup.settings).length > 0 };
}

/** The options page's sentence after an import. */
export function importReport(plan: ImportPlan): string {
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  const what = [plan.restored > 0 || !plan.settings ? `${n(plan.restored, "icon")}` : "", plan.settings ? "your settings" : ""].filter(Boolean).join(" and ");
  const skipped = plan.notFound + plan.invalid;
  const why = plan.invalid === 0 ? "their bookmarks weren't found" : plan.notFound === 0 ? "they weren't valid" : "their bookmarks weren't found or they weren't valid";
  return `Restored ${what}${skipped > 0 ? `; ${n(skipped, "icon")} skipped: ${why}` : ""}.`;
}
