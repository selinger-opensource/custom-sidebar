# Compact Sidebar

A Chrome extension that puts your **bookmarks above the tabs of the current window** in one side panel, so a laptop screen doesn't spend 600 px on navigation. Optionally, it also runs a **nightly sweep** that closes tabs you haven't used in three hours.

<p>
  <img src="docs/screenshots/panel-neutral-light.png" width="300" alt="The side panel in the Neutral colours: a Bookmarks section with folders, then the window's tabs with the selected one highlighted">
  &nbsp;
  <img src="docs/screenshots/panel-warm-light.png" width="300" alt="The same panel in the Warm colours">
</p>

*Screenshots use invented bookmarks and pages.*

## What it does

- **Bookmarks** from Chrome's own bookmarks: the bookmarks bar inline, folders that expand, "Other bookmarks" as a folder. Clicking one opens it in this window (⌘/Ctrl-click or middle-click: in the background).
- **Edit bookmarks in place:** drag to move bookmarks and folders, drag a tab in to save it, and right-click for Edit (title and URL), Delete, New folder and Add current tab. Keys: F2 edit, Delete delete, ⌥↑/⌥↓ move, ⌘/Ctrl+Z undo, Shift+F10 menu. The last edit can be undone from the footer.
- **Tabs** of the window the panel sits in, in tab-strip order: click to switch, × or middle-click to close, and a New tab row. Each window has its own independent panel.
- Both sections fold, and the panel remembers which folders are open.
- Updates live from Chrome's events; nothing polls.
- Two colour treatments, **Neutral** (like Chrome, the default) and **Warm**, each following your system's light or dark mode.
- **Nightly sweep (off by default):** once a day at 03:00, or the first time Chrome runs after that, it closes tabs not used in the last 3 hours. It keeps the selected tab of the focused window and tabs playing audio, never closes a window, and never touches bookmarks. Switch it on in the options.

What it deliberately doesn't do: show tabs of other windows, search, archive tabs, replace the New Tab page, or phone home.

## Install

There's no Chrome Web Store listing. Chrome 150 or newer.

1. Download the latest `compact-sidebar-<version>.zip` from [Releases](../../releases) and unzip it somewhere permanent (Chrome runs the extension from that folder).
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the unzipped folder.
3. Pin the icon in the toolbar. Click it, or press **Ctrl+Shift+S** (**⇧⌘S** on a Mac), to open or close the panel. Change the shortcut at `chrome://extensions/shortcuts`.

Recommended layout, for the smallest footprint: in Chrome's settings put the **side panel on the left**, and if you use vertical tabs, collapse them to the narrow icon rail. Chrome's tab strip itself can't be hidden by an extension, so your tabs appear both there and in the panel.

### Options

Right-click the icon → **Options**: colour treatment, and the nightly sweep's switch.

### Keyboard

One tab stop for the whole list. ↑/↓, Home/End move; → opens a folder or steps into it, ← closes it or steps out (on a section heading, they fold the section); Enter or Space opens; Delete or Backspace closes a tab.

## Permissions

| Permission | Why |
|---|---|
| `sidePanel` | The panel itself. |
| `bookmarks` | Read your bookmarks, and change them when you edit them in the panel. Chrome warns "Read and change your bookmarks". |
| `tabs` | Titles and URLs of the panel's window. Chrome warns "Read your browsing history". |
| `favicon` | Site icons from Chrome's local favicon cache (a never-visited bookmark shows a globe). |
| `storage` | Settings, open folders, and the sweep's counts-only receipts, on your machine. |
| `alarms`, `webNavigation` | The nightly sweep: a periodic "is it due?" check, and counting navigations as use. |

No host permissions, no network requests, no analytics. See [SECURITY.md](SECURITY.md).

## Known limits

- Chrome's side panel is at least 378 px wide and has its own 49 px header; no extension can change either.
- Another extension's side panel replaces this one in that window until you click the icon again.
- Pinned tabs show as ordinary rows; tab groups aren't shown.
- Nightly sweep: a page that asks "Leave site?" stays open with its prompt; pages that don't ask lose unsaved input. A tab read for hours without switching to it counts as unused.

## Development

```bash
pnpm install
pnpm check     # typecheck + tests + build → dist/extension, with its sha256
```

- `extension/src/sidebar.ts` — rows, keyboard and the session, behind the `SidebarBrowser` seam; `sidebar-chrome.ts` is the Chrome adapter, the tests use a fake.
- `extension/src/sweep.ts` — the nightly sweep, behind the `Browser` seam (`chrome-browser.ts`).
- `panel.ts`, `options.ts`, `background.ts` — rendering and wiring only.
- `scripts/sidebar-feasibility.mjs` and `scripts/feasibility.mjs` drive [Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/) with throwaway profiles and synthetic pages: `CFT_BIN=<binary> pnpm sidebar:measure`. On macOS, `HARNESS_BACKGROUND=1` keeps the test browser behind your work (the shortcut trigger is then skipped, since Chrome sends shortcuts only to a focused window). Never point them at your own Chrome profile.

Issues and pull requests are welcome; this is a small tool kept deliberately small.

## License

[MIT](LICENSE)
