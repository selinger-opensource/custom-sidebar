# Changelog

## 0.7.0

First release of Custom Sidebar, a fork of Compact Sidebar 0.6.0 by MF Consulting.

### Added
- **Tab groups** in the Tabs section, in tab-strip order, as coloured pills that expand and collapse in Chrome too. Pinned tabs come first, with a pin mark.
- **Group menu** (right-click a pill): Name and colour, New tab in group, Move group to new window, Save group to bookmarks, Close group, Ungroup, Delete group (with Undo).
- **Save a group as bookmarks** by dragging its pill into Bookmarks: one folder named and coloured after the group.
- **Tab menu** (right-click a tab): pin/unpin, new tab below, add to or remove from a group, move to a window, reload, duplicate, mute, split view (Chrome 155+), close other tabs and tabs below, bookmark tab, bookmark all tabs, copy link.
- **Folder menu**: Open All, in a new window, in an incognito window, and in a new tab group.
- **Expand/collapse all** buttons on the Bookmarks and Tabs headings.
- **Rename on build**: `pnpm rename "My Sidebar"` sets the extension name; the default is Custom Sidebar.

### Changed
- Tidy and the nightly sweep close only ungrouped tabs; pinned and grouped tabs stay.
- New `tabGroups` permission (Chrome warns "View and manage your tab groups").
- Renamed from Compact Sidebar to Custom Sidebar; release zips are `custom-sidebar-<version>.zip`.
