# Custom Sidebar

**Your bookmarks above this window's tabs, in one Chrome side panel.**

On a laptop, Chrome's vertical tabs plus its bookmarks panel take about 600 px of the screen. Custom Sidebar puts both into a single side panel at Chrome's minimum width, with drag-and-drop bookmark editing, emoji and colour icons, your tab groups as on the tab strip, and a one-click Tidy for tabs. It runs entirely on your machine: no account, no analytics, and out of the box no network requests at all.

<p>
  <img src="docs/screenshots/panel-neutral-light.png" width="300" alt="The side panel in the Neutral colours: a Bookmarks section with folders, then the window's tabs with the selected one highlighted">
  &nbsp;
  <img src="docs/screenshots/panel-warm-light.png" width="300" alt="The same panel in the Warm colours">
</p>

*Screenshots use invented bookmarks and pages.*

## Features

**Bookmarks**
- Chrome's own bookmarks, nothing separate to sync: the bookmarks bar inline, folders that expand, "Other bookmarks" as a folder.
- Click to open in this window; ⌘/Ctrl-click or middle-click opens in the background.
- **Edit in place:** drag to move bookmarks and folders; drag a tab in to save it; right-click for **Edit** (title and URL), **Delete**, **New folder** and **Add current tab**.
- **Open a folder's bookmarks** from its right-click menu, as on Chrome's bookmark bar: **Open All (N)**, **in New Window**, **in Incognito Window** or **in New Tab Group**. N counts the folder's own bookmarks, not its subfolders'. The tab group is named after the folder and takes its folder colour if it has one; its name editor opens, as in Chrome. From 15 bookmarks on, the menu asks first.
- **Undo** the last change from the footer, or with ⌘/Ctrl+Z.
- **Icons:** give any bookmark or folder an emoji (a grid of common ones, or any emoji from your system's emoji picker), or give a folder a colour (Chrome's tab-group colours).

**Tabs**
- The tabs of the window the panel sits in, as Chrome's tab strip has them: pinned tabs first (marked with a pin), each **tab group** as a pill in its colour with its tabs indented under it, and ungrouped tabs where they sit. Click to switch, × or middle-click to close, plus a New tab row. Each window has its own panel.
- **Groups expand and collapse** with a click on their pill, together with Chrome's own: collapse one in the panel and it collapses on the tab strip, and the other way round. The button beside the broom expands or collapses them all. Collapsing the group with the selected tab selects the nearest tab outside it first, as the tab strip does.
- **Right-click a group** for Chrome's group commands: **Name and colour…**, **New tab in group**, **Move group to new window**, **Save group to bookmarks**, **Close group**, **Ungroup** and **Delete group**.
- **Right-click a tab** for Chrome's tab commands that extensions can carry out: **New tab below**, **Add tab to (new) group**, **Remove from group**, **Move tab to new window / another window**, **Reload**, **Duplicate**, **Pin / Unpin**, **Mute / Unmute tab**, **Split view** (Chrome 155 and later), **Close**, **Close other tabs**, **Close tabs below**, **Bookmark tab**, **Bookmark all tabs** and **Copy link**. Close other tabs and Close tabs below work like Chrome's: pinned tabs stay, a group they close entirely stays in Chrome's saved tab groups, and Undo reopens the rest.
- **Drag a group into Bookmarks** to save it there as a folder in its colour, with its tabs as bookmarks; the group stays open. One Undo removes the folder.
- **Tidy:** the broom on the Tabs heading closes the tabs that aren't in a group, except the selected one; pinned tabs and grouped tabs stay. Undo reopens them where they were (without their back history; Chrome's own *Reopen closed tab* still has that).

**Everything else**
- Both sections fold, and the panel remembers which folders are open.
- Live updates from Chrome's events; nothing polls.
- Two colour treatments, **Neutral** (like Chrome, the default) and **Warm**, each following your system's light or dark mode.
- **Optional nightly sweep** (off by default): once a day at 03:00, or the first time Chrome runs after that, it closes tabs you haven't used in the last 3 hours. It keeps the selected tab of the focused window, tabs playing audio, pinned tabs and tabs in a group, never closes a window, and never touches bookmarks.

Deliberately not included: tabs of other windows, search, tab archives, a New Tab page replacement, or anything that phones home.

## Install

There's no Chrome Web Store listing; you load it yourself. Chrome 150 or newer.

1. Download the latest `custom-sidebar-<version>.zip` from [Releases](../../releases) and unzip it somewhere permanent. Chrome runs the extension from that folder.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the unzipped folder.
3. Optional, when building from source: give it your own name, which Chrome shows in the side panel's header — `pnpm rename "My Sidebar"` (see Development).
4. Pin the icon in the toolbar. Click it, or press **Ctrl+Shift+S** (**⇧⌘S** on a Mac), to open or close the panel. You can change the shortcut at `chrome://extensions/shortcuts`.

**Recommended layout:** in Chrome's settings, put the **side panel on the left**, and if you use vertical tabs, collapse them to the narrow icon rail. An extension can't hide Chrome's own tab strip, so your tabs appear both there and in the panel.

**Updating:** Chrome knows an unpacked extension by its folder. Replace the folder's contents with the new version's files and click the reload icon on the extension's card at `chrome://extensions`; your settings and icons stay. (Removing the extension and loading a new folder also works, but starts with fresh settings.)

## Rename it on build

Chrome shows the extension's manifest name in the side panel's header, and no extension can change that at runtime, so the name is set when you build. The default is **Custom Sidebar**. To name your own copy (for example "Selinger Sidebar"):

```bash
git clone https://github.com/<your-username>/custom-sidebar.git
cd custom-sidebar
pnpm install                       # or: npx -y pnpm@11.1.2 install
pnpm rename "Selinger Sidebar"     # saves the name and rebuilds dist/extension
```

Then load `dist/extension` at `chrome://extensions` (**Developer mode** → **Load unpacked**), or, if it's already loaded, click the reload icon on its card. Settings and bookmark icons are kept, because Chrome identifies an unpacked extension by its folder.

- Your name is stored in `.sidebar-name` (gitignored), so every later build, `pnpm check` included, keeps it, and it survives `git pull`.
- `pnpm rename` with no name goes back to **Custom Sidebar**.
- Names are limited to 75 characters (Chrome's limit); about 45 or fewer fits the header best.

## Using it

| | Mouse | Keyboard |
|---|---|---|
| Move around | | ↑/↓, Home/End (the whole list is one tab stop) |
| Open a folder / step in, close / step out | click the folder | → / ← (on a section heading: fold it) |
| Open a bookmark, switch to a tab | click | Enter or Space (⌘/Ctrl+Enter: in the background) |
| Close a tab | × or middle-click | Delete or Backspace |
| Pin, mute, group, move, duplicate, reload, split, close others/below, bookmark or copy a tab | right-click the tab | Shift+F10 (or the menu key) |
| Expand or collapse a group | click its pill | Enter, Space or → / ← |
| Expand or collapse all groups | the button beside the broom | Tab to it, then Space |
| Rename or recolour a group | right-click → Name and colour… | F2 |
| A group's other commands (new tab, move, save, close, ungroup, delete) | right-click the group | Shift+F10 |
| Edit a bookmark or folder (title, URL, icon) | right-click → Edit… | F2 |
| Delete a bookmark or folder | right-click → Delete | Delete or Backspace |
| Move a bookmark or folder | drag | ⌥/Alt+↑ / ↓ within its folder |
| Open a folder's bookmarks (here, new window, incognito, new tab group) | right-click the folder → Open All … | Shift+F10 → Open All … |
| Save a tab as a bookmark | drag the tab into Bookmarks, or right-click → Add current tab | Shift+F10 → Add current tab |
| Save a group as a bookmark folder | drag its pill into Bookmarks, or right-click → Save group to bookmarks | Shift+F10 → Save group to bookmarks |
| Tidy (close the ungrouped tabs but the selected one; pinned tabs stay) | the broom on the Tabs heading | Tab to the broom, then Space |
| Undo the last change | Undo in the footer | ⌘/Ctrl+Z |

In the editor, Enter saves and Escape cancels. Click the icon left of the name to choose an emoji or folder colour (for a group, its colour).

**What the group commands do.** Close group closes its tabs and keeps it in Chrome's saved tab groups, so you can reopen it from Chrome's tab groups menu, just like Chrome's own Close group. Delete group closes its tabs and removes it from there; Undo in the footer reopens it as a new group. Ungroup leaves the tabs open and, as in Chrome, removes the group from the saved ones. Move group to new window isn't offered for a group that is the whole window, and closing such a group opens a New Tab first, so the window stays.

## Options

Open them with the ⚙ at the bottom of the panel:

- **Colours:** Neutral or Warm.
- **Site icons (off by default):** Chrome only has icons for pages you've visited, so a bookmark you've never opened shows a globe. Switch this on and the panel asks those bookmarks' own sites for their icon instead. What that means for privacy is described in [SECURITY.md](SECURITY.md).
- **Nightly sweep (off by default):** the tab sweep described above.

## Privacy and permissions

Everything stays on your machine. There are no host permissions, no content scripts and no analytics, and out of the box the extension makes no network requests at all. The only requests it can make are the optional site icons. The full picture is in [SECURITY.md](SECURITY.md).

| Permission | Why |
|---|---|
| `sidePanel` | The panel itself. |
| `bookmarks` | Read your bookmarks, and change them when you edit them in the panel. Chrome warns "Read and change your bookmarks". |
| `tabs` | Titles and URLs of the panel's window. Chrome warns "Read your browsing history". |
| `favicon` | Site icons from Chrome's local favicon cache. |
| `tabGroups` | Show this window's tab groups, and expand, collapse, rename, recolour and move them from the panel. Chrome warns "View and manage your tab groups". |
| `storage` | Settings, open folders, your bookmark icons, and the sweep's counts-only receipts, on your machine. |
| `alarms`, `webNavigation` | The nightly sweep: a periodic "is it due?" check, and counting navigations as use. |

## Known limits

- Chrome's side panel is at least 378 px wide and has its own 49 px header; no extension can change either.
- Another extension's side panel replaces this one in that window until you click the icon again, and Chrome doesn't reopen side panels after a restart.
- Pinned tabs show as rows with a pin, not as Chrome's compact icons.
- Open All in New Tab Group avoids the names of open groups ("Work (1)"), but can't see Chrome's closed saved groups, which Chrome also avoids. Open All in Incognito Window opens the window but, as the extension is kept out of incognito, it can't see or change it afterwards.
- The tab menu leaves out what extensions can't do or would need a broader permission for: **Reopen closed tab** (the `sessions` permission would change Chrome's warning to "Read your browsing history on all your signed-in devices"; Undo covers the panel's own closes), **Mute site** (a site setting needs the `contentSettings` permission and its warning; Mute tab mutes just the tab), **Send to your devices** and **Share** (no extension API). Copy link needs no clipboard permission: it copies from your click.
- Extensions only see open tab groups, not Chrome's saved ones: a closed group leaves the panel (reopen it from Chrome's tab groups menu). Chrome's API has no "close group", so Close group moves the group into a minimized window of its own and closes that window, which is how Chrome keeps a group saved. Chrome's *Reopen closed tab* then brings back that window.
- Bookmark icons are stored by the extension, not in Chrome's bookmarks, so they don't sync to your other devices.
- Nightly sweep: a page that asks "Leave site?" stays open with its prompt; pages that don't ask lose unsaved input. A tab read for hours without switching to it counts as unused.

## Development

```bash
pnpm install
pnpm check     # typecheck + tests + build → dist/extension, with its sha256
pnpm rename "My Sidebar"   # name your build (rebuilds dist/extension)
pnpm rename                # back to the default name, Custom Sidebar
```

- **Renaming:** Chrome's side-panel header shows the extension's manifest name, which can't change at runtime, so `pnpm rename` sets it for your builds: it keeps the name in `.sidebar-name` (gitignored, at most 75 characters, 45 recommended), and every later build, `pnpm check` included, uses it, so it survives `git pull`. Afterwards click the reload icon on the extension's card at `chrome://extensions`; settings and icons stay, as Chrome knows an unpacked extension by its folder.

- `extension/src/sidebar.ts`: rows, keyboard, bookmark edits, tab groups, Undo and Tidy, behind the `SidebarBrowser` seam. `sidebar-chrome.ts` is the Chrome adapter; the tests use an in-memory fake.
- `extension/src/sweep.ts`: the nightly sweep, behind the `Browser` seam (`chrome-browser.ts`).
- `panel.ts`, `options.ts`, `background.ts`: rendering and wiring.
- `GLOSSARY.md`: the project's vocabulary (Sidebar, Bookmark edit, Tidy, …).
- `scripts/sidebar-feasibility.mjs` and `scripts/feasibility.mjs` drive [Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/) with throwaway profiles and synthetic pages: `CFT_BIN=<binary> pnpm sidebar:measure`. On macOS, `HARNESS_BACKGROUND=1` keeps the test browser behind your work (the shortcut trigger is then skipped, since Chrome sends shortcuts only to a focused window). Never point them at your own Chrome profile.
- Releases: push a tag `v<version>` matching `manifest.json`; GitHub Actions builds the zip and publishes it.

## Contributing and support

Issues and pull requests are welcome. This is a small tool, kept deliberately small, and maintained on a best-effort basis, so not every feature request will make it in. Please report security issues privately, as described in [SECURITY.md](SECURITY.md).

## About

Custom Sidebar is a fork of Compact Sidebar, which is built and maintained by **[MF Consulting](https://matthiasfrank.de/en/notion-consulting/)**. We help teams work better with Notion and AI, and build custom software when off-the-shelf tools don't fit. If that sounds like something your team needs, [get in touch](https://matthiasfrank.de/en/notion-consulting/).

## License

[MIT](LICENSE) © MF Consulting
