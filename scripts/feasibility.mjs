// Feasibility slice for the nightly sweep (plan step 5). Drives Chrome for Testing over the
// DevTools protocol with throwaway profiles and synthetic local pages only.
//
//   node scripts/feasibility.mjs "<path to Google Chrome for Testing binary>" <work dir>
//
// Never point this at a real Chrome or a real profile.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [chromeBin, workDir] = process.argv.slice(2);
if (!chromeBin || !workDir) throw new Error("usage: feasibility.mjs <chrome-for-testing> <work dir>");
const EXT = resolve("dist/extension");
const EXT_NAME = JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8")).name;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// --- Synthetic pages. ----------------------------------------------------------------------
const server = createServer((req, res) => {
  const page = (body) => `<!doctype html><title>${req.url}</title><body>${req.url}${body}</body>`;
  res.setHeader("content-type", "text/html");
  if (req.url.startsWith("/audio"))
    return res.end(page(`<script>const c=new AudioContext();const o=c.createOscillator();
      const g=c.createGain();g.gain.value=0.001;o.connect(g).connect(c.destination);o.start();</script>`));
  if (req.url.startsWith("/unload"))
    return res.end(page(`<script>addEventListener("beforeunload",e=>{e.preventDefault();e.returnValue="";});</script>`));
  res.end(page(""));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

// --- Minimal CDP client. -------------------------------------------------------------------
class Cdp {
  static async connect(url) {
    const c = new Cdp();
    c.ws = new WebSocket(url);
    c.id = 0;
    c.pending = new Map();
    c.listeners = [];
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

async function launch(profile, extraArgs = []) {
  rmSync(join(profile, "DevToolsActivePort"), { force: true });
  const proc = spawn(chromeBin, [
    `--user-data-dir=${profile}`,
    `--load-extension=${EXT}`,
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required",
    "--headless=new",
    ...extraArgs,
  ], { stdio: "ignore" });
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    if (existsSync(join(profile, "DevToolsActivePort")))
      port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0];
  }
  const { webSocketDebuggerUrl, Browser } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const cdp = await Cdp.connect(webSocketDebuggerUrl);
  cdp.version = Browser;
  cdp.proc = proc;
  // Find the extension's service worker and attach to it.
  for (let i = 0; i < 100 && !cdp.sw; i++) {
    const { targetInfos } = await cdp.send("Target.getTargets");
    for (const sw of targetInfos.filter((t) => t.type === "service_worker" && t.url.startsWith("chrome-extension://"))) {
      const session = (await cdp.send("Target.attachToTarget", { targetId: sw.targetId, flatten: true })).sessionId;
      const r = await cdp.send("Runtime.evaluate", { expression: "globalThis.chrome?.runtime?.getManifest?.().name", returnByValue: true }, session);
      if (r.result.value === EXT_NAME) cdp.sw = session;
    }
    if (!cdp.sw) await sleep(200);
  }
  if (!cdp.sw) throw new Error("extension service worker not found");
  cdp.swLog = [];
  cdp.listeners.push((m) => {
    if (m.sessionId !== cdp.sw) return;
    if (m.method === "Runtime.consoleAPICalled") cdp.swLog.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
    if (m.method === "Runtime.exceptionThrown") cdp.swLog.push("EXC " + m.params.exceptionDetails.exception?.description);
  });
  await cdp.send("Runtime.enable", {}, cdp.sw);
  return cdp;
}

/** Evaluates an async expression inside the extension's service worker. */
async function inSw(cdp, expression) {
  const r = await cdp.send("Runtime.evaluate", { expression: `(async()=>{${expression}})()`, awaitPromise: true, returnByValue: true }, cdp.sw);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

async function pages(cdp) {
  const { targetInfos } = await cdp.send("Target.getTargets");
  return targetInfos.filter((t) => t.type === "page").map((t) => t.url.replace(ORIGIN, ""));
}

async function quit(cdp) {
  await cdp.send("Browser.close").catch(() => {});
  await new Promise((r) => (cdp.proc.exitCode !== null ? r() : cdp.proc.on("exit", r)));
}

/** Waits until a sweep receipt newer than `since` appears (the alarm fires at most every 30 s). */
async function awaitSweep(cdp, since, timeoutMs = 120_000) {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(1000)) {
    const r = await inSw(cdp, `return (await chrome.storage.local.get("sweepReceipts")).sweepReceipts?.[0] ?? null;`);
    if (r && r.at > since) return r;
  }
  const state = await inSw(cdp, `return { local: await chrome.storage.local.get(null), alarms: await chrome.alarms.getAll(), now: Date.now() };`);
  throw new Error("no sweep happened: " + JSON.stringify({ state, swLog: cdp.swLog, dialog: globalThis.dialogOpened ?? null, pages: await pages(cdp) }));
}
const pokeAlarm = (cdp) => inSw(cdp, `await chrome.alarms.create("sweep-check",{delayInMinutes:0.5,periodInMinutes:5}); return true;`);

const results = {};
mkdirSync(workDir, { recursive: true });
// Every run gets its own fresh directory; nothing pre-existing is ever deleted.
const runDir = mkdtempSync(join(workDir, "run-"));
log("run dir", runDir);

// =============================================================================================
// Probe A + D + E: one sweep in a live session.
{
  const profile = join(runDir, "profile-a");
  const cdp = await launch(profile);
  log("Chrome", cdp.version);
  results.chrome = cdp.version;
  await sleep(7000);
  results.installInitialisesLastSweep = await inSw(cdp, `return typeof (await chrome.storage.local.get("lastSweepAt")).lastSweepAt === "number";`);

  const ids = await inSw(cdp, `
    const w1 = await chrome.windows.create({ url: "${ORIGIN}/page/1", focused: true });
    const t2 = await chrome.tabs.create({ windowId: w1.id, url: "${ORIGIN}/page/2", active: false });
    const ta = await chrome.tabs.create({ windowId: w1.id, url: "${ORIGIN}/audio", active: false });
    const tu = await chrome.tabs.create({ windowId: w1.id, url: "${ORIGIN}/unload", active: false });
    const w2 = await chrome.windows.create({ url: "${ORIGIN}/page/3", focused: false });
    const t4 = await chrome.tabs.create({ windowId: w2.id, url: "${ORIGIN}/page/4", active: false });
    const t5 = await chrome.tabs.create({ windowId: w2.id, url: "${ORIGIN}/page/5", active: false });
    const w3 = await chrome.windows.create({ url: "${ORIGIN}/page/6", focused: false });
    await chrome.tabs.create({ windowId: w3.id, url: "${ORIGIN}/page/7", active: false });
    await chrome.windows.update(w1.id, { focused: true });
    return { w3: w3.id, w1: w1.id, w2: w2.id, t2: t2.id, audio: ta.id, unload: tu.id, t4: t4.id, t5: t5.id };`);
  await sleep(3000);

  // Give the unload page a user gesture (Chrome only honours beforeunload after one).
  const { targetInfos } = await cdp.send("Target.getTargets");
  const unloadTarget = targetInfos.find((t) => t.url.endsWith("/unload"));
  const us = (await cdp.send("Target.attachToTarget", { targetId: unloadTarget.targetId, flatten: true })).sessionId;
  let dialogOpened = false;
  cdp.listeners.push((m) => { if (m.method === "Page.javascriptDialogOpening") globalThis.dialogOpened = dialogOpened = m.params; });
  await cdp.send("Page.enable", {}, us);
  for (const type of ["mousePressed", "mouseReleased"])
    await cdp.send("Input.dispatchMouseEvent", { type, x: 5, y: 5, button: "left", clickCount: 1 }, us);
  results.audibleSeen = await inSw(cdp, `return (await chrome.tabs.get(${ids.audio})).audible;`);

  // Guard 60 s. Let everything go stale, then use t4 (activate) and t5 (agent-style navigation).
  // The sweep follows ~32 s later (alarm delay), so those two are inside the guard.
  // The sweep is off by default since v0.2.0 (options page switch); this probe needs it on.
  await inSw(cdp, `await chrome.storage.local.set({ enabled: true, testGuardMs: 60000 }); return true;`);
  await sleep(65_000);
  await inSw(cdp, `await chrome.tabs.update(${ids.t4}, { active: true }); return true;`);
  const t5Target = (await cdp.send("Target.getTargets")).targetInfos.find((t) => t.url.endsWith("/page/5"));
  const s5 = (await cdp.send("Target.attachToTarget", { targetId: t5Target.targetId, flatten: true })).sessionId;
  await cdp.send("Page.navigate", { url: `${ORIGIN}/page/5b` }, s5);
  await sleep(2000);
  results.recordsBeforeSweep = await inSw(cdp, `return Object.keys((await chrome.storage.session.get("lastUse")).lastUse ?? {}).length;`);
  results.pagesBeforeSweep = await pages(cdp);

  const before = Date.now();
  await inSw(cdp, `await chrome.storage.local.set({ testForceDue: true }); return true;`);
  await pokeAlarm(cdp);
  results.sweepA = await awaitSweep(cdp, before);
  await sleep(2000);
  results.pagesAfterSweep = await pages(cdp);
  results.windowsAfterSweep = await inSw(cdp, `return (await chrome.windows.getAll({ populate: true })).map(w => ({ id: w.id, tabs: w.tabs.length, focused: w.focused }));`);
  results.emptiedWindowSurvives = results.windowsAfterSweep.some((w) => w.id === ids.w3 && w.tabs === 1);
  results.beforeunloadDialog = dialogOpened ? { type: dialogOpened.type } : false;
  results.unloadTabStillOpen = await inSw(cdp, `try { await chrome.tabs.get(${ids.unload}); return true; } catch { return false; }`);
  log("probe A", JSON.stringify(results.sweepA));
  await quit(cdp);

  // E: closed pages are in native History.
  const db = join(runDir, "history-copy.sqlite");
  copyFileSync(join(profile, "Default", "History"), db);
  results.historyUrls = execFileSync("sqlite3", [db, "select url from urls order by id;"], { encoding: "utf8" })
    .trim().split("\n").map((u) => u.replace(ORIGIN, ""));
}

// =============================================================================================
// Probe B + C: restart with session restore, then a sweep that was missed while Chrome was closed.
{
  const profile = join(runDir, "profile-b");
  mkdirSync(join(profile, "Default"), { recursive: true });
  writeFileSync(join(profile, "Default", "Preferences"), JSON.stringify({ session: { restore_on_startup: 1 } }));

  // Run 1: open and use tabs, then quit.
  let cdp = await launch(profile);
  await sleep(7000);
  const run1 = await inSw(cdp, `
    const w = await chrome.windows.create({ url: "${ORIGIN}/page/r1", focused: true });
    for (const n of ["r2", "r3"]) await chrome.tabs.create({ windowId: w.id, url: "${ORIGIN}/page/" + n });
    await new Promise(r => setTimeout(r, 1500));
    const tabs = await chrome.tabs.query({ windowId: w.id });
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.storage.local.set({ enabled: false });
    return (await chrome.tabs.query({ windowId: w.id })).map(t => ({ index: t.index, lastAccessed: t.lastAccessed }));`);
  results.restartRun1 = run1;
  await sleep(3000);
  await quit(cdp);
  const quitAt = Date.now();

  // Run 2: what does Chrome restore, and did restore count as use?
  cdp = await launch(profile, ["--restore-last-session"]);
  await sleep(10_000);
  results.restartRun2 = await inSw(cdp, `
    const wins = await chrome.windows.getAll({ populate: true });
    return { launchedAt: ${Date.now()}, records: (await chrome.storage.session.get("lastUse")).lastUse ?? {},
      windows: wins.map(w => w.tabs.map(t => ({ index: t.index, active: t.active, lastAccessed: t.lastAccessed }))) };`);
  results.restartRun2.pages = await pages(cdp);
  results.restartRun2.lastAccessedPreserved = results.restartRun2.windows.flat()
    .map((t) => run1.some((r) => Math.abs(r.lastAccessed - t.lastAccessed) < 10));
  // Arrange a sweep that is overdue while Chrome is closed: last sweep two days ago, guard 30 s.
  // Re-enabling resets the baseline to now (that's the feature) — check it, then backdate.
  results.reenableResetsBaseline = await inSw(cdp, `
    await chrome.storage.local.set({ enabled: true, lastSweepAt: Date.now() - 2 * 86400000 });
    await new Promise(r => setTimeout(r, 1000));
    return Date.now() - (await chrome.storage.local.get("lastSweepAt")).lastSweepAt < 5000;`);
  await inSw(cdp, `await chrome.storage.local.set({ lastSweepAt: Date.now() - 2 * 86400000, testGuardMs: 30000 }); return true;`);
  await quit(cdp);
  await sleep(35_000); // let every restored tab's last use fall outside the 30 s guard

  // Run 3: the missed sweep runs on launch, after restore settles.
  const launch3 = Date.now();
  cdp = await launch(profile, ["--restore-last-session"]);
  results.sweepOnLaunch = await awaitSweep(cdp, launch3, 60_000);
  results.sweepOnLaunchDelayMs = results.sweepOnLaunch.at - launch3;
  results.pagesAfterLaunchSweep = await pages(cdp);
  await quit(cdp);
  results.quitToRelaunchMs = launch3 - quitAt;
}

server.close();
writeFileSync(join(runDir, "feasibility-results.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
