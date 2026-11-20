# Changelog

## 0.7.0

First release of Custom Sidebar, a fork of Compact Sidebar 0.6.0 by MF Consulting.

### Added
- **Tab groups** in the Tabs section, in tab-strip order, as coloured pills that expand and collapse in Chrome too. Pinned tabs come first, with a pin mark.
- **Group menu** (right-click a pill): Name and colour, New tab in group, Move group to new window, Save group to bookmarks, Close group, Ungroup, Delete group (with Undo).
- **Save a group as bookmarks** by dragging its pill into Bookmarks: one folder named and coloured after the group.
- **Tab menu** (right-click a tab): pin/unpin, new tab below, add to or remove from a group, move to a window, reload, duplicate, mute, split view (Chrome 155+), close other tabs and tabs below, bookmark tab, bookmark all tabs, copy link.
- **Folder menu**: Open All, in a new window, in an incognito window, and in a new tab group.
- **Move tabs and groups** by dragging among the tabs, as on Chrome's tab strip, or with Alt+Up/Down.
- **Sort by name** on any editable bookmark folder and on the Bookmarks heading, as in Chrome's bookmark manager (with Undo).
- **Expand all, level by level**: the Bookmarks heading expands the top-level folders; a folder with subfolders gets its own button. An "Every level" option and a per-folder "Don't expand with Expand all" mark. Collapse all but the selected tab's group on the Tabs heading.
- **New bookmarks go first or last** in a folder (an option) when the panel picks the spot.
- **Backup**: export and import your icons, Expand all marks, settings and folding from the options page.
- **Rename on build**: `pnpm rename "My Sidebar"` sets the extension name; the default is Custom Sidebar.

### Changed
- Tidy and the nightly sweep close only ungrouped tabs; pinned and grouped tabs stay.
- New `tabGroups` permission (Chrome warns "View and manage your tab groups").
- Renamed from Compact Sidebar to Custom Sidebar; release zips are `custom-sidebar-<version>.zip`.
