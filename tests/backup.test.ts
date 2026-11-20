import { describe, expect, test } from "vitest";
import { BACKUP_FORMAT, backupFileName, buildBackup, checkBackup, importReport, planImport, type Backup } from "../extension/src/backup";
import type { BookmarkNode } from "../extension/src/sidebar";

const link = (id: string, title: string, url = `https://example.test/${id}`): BookmarkNode => ({ id, title, url });
const folder = (id: string, title: string, children: BookmarkNode[]): BookmarkNode => ({ id, title, children });
const tree = (bar: BookmarkNode[], other: BookmarkNode[] = []): BookmarkNode[] => [
  { id: "0", title: "", children: [folder("1", "Bookmarks bar", bar), folder("2", "Other bookmarks", other)] },
];
// Bar: Mail(10), Work(11: Spec 12, Notes 13 (folder: Old 14)), Recipes(15)
const today = () => tree([link("10", "Mail"), folder("11", "Work", [link("12", "Spec"), folder("13", "Notes", [link("14", "Old")])]), link("15", "Recipes")]);
const EXT = { name: "Selinger Sidebar", version: "0.6.0" };
const NOW = new Date(2026, 10, 20, 14, 30);

const stored = (): Record<string, unknown> => ({
  "icon:10": "📬",
  "icon:11": "folder:green",
  "icon:13": "🗂️",
  "icon:99": "⭐", // its bookmark is gone
  "noExpandAll:11": true,
  "noExpandAll:98": true, // gone too
  expandAll: "every",
  colourTreatment: "warm",
  newBookmarks: "top",
  siteIcons: true,
  enabled: true,
  sidebarFolding: { expanded: ["11", "12", "77"], folded: ["tabs"] },
  // Never exported:
  "siteIcon:https://example.test": { url: null, at: 1 },
  sweepReceipts: [{ closed: 3 }],
  lastSweepAt: 123,
  testGuardMs: 1000,
  dryRun: true,
});

describe("export", () => {
  test("icons with fingerprints, settings and folding; nothing derived or transient", () => {
    const b = buildBackup(stored(), today(), EXT, NOW);
    expect(b).toMatchObject({ format: BACKUP_FORMAT, version: 1, extension: EXT, exportedAt: NOW.toISOString() });
    expect(b.settings).toEqual({ colourTreatment: "warm", newBookmarks: "top", expandAll: "every", siteIcons: true, nightlySweep: true });
    expect(b.noExpand).toEqual([{ id: "11", title: "Work", path: ["Bookmarks bar"] }]);
    expect(b.icons).toEqual([
      { id: "10", title: "Mail", url: "https://example.test/10", icon: "📬" },
      { id: "11", title: "Work", path: ["Bookmarks bar"], icon: "folder:green" },
      { id: "13", title: "Notes", path: ["Bookmarks bar", "Work"], icon: "🗂️" },
    ]);
    expect(b.folding).toEqual({ expanded: [{ id: "11", title: "Work", path: ["Bookmarks bar"] }], folded: ["tabs"] });
    const json = JSON.stringify(b);
    for (const word of ["siteIcon:", "sweepReceipts", "lastSweepAt", "testGuardMs", "dryRun"]) expect(json).not.toContain(word);
  });

  test("a fresh install exports the defaults", () => {
    const b = buildBackup({}, today(), EXT, NOW);
    expect(b.settings).toEqual({ colourTreatment: "neutral", newBookmarks: "bottom", expandAll: "level", siteIcons: false, nightlySweep: false });
    expect(b.noExpand).toEqual([]);
    expect(b.icons).toEqual([]);
  });

  test("the file is named after the extension and the local date", () => {
    expect(backupFileName("Selinger Sidebar", NOW)).toBe("Selinger-Sidebar-backup-2026-11-20.json");
    expect(backupFileName("A/B: C?", NOW)).toBe("AB-C-backup-2026-11-20.json");
    expect(backupFileName("///", NOW)).toBe("sidebar-backup-2026-11-20.json");
  });
});

const roundTrip = (b: Backup) => {
  const checked = checkBackup(JSON.stringify(b));
  if (typeof checked === "string") throw new Error(checked);
  return checked;
};

describe("checking a file", () => {
  test("refuses what isn't a backup of this extension, or comes from a newer version", () => {
    expect(checkBackup("nope")).toMatch(/isn't JSON/);
    expect(checkBackup(JSON.stringify({ format: "other" }))).toMatch(/isn't a backup of this extension/);
    expect(checkBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 2 }))).toMatch(/newer version/);
    expect(checkBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 0 }))).toMatch(/format isn't known/);
    expect(checkBackup("x".repeat(5_000_001))).toMatch(/too large/);
  });

  test("drops and counts entries that aren't icons the editor could make", () => {
    const file = {
      format: BACKUP_FORMAT,
      version: 1,
      icons: [
        { id: "10", title: "Mail", url: "https://example.test/10", icon: "📬" },
        { id: "11", title: "Work", path: ["Bookmarks bar"], icon: "folder:mauve" }, // no such colour
        { id: "10", title: "Mail", url: "https://example.test/10", icon: "folder:blue" }, // a colour on a bookmark
        { id: "10", title: "Mail", url: "https://example.test/10", icon: "AB" }, // two characters
        { id: "", title: "x", url: "u", icon: "⭐" },
        { id: "11", title: "Work", icon: "⭐" }, // a folder needs its path
        { id: "11", title: "Work", path: ["Bookmarks bar"], icon: "👩‍💻" }, // one emoji sequence is fine
        "junk",
      ],
      settings: { colourTreatment: "purple", newBookmarks: "middle", expandAll: "all", siteIcons: "yes", nightlySweep: false },
      noExpand: [{ id: "11", title: "Work", path: ["Bookmarks bar"] }, { id: "10", title: "Mail", url: "https://example.test/10" }, "junk"], // a bookmark can't be marked
      folding: { expanded: [{ id: "12", title: "Spec", url: "https://example.test/12" }], folded: ["tabs", "nope"] },
    };
    const c = checkBackup(JSON.stringify(file));
    expect(c).toMatchObject({ invalid: 6, settings: { nightlySweep: false }, noExpand: [{ id: "11" }], expanded: [], folded: ["tabs"] });
    if (typeof c !== "string") expect(c.settings).not.toHaveProperty("expandAll");
    if (typeof c === "string") return;
    expect(c.icons.map((i) => i.icon)).toEqual(["📬", "👩‍💻"]);
  });
});

describe("import", () => {
  test("same bookmarks: everything comes back, with the sweep's baseline when it's switched on", () => {
    const plan = planImport(roundTrip(buildBackup(stored(), today(), EXT, NOW)), {}, today(), 555);
    expect(plan.write).toEqual({
      "icon:10": "📬",
      "icon:11": "folder:green",
      "icon:13": "🗂️",
      "noExpandAll:11": true,
      colourTreatment: "warm",
      newBookmarks: "top",
      expandAll: "every",
      siteIcons: true,
      enabled: true,
      lastSweepAt: 555,
      sidebarFolding: { expanded: ["11"], folded: ["tabs"] },
    });
    expect(importReport(plan)).toBe("Restored 3 icons and your settings.");
  });

  test("merges: icons on other bookmarks stay; unchanged settings aren't rewritten (the sweep keeps its baseline)", () => {
    const backup = roundTrip(buildBackup(stored(), today(), EXT, NOW));
    const plan = planImport(backup, { "icon:15": "🍳", enabled: true, lastSweepAt: 1, colourTreatment: "warm", newBookmarks: "top", siteIcons: true, sidebarFolding: { expanded: ["13"], folded: [] } }, today(), 555);
    expect(plan.write).not.toHaveProperty("icon:15");
    expect(plan.write).not.toHaveProperty("lastSweepAt");
    expect(plan.write).not.toHaveProperty("enabled");
    expect(plan.write).not.toHaveProperty("newBookmarks");
    expect(plan.write).toMatchObject({ sidebarFolding: { expanded: ["13", "11"], folded: ["tabs"] } });
  });

  test("new IDs (another profile, or bookmarks recreated): matched by title and URL, or title and folder path", () => {
    const backup = roundTrip(buildBackup(stored(), today(), EXT, NOW));
    const elsewhere = tree([link("50", "Mail", "https://example.test/10"), folder("51", "Work", [link("52", "Spec"), folder("53", "Notes", [])])]);
    const plan = planImport(backup, {}, elsewhere, 0);
    expect(plan.write).toMatchObject({ "icon:50": "📬", "icon:51": "folder:green", "icon:53": "🗂️", "noExpandAll:51": true });
    expect(plan.restored).toBe(3);
  });

  test("never the wrong bookmark: an ID now on something else, a moved folder, or two matches are skipped", () => {
    const backup = roundTrip(buildBackup(stored(), today(), EXT, NOW));
    const changed = tree([
      link("10", "Calendar"), // ID 10 is another bookmark now
      link("60", "Mail", "https://example.test/10"),
      link("61", "Mail", "https://example.test/10"), // two Mails: not unique
      folder("2x", "Archive", [folder("11", "Work", [])]), // Work moved under Archive: its path differs
    ]);
    const plan = planImport(backup, {}, changed, 0);
    expect(Object.keys(plan.write).filter((k) => k.startsWith("icon:"))).toEqual([]);
    expect(plan.notFound).toBe(3);
    expect(importReport(plan)).toBe("Restored your settings; 3 icons skipped: their bookmarks weren't found.");
  });

  test("an ID match wins over a fingerprint match elsewhere, and one bookmark never gets two icons", () => {
    const file = roundTrip({
      ...buildBackup({}, today(), EXT, NOW),
      icons: [
        { id: "70", title: "Mail", url: "https://example.test/10", icon: "⭐" }, // gone ID; fingerprint = bookmark 10
        { id: "10", title: "Mail", url: "https://example.test/10", icon: "📬" }, // exact
      ],
    });
    const plan = planImport(file, {}, today(), 0);
    expect(plan.write["icon:10"]).toBe("📬");
    expect(plan.restored).toBe(1);
  });

  test("the report counts invalid entries too", () => {
    expect(importReport({ write: {}, restored: 2, notFound: 1, invalid: 1, settings: false })).toBe(
      "Restored 2 icons; 2 icons skipped: their bookmarks weren't found or they weren't valid.",
    );
  });
});
