// Feasibility harness for the Sidebar (production build, dist/extension). Drives a HEADED
// Chrome for Testing with throwaway profiles, synthetic bookmarks and synthetic local pages only.
//
//   node scripts/sidebar-feasibility.mjs "<Chrome for Testing binary>" <work dir> [measure|demo]
//
// measure (default): runs each shell layout, measures geometry via Chrome's UI DevTools
//   (native view bounds) and the panel page, exercises interactions, the options page, the
//   keyboard shortcut and a browser restart; writes JSON + panel PNGs.
// demo: opens one headed window with the Sidebar open and leaves it running for a human.
// Never point this at a real Chrome or a real profile.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SYNTHETIC as S } from "./sidebar-synthetic.mjs";

const [chromeBin, workDir, mode = "measure"] = process.argv.slice(2);
if (!chromeBin || !workDir) throw new Error("usage: sidebar-feasibility.mjs <chrome-for-testing> <work dir> [measure|demo]");
const EXT = resolve("dist/extension");
const EXT_NAME = JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8")).name;
// A second extension with its own side panel, standing in for another extension's (e.g. Claude's).
const PROBE = resolve("scripts/fixtures/other-side-panel");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// Laptop-scale window: the MacBook's logical screen is 1512 × 982; leave the menu bar.
const WINDOW = { x: 0, y: 38, width: 1512, height: 944 };

// --- Synthetic data and pages. ---------------------------------------------------------------
const titles = new Map();
const collect = (nodes) => nodes.forEach((n) => (n.children ? collect(n.children) : titles.set(n.path, n.title)));
collect(S.bar); collect(S.other); collect(S.windows.human); collect(S.windows.ai);
const COLORS = ["#1a73e8", "#188038", "#d93025", "#e37400", "#9334e6", "#007b83", "#b06000", "#c5221f"];
const siteIconRequests = [];
const redirectedRequests = []; // icon requests that reached this site through another site's redirect
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  const seg = path.split("/")[1] || "x";
  if (path === "/favicon.ico") {
    // The site-wide icon a site icon fetch finds (the Sidebar asks for it when Chrome has none).
    siteIconRequests.push(req.headers.host);
    if (req.url.includes("via=redirect")) redirectedRequests.push(req.url);
    res.setHeader("content-type", "image/svg+xml");
    return res.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="8" fill="#7b3fe4"/></svg>`);
  }
  if (path.startsWith("/favicon/")) {
    const s = path.split("/")[2].replace(".svg", "");
    const c = COLORS[[...s].reduce((a, ch) => a + ch.charCodeAt(0), 0) % COLORS.length];
    res.setHeader("content-type", "image/svg+xml");
    return res.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="${c}"/><text x="8" y="12" font-family="Helvetica,Arial,sans-serif" font-size="10" font-weight="700" fill="#fff" text-anchor="middle">${s[0].toUpperCase()}</text></svg>`);
  }
  res.setHeader("content-type", "text/html; charset=utf-8");
  const title = titles.get(path) ?? path;
  const audio = path === "/music"
    ? `<script>const c=new AudioContext();const o=c.createOscillator();const g=c.createGain();g.gain.value=0.0005;o.connect(g).connect(c.destination);o.start();</script>` : "";
  res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><link rel="icon" href="/favicon/${seg}.svg">
    <body style="font:15px system-ui;margin:0;background:#f6f7f9;color:#333"><div style="padding:24px 28px;max-width:60em">
    <div style="color:#888;font-size:12px">Synthetic page · ${path}</div><h1 style="font-size:22px">${title}</h1>
    <p style="line-height:1.6">${"Synthetic content for layout measurement. ".repeat(14)}</p>
    <div id="vw" style="position:fixed;right:12px;bottom:10px;font:12px ui-monospace,monospace;color:#888"></div></div>
    <script>const f=()=>vw.textContent="page viewport "+innerWidth+" × "+innerHeight;f();addEventListener("resize",f)</script>${audio}</body>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
// A second site that answers icon requests slowly and has none, to switch site icons off while
// a request is under way: its request log shows whether another request followed.
const slowSiteRequests = [];
const slowSite = createServer((req, res) => {
  slowSiteRequests.push(new URL(req.url, "http://x").pathname);
  setTimeout(() => { res.statusCode = 404; res.end(); }, 1500);
});
await new Promise((r) => slowSite.listen(0, "127.0.0.1", r));
// A site that forwards its icon requests to another site (the main one): the Sidebar must not follow.
const redirectSite = createServer((req, res) => {
  res.statusCode = 302;
  res.setHeader("location", `${ORIGIN}/favicon.ico?via=redirect`);
  res.end();
});
await new Promise((r) => redirectSite.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

// --- Profile files: native bookmarks (source of truth) and shell prefs. -----------------------
let bid = 10;
const chromeTime = () => String((Date.now() + 11644473600000) * 1000);
const bm = (n) => n.children
  ? { type: "folder", id: String(bid++), name: n.title, date_added: chromeTime(), date_modified: chromeTime(), children: n.children.map(bm) }
  : { type: "url", id: String(bid++), name: n.title, url: ORIGIN + n.path, date_added: chromeTime() };
function writeProfile(profile, prefs) {
  mkdirSync(join(profile, "Default"), { recursive: true });
  bid = 10;
  writeFileSync(join(profile, "Default", "Bookmarks"), JSON.stringify({
    version: 1,
    roots: {
      bookmark_bar: { type: "folder", id: "1", name: "Bookmarks bar", date_added: chromeTime(), date_modified: chromeTime(), children: S.bar.map(bm) },
      other: { type: "folder", id: "2", name: "Other bookmarks", date_added: chromeTime(), date_modified: chromeTime(), children: S.other.map(bm) },
      synced: { type: "folder", id: "3", name: "Mobile bookmarks", date_added: chromeTime(), date_modified: chromeTime(), children: [] },
    },
  }, null, 1));
  writeFileSync(join(profile, "Default", "Preferences"), JSON.stringify(prefs));
}

// --- Minimal CDP client (also speaks to Chrome's UI DevTools server). -------------------------
class Cdp {
  static async connect(url) {
    const c = new Cdp();
    c.ws = new WebSocket(url);
    c.id = 0; c.pending = new Map(); c.listeners = [];
    c.ws.onmessage = ({ data }) => {
      const m = JSON.parse(data);
      if (m.id && c.pending.has(m.id)) {
        const { ok, fail } = c.pending.get(m.id);
        c.pending.delete(m.id);
        m.error ? fail(new Error(JSON.stringify(m.error))) : ok(m.result);
      } else if (m.method) c.listeners.forEach((l) => l(m));
    };
    await new Promise((r, j) => ((c.ws.onopen = r), (c.ws.onerror = j)));
    return c;
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
    return new Promise((ok, fail) => this.pending.set(id, { ok, fail }));
  }
}

let uiPort = 9400 + Math.floor(Math.random() * 400);
// HARNESS_BACKGROUND=1 (macOS): launch through `open -g` so Chrome never comes to the front and
// never asks for window focus, leaving the person's active window alone. Occlusion throttling is
// off either way, so panels in covered windows still render promptly.
const BG = process.env.HARNESS_BACKGROUND === "1";
const FOCUS = String(!BG);
const APP = chromeBin.includes(".app/") ? chromeBin.slice(0, chromeBin.indexOf(".app/") + 4) : undefined;
async function launch(profile, extraArgs = [], { headed = true, url = `${ORIGIN}/mail` } = {}) {
  uiPort += 1;
  rmSync(join(profile, "DevToolsActivePort"), { force: true }); // a relaunch must not read the last run's port
  const args = [
    `--user-data-dir=${profile}`,
    `--load-extension=${EXT},${PROBE}`,
    "--remote-debugging-port=0",
    `--enable-ui-devtools=${uiPort}`,
    "--no-first-run", "--no-default-browser-check", "--disable-search-engine-choice-screen",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling",
    `--window-position=${WINDOW.x},${WINDOW.y}`, `--window-size=${WINDOW.width},${WINDOW.height}`,
    ...(headed ? [] : ["--headless=new"]),
    ...extraArgs,
    ...(url ? [url] : []),
  ];
  // `open -W` lives as long as Chrome does, so exit handling stays the same.
  const proc = BG && APP
    ? spawn("/usr/bin/open", ["-g", "-n", "-W", "-a", APP, "--args", ...args], { stdio: "ignore" })
    : spawn(chromeBin, args, { stdio: "ignore" });
  let port;
  for (let i = 0; i < 150 && !port; i++) {
    await sleep(100);
    if (existsSync(join(profile, "DevToolsActivePort"))) port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0];
  }
  const { webSocketDebuggerUrl, Browser } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const cdp = await Cdp.connect(webSocketDebuggerUrl);
  cdp.version = Browser; cdp.proc = proc; cdp.uiPort = uiPort;
  cdp.sw = await findWorker(cdp, EXT_NAME);
  cdp.extId = (await evalIn(cdp, cdp.sw, "chrome.runtime.id"));
  cdp.probeSw = await findWorker(cdp, "Other Side Panel (PROBE)");
  cdp.probeId = await evalIn(cdp, cdp.probeSw, "chrome.runtime.id");
  return cdp;
}
async function findWorker(cdp, name) {
  for (let i = 0; i < 100; i++) {
    const { targetInfos } = await cdp.send("Target.getTargets");
    for (const sw of targetInfos.filter((t) => t.type === "service_worker" && t.url.startsWith("chrome-extension://"))) {
      const session = (await cdp.send("Target.attachToTarget", { targetId: sw.targetId, flatten: true })).sessionId;
      const r = await cdp.send("Runtime.evaluate", { expression: "chrome.runtime.getManifest().name", returnByValue: true }, session);
      if (r.result.value === name) return session;
    }
    await sleep(200);
  }
  throw new Error("worker not found: " + name);
}
async function evalIn(cdp, session, expression) {
  const r = await cdp.send("Runtime.evaluate", { expression: `(async()=>(${expression}))()`, awaitPromise: true, returnByValue: true }, session);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
  return r.result.value;
}
async function quit(cdp) {
  await cdp.send("Browser.close").catch(() => {});
  await new Promise((r) => (cdp.proc.exitCode !== null ? r() : cdp.proc.on("exit", r)));
}
async function attachPage(cdp, match) {
  for (let i = 0; i < 60; i++) {
    const { targetInfos } = await cdp.send("Target.getTargets");
    const t = targetInfos.find((x) => match(x));
    if (t) return { target: t, session: (await cdp.send("Target.attachToTarget", { targetId: t.targetId, flatten: true })).sessionId };
    await sleep(200);
  }
  throw new Error("page not found");
}
/** A real (trusted) click via CDP input — counts as a user gesture for sidePanel.open(). */
async function clickSelector(cdp, session, selector) {
  const { x, y } = await evalIn(cdp, session, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:"nearest"});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  for (const type of ["mousePressed", "mouseReleased"])
    await cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }, session);
}
async function pressKey(cdp, session, key, code = key, keyCode = 0) {
  for (const type of ["keyDown", "keyUp"])
    await cdp.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: keyCode }, session);
}

// --- UI DevTools: Chrome's native view tree with bounds. -------------------------------------
async function uiTree(port) {
  // The UI DevTools server speaks the DevTools protocol on ws://127.0.0.1:<port>/0 (no /json list).
  const ui = await Cdp.connect(`ws://127.0.0.1:${port}/0`);
  await ui.send("DOM.enable").catch(() => {});
  await ui.send("CSS.enable").catch(() => {});
  const { root } = await ui.send("DOM.getDocument");
  return { ui, root };
}

/** Bounds and visibility of the first native view with each name (UI DevTools CSS properties). */
async function viewGeometry(port, names) {
  const { ui, root } = await uiTree(port);
  const found = {};
  const walk = (n, path) => {
    const a = Object.fromEntries((n.attributes ?? []).reduce((acc, v, i, arr) => (i % 2 ? acc : [...acc, [v, arr[i + 1]]]), []));
    if (names.includes(a.name) && !found[a.name]) found[a.name] = n.nodeId;
    (n.children ?? []).forEach((c) => walk(c));
  };
  walk(root);
  const out = {};
  for (const [name, nodeId] of Object.entries(found)) {
    const r = await ui.send("CSS.getMatchedStylesForNode", { nodeId });
    const props = {};
    for (const m of r.matchedCSSRules ?? []) for (const p of m.rule.style.cssProperties) props[p.name] ??= p.value;
    out[name] = props;
  }
  ui.ws.close();
  return out;
}

// --- Scenario helpers. ------------------------------------------------------------------------
const ext = (cdp, path) => `chrome-extension://${cdp.extId}/${path}`;
const inExt = (cdp, expr) => evalIn(cdp, cdp.sw, expr);

/** Opens the synthetic Human window tabs (in the launch window) and a second AI window. */
async function openSyntheticWindows(cdp) {
  return inExt(cdp, `(async () => {
    const S = ${JSON.stringify(S.windows)}, O = ${JSON.stringify(ORIGIN)};
    const [human] = await chrome.windows.getAll({ windowTypes: ["normal"] });
    // Visit every synthetic bookmark once so Chrome's favicon cache knows them, as it would for
    // real, previously visited bookmarks.
    const warm = await chrome.tabs.create({ windowId: human.id, url: "about:blank", active: false });
    for (const p of ${JSON.stringify([...titles.keys()])}) {
      await chrome.tabs.update(warm.id, { url: O + p });
      await new Promise((r) => { const f = (id, c) => { if (id === warm.id && c.status === "complete") { chrome.tabs.onUpdated.removeListener(f); r(); } }; chrome.tabs.onUpdated.addListener(f); });
    }
    await chrome.tabs.remove(warm.id);
    for (const t of S.human.slice(1)) await chrome.tabs.create({ windowId: human.id, url: O + t.path, active: false });
    const ai = await chrome.windows.create({ url: S.ai.map((t) => O + t.path), focused: false,
      left: ${WINDOW.x + 60}, top: ${WINDOW.y + 40}, width: ${WINDOW.width - 120}, height: ${WINDOW.height - 80} });
    const pick = async (wid, list) => { const tabs = await chrome.tabs.query({ windowId: wid });
      const i = list.findIndex((t) => t.active); await chrome.tabs.update(tabs[i].id, { active: true }); };
    await pick(human.id, S.human); await pick(ai.id, S.ai);
    await chrome.windows.update(human.id, { focused: ${FOCUS} });
    return { human: human.id, ai: ai.id };
  })()`);
}

/** Opens (or, for the probe, closes) a side panel in a window through a real CDP click on one of
 *  that extension's pages: a trusted click counts as the user gesture sidePanel.open() needs.
 *  The production extension has no "open" button, so the harness adds one to its options page. */
async function openPanel(cdp, windowId, which = "ext", button = "#open") {
  const id = which === "ext" ? cdp.extId : cdp.probeId;
  const path = which === "ext" ? "options.html" : "open.html";
  const wasActive = await inExt(cdp, `chrome.tabs.query({ windowId: ${windowId}, active: true }).then(([t]) => t.id)`);
  const tabId = await inExt(cdp, `chrome.tabs.create({ windowId: ${windowId}, url: "chrome-extension://${id}/${path}", active: true }).then((t) => t.id)`);
  await sleep(800);
  const { session } = await attachPage(cdp, (t) => t.url.startsWith(`chrome-extension://${id}/${path}`));
  if (which === "ext") {
    await evalIn(cdp, session, `(async () => {
      const { id: windowId } = await chrome.windows.getCurrent();
      const b = Object.assign(document.createElement("button"), { id: "open", textContent: "open (harness)" });
      b.style.cssText = "position:fixed;left:0;top:0;width:240px;height:80px;z-index:9";
      b.onclick = () => chrome.sidePanel.open({ windowId }).then(() => (document.title = "opened"), (e) => (document.title = "failed: " + e.message));
      document.body.append(b);
    })()`);
  }
  await clickSelector(cdp, session, button);
  await sleep(1200);
  const title = await evalIn(cdp, session, "document.title");
  await inExt(cdp, `chrome.tabs.update(${wasActive}, { active: true }).then(() => chrome.tabs.remove(${tabId}))`);
  await cdp.send("Target.detachFromTarget", { sessionId: session }).catch(() => {});
  await sleep(600);
  return title;
}
async function panelTargets(cdp) {
  const { targetInfos } = await cdp.send("Target.getTargets");
  return targetInfos.filter((t) => t.url.startsWith(ext(cdp, "panel.html")));
}
const PANEL_WINDOW = "chrome.windows.getCurrent().then((w) => document.querySelector('#app[data-renders]') ? w.id : null)";
async function attachPanel(cdp, windowId) {
  for (let attempt = 0; attempt < 20; attempt++) {
    for (const t of await panelTargets(cdp)) {
      const session = (await cdp.send("Target.attachToTarget", { targetId: t.targetId, flatten: true })).sessionId;
      for (let i = 0; i < 30; i++) {
        const w = await evalIn(cdp, session, PANEL_WINDOW).catch(() => null);
        if (w === windowId) return session;
        if (w !== null) break;
        await sleep(100);
      }
      await cdp.send("Target.detachFromTarget", { sessionId: session }).catch(() => {});
    }
    await sleep(250);
  }
  throw new Error("no panel in window " + windowId);
}
/** Records sidePanel.onOpened/onClosed in the extension's worker (from the harness, through its
 *  console; the extension itself logs nothing). Hidden panel pages can linger after a panel is
 *  replaced, and pages in occluded windows report "hidden", so events are the reliable signal. */
const listenPanelEvents = (cdp) => inExt(cdp, `(() => { self.harnessPanelEvents = [];
  chrome.sidePanel.onOpened.addListener((i) => self.harnessPanelEvents.push({ type: "opened", ...i }));
  chrome.sidePanel.onClosed.addListener((i) => self.harnessPanelEvents.push({ type: "closed", ...i })); return true; })()`);
/** Windows whose Sidebar is open, by the latest panel event per window. */
async function panelWindows(cdp) {
  const last = new Map();
  for (const e of await inExt(cdp, "self.harnessPanelEvents ?? []")) last.set(e.windowId, e.type);
  return [...last].filter(([, type]) => type === "opened").map(([w]) => w);
}
async function activePage(cdp, windowId) {
  const url = await inExt(cdp, `chrome.tabs.query({ windowId: ${windowId}, active: true }).then(([t]) => t.url)`);
  return attachPage(cdp, (t) => t.type === "page" && t.url === url);
}
/** Moves the pointer off the rows so screenshots don't show a stray hover. */
const parkMouse = (cdp, session) => cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 300, y: 2000 }, session);
async function shot(cdp, session, file) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, session);
  writeFileSync(file, Buffer.from(data, "base64"));
  return file;
}
const VIEWS = ["BrowserView", "TopContainerView", "ToolbarView", "SidePanel", "SidePanelResizeArea", "VerticalTabStripRegionView", "HorizontalTabStripRegionViewOld", "ContentsContainerView", "ContentsWebView"];
const bounds = (g) => g && { x: +g.X, y: +g.Y, width: +g.Width, height: +g.Height, visible: g.Visible === "true", drawn: g.IsDrawn === "true", min: g.MinimumSize };

const LAYOUTS = {
  baseline: { label: "Today: native vertical tabs (expanded) + a side panel", prefs: { vertical_tabs: { enabled: true, collapsed_state: false }, side_panel: { is_right_aligned: false } } },
  A: { label: "A: native horizontal tabs + Sidebar on the left", prefs: { vertical_tabs: { enabled: false }, side_panel: { is_right_aligned: false } } },
  B: { label: "B: native vertical tabs collapsed to a rail + Sidebar on the left", prefs: { vertical_tabs: { enabled: true, collapsed_state: true }, side_panel: { is_right_aligned: false } } },
  Bright: { label: "B′: collapsed vertical rail on the left + Sidebar on the right", prefs: { vertical_tabs: { enabled: true, collapsed_state: true }, side_panel: { is_right_aligned: true } } },
};

async function measureLayout(runDir, key, { interactions = false } = {}) {
  const L = LAYOUTS[key];
  const profile = join(runDir, `profile-${key}`);
  writeProfile(profile, L.prefs);
  const cdp = await launch(profile);
  const out = { layout: key, label: L.label, chrome: cdp.version };
  try {
    const win = await openSyntheticWindows(cdp);
    await listenPanelEvents(cdp);
    await sleep(1500);
    out.openTitle = await openPanel(cdp, win.human);
    const panel = await attachPanel(cdp, win.human);
    await sleep(500);
    const g = await viewGeometry(cdp.uiPort, VIEWS);
    out.views = Object.fromEntries(Object.entries(g).map(([k, v]) => [k, bounds(v)]));
    out.panelPage = await evalIn(cdp, panel, "chrome.windows.getCurrent().then((w) => ({ innerWidth, innerHeight, dpr: devicePixelRatio, windowId: w.id }))");
    const page = await activePage(cdp, win.human);
    out.page = await evalIn(cdp, page.session, "({ innerWidth, innerHeight })");
    await parkMouse(cdp, panel);
    out.files = { panel: await shot(cdp, panel, join(runDir, `${key}-panel.png`)), page: await shot(cdp, page.session, join(runDir, `${key}-page.png`)) };
    if (interactions) {
      out.gallery = await gallery(cdp, runDir, panel);
      out.interactions = await runInteractions(cdp, runDir, win, panel);
      // Chrome routes extension shortcuts only to a focused window, so background mode can't test it.
      out.shortcut = BG
        ? { skipped: "needs a focused window; run without HARNESS_BACKGROUND",
            registered: (await inExt(cdp, "chrome.commands.getAll()")).find((c) => c.name === "_execute_action")?.shortcut ?? "" }
        : await shortcut(cdp);
    }
  } catch (e) {
    out.error = String(e.stack ?? e).slice(0, 800);
  } finally {
    await quit(cdp);
  }
  return out;
}

/** Real side-panel renders of both treatments × light/dark, at the measured panel size. */
async function gallery(cdp, runDir, panel) {
  const files = [];
  // Show some depth: open the first two folders (as a person would), then render.
  await inExt(cdp, `chrome.storage.local.set({ sidebarFolding: { expanded: ["13"], folded: [] } })`);
  for (const treatment of ["neutral", "warm"]) for (const scheme of ["light", "dark"]) {
    await inExt(cdp, `chrome.storage.local.set(${JSON.stringify({ colourTreatment: treatment })})`);
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] }, panel);
    await parkMouse(cdp, panel);
    await sleep(400);
    files.push(await shot(cdp, panel, join(runDir, `production-panel-${treatment}-${scheme}.png`)));
  }
  // Keyboard focus and hover states (neutral light).
  await inExt(cdp, `chrome.storage.local.set({ colourTreatment: "neutral" })`);
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] }, panel);
  await sleep(300);
  await evalIn(cdp, panel, `document.querySelector('.row.tab').focus()`);
  await pressKey(cdp, panel, "ArrowDown", "ArrowDown", 40);
  await pressKey(cdp, panel, "ArrowDown", "ArrowDown", 40);
  const { x, y } = await evalIn(cdp, panel, `(() => { const r = document.querySelectorAll('.row.bookmark')[1].getBoundingClientRect(); return { x: r.x + 40, y: r.y + 10 }; })()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, panel);
  await sleep(200);
  files.push(await shot(cdp, panel, join(runDir, `production-panel-states-focus-hover.png`)));
  await cdp.send("Emulation.setEmulatedMedia", { features: [] }, panel);
  await inExt(cdp, `chrome.storage.local.remove("sidebarFolding")`);
  await sleep(300);
  return files.map((f) => f.split("/").pop());
}

const labels = (cdp, panel, kind) => evalIn(cdp, panel, `[...document.querySelectorAll('.row.${kind} .label')].map((l) => l.textContent)`);
const rowKeys = (cdp, panel) => evalIn(cdp, panel, `[...document.querySelectorAll('[data-key]')].map((r) => r.dataset.key)`);
/** A selector for the row of a kind whose label is exactly `label` (marks it for the click). */
async function rowSelector(cdp, panel, kind, label) {
  const ok = await evalIn(cdp, panel, `(() => { document.querySelectorAll('[data-harness]').forEach((e) => e.removeAttribute('data-harness'));
    const r = [...document.querySelectorAll('.row.${kind}')].find((r) => r.querySelector('.label')?.textContent === ${JSON.stringify(label)});
    r?.setAttribute('data-harness', ''); return !!r; })()`);
  if (!ok) throw new Error(`no ${kind} row "${label}"`);
  return "[data-harness]";
}
async function until(fn, ms = 4000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) { const v = await fn(); if (v) return v; }
  return false;
}

async function runInteractions(cdp, runDir, win, panel) {
  const r = {};
  const tabsIn = (wid) => inExt(cdp, `chrome.tabs.query({ windowId: ${wid} }).then((ts) => ts.map((t) => ({ id: t.id, url: t.url.replace(${JSON.stringify(ORIGIN)}, ""), active: t.active, title: t.title })))`);
  const renders = () => evalIn(cdp, panel, "Number(document.getElementById('app').dataset.renders)");

  // 1. Initial state: this window's tabs only, bookmarks from the native tree.
  const humanTabs = await tabsIn(win.human);
  const panelTabs = await labels(cdp, panel, "tab");
  r.listsOnlyOwnWindowTabs = panelTabs.length === humanTabs.length && panelTabs.every((t, i) => t === humanTabs[i].title);
  r.bookmarkRowsShown = (await labels(cdp, panel, "bookmark")).length;
  r.foldersShown = await labels(cdp, panel, "folder");
  r.bookmarksFromNativeTree = r.bookmarkRowsShown === 3 && r.foldersShown.length === 5 && r.foldersShown.at(-1) === "Other bookmarks";

  // 2. Expand a folder by keyboard: focus the Clients row, ArrowRight, then ArrowDown.
  await evalIn(cdp, panel, `[...document.querySelectorAll('.row.folder')].find((r) => r.textContent.includes("Clients")).focus()`);
  await pressKey(cdp, panel, "ArrowRight", "ArrowRight", 39);
  await sleep(250);
  r.keyboardExpandsFolder = await evalIn(cdp, panel, `[...document.querySelectorAll('.row.folder')].find((r) => r.textContent.includes("Clients")).getAttribute("aria-expanded") === "true"`);
  await pressKey(cdp, panel, "ArrowDown", "ArrowDown", 40);
  r.keyboardArrowMovesFocus = await evalIn(cdp, panel, `document.activeElement?.textContent.includes("Northwind")`);

  // 3. Click a bookmark: a real tab opens in THIS window and shows up in the tab list.
  await clickSelector(cdp, panel, await rowSelector(cdp, panel, "folder", "Everyday"));
  await until(async () => (await labels(cdp, panel, "bookmark")).includes("Team chat"));
  const before = (await tabsIn(win.human)).length;
  const r0 = await renders();
  await clickSelector(cdp, panel, await rowSelector(cdp, panel, "bookmark", "Team chat"));
  r.bookmarkClickOpensTabInOwnWindow = await until(async () => {
    const ts = await tabsIn(win.human);
    return ts.length === before + 1 && ts.some((t) => t.url === "/chat" && t.active);
  });
  r.aiWindowUntouched = (await tabsIn(win.ai)).length === S.windows.ai.length;
  r.newTabListedWithoutPolling = await until(async () => (await labels(cdp, panel, "tab")).includes("Team chat"));
  await sleep(500);
  r.rendersForThatClick = (await renders()) - r0;

  // 4. Activate another tab from the list.
  await clickSelector(cdp, panel, ".row.tab");
  r.tabClickActivates = await until(async () => (await tabsIn(win.human))[0].active);

  // 5. Close a tab with its × button.
  const victim = (await tabsIn(win.human)).find((t) => t.url === "/calendar");
  await evalIn(cdp, panel, `document.querySelector('[data-close="${victim.id}"]').style.visibility = "visible"`);
  await clickSelector(cdp, panel, `[data-close="${victim.id}"]`);
  r.closeButtonClosesTab = await until(async () => !(await tabsIn(win.human)).some((t) => t.id === victim.id));
  r.closedTabLeavesList = await until(async () => !(await labels(cdp, panel, "tab")).includes("Calendar"));
  r.bookmarkUntouchedByClose = await inExt(cdp, `chrome.bookmarks.search({ url: ${JSON.stringify(ORIGIN + "/calendar")} }).then((b) => b.length === 1)`);

  // 6. Native bookmark changes appear live (made by the harness through the API, as the
  //    bookmark manager would; the extension itself never writes bookmarks).
  const made = await inExt(cdp, `chrome.bookmarks.create({ parentId: "1", title: "Added elsewhere", url: ${JSON.stringify(ORIGIN + "/added")} }).then((b) => b.id)`);
  r.bookmarkCreateShowsLive = await until(async () => (await labels(cdp, panel, "bookmark")).includes("Added elsewhere"));
  await inExt(cdp, `chrome.bookmarks.update("${made}", { title: "Renamed elsewhere" })`);
  r.bookmarkRenameShowsLive = await until(async () => (await labels(cdp, panel, "bookmark")).includes("Renamed elsewhere"));
  await inExt(cdp, `chrome.bookmarks.remove("${made}")`);
  r.bookmarkRemoveShowsLive = await until(async () => !(await labels(cdp, panel, "bookmark")).includes("Renamed elsewhere"));

  // 7. Folding is remembered: fold Tabs, reload the panel page, same rows.
  await clickSelector(cdp, panel, `[data-key="s:tabs"]`);
  await until(async () => !(await rowKeys(cdp, panel)).includes("newtab"));
  const keysBefore = await rowKeys(cdp, panel);
  await cdp.send("Page.reload", {}, panel);
  await sleep(1200);
  await until(() => evalIn(cdp, panel, "!!document.querySelector('#app[data-renders]')").catch(() => false));
  const keysAfter = await rowKeys(cdp, panel);
  r.foldingSurvivesReload = keysBefore.length > 3 && JSON.stringify(keysBefore) === JSON.stringify(keysAfter);
  r.foldingStored = await inExt(cdp, `chrome.storage.local.get("sidebarFolding").then((s) => s.sidebarFolding)`);
  await clickSelector(cdp, panel, `[data-key="s:tabs"]`);
  await until(async () => (await rowKeys(cdp, panel)).includes("newtab"));

  // 8. Options page: Warm applies live to the open panel; the sweep starts off and switching
  //    it on from never-set restarts its baseline (lastSweepAt ≈ now).
  r.options = await optionsPage(cdp, win, panel, runDir);

  // 9. The other window gets its own, independent panel.
  r.aiPanelOpen = await openPanel(cdp, win.ai);
  const aiPanel = await attachPanel(cdp, win.ai);
  const aiTabs = await labels(cdp, aiPanel, "tab");
  r.aiPanelListsOnlyAiTabs = aiTabs.length === S.windows.ai.length && aiTabs[0] === S.windows.ai[0].title;
  const aiBefore = (await tabsIn(win.ai)).length, humanBefore = (await tabsIn(win.human)).length;
  await clickSelector(cdp, aiPanel, await rowSelector(cdp, aiPanel, "bookmark", "Notes"));
  r.aiBookmarkOpensInAiWindow = await until(async () => (await tabsIn(win.ai)).length === aiBefore + 1 && (await tabsIn(win.human)).length === humanBefore);
  r.humanPanelStillOpen = (await panelWindows(cdp)).includes(win.human);

  // 10. Switching tabs keeps the (global) panel open.
  await inExt(cdp, `chrome.tabs.query({ windowId: ${win.human} }).then((ts) => chrome.tabs.update(ts[2].id, { active: true }))`);
  await sleep(500);
  r.panelSurvivesTabSwitch = (await panelWindows(cdp)).includes(win.human);

  // 11. Another extension opens its side panel in the Human window.
  r.otherPanelOpen = await openPanel(cdp, win.human, "probe");
  await sleep(800);
  r.panelWindowsAfterOtherOpens = await panelWindows(cdp);
  r.ourPanelReplacedInThatWindow = !r.panelWindowsAfterOtherOpens.includes(win.human) && r.panelWindowsAfterOtherOpens.includes(win.ai);
  r.otherPanelClose = await openPanel(cdp, win.human, "probe", "#close");
  await sleep(800);
  r.ourPanelBackByItself = (await panelWindows(cdp)).includes(win.human);
  r.reopenAfterOther = await openPanel(cdp, win.human);
  r.panelWindowsAfterReopen = await panelWindows(cdp);
  r.reopenShowsOursAgain = r.panelWindowsAfterReopen.includes(win.human);
  r.panelEvents = await inExt(cdp, "self.harnessPanelEvents");

  // 12. × on a window's only tab keeps the window (a New Tab replaces it) and its panel.
  const solo = await inExt(cdp, `chrome.windows.create({ url: ${JSON.stringify(ORIGIN + "/calendar")}, focused: ${FOCUS} }).then((w) => w.id)`);
  await sleep(800);
  await openPanel(cdp, solo);
  const soloPanel = await attachPanel(cdp, solo);
  const [onlyTab] = await tabsIn(solo);
  await clickSelector(cdp, soloPanel, `[data-close="${onlyTab.id}"]`);
  r.closeLastTabKeepsWindow = await until(async () => {
    const left = await tabsIn(solo).catch(() => null);
    return !!left && left.length === 1 && left[0].id !== onlyTab.id;
  });
  r.closeLastTabKeepsPanel = (await panelWindows(cdp)).includes(solo);

  // 13. Bookmark edits (plan bookmark-editing, step 9).
  // Step 11 replaced and reopened the Human window's panel; the replaced page lingers (no frames)
  // next to the live one, so bookmarkEdits picks the page that renders its lab folder.
  r.edits = await bookmarkEdits(cdp, win, tabsIn, runDir);

  const CHECKS = ["listsOnlyOwnWindowTabs", "bookmarksFromNativeTree", "keyboardExpandsFolder", "keyboardArrowMovesFocus",
    "bookmarkClickOpensTabInOwnWindow", "aiWindowUntouched", "newTabListedWithoutPolling", "tabClickActivates",
    "closeButtonClosesTab", "closedTabLeavesList", "bookmarkUntouchedByClose", "bookmarkCreateShowsLive",
    "bookmarkRenameShowsLive", "bookmarkRemoveShowsLive", "aiPanelListsOnlyAiTabs", "aiBookmarkOpensInAiWindow",
    "panelSurvivesTabSwitch", "foldingSurvivesReload", "ourPanelReplacedInThatWindow", "reopenShowsOursAgain", "closeLastTabKeepsWindow",
    "closeLastTabKeepsPanel"];
  r.checks = Object.fromEntries(CHECKS.map((k) => [k, r[k] === true]));
  r.passed = `${Object.values(r.checks).filter(Boolean).length}/${CHECKS.length}`;
  return r;
}

/** Bookmark edits: Chrome's own write rules (which the unit tests' fake encodes), then the panel's
 *  keyboard, menu, inline editor, Undo and drag and drop, on a lab folder at the top of the bar. */
/** The panel page in `windowId` for which `expr` is true (a replaced page lingers beside the live one). */
async function livePanel(cdp, windowId, expr) {
  for (let attempt = 0; attempt < 40; attempt++) {
    for (const t of await panelTargets(cdp)) {
      const session = (await cdp.send("Target.attachToTarget", { targetId: t.targetId, flatten: true })).sessionId;
      const ok = await evalIn(cdp, session, `chrome.windows.getCurrent().then((w) => w.id === ${windowId} && (${expr}))`).catch(() => false);
      if (ok) return session;
      await cdp.send("Target.detachFromTarget", { sessionId: session }).catch(() => {});
    }
    await sleep(250);
  }
  throw new Error(`no live panel in window ${windowId}`);
}

async function bookmarkEdits(cdp, win, tabsIn, runDir) {
  const e = {};
  let panel;
  try {
    await bookmarkEditSteps(cdp, win, tabsIn, e, (p) => (panel = p), runDir);
  } catch (err) {
    e.error = `${e.step}: ${String(err).split("\n")[0]}`;
    e.debug = {
      panel: panel === undefined ? "none" : await evalIn(cdp, panel, `({ keys: [...document.querySelectorAll("[data-key]")].map((r) => r.dataset.key).slice(0, 12), hidden: document.hidden, renders: document.getElementById("app").dataset.renders })`).catch((x) => String(x).slice(0, 200)),
      panelTargets: (await panelTargets(cdp)).length,
    };
  }
  const flat = { ...e.chromeRules, ...e };
  for (const k of ["chromeRules", "menuItems", "step", "error"]) delete flat[k];
  e.checks = Object.fromEntries(Object.entries(flat).filter(([, v]) => typeof v === "boolean"));
  if (e.error) e.checks.completed = false;
  return e;
}
async function bookmarkEditSteps(cdp, win, tabsIn, e, found, runDir) {
  let panel; // set once the lab folder exists
  const bm = (expr) => inExt(cdp, expr);
  const MOD = process.platform === "darwin" ? 4 : 2; // ⌘ on a Mac, Ctrl elsewhere
  const key = async (k, code, vk, modifiers = 0) => {
    for (const type of ["rawKeyDown", "keyUp"]) await cdp.send("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: vk, modifiers }, panel);
  };
  const center = (sel, fy = 0.5) => evalIn(cdp, panel, `(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({ block: "nearest" });
    const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height * ${fy} }; })()`);
  const rightClick = async (sel) => {
    const { x, y } = await center(sel);
    for (const type of ["mousePressed", "mouseReleased"]) await cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "right", clickCount: 1 }, panel);
  };
  const menuItems = () => evalIn(cdp, panel, `[...document.querySelectorAll('.menu [role="menuitem"]')].map((b) => b.textContent).join("|")`);
  const menuItem = async (label) => {
    await evalIn(cdp, panel, `[...document.querySelectorAll('.menu [role="menuitem"]')].find((b) => b.textContent === ${JSON.stringify(label)})?.setAttribute("data-harness-item", "")`);
    await clickSelector(cdp, panel, "[data-harness-item]");
  };
  const focusRow = (id) => evalIn(cdp, panel, `document.querySelector('[data-key="b:${id}"]').focus()`);
  const editorOpen = (n) => until(() => evalIn(cdp, panel, `document.activeElement?.tagName === "INPUT" && document.querySelectorAll(".row.editing input").length === ${n}`));
  const titles = (id) => bm(`chrome.bookmarks.getChildren(${JSON.stringify(id)}).then((c) => c.map((n) => n.title))`);
  const titleOf = (id) => bm(`chrome.bookmarks.get(${JSON.stringify(id)}).then(([n]) => n.title)`);
  const idOf = (title) => bm(`chrome.bookmarks.search({ title: ${JSON.stringify(title)} }).then(([n]) => n?.id ?? null)`);
  const O = JSON.stringify(ORIGIN);

  e.step = "1. chrome.bookmarks' rules";
  // 1. chrome.bookmarks' rules, in a probe folder (removed again).
  e.chromeRules = await bm(`(async () => {
    const f = await chrome.bookmarks.create({ title: "Rule probe" });
    const mk = (t) => chrome.bookmarks.create({ parentId: f.id, title: t, url: ${O} + "/probe/" + t });
    const a = await mk("a"), b = await mk("b"), c = await mk("c");
    const order = async () => (await chrome.bookmarks.getChildren(f.id)).map((n) => n.title).join("");
    const out = {};
    await chrome.bookmarks.move(a.id, { parentId: f.id, index: 3 });
    out.moveLaterSkipsOldSlot = (await order()) === "bca";
    await chrome.bookmarks.move(a.id, { parentId: f.id, index: 0 });
    out.moveEarlier = (await order()) === "abc";
    out.createPastEndRefused = await chrome.bookmarks.create({ parentId: f.id, index: 9, title: "x", url: ${O} + "/x" }).then(() => false, () => true);
    out.movePastEndRefused = await chrome.bookmarks.move(a.id, { parentId: f.id, index: 9 }).then(() => false, () => true);
    const sub = await chrome.bookmarks.create({ parentId: f.id, title: "sub" });
    await chrome.bookmarks.create({ parentId: sub.id, title: "deep", url: ${O} + "/deep" });
    out.removeRefusesNonEmptyFolder = await chrome.bookmarks.remove(sub.id).then(() => false, () => true);
    const event = new Promise((r) => chrome.bookmarks.onRemoved.addListener(function l(id, info) {
      if (id === sub.id) { chrome.bookmarks.onRemoved.removeListener(l); r(info); } }));
    await chrome.bookmarks.removeTree(sub.id);
    const info = await event;
    out.removedEventHasSubtree = info.node?.children?.[0]?.title === "deep" && info.parentId === f.id && info.index === 3;
    const updated = await chrome.bookmarks.update(b.id, { title: "B" });
    out.updateTitleKeepsUrl = updated.title === "B" && updated.url === ${O} + "/probe/b";
    await chrome.bookmarks.removeTree(f.id);
    return out;
  })()`);

  e.step = 'A lab folder first in the bar';
  // A lab folder first in the bar, opened in the panel.
  const lab = await bm(`(async () => {
    const [bar] = (await chrome.bookmarks.getTree())[0].children;
    const f = await chrome.bookmarks.create({ parentId: bar.id, index: 0, title: "Edit lab" });
    for (const t of ["Alpha", "Beta", "Gamma"]) await chrome.bookmarks.create({ parentId: f.id, title: t, url: ${O} + "/lab/" + t.toLowerCase() });
    const sub = await chrome.bookmarks.create({ parentId: f.id, title: "Lab sub" });
    for (const t of ["One", "Two"]) await chrome.bookmarks.create({ parentId: sub.id, title: t, url: ${O} + "/lab/" + t.toLowerCase() });
    return { folder: f.id, sub: sub.id };
  })()`);
  panel = await livePanel(cdp, win.human, `!!document.querySelector('[data-key="b:${lab.folder}"]')`);
  found(panel);
  await clickSelector(cdp, panel, `[data-key="b:${lab.folder}"]`);
  const alpha = await idOf("Alpha"), beta = await idOf("Beta"), gamma = await idOf("Gamma");
  await until(() => evalIn(cdp, panel, `!!document.querySelector('[data-key="b:${alpha}"]')`));

  e.step = '2. F2 edits in place';
  // 2. F2 edits in place; Enter saves; ⌘Z undoes.
  await focusRow(alpha);
  await key("F2", "F2", 113);
  e.f2OpensEditorWithTitleAndUrl = !!(await editorOpen(2));
  await shot(cdp, panel, join(runDir, "edit-editor.png"));
  await cdp.send("Input.insertText", { text: "Alpha renamed" }, panel);
  await key("Enter", "Enter", 13);
  e.editSaves = !!(await until(async () => (await titleOf(alpha)) === "Alpha renamed"));
  e.editNotice = !!(await until(() => evalIn(cdp, panel, `document.querySelector("#notice .notice-text")?.textContent.startsWith("Edited") ?? false`)));
  await focusRow(alpha);
  await key("z", "KeyZ", 90, MOD);
  e.cmdZUndoesEdit = !!(await until(async () => (await titleOf(alpha)) === "Alpha"));

  e.step = '3. Editing';
  // 3. Editing, then clicking another bookmark once: the edit saves and the click opens it.
  await focusRow(alpha);
  await key("F2", "F2", 113);
  await editorOpen(2);
  await cdp.send("Input.insertText", { text: "Alpha again" }, panel);
  const tabsBefore = (await tabsIn(win.human)).length;
  await clickSelector(cdp, panel, `[data-key="b:${beta}"] .label`);
  e.clickAfterEditSaves = !!(await until(async () => (await titleOf(alpha)) === "Alpha again"));
  e.clickAfterEditOpensClicked = !!(await until(async () => (await tabsIn(win.human)).length === tabsBefore + 1));

  e.step = '4. Delete on a folder';
  // 4. Delete on a folder removes it whole; Undo in the footer rebuilds it.
  await focusRow(lab.sub);
  await key("Delete", "Delete", 46);
  e.deleteRemovesFolder = !!(await until(async () => !(await titles(lab.folder)).includes("Lab sub")));
  await until(() => evalIn(cdp, panel, `!!document.querySelector("#undo")`));
  await shot(cdp, panel, join(runDir, "edit-undo-notice.png"));
  await clickSelector(cdp, panel, "#undo");
  e.undoRestoresSubtree = !!(await until(async () => {
    const id = await idOf("Lab sub");
    return id !== null && (await titles(id)).join(",") === "One,Two";
  }));

  e.step = '5. The menu';
  // 5. The menu: items, Add current tab, New folder with its editor; a root folder offers adds only.
  await rightClick(`[data-key="b:${lab.folder}"]`);
  e.menuItems = await until(menuItems) || "";
  await shot(cdp, panel, join(runDir, "edit-menu.png"));
  e.menuOnFolder = e.menuItems === "Edit…|Delete|New folder|Add current tab";
  const activeUrl = await bm(`chrome.tabs.query({ windowId: ${win.human}, active: true }).then(([t]) => t.url)`);
  await menuItem("Add current tab");
  e.addCurrentTab = !!(await until(async () => (await bm(`chrome.bookmarks.getChildren("${lab.folder}").then((c) => c.at(-1)?.url)`)) === activeUrl));
  await rightClick(`[data-key="b:${lab.folder}"]`);
  await until(menuItems);
  await menuItem("New folder");
  e.newFolderOpensEditor = !!(await editorOpen(1));
  await cdp.send("Input.insertText", { text: "Fresh" }, panel);
  await key("Enter", "Enter", 13);
  e.newFolderNamed = !!(await until(async () => (await titles(lab.folder)).includes("Fresh")));
  const otherKey = await evalIn(cdp, panel, `[...document.querySelectorAll(".row.folder")].find((r) => r.querySelector(".label")?.textContent === "Other bookmarks")?.dataset.key ?? null`);
  if (otherKey) {
    await rightClick(`[data-key="${otherKey}"]`);
    e.rootMenuAddsOnly = (await until(menuItems)) === "New folder|Add current tab";
    await key("Escape", "Escape", 27);
  } else e.rootMenuAddsOnly = "skipped: no Other bookmarks row";

  e.step = '6. Drag and drop';
  // 6. Drag and drop (CDP drag interception): Gamma before Alpha; this window's first tab into the lab folder.
  const drag = async (fromSel, toSel, fy) => {
    const a = await center(fromSel);
    await cdp.send("Input.setInterceptDrags", { enabled: true }, panel);
    const intercepted = new Promise((resolve) => cdp.listeners.push((m) => {
      if (m.method === "Input.dragIntercepted" && m.sessionId === panel) resolve(m.params.data);
    }));
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: a.x, y: a.y, button: "left", buttons: 1, clickCount: 1 }, panel);
    const b = await center(toSel, fy);
    for (let i = 1; i <= 6; i++) {
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: a.x + ((b.x - a.x) * i) / 6, y: a.y + ((b.y - a.y) * i) / 6, button: "left", buttons: 1 }, panel);
    }
    const data = await Promise.race([intercepted, sleep(2000).then(() => null)]);
    if (data) for (const type of ["dragEnter", "dragOver", "drop"]) await cdp.send("Input.dispatchDragEvent", { type, x: b.x, y: b.y, data }, panel);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.x, y: b.y, button: "left", clickCount: 1 }, panel);
    await cdp.send("Input.setInterceptDrags", { enabled: false }, panel);
    return !!data;
  };
  e.dragIntercepted = await drag(`[data-key="b:${gamma}"]`, `[data-key="b:${alpha}"]`, 0.15);
  e.dragMovesBookmark = !!(await until(async () => (await titles(lab.folder))[0] === "Gamma"));
  const [firstTab] = await tabsIn(win.human);
  await drag(`[data-key="t:${firstTab.id}"]`, `[data-key="b:${lab.folder}"]`, 0.5);
  e.tabDropSavesBookmark = !!(await until(async () => (await bm(`chrome.bookmarks.getChildren("${lab.folder}").then((c) => c.at(-1)?.url)`)) === ORIGIN + firstTab.url)); // tabsIn strips ORIGIN
  e.tabStaysOpen = (await tabsIn(win.human)).some((t) => t.id === firstTab.id);

  // 7. Bookmark icons: pick one from the grid, Undo; type any emoji. Site icons: a never-visited
  //    site gets its own /favicon.ico; a site with none keeps the globe; switched off, no requests.
  e.step = "7. Icons";
  const iconsStored = () => bm(`chrome.storage.local.get(null).then((s) => Object.fromEntries(Object.entries(s).filter(([k]) => k.startsWith("icon:")).map(([k, v]) => [k.slice(5), v])))`);
  await focusRow(beta);
  await key("F2", "F2", 113);
  await editorOpen(2);
  await clickSelector(cdp, panel, ".row.editing .icon-pick");
  e.iconPickerOpens = !!(await until(() => evalIn(cdp, panel, `document.querySelectorAll(".icon-picker .icon-grid button").length === 40`)));
  await shot(cdp, panel, join(runDir, "icon-picker.png"));
  await evalIn(cdp, panel, `[...document.querySelectorAll(".icon-grid button")].find((b) => b.textContent === "📚").setAttribute("data-harness-item", "")`);
  await clickSelector(cdp, panel, "[data-harness-item]");
  e.pickedIconShowsInEditor = await evalIn(cdp, panel, `document.querySelector(".row.editing .icon-pick")?.textContent === "📚" && !document.querySelector(".icon-picker")`);
  await key("Enter", "Enter", 13);
  e.pickedIconSaved = !!(await until(async () => (await iconsStored())[beta] === "📚"));
  e.iconShowsOnRow = !!(await until(() => evalIn(cdp, panel, `document.querySelector('[data-key="b:${beta}"] .emoji')?.textContent === "📚"`)));
  await focusRow(beta);
  await key("z", "KeyZ", 90, MOD);
  e.undoRemovesIcon = !!(await until(async () => (await iconsStored())[beta] === undefined));
  await focusRow(gamma);
  await key("F2", "F2", 113);
  await editorOpen(2);
  await clickSelector(cdp, panel, ".row.editing .icon-pick");
  await until(() => evalIn(cdp, panel, `!!document.querySelector(".icon-foot input")`));
  await evalIn(cdp, panel, `document.querySelector(".icon-foot input").focus()`);
  await cdp.send("Input.insertText", { text: "🍳" }, panel); // what the system emoji picker does
  await key("Enter", "Enter", 13);
  e.typedEmojiSaved = !!(await until(async () => (await iconsStored())[gamma] === "🍳"));

  const port = new URL(ORIGIN).port;
  // Evidence for the no-cors redirect rule (learnings · no-cors-redirect-modes).
  e.fetchProbe = await evalIn(cdp, panel, `Promise.all(["error", "follow", "manual"].map((redirect) =>
    fetch("http://localhost:${port}/favicon.ico", { mode: "no-cors", redirect, credentials: "omit" }).then((r) => redirect + ": " + r.type + " " + r.status, (x) => redirect + ": ERR " + x.message)))`);
  const fresh = `http://localhost:${port}/never-visited`, dead = "http://localhost:9/nothing-here";
  siteIconRequests.length = 0;
  const [freshId, deadId] = await bm(`Promise.all([
    chrome.bookmarks.create({ parentId: "${lab.folder}", title: "Never visited", url: ${JSON.stringify(fresh)} }),
    chrome.bookmarks.create({ parentId: "${lab.folder}", title: "No icon anywhere", url: ${JSON.stringify(dead)} }),
  ]).then((ns) => ns.map((n) => n.id))`);
  const imgFor = async (id) => evalIn(cdp, panel, `(() => { const i = document.querySelector('[data-key="b:${id}"] img.ico'); return i ? { src: i.src, ok: i.complete && i.naturalWidth > 0 } : null; })()`);
  const siteIcon = await until(async () => { const i = await imgFor(freshId); return i?.src === `http://localhost:${port}/favicon.ico` && i.ok ? i : null; }, 6000);
  e.siteIconForNeverVisited = !!siteIcon;
  // Only bookmarked sites are asked (the lab's never-visited 127.0.0.1 pages count too), nobody else.
  e.siteIconAskedOnlyBookmarkedSites = siteIconRequests.includes(`localhost:${port}`) && siteIconRequests.every((h) => h === `localhost:${port}` || h === `127.0.0.1:${port}`);
  e.siteIconHosts = [...siteIconRequests];
  // A page Chrome has its own icon for keeps it, even on a site whose icon was fetched for another page.
  const knownPage = await bm(`chrome.bookmarks.search({ title: "Calendar" }).then(([n]) => n.id)`);
  const known = await imgFor(knownPage);
  e.cachedIconsKeptOnSameSite = !!known && known.src.startsWith("chrome-extension://") && known.ok;
  // While asked and after it fails, a site without an icon keeps Chrome's default (never blank).
  await sleep(1500);
  const deadImg = await imgFor(deadId);
  e.deadImg = deadImg;
  e.noSiteIconKeepsDefault = !!deadImg && deadImg.src.startsWith("chrome-extension://") && deadImg.ok;
  await shot(cdp, panel, join(runDir, "site-icons.png"));
  // A site that redirects its icon requests elsewhere: not followed, the globe stays.
  const redirectId = await bm(`chrome.bookmarks.create({ parentId: "${lab.folder}", title: "Redirecting site", url: "http://localhost:${redirectSite.address().port}/page" }).then((n) => n.id)`);
  await sleep(2500);
  const redirectImg = await imgFor(redirectId);
  // Recorded, not judged: Chrome gives extensions no way to refuse the redirect (see learnings).
  e.redirectBehaviour = redirectedRequests.length > 0 ? `followed (${redirectedRequests.length} request(s) reached the other site)` : "not followed";
  e.redirectRowImg = redirectImg;
  // Switched off while a site is being asked: no further request to it.
  slowSiteRequests.length = 0;
  await bm(`chrome.bookmarks.create({ parentId: "${lab.folder}", title: "Slow site", url: "http://localhost:${slowSite.address().port}/page" })`);
  await until(() => slowSiteRequests.length > 0, 6000);
  await bm(`chrome.storage.local.set({ siteIcons: false })`);
  await sleep(4000);
  // Each window's panel may have asked for /favicon.ico before the switch; none goes on to the next file.
  e.switchOffStopsPendingSiteRequests = slowSiteRequests.length > 0 && slowSiteRequests.every((path) => path === "/favicon.ico");
  e.slowSiteRequests = [...slowSiteRequests];
  e.switchedOffUsesChromeCacheOnly = !!(await until(async () => {
    const i = await imgFor(freshId);
    return !!i && i.src.startsWith("chrome-extension://");
  }));
  // Switched back on in the same panel: the never-visited bookmark gets its site icon again.
  await bm(`chrome.storage.local.set({ siteIcons: true })`);
  e.offThenOnFindsSiteIconAgain = !!(await until(async () => {
    const i = await imgFor(freshId);
    return i?.src === `http://localhost:${port}/favicon.ico` && i.ok;
  }, 6000));

  await bm(`chrome.bookmarks.removeTree("${lab.folder}")`);
}

async function optionsPage(cdp, win, panel, runDir) {
  const o = {};
  // Age the install-time baseline so a reset to "now" is visible.
  const aged = Date.now() - 2 * 86400_000;
  await inExt(cdp, `chrome.storage.local.set({ lastSweepAt: ${aged} })`);
  o.storedBefore = await inExt(cdp, `chrome.storage.local.get(["enabled", "colourTreatment"])`);
  const wasActive = await inExt(cdp, `chrome.tabs.query({ windowId: ${win.human}, active: true }).then(([t]) => t.id)`);
  const tabId = await inExt(cdp, `chrome.tabs.create({ windowId: ${win.human}, url: "${ext(cdp, "options.html")}", active: true }).then((t) => t.id)`);
  await sleep(800);
  const { session } = await attachPage(cdp, (t) => t.url === ext(cdp, "options.html"));
  await sleep(300);
  o.sweepUncheckedOnFreshProfile = await evalIn(cdp, session, `document.getElementById("sweep").checked === false`);
  o.neutralCheckedOnFreshProfile = await evalIn(cdp, session, `document.querySelector('input[value="neutral"]').checked`);
  await clickSelector(cdp, session, "#sweep");
  const switchedOn = await until(() => inExt(cdp, `chrome.storage.local.get(["enabled", "lastSweepAt"]).then((s) => s.enabled === true && s.lastSweepAt > Date.now() - 60000 ? s : null)`));
  o.sweepSwitchStoresEnabled = !!switchedOn;
  o.switchingOnRestartsBaseline = !!switchedOn && switchedOn.lastSweepAt > aged;
  await clickSelector(cdp, session, 'input[value="warm"]');
  o.warmAppliesLiveToPanel = await until(() => evalIn(cdp, panel, `document.documentElement.dataset.treatment === "warm"`));
  await clickSelector(cdp, session, 'input[value="neutral"]');
  o.neutralAppliesLiveToPanel = await until(() => evalIn(cdp, panel, `document.documentElement.dataset.treatment === "neutral"`));
  // Phase 2.1: the tab title names the extension; the panel shows our icon for our own page.
  o.titleNamesExtension = await evalIn(cdp, session, `document.title === chrome.runtime.getManifest().name + " options"`);
  o.ownPageRowShowsOurIcon = await until(() => evalIn(cdp, panel, `(() => {
    const i = document.querySelector('[data-key="t:${tabId}"] img.ico');
    return !!i && i.src === chrome.runtime.getURL("icons/icon-32.png") && i.complete && i.naturalWidth > 0;
  })()`));
  await inExt(cdp, `chrome.tabs.update(${wasActive}, { active: true }).then(() => chrome.tabs.remove(${tabId}))`);
  await sleep(400);
  // The ⚙ button opens the options page; rows are 24 px.
  await clickSelector(cdp, panel, "#options");
  const opened = await until(() => inExt(cdp, `chrome.tabs.query({ url: "${ext(cdp, "options.html")}" }).then((ts) => ts[0]?.id ?? null)`));
  o.gearOpensOptions = !!opened;
  if (opened) await inExt(cdp, `chrome.tabs.remove(${opened})`);
  await sleep(400);
  o.rowHeightPx = await evalIn(cdp, panel, `document.querySelector(".row").getBoundingClientRect().height`);
  o.rowsAre24px = o.rowHeightPx === 24;
  return o;
}

/** The _execute_action shortcut: registered? And does a synthetic key press reach it? */
async function shortcut(cdp) {
  const s = {};
  s.commands = await inExt(cdp, "chrome.commands.getAll()");
  s.registered = s.commands.find((c) => c.name === "_execute_action")?.shortcut ?? "";
  // A third window without our panel; press the shortcut on its page.
  const wid = await inExt(cdp, `chrome.windows.create({ url: ${JSON.stringify(ORIGIN + "/notes")}, focused: ${FOCUS} }).then((w) => w.id)`);
  await sleep(1500);
  const page = await activePage(cdp, wid);
  await cdp.send("Page.bringToFront", {}, page.session).catch(() => {});
  const before = (await panelWindows(cdp)).filter((w) => w === wid).length;
  // Shortcuts reach only the focused window, and macOS makes Chrome the active app only while a
  // person is using the Mac (an unattended run can't activate it, not even with `open -a`).
  s.windowFocusedAtKey = await inExt(cdp, `chrome.windows.get(${wid}).then((w) => w.focused)`);
  // The manifest's default: Command+Shift+S on macOS (CDP Meta = 4), Ctrl+Shift+S elsewhere.
  const SHIFT = 8, MOD = process.platform === "darwin" ? 4 : 2;
  for (const type of ["rawKeyDown", "keyUp"]) {
    await cdp.send("Input.dispatchKeyEvent", { type, modifiers: MOD | SHIFT, key: "S", code: "KeyS", windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 1 }, page.session);
  }
  await sleep(1500);
  s.cdpKeyOpenedPanel = (await panelWindows(cdp)).filter((w) => w === wid).length > before;
  s.panelWindowsAfterKey = await panelWindows(cdp);
  // Pressed again, the same shortcut should close it (the action toggles the panel).
  for (const type of ["rawKeyDown", "keyUp"]) {
    await cdp.send("Input.dispatchKeyEvent", { type, modifiers: MOD | SHIFT, key: "S", code: "KeyS", windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 1 }, page.session);
  }
  await sleep(1500);
  s.panelWindowsAfterSecondKey = await panelWindows(cdp);
  s.secondKeyClosedPanel = !s.panelWindowsAfterSecondKey.includes(wid);
  if (!s.windowFocusedAtKey && !s.cdpKeyOpenedPanel) s.skipped = "window not focused: Chrome wasn't the active app (unattended run?)";
  // Chrome's UI DevTools server: does it accept input events for native views?
  try {
    const { ui } = await uiTree(cdp.uiPort);
    try {
      await ui.send("Input.dispatchKeyEvent", { type: "keyDown", modifiers: MOD | SHIFT, key: "S", code: "KeyS", windowsVirtualKeyCode: 83 });
      s.uiDevtoolsInput = "accepted";
    } catch (e) {
      s.uiDevtoolsInput = "unsupported: " + e.message.slice(0, 120);
    } finally {
      ui.ws.close();
    }
  } catch (e) {
    s.uiDevtoolsInput = "no connection: " + e.message.slice(0, 80);
  }
  return s;
}

/** Does Chrome reopen the Sidebar after a browser restart (session restore on)? */
async function restartCheck(runDir) {
  const out = {};
  const profile = join(runDir, "profile-restart");
  writeProfile(profile, { ...LAYOUTS.B.prefs, session: { restore_on_startup: 1 } });
  let cdp = await launch(profile);
  try {
    await sleep(1500);
    const [w] = await inExt(cdp, `chrome.windows.getAll({ windowTypes: ["normal"] }).then((ws) => ws.map((w) => w.id))`);
    await inExt(cdp, `chrome.tabs.create({ windowId: ${w}, url: ${JSON.stringify(ORIGIN + "/calendar")}, active: false })`);
    await listenPanelEvents(cdp);
    out.openTitle = await openPanel(cdp, w);
    out.panelWindowsBeforeRestart = await panelWindows(cdp);
    out.tabsBeforeRestart = await inExt(cdp, `chrome.tabs.query({}).then((ts) => ts.length)`);
  } finally {
    await quit(cdp);
  }
  await sleep(1000);
  cdp = await launch(profile, ["--restore-last-session"], { url: null });
  try {
    await sleep(4000);
    out.tabsAfterRestart = await inExt(cdp, `chrome.tabs.query({}).then((ts) => ts.length)`);
    out.sessionRestored = out.tabsAfterRestart === out.tabsBeforeRestart;
    out.panelTargetsAfterRestart = (await panelTargets(cdp)).length;
    out.panelReopensAfterRestart = out.panelTargetsAfterRestart > 0;
  } finally {
    await quit(cdp);
  }
  return out;
}

// --- Composite: real panel + page pixels placed at Chrome's measured native geometry. ---------
// macOS screen recording is not granted to this session, so Chrome's own toolbar, tab strip and
// rail are drawn as labelled boxes at their measured bounds, never as pixels.
function compositeHtml(r) {
  const v = r.views, W = v.BrowserView.width, H = v.BrowserView.height;
  const sp = v.SidePanel, rail = v.VerticalTabStripRegionView, top = sp.y;
  const railW = rail.visible ? rail.width : 0;
  const panelLeft = sp.x < W / 2;
  const header = sp.height - r.panelPage.innerHeight;
  const contentX = sp.x + (panelLeft ? 0 : sp.width - r.panelPage.innerWidth - 9) + Math.round((sp.width - 9 - r.panelPage.innerWidth) / 2);
  const pageX = panelLeft ? sp.x + sp.width : railW, pageW = W - pageX - (panelLeft ? 0 : W - sp.x);
  const native = "background:repeating-linear-gradient(135deg,#e6e8eb 0 6px,#eef0f2 6px 12px);color:#555;font:12px system-ui;display:flex;align-items:center;justify-content:center;text-align:center;";
  const tag = (x, y, text) => `<div style="position:absolute;left:${x}px;top:${y}px;background:#1f1f1f;color:#fff;font:600 12px system-ui;padding:3px 7px;border-radius:4px;white-space:nowrap">${text}</div>`;
  return `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff">
  <div style="position:relative;width:${W}px;height:${H}px;overflow:hidden;font:12px system-ui">
    <div style="position:absolute;left:0;top:0;width:${W}px;height:${top}px;${native}">Chrome toolbar${rail.visible ? "" : " + horizontal tab strip"} — native, ${top} px tall (drawn from measured bounds)</div>
    ${rail.visible ? `<div style="position:absolute;left:${rail.x}px;top:${rail.y}px;width:${rail.width}px;height:${rail.height}px;${native}writing-mode:vertical-rl">native vertical tabs · ${rail.width} px</div>` : ""}
    <div style="position:absolute;left:${sp.x}px;top:${sp.y}px;width:${sp.width}px;height:${header}px;${native}">native panel header · ${header} px</div>
    <img src="${r.layout}-panel.png" style="position:absolute;left:${contentX}px;top:${sp.y + header}px;width:${r.panelPage.innerWidth}px;height:${r.panelPage.innerHeight}px">
    <div style="position:absolute;left:${panelLeft ? sp.x + sp.width - 1 : sp.x}px;top:${top}px;width:1px;height:${sp.height}px;background:#c7c9cc"></div>
    <img src="${r.layout}-page.png" style="position:absolute;left:${pageX + (pageW - r.page.innerWidth) / 2}px;top:${top + (H - top - r.page.innerHeight) / 2}px;width:${r.page.innerWidth}px;height:${r.page.innerHeight}px;outline:1px solid #ddd">
    ${tag(sp.x + 8, H - 34, `panel ${sp.width} px (content ${r.panelPage.innerWidth})`)}
    ${rail.visible && railW > 100 ? tag(8, H - 64, `vertical tabs ${railW} px`) : ""}
    ${tag(pageX + 12, top + 10, `page ${r.page.innerWidth} px of ${W}`)}
  </div>`;
}
function renderComposite(runDir, r) {
  const html = join(runDir, `composite-${r.layout}.html`);
  writeFileSync(html, compositeHtml(r));
  const png = join(runDir, `shell-${r.layout}.png`);
  const p = spawn(chromeBin, ["--headless=new", `--user-data-dir=${mkdtempSync(join(runDir, "composite-profile-"))}`, "--no-first-run",
    "--force-device-scale-factor=1", "--hide-scrollbars", `--window-size=${r.views.BrowserView.width},${r.views.BrowserView.height}`,
    `--screenshot=${png}`, "--virtual-time-budget=2000", `file://${html}`], { stdio: "ignore" });
  return new Promise((ok) => p.on("exit", () => ok(png)));
}

if (mode === "measure") {
  mkdirSync(workDir, { recursive: true });
  const runDir = mkdtempSync(join(workDir, "measure-"));
  log("run dir", runDir);
  const results = { at: new Date().toISOString(), window: WINDOW, layouts: [] };
  for (const key of (process.env.ONLY ?? Object.keys(LAYOUTS).join(",")).split(",")) {
    log("layout", key);
    const r = await measureLayout(runDir, key, { interactions: key === "B" });
    log(JSON.stringify(r).slice(0, 400));
    results.layouts.push(r);
  }
  if (!process.env.ONLY || process.env.RESTART === "1") {
    log("restart check");
    results.restart = await restartCheck(runDir).catch((e) => ({ error: String(e.stack ?? e).slice(0, 800) }));
    log(JSON.stringify(results.restart));
  }
  for (const r of results.layouts) if (!r.error) r.files.shell = await renderComposite(runDir, r);
  writeFileSync(join(runDir, "results.json"), JSON.stringify(results, null, 2));
  log("results", join(runDir, "results.json"));
  server.close();
  slowSite.close();
  redirectSite.close();
  const failed = requiredFailures(results);
  if (failed.length) log("FAILED:", failed.join(", "));
  else log("all required checks passed");
  process.exit(failed.length ? 1 : 0);
}

/** Required checks that didn't pass. The restart probe finding the panel closed is a valid
 *  measurement, not a failure; the probe erroring is. */
function requiredFailures(results) {
  const failed = [];
  for (const r of results.layouts) {
    if (r.error) failed.push(`${r.layout ?? "layout"}: ${String(r.error).split("\n")[0]}`);
    const i = r.interactions ?? {};
    for (const [k, ok] of Object.entries(i.checks ?? {})) if (!ok) failed.push(k);
    for (const [k, ok] of Object.entries(i.options ?? {})) if (typeof ok === "boolean" && !ok) failed.push(`options.${k}`);
    for (const [k, ok] of Object.entries(i.edits?.checks ?? {})) if (!ok) failed.push(`edits.${k}`);
  }
  const restart = results.restart;
  if (restart?.error) failed.push(`restart: ${restart.error.split("\n")[0]}`);
  for (const r of results.layouts) {
    const s = r.shortcut;
    if (s && !s.registered) failed.push("shortcut not registered");
    else if (s && !s.skipped && (!s.cdpKeyOpenedPanel || !s.secondKeyClosedPanel)) failed.push("shortcut");
    if (s?.skipped) log("shortcut check skipped:", s.skipped);
  }
  return failed;
}

if (mode === "demo") {
  // A live, headed review session: synthetic Human + AI windows, the Sidebar open in both. Layout via DEMO_LAYOUT (A, B, Bright, baseline; default B). Quit Chrome to end.
  const key = process.env.DEMO_LAYOUT ?? "B";
  mkdirSync(workDir, { recursive: true });
  const runDir = mkdtempSync(join(workDir, "demo-"));
  const profile = join(runDir, "profile");
  writeProfile(profile, LAYOUTS[key].prefs);
  const cdp = await launch(profile);
  const win = await openSyntheticWindows(cdp);
  await sleep(1000);
  await openPanel(cdp, win.ai);
  await openPanel(cdp, win.human);
  log(`demo running (${LAYOUTS[key].label}) — throwaway profile ${profile}`);
  log("Colours and the sweep switch: the extension's options page (chrome://extensions → Details → Extension options). Quit Chrome for Testing to end.");
  cdp.proc.on("exit", () => { server.close(); process.exit(0); });
}

if (mode === "explore") {
  const runDir = mkdtempSync(join(workDir, "explore-"));
  const profile = join(runDir, "profile");
  writeProfile(profile, JSON.parse(process.argv[5] ?? "{}"));
  const cdp = await launch(profile, (process.argv[6] ?? "").split(" ").filter(Boolean));
  log("launched", cdp.version, "ui port", cdp.uiPort);
  const g = await viewGeometry(cdp.uiPort, ["BrowserView", "SidePanel", "VerticalTabStripRegionView", "HorizontalTabStripRegionViewOld", "TabStrip"]);
  log(JSON.stringify(g, null, 1));
  await sleep(1000);
  await quit(cdp);
  process.exit(0);
}
