# Security

## What the extension can see

- **Bookmarks:** read, and changed only when you edit them in the panel (move, edit, delete, new folder, add). The nightly sweep never changes bookmarks.
- **Tabs:** titles and URLs of the window the side panel sits in, to list them. The nightly sweep reads only tab IDs, activity times and audio state.
- **Storage:** settings, which folders are expanded, and the sweep's counts-only receipts, in `chrome.storage` on your machine.

- **Bookmark icons** you choose (emoji or folder colours) are kept in `chrome.storage` on your machine; they don't sync.
- **Site-icon lookups:** which icon address each looked-up site gave (or that it had none) is remembered in `chrome.storage` for up to 7 days, so opening the panel doesn't ask sites again. Switching site icons off deletes it.

**Network:** none out of the box. The only requests it can make are **site icons**, which are **off by default** and switched on in the options. When Chrome hasn't stored a bookmarked page's icon (you've never visited it), the panel asks that bookmark's own site for `/favicon.ico`, then `/apple-touch-icon.png`, like a browser does on a visit. As on a visit, the request carries that site's cookies, and if the site redirects it to where it keeps its icon, the redirect is followed (Chrome gives extensions without site permissions no way to refuse it). Tabs never trigger it, no other service is ever contacted, and there is no analytics. With it off (the default), every icon comes from Chrome's own local cache and the extension makes no network requests at all; switching it off again deletes what it remembered.

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** on this repository (Security → Report a vulnerability) rather than a public issue. Expect a reply within a week. There is no bug bounty.

## Supported versions

Only the latest release is supported.
