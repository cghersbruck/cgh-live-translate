#!/usr/bin/env node
/**
 * Takes all README/PR screenshots: home (desktop + mobile), watch and broadcast (mobile) in every UI locale.
 * Playwright is a pinned devDependency (npm ci --ignore-scripts, then: npx --no-install playwright install chromium). $PLAYWRIGHT_DIR/node_modules is an optional fallback.
 *
 * Mock mode (stubbed API, no LiveKit needed):
 *   npm run screenshots
 * Live mode (real session + real LiveKit room; LiveKit/Gemini creds from Infisical project cgh, root path, dev env).
 * Never starts a Gemini translation. Needs an Infisical login; if the session expired, the owner logs in:
 *   infisical run --projectId=ed919770-bc3a-46bb-8458-a70c022b771f --env=dev -- npm run screenshots
 *
 * Flags go after "--": `npm run screenshots -- --mock` forces mock, `npm run screenshots -- --live` forces live
 * (error if LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET missing). In live mode a missing button or a room that is not connected exits non-zero.
 * Env: BASE_URL (else http://localhost:3100, started with `next dev` if nothing answers),
 * OUT_DIR (default docs/screenshots; must be a subdirectory of the repo or of the system temp dir, only its *.png are deleted),
 * SHOTS_PORT (default 3100, port of a server this script starts), BROADCAST_PASSWORD (a random one is used for a server this script starts). Env values are never printed.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const OUT = resolve(root, process.env.OUT_DIR || "docs/screenshots");
const inside = (base, p) => { const r = relative(base, p); return r !== "" && !r.startsWith("..") && !isAbsolute(r); };
if (![root, "/tmp", "/private/tmp", tmpdir()].some((b) => inside(b, OUT))) die(`OUT_DIR must be a subdirectory of the repo or of the system temp dir, got: ${OUT}`);
const LOCALES = ["de", "en", "zh-Hans", "es", "ro", "ru", "hu"];
const LIVE_ENV = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"];
const missing = LIVE_ENV.filter((k) => !process.env[k]);
if (process.argv.includes("--live") && missing.length) die(`--live needs env: ${missing.join(", ")} (names only)`);
const LIVE = process.argv.includes("--live") || (!process.argv.includes("--mock") && !missing.length);
const PORT = process.env.SHOTS_PORT || "3100";
const BASE = process.env.BASE_URL || `http://localhost:${PORT}`;
let server = null;
let browser = null;
let password = process.env.BROADCAST_PASSWORD || "";
let sessionId = "";
let failed = 0;

function die(msg) { console.error(msg); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const answers = (url) => fetch(url, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok, () => false);

function loadPlaywright() {
  const dirs = [root, process.env.PLAYWRIGHT_DIR].filter(Boolean);
  for (const dir of dirs) {
    try { return createRequire(join(dir, "x.js"))("playwright"); } catch { /* try next */ }
  }
  die("playwright not found: run npm ci --ignore-scripts or set PLAYWRIGHT_DIR (dir containing node_modules/playwright), e.g. a repo that has it");
}

async function ensureServer() {
  if (process.env.BASE_URL || (await answers(BASE))) return;
  if (!password) password = randomUUID();
  // stdio ignored: dev server logs must not end up in our output
  server = spawn("npx", ["--no-install", "next", "dev", "-p", PORT], { cwd: root, detached: true, stdio: "ignore", env: { ...process.env, BROADCAST_PASSWORD: password } });
  let exited = false;
  server.on("exit", () => { exited = true; });
  for (const end = Date.now() + 90_000; Date.now() < end; await sleep(1000)) {
    if (exited) die("next dev exited before it answered (another dev server in this repo running?)");
    if (await answers(BASE)) return;
  }
  die("next dev did not answer within 90 s");
}
const stopServer = () => { try { if (server?.pid) process.kill(-server.pid, "SIGTERM"); } catch { /* already gone */ } };
process.on("exit", stopServer);

// Idempotent: normal end, error and signals all run it once (browser, live session, server - in this order).
let cleanup = null;
const cleanupOnce = () => (cleanup ??= (async () => {
  await browser?.close().catch(() => {});
  if (sessionId) await fetch(`${BASE}/api/sessions/${sessionId}`, { method: "DELETE", signal: AbortSignal.timeout(5000) }).catch(() => console.warn("WARN: live session delete failed"));
  stopServer();
})());
for (const [sig, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) process.on(sig, () => cleanupOnce().finally(() => process.exit(code)));

const json = (route, body) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });

async function newContext(browser, loc, mobile) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    ...(mobile && { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }),
    permissions: ["microphone"],
  });
  await ctx.addInitScript(([l, pw, live]) => {
    localStorage.setItem("cgh-ui-language", l);
    if (pw) sessionStorage.setItem("broadcast_password", pw);
    // Chromium's fake mic can hang getUserMedia on macOS (OS permission); a silent synthetic track is enough
    if (live) navigator.mediaDevices.getUserMedia = async () => new AudioContext().createMediaStreamDestination().stream;
  }, [loc, LIVE ? password : "", LIVE]);
  if (!LIVE) {
    // LiveKit socket to the fake server stays "connecting" forever: no connection-lost error screen
    await ctx.addInitScript(() => {
      const Native = window.WebSocket;
      window.WebSocket = function (url, ...rest) {
        return String(url).includes("127.0.0.1:9") ? Object.assign(new EventTarget(), { readyState: 0, close() {}, send() {} }) : new Native(url, ...rest);
      };
    });
  }
  await ctx.route(/\/api\/auth\/status$/, (r) => json(r, { passwordRequired: false }));
  if (!LIVE) {
    await ctx.route(/\/api\/sessions\/[^/?]+$/, (r) => r.request().method() === "GET" ? json(r, { sessionId: "demo", allowedLanguages: ["en", "es", "ro", "ru", "hu", "zh-Hans"], translations: [] }) : r.fallback());
    await ctx.route(/\/api\/token\?/, (r) => json(r, { token: "mock", serverUrl: "wss://127.0.0.1:9" }));
    await ctx.route(/\/api\/translate\/status\?/, (r) => json(r, { translations: [] }));
  }
  return ctx;
}

// Opens a page and waits for a settled UI (click: press the first dark button); live pages also wait for the connected state (class status--active).
async function open(ctx, path, name, connected, click) {
  const page = await ctx.newPage();
  await page.goto(BASE + path, { waitUntil: "load", timeout: 90_000 });
  // first dark button: watch = "start listening" gate (needed for audio), broadcast = microphone on (fake device)
  if (click) await page.click(".btn-dark", { timeout: 10_000 }).catch(() => { failed++; console.warn(`WARN ${name}: button not found, shooting current state`); });
  if (LIVE && connected) {
    await page.waitForSelector(".status--active", { timeout: 20_000 }).then(() => console.log(`  ${name}: connected`),
      () => { failed++; console.warn(`WARN ${name}: LiveKit room not connected within 20 s, shooting current state`); });
  }
  await page.waitForTimeout(1200);
  return page;
}

async function snap(page, name) {
  try {
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    console.log(`ok   ${name}`);
  } catch (e) { failed++; console.error(`FAIL ${name}: ${e.message.split("\n")[0]}`); }
}

async function step(name, fn) {
  try { await fn(); } catch (e) { failed++; console.error(`FAIL ${name}: ${e.message.split("\n")[0]}`); }
}

async function main() {
  console.log(`mode=${LIVE ? "live" : "mock"} out=${OUT}`);
  console.log(`env present: ${LIVE_ENV.filter((k) => process.env[k]).join(",") || "-"}; absent: ${missing.join(",") || "-"}`);
  const { chromium } = loadPlaywright();
  await ensureServer();
  const shown = new URL(BASE);
  shown.username = shown.password = ""; // never print userinfo
  console.log(`server=${shown.href}${server ? " (started by script)" : ""}`);

  if (LIVE) {
    const probe = await fetch(`${BASE}/api/token?room=probe&identity=probe&role=organizer`);
    if (probe.status === 401) console.warn("WARN credential probe inconclusive (HTTP 401, password required): LiveKit credentials not checked");
    if (probe.status === 500) die("server at BASE has no LiveKit credentials: start it with the same env, or stop it and let the script start one (SHOTS_PORT picks another port)");
    const res = await fetch(`${BASE}/api/sessions`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizerName: "host", password, eventId: `shots-${randomUUID().slice(0, 6)}` }) });
    if (!res.ok) die(`POST /api/sessions failed: HTTP ${res.status}`);
    sessionId = (await res.json()).sessionId;
  }
  const id = sessionId || "demo";

  // signal handlers are ours (cleanupOnce), not Playwright's
  browser = await chromium.launch({ handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  // server reachable, session created, browser up: only now touch OUT
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) if (f.endsWith(".png")) unlinkSync(join(OUT, f));
  try {
    await step("home-de-desktop", async () => {
      const ctx = await newContext(browser, "de", false);
      await snap(await open(ctx, "/", "home-de-desktop"), "home-de-desktop");
      await ctx.close();
    });
    for (const loc of LOCALES) {
      await step(`mobile-${loc}`, async () => {
        const host = await newContext(browser, loc, true);
        const listener = await newContext(browser, loc, true); // second context: separate browser session
        try {
          await snap(await open(host, "/", `home-${loc}-mobile`), `home-${loc}-mobile`);
          const b = await open(host, `/session/${id}/broadcast`, `broadcast-${loc}-mobile`, true, LIVE);
          const w = await open(listener, `/session/${id}/watch`, `watch-${loc}-mobile`, true, true);
          await snap(w, `watch-${loc}-mobile`);
          await snap(b, `broadcast-${loc}-mobile`);
        } finally { await host.close(); await listener.close(); }
      });
    }
  } finally {
    await cleanupOnce();
  }
  const n = readdirSync(OUT).filter((f) => f.endsWith(".png")).length;
  console.log(`${n} PNG in ${OUT}, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(`error: ${e.message.split("\n")[0]}`); process.exitCode = 1; }).finally(cleanupOnce);
