# Security

## What the extension can see

- **Bookmarks:** read only. The extension never creates, edits, moves or deletes a bookmark.
- **Tabs:** titles and URLs of the window the side panel sits in, to list them. The nightly sweep reads only tab IDs, activity times and audio state.
- **Storage:** settings, which folders are expanded, and the sweep's counts-only receipts, in `chrome.storage` on your machine.

It makes **no network requests**, has no analytics, and sends nothing anywhere. Favicons come from Chrome's own local cache.

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** on this repository (Security → Report a vulnerability) rather than a public issue. Expect a reply within a week. There is no bug bounty.

## Supported versions

Only the latest release is supported.
