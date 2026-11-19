// Chrome adapter for the Sidebar's SidebarBrowser seam. Reads bookmarks and writes them only for a
// Bookmark edit, reads the tabs of one window, and turns every bookmark, tab and Folding change
// into a SidebarEvent, leaving the filtering to the session in sidebar.ts.
import { NO_FOLDING, type BookmarkIcons, type BookmarkNode, type Folding, type IconChanges, type SidebarBrowser, type TabInfo } from "./sidebar";

export const FOLDING_KEY = "sidebarFolding";
/** One storage key per Bookmark icon: `icon:<bookmark id>`. */
export const ICON_KEY_PREFIX = "icon:";

const toTabInfo = (t: chrome.tabs.Tab): TabInfo[] =>
  t.id === undefined || t.id === chrome.tabs.TAB_ID_NONE
    ? []
    : [{ id: t.id, title: t.title ?? "", url: t.url ?? t.pendingUrl ?? "", active: t.active, audible: t.audible ?? false }];

export const chromeSidebar: SidebarBrowser = {
  async currentWindowId() {
    const win = await chrome.windows.getCurrent();
    if (win.id === undefined) throw new Error("the Sidebar's window has no id");
    return win.id;
  },

  async bookmarkTree() {
    return (await chrome.bookmarks.getTree()) as BookmarkNode[];
  },

  async tabs(windowId) {
    return (await chrome.tabs.query({ windowId })).flatMap(toTabInfo);
  },

  async loadFolding() {
    const stored = await chrome.storage.local.get(FOLDING_KEY);
    return stored[FOLDING_KEY] as Folding | undefined;
  },

  async saveFolding(folding) {
    await chrome.storage.local.set({ [FOLDING_KEY]: folding });
  },

  async loadIcons() {
    const icons: BookmarkIcons = {};
    for (const [key, value] of Object.entries(await chrome.storage.local.get(null))) {
      if (key.startsWith(ICON_KEY_PREFIX) && typeof value === "string") icons[key.slice(ICON_KEY_PREFIX.length)] = value;
    }
    return icons;
  },

  async saveIcons(changes) {
    const set = Object.fromEntries(Object.entries(changes).flatMap(([id, icon]) => (icon === null ? [] : [[ICON_KEY_PREFIX + id, icon]])));
    const removed = Object.entries(changes).flatMap(([id, icon]) => (icon === null ? [ICON_KEY_PREFIX + id] : []));
    if (Object.keys(set).length > 0) await chrome.storage.local.set(set);
    if (removed.length > 0) await chrome.storage.local.remove(removed);
  },

  subscribe(listener) {
    const bookmarks = () => listener({ kind: "bookmarks" });
    chrome.bookmarks.onCreated.addListener(bookmarks);
    chrome.bookmarks.onRemoved.addListener(bookmarks);
    chrome.bookmarks.onChanged.addListener(bookmarks);
    chrome.bookmarks.onMoved.addListener(bookmarks);
    chrome.bookmarks.onChildrenReordered.addListener(bookmarks);
    chrome.bookmarks.onImportEnded.addListener(bookmarks);

    const tabs = (windowId?: number, changed?: string[]) =>
      listener({ kind: "tabs", ...(windowId !== undefined && { windowId }), ...(changed && { changed }) });
    chrome.tabs.onCreated.addListener((t) => tabs(t.windowId));
    chrome.tabs.onUpdated.addListener((_id, change, t) => tabs(t.windowId, Object.keys(change)));
    chrome.tabs.onActivated.addListener((i) => tabs(i.windowId));
    chrome.tabs.onMoved.addListener((_id, i) => tabs(i.windowId));
    chrome.tabs.onRemoved.addListener((_id, i) => tabs(i.windowId));
    chrome.tabs.onAttached.addListener((_id, i) => tabs(i.newWindowId));
    chrome.tabs.onDetached.addListener((_id, i) => tabs(i.oldWindowId));
    chrome.tabs.onReplaced.addListener(() => tabs());

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      const change = changes[FOLDING_KEY];
      if (change) listener({ kind: "folding", folding: (change.newValue as Folding | undefined) ?? NO_FOLDING });
      const icons: IconChanges = {};
      for (const [key, { newValue }] of Object.entries(changes)) {
        if (key.startsWith(ICON_KEY_PREFIX)) icons[key.slice(ICON_KEY_PREFIX.length)] = typeof newValue === "string" ? newValue : null;
      }
      if (Object.keys(icons).length > 0) listener({ kind: "icons", changes: icons });
    });
  },

  async openBookmark(windowId, url, background) {
    await chrome.tabs.create({ windowId, url, active: !background });
  },

  async selectTab(tabId) {
    await chrome.tabs.update(tabId, { active: true });
  },

  async closeTab(tabId) {
    await chrome.tabs.remove(tabId);
  },

  async newTab(windowId) {
    await chrome.tabs.create({ windowId });
  },

  async moveBookmark(id, to) {
    await chrome.bookmarks.move(id, to);
  },

  async updateBookmark(id, changes) {
    await chrome.bookmarks.update(id, changes);
  },

  async removeBookmark(id, whole) {
    // What Undo rebuilds: the subtree Chrome's removal event reports, which is exactly what went;
    // the copy read just before stands in if that event doesn't arrive. (The rows may lag both.)
    const [before] = await chrome.bookmarks.getSubTree(id);
    if (!before) throw new Error("bookmark not found");
    let listener: Parameters<typeof chrome.bookmarks.onRemoved.addListener>[0] = () => {};
    const reported = new Promise<BookmarkNode>((resolve) => {
      listener = (removedId, info) => {
        if (removedId === id) resolve(info.node as BookmarkNode);
      };
      chrome.bookmarks.onRemoved.addListener(listener);
    });
    try {
      if (whole && before.url === undefined) await chrome.bookmarks.removeTree(id);
      else await chrome.bookmarks.remove(id); // refuses a folder with anything in it
      const fallback = new Promise<BookmarkNode>((resolve) => setTimeout(() => resolve(before as BookmarkNode), 1000));
      return await Promise.race([reported, fallback]);
    } finally {
      chrome.bookmarks.onRemoved.removeListener(listener);
    }
  },

  async createBookmark(at, node) {
    return (await chrome.bookmarks.create({ ...at, ...node })).id;
  },
};
