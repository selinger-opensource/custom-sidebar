// Chrome adapter for the Sidebar's SidebarBrowser seam. Reads bookmarks (never writes them) and
// the tabs of one window; turns every bookmark, tab and Folding change into a SidebarEvent and
// leaves the filtering to the session in sidebar.ts.
import { NO_FOLDING, type BookmarkNode, type Folding, type SidebarBrowser, type TabInfo } from "./sidebar";

export const FOLDING_KEY = "sidebarFolding";

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
      const change = changes[FOLDING_KEY];
      if (area === "local" && change) listener({ kind: "folding", folding: (change.newValue as Folding | undefined) ?? NO_FOLDING });
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
};
