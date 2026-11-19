let windowId;
chrome.windows.getCurrent().then((w) => (windowId = w.id));
const done = (p) => p.then(() => (document.title = "opened"), (e) => (document.title = "failed: " + e.message));
document.getElementById("open").addEventListener("click", () => done(chrome.sidePanel.open({ windowId })));
document.getElementById("close").addEventListener("click", () => done(chrome.sidePanel.close({ windowId })));
