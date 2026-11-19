// Chrome adapter for the sweep's Browser seam. Needs no "tabs" permission: IDs, active,
// audible and lastAccessed are available without it; URLs and titles are never read.
import type { Browser, LastUseRecords, WindowSnapshot } from "./sweep";

export const LAST_USE_KEY = "lastUse";
const CLOSE_TIMEOUT_MS = 5_000;

export const chromeBrowser: Browser = {
  async windows(): Promise<WindowSnapshot[]> {
    const wins = await chrome.windows.getAll({ populate: true });
    return wins.flatMap((w) =>
      w.id === undefined
        ? []
        : [
            {
              id: w.id,
              type: w.type ?? "unknown",
              focused: w.focused,
              incognito: w.incognito,
              tabs: (w.tabs ?? []).flatMap((t) =>
                t.id === undefined || t.id === chrome.tabs.TAB_ID_NONE
                  ? []
                  : [{ id: t.id, active: t.active, audible: t.audible ?? false, lastAccessed: t.lastAccessed }],
              ),
            },
          ],
    );
  },

  async lastUseRecords(): Promise<LastUseRecords> {
    const stored = await chrome.storage.session.get(LAST_USE_KEY);
    return (stored[LAST_USE_KEY] as LastUseRecords | undefined) ?? {};
  },

  async createPlaceholder(windowId: number): Promise<void> {
    // No url: Chrome opens its New Tab page. Background, so focus is never stolen.
    await chrome.tabs.create({ windowId, active: false });
  },

  async closeTab(tabId: number): Promise<"closed" | "gone"> {
    // A page with unsaved input can answer with Chrome's "Leave site?" prompt; tabs.remove then
    // waits until someone answers it. Don't let that stall the rest of the sweep: give up
    // waiting, leave the prompt for the user, and move on (feasibility probe D, 2026-11-18).
    const removed = chrome.tabs.remove(tabId).then(
      () => "closed" as const,
      (e: unknown) => {
        if (e instanceof Error && /No tab with id/i.test(e.message)) return "gone" as const;
        throw e;
      },
    );
    const timedOut = new Promise<"blocked">((r) => setTimeout(() => r("blocked"), CLOSE_TIMEOUT_MS));
    const result = await Promise.race([removed, timedOut]);
    if (result === "blocked") throw new Error("close waiting on the page's leave-site prompt");
    return result;
  },
};
