// Chrome adapter for the Sidebar's SidebarBrowser seam. Reads bookmarks and writes them only for a
// Bookmark edit, reads the tabs and tab groups of one window, and turns every bookmark, tab, group
// and Folding change into a SidebarEvent, leaving the filtering to the session in sidebar.ts.
import { NO_FOLDING, type BookmarkIcons, type BookmarkNode, type Folding, type IconChanges, type ReopenedTab, type SidebarBrowser, type TabInfo } from "./sidebar";

import { FOLDING_KEY, ICON_KEY_PREFIX, NO_EXPAND_PREFIX } from "./settings";

export { FOLDING_KEY, ICON_KEY_PREFIX };

// Before its first page commits, a tab's url is "" and pendingUrl has the address.
const toTabInfo = (t: chrome.tabs.Tab): TabInfo[] =>
  t.id === undefined || t.id === chrome.tabs.TAB_ID_NONE
    ? []
    : [{ id: t.id, title: t.title ?? "", url: t.url || t.pendingUrl || "", active: t.active, audible: t.audible ?? false, pinned: t.pinned, groupId: t.groupId,
        muted: t.mutedInfo?.muted ?? false, ...(t.splitViewId !== undefined && t.splitViewId !== -1 && { splitViewId: t.splitViewId }) }];

/** Opens tabs again, in the background, at their old positions (ascending `index`), each on its
 *  own, and back into their groups: the old one while it's still open, else one new group per old
 *  one with its title and colour. Resolves to the tabs that couldn't be opened. */
async function reopen(windowId: number, tabs: ReopenedTab[]): Promise<ReopenedTab[]> {
  const failed: ReopenedTab[] = [];
  const regrouped = new Map<number, number>(); // old group id → the group it reopens into
  for (const tab of [...tabs].sort((a, b) => a.index - b.index)) {
    let id: number | undefined;
    try {
      id = (await chrome.tabs.create({ windowId, index: tab.index, active: false, ...(tab.url && { url: tab.url }) })).id;
    } catch {
      failed.push(tab);
      continue;
    }
    const was = tab.group;
    if (!was || id === undefined) continue;
    try {
      let into = regrouped.get(was.id);
      if (into === undefined && (await chrome.tabGroups.get(was.id).then((g) => g.windowId === windowId, () => false))) into = was.id;
      if (into !== undefined) await chrome.tabs.group({ groupId: into, tabIds: [id] });
      else {
        into = await chrome.tabs.group({ tabIds: [id], createProperties: { windowId } });
        await chrome.tabGroups.update(into, { title: was.title, color: was.colour });
      }
      regrouped.set(was.id, into);
    } catch {
      // Open, if not in its group.
    }
  }
  return failed;
}

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

  async loadSkips() {
    return Object.entries(await chrome.storage.local.get(null)).flatMap(([key, value]) => (key.startsWith(NO_EXPAND_PREFIX) && value === true ? [key.slice(NO_EXPAND_PREFIX.length)] : []));
  },

  async saveSkips(changes) {
    const set = Object.fromEntries(Object.entries(changes).flatMap(([id, on]) => (on ? [[NO_EXPAND_PREFIX + id, true]] : [])));
    const removed = Object.entries(changes).flatMap(([id, on]) => (on ? [] : [NO_EXPAND_PREFIX + id]));
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
    // A group's title, colour, collapsed state or place; its tabs' groupId changes come as tab updates.
    const group = (g: chrome.tabGroups.TabGroup) => tabs(g.windowId);
    chrome.tabGroups.onCreated.addListener(group);
    chrome.tabGroups.onUpdated.addListener(group);
    chrome.tabGroups.onRemoved.addListener(group);
    chrome.tabGroups.onMoved.addListener(group);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      const change = changes[FOLDING_KEY];
      if (change) listener({ kind: "folding", folding: (change.newValue as Folding | undefined) ?? NO_FOLDING });
      const icons: IconChanges = {};
      for (const [key, { newValue }] of Object.entries(changes)) {
        if (key.startsWith(ICON_KEY_PREFIX)) icons[key.slice(ICON_KEY_PREFIX.length)] = typeof newValue === "string" ? newValue : null;
      }
      if (Object.keys(icons).length > 0) listener({ kind: "icons", changes: icons });
      const skips: Record<string, boolean> = {};
      for (const [key, { newValue }] of Object.entries(changes)) {
        if (key.startsWith(NO_EXPAND_PREFIX)) skips[key.slice(NO_EXPAND_PREFIX.length)] = newValue === true;
      }
      if (Object.keys(skips).length > 0) listener({ kind: "skips", changes: skips });
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

  async closeTabs(tabIds) {
    const results = await Promise.allSettled(tabIds.map((id) => chrome.tabs.remove(id)));
    return tabIds.filter((_, i) => results[i]!.status === "fulfilled");
  },

  async reopenTabs(windowId, tabs) {
    return reopen(windowId, tabs);
  },

  async newTabAt(windowId, index, groupId) {
    const tab = await chrome.tabs.create({ windowId, index, active: true });
    if (tab.id === undefined) throw new Error("the new tab has no id");
    if (groupId !== undefined) await chrome.tabs.group({ groupId, tabIds: [tab.id] });
    return tab.id;
  },

  async groupTab(tabId, groupId) {
    return chrome.tabs.group({ tabIds: [tabId], ...(groupId !== undefined && { groupId }) });
  },

  async moveTab(tabId, windowId, index) {
    await chrome.tabs.move(tabId, { windowId, index });
  },

  async moveTabToNewWindow(tabId) {
    await chrome.windows.create({ tabId, focused: true });
  },

  async reloadTab(tabId) {
    await chrome.tabs.reload(tabId);
  },

  async duplicateTab(tabId) {
    await chrome.tabs.duplicate(tabId);
  },

  async updateTab(tabId, { pinned, muted }) {
    await chrome.tabs.update(tabId, { ...(pinned !== undefined && { pinned }), ...(muted !== undefined && { muted }) });
  },

  canSplit: typeof chrome.tabs.createSplit === "function",

  async createSplit(tabIds) {
    await chrome.tabs.createSplit(tabIds);
  },

  async unsplit(splitViewId) {
    await chrome.tabs.unsplit(splitViewId);
  },

  async moveTabs(tabIds, index) {
    await chrome.tabs.move(tabIds, { index });
  },

  async moveGroup(groupId, index) {
    await chrome.tabGroups.move(groupId, { index });
  },

  async groupInto(tabIds, groupId) {
    await chrome.tabs.group({ groupId, tabIds: tabIds as [number, ...number[]] });
  },

  async openTabs(windowId, urls) {
    const opened: number[] = [];
    for (const url of urls) {
      const id = await chrome.tabs.create({ windowId, url, active: false }).then((t) => t.id, () => undefined);
      if (id !== undefined) opened.push(id);
    }
    return opened;
  },

  async groupTabs(windowId, tabIds, title, colour) {
    const id = await chrome.tabs.group({ tabIds: tabIds as [number, ...number[]], createProperties: { windowId } });
    await chrome.tabGroups.update(id, { title, ...(colour !== undefined && { color: colour }) });
    return id;
  },

  async openWindow(urls, incognito) {
    // One call with every page: an extension kept out of incognito ("not_allowed") can open an
    // incognito window but gets no handle on it to add tabs afterwards (checked in Chrome 158).
    await chrome.windows.create({ url: urls, focused: true, ...(incognito && { incognito: true }) });
  },

  async groupTitles() {
    return (await chrome.tabGroups.query({})).map((g) => g.title ?? "");
  },

  async otherWindows(windowId) {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
    return windows.flatMap((w) => {
      if (w.id === undefined || w.id === windowId || w.incognito) return [];
      const tabs = w.tabs ?? [];
      const shown = tabs.find((t) => t.active);
      return [{ id: w.id, title: shown?.title || shown?.url || "Window", tabs: tabs.length }];
    });
  },

  async tabGroups(windowId) {
    return (await chrome.tabGroups.query({ windowId })).map((g) => ({ id: g.id, title: g.title ?? "", colour: g.color, collapsed: g.collapsed }));
  },

  async updateGroup(groupId, { title, colour, collapsed }) {
    await chrome.tabGroups.update(groupId, { ...(title !== undefined && { title }), ...(colour !== undefined && { color: colour }), ...(collapsed !== undefined && { collapsed }) });
  },

  async moveGroupToNewWindow(groupId) {
    // A new window comes with a New Tab; the group goes in after it, and then the New Tab goes.
    const win = await chrome.windows.create({ focused: true });
    const windowId = win?.id;
    if (windowId === undefined) throw new Error("the new window has no id");
    try {
      await chrome.tabGroups.move(groupId, { windowId, index: -1 });
    } catch (error) {
      await chrome.windows.remove(windowId);
      throw error;
    }
    const placeholder = win?.tabs?.[0]?.id;
    if (placeholder !== undefined) await chrome.tabs.remove(placeholder);
  },

  async closeGroups(groupIds) {
    // Closing a window keeps its groups in Chrome's saved tab groups, as Chrome's own Close group
    // does; removing a group's tabs deletes it from them, as its Delete group does (both checked
    // in Chrome 158). The tabGroups API has no close of its own, so: the groups move into a
    // minimized window of their own, which then closes.
    const windowId = (await chrome.windows.create({ focused: false, state: "minimized" }))?.id;
    if (windowId === undefined) throw new Error("the new window has no id");
    try {
      for (const groupId of groupIds) await chrome.tabGroups.move(groupId, { windowId, index: -1 });
    } finally {
      await chrome.windows.remove(windowId);
    }
  },

  async ungroupTabs(tabIds) {
    await chrome.tabs.ungroup(tabIds as [number, ...number[]]);
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
