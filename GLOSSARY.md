# Glossary

The words the code uses. New concepts get a term here before they get a name in code.

- **Sidebar**: the extension's side panel showing native bookmarks (read-only) above the tabs of the window it sits in; one independent instance per window. Not a tab-strip replacement: Chrome's own tab strip stays.
- **Folding**: which bookmark folders are expanded and which Sidebar sections (Bookmarks, Tabs) are folded; remembered per profile, shared by every window's Sidebar.
- **Colour treatment**: the Sidebar's palette, Neutral (Chrome-like, the default) or Warm; each follows the system's light/dark setting.
- **Navigation footprint**: horizontal pixels the window spends on navigation UI (native tab strip or rail + side panel); the page keeps the rest.
- **Tab instance**: one currently open tab. IDs are session-scoped; a URL alone is not an instance identity.
- **Last use**: the most recent time a tab instance was switched to (Chrome's `lastAccessed`, or the extension's in-session record of activation) or deliberately navigated (a committed navigation that is not a reload). A restored tab with no use since Chrome launched has no in-session last use.
- **Nightly sweep**: one serialized pass per day, at 03:00 local or the first moment Chrome runs after it (wake or launch), that closes tab instances outside the recent-use guard; it never touches bookmarks. Off unless switched on.
- **Recent-use guard**: the window (3 hours) before a nightly sweep; a tab whose last use falls inside it, the focused window's selected tab, and an audible tab survive the sweep.
- **Placeholder tab**: a New Tab page opened before a window's last tab is closed (by the sweep or from the Sidebar), so the window is never closed.
