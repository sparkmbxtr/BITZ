import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { routeMonitorAuth } from "../../worker/nucleosome-auth.mjs";
import { routeNucleosomeProgress } from "../../worker/nucleosome-progress.mjs";
import { INITIAL_SNAPSHOT } from "../../worker/nucleosome-snapshot.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const executablePath = process.env.CHROMIUM_PATH || ["/usr/bin/chromium", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"].find(existsSync);
let version = "a".repeat(24), base;
const state = structuredClone(INITIAL_SNAPSHOT);
state.information_updated_at = new Date().toISOString();
const fixture = "UPDATES-FIXTURE";
const env = { NUCLEOSOME_PASSWORD_HASH: createHash("sha256").update(fixture).digest("hex"), DASHBOARD_SESSION_SECRET: "only-a-fixture-key",
  CONTEXT_LOG: { getByName: () => ({ readNucleosomeProgress: async () => JSON.stringify(state) }) } };
const server = createServer(async (incoming, outgoing) => {
  try {
    const local = new URL(incoming.url, base);
    if (local.pathname === "/api/display-version") {
      outgoing.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });outgoing.end(JSON.stringify({ version }));return;
    }
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const headers = Object.fromEntries(Object.entries(incoming.headers).filter(([, value]) => value !== undefined));
    const request = new Request(local.pathname === "/api/nucleosome-auth" ? local : new URL(incoming.url, "https://spark.bioengineering.workers.dev"),
      { method: incoming.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
    const response = local.pathname === "/api/nucleosome-auth" ? await routeMonitorAuth(request, env) : await routeNucleosomeProgress(request, env);
    if (!response) { outgoing.writeHead(404);outgoing.end();return; }
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end((await response.text()).replaceAll("development", version));
  } catch { outgoing.writeHead(500);outgoing.end("Fixture failure; body omitted"); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));base = "http://localhost:" + server.address().port;
const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking"] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    // Restricted device storage must not disable the in-memory update fallback.
    Object.defineProperty(window, "sessionStorage", { get() { throw new DOMException("Fixture storage disabled", "SecurityError"); } });
  });
  const page = await context.newPage();
  await page.clock.install({ time: new Date() });
  await page.goto(base);await page.locator("#password").fill(fixture);
  await Promise.all([page.waitForNavigation(), page.getByRole("button", { name: "Open monitor" }).click()]);
  await page.waitForFunction(() => document.getElementById("active-steps").textContent.includes("35,000"));
  assert.equal(await page.locator("#wsl-state").textContent(), "WSL unconfirmed");
  const originalCookie = (await context.cookies(base)).find(c => c.name === "__Host-spark_nucleosome_week");
  const beforeURL = page.url();
  const at = new Date().toISOString();
  state.jobs[4].step = 36000;state.jobs[4].checkpoint_at = at;state.information_updated_at = at;
  state.history.push({ at, step: 436000 });
  state.wsl_connection = { reported_state: "connected", observed_at: at, last_seen_at: at, evidence: "original-wsl-relay" };
  await page.clock.fastForward(31000);
  await page.waitForFunction(() => document.getElementById("active-steps").textContent.includes("36,000"));
  assert.equal(await page.locator("#wsl-state").textContent(), "WSL connected");
  assert.equal(page.url(), beforeURL, "new progress and WSL state render without navigation");
  const old = new Date(Date.now() - 20 * 60_000).toISOString();
  state.wsl_connection = { reported_state: "connected", observed_at: old, last_seen_at: old, evidence: "original-wsl-relay" };
  await page.clock.fastForward(31000);
  await page.waitForFunction(() => document.getElementById("wsl-state").textContent === "WSL disconnected");
  assert.equal(await page.locator("#feed-state").textContent(), "Feed connected");
  version = "b".repeat(24);
  for (let i = 0; i < 4 && !page.url().includes("_display_build="); i++) {
    await page.clock.fastForward(31000);await new Promise(resolve => setTimeout(resolve, 100));
  }
  await page.waitForURL(url => url.searchParams.get("_display_build") === version);
  await page.waitForFunction(() => document.getElementById("active-steps").textContent.includes("36,000"));
  assert.equal(await page.locator('meta[name="spark-ui-build"]').getAttribute("content"), version);
  const after = (await context.cookies(base)).find(c => c.name === originalCookie.name);
  assert.equal(after.value, originalCookie.value, "automatic UI update preserves exactly the same login cookie");
  assert.equal(after.expires, originalCookie.expires, "automatic update does not renew the week");
  const fits = [];
  for (const [width, height] of [[320,568],[390,844],[768,1024],[1024,768],[1440,900],[1920,1080],[2560,1440]]) {
    await page.setViewportSize({ width, height });
    const bounds = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
      bottom: document.querySelector('main').getBoundingClientRect().bottom, right: document.querySelector('main').getBoundingClientRect().right }));
    assert.ok(bounds.width <= width + 1 && bounds.bottom <= height + 2 && bounds.right <= width + 1, JSON.stringify({ width, height, bounds }));
    fits.push({ width, height, core_fits: true });
  }
  process.stdout.write(JSON.stringify({ live_updates_verified: true, progress_changed_without_navigation: true,
    WSL_independent_states_verified: ["unconfirmed","connected","disconnected"],
    stable_new_UI_loaded_automatically: true, same_cookie_and_expiry_preserved: true,
    no_manual_reload_or_cookie_clear: true, disabled_session_storage_did_not_block_updates: true,
    viewports: fits, credentials_recorded: false, MD_action: false }) + "\n");
  await context.close();
} finally { await browser.close();server.closeAllConnections();await new Promise(resolve => server.close(resolve)); }
