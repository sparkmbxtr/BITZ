import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { routeMonitorAuth } from "../../worker/nucleosome-auth.mjs";
import { routeNucleosomeProgress } from "../../worker/nucleosome-progress.mjs";
import { INITIAL_SNAPSHOT } from "../../worker/nucleosome-snapshot.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const executablePath = process.env.CHROMIUM_PATH || ["/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync);
const state = structuredClone(INITIAL_SNAPSHOT);
state.information_updated_at = new Date().toISOString();
const fixture = "DESIGN-BROWSER-FIXTURE";
const env = { NUCLEOSOME_PASSWORD_HASH: createHash("sha256").update(fixture).digest("hex"),
  DASHBOARD_SESSION_SECRET: "only-a-design-fixture-key",
  CONTEXT_LOG: { getByName: () => ({ readNucleosomeProgress: async () => JSON.stringify(state) }) } };
let base, version = "a".repeat(24);
const server = createServer(async (incoming, outgoing) => {
  try {
    const local = new URL(incoming.url, base);
    if (local.pathname === "/api/display-version") {
      outgoing.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      outgoing.end(JSON.stringify({ version })); return;
    }
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const headers = Object.fromEntries(Object.entries(incoming.headers).filter(([, value]) => value !== undefined));
    const request = new Request(local.pathname === "/api/nucleosome-auth" ? local : new URL(incoming.url, "https://spark.bioengineering.workers.dev"),
      { method: incoming.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
    const response = local.pathname === "/api/nucleosome-auth" ? await routeMonitorAuth(request, env) : await routeNucleosomeProgress(request, env);
    if (!response) { outgoing.writeHead(404); outgoing.end(); return; }
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end((await response.text()).replaceAll("development", version));
  } catch { outgoing.writeHead(500); outgoing.end("Fixture failure; body omitted"); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
base = "http://localhost:" + server.address().port;
const browser = await chromium.launch({ executablePath, headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking"] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => Object.defineProperty(window, "sessionStorage", {
    get() { throw new DOMException("Fixture storage disabled", "SecurityError"); },
  }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.name));
  await page.clock.install({ time: new Date() });
  await page.goto(base);
  await page.locator("#password").fill(fixture);
  await Promise.all([page.waitForNavigation(), page.getByRole("button", { name: "Open monitor" }).click()]);
  const cookie = (await context.cookies(base)).find(value => value.name === "__Host-spark_nucleosome_week");
  assert.ok(cookie);
  await page.getByRole("link", { name: "Experiment Design", exact: true }).click();
  await page.waitForURL("**/experiment-design");
  await page.waitForFunction(() => document.getElementById("design-live-summary").textContent.includes("35,000"));
  assert.equal(await page.locator("h1").textContent(), "Experiment design");
  assert.equal(await page.locator('[aria-current="page"]').textContent(), "Experiment Design");
  const palette = await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, ink: getComputedStyle(document.body).color }));
  assert.deepEqual(palette, { bg: "rgb(243, 215, 128)", ink: "rgb(75, 27, 49)" });
  const url = page.url();
  const at = new Date().toISOString();
  state.jobs[4].step = 36000;state.jobs[4].checkpoint_at = at;state.information_updated_at = at;
  state.history.push({ at, step: 436000 });
  state.wsl_connection = { reported_state: "connected", observed_at: at, last_seen_at: at, evidence: "original-wsl-relay" };
  await page.clock.fastForward(31000);
  await page.waitForFunction(() => document.getElementById("design-live-summary").textContent.includes("36,000"));
  assert.match(await page.locator("#design-connection").textContent(), /WSL connected/);
  assert.equal(page.url(), url, "progress changes in the open design tab without navigation");
  version = "b".repeat(24);
  for (let i = 0; i < 4 && !page.url().includes("_display_build="); i++) {
    await page.clock.fastForward(31000);await new Promise(resolve => setTimeout(resolve, 100));
  }
  await page.waitForURL(value => value.searchParams.get("_display_build") === version);
  await page.waitForFunction(() => document.getElementById("design-live-summary").textContent.includes("36,000"));
  assert.equal(await page.locator('meta[name="spark-ui-build"]').getAttribute("content"), version);
  const after = (await context.cookies(base)).find(value => value.name === cookie.name);
  assert.equal(after.value, cookie.value);
  assert.equal(after.expires, cookie.expires);
  const viewports = [];
  for (const [width, height] of [[320,568],[390,844],[768,1024],[1024,768],[1440,900],[1920,1080],[2560,1440]]) {
    await page.setViewportSize({ width, height });
    const bounds = await page.evaluate(() => ({ pageWidth: document.documentElement.scrollWidth, width: innerWidth,
      navBottom: document.querySelector('.workspace-tabs').getBoundingClientRect().bottom }));
    assert.ok(bounds.pageWidth <= width + 1, "no page-wide horizontal overflow");
    assert.ok(bounds.navBottom < height, "both navigation tabs stay reachable");
    await page.locator("#references").scrollIntoViewIfNeeded();
    assert.ok(await page.locator("#references").isVisible());
    viewports.push({ width, height, all_definitions_reachable: true });
  }
  if (process.env.SCREENSHOT_DIR) {
    mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
    for (const [name,width,height] of [["desktop",1440,1000],["phone",390,844]]) {
      await page.setViewportSize({ width,height });await page.evaluate(() => document.getElementById("design-scroll").scrollTo({ top: 0, behavior: "instant" }));
      await page.screenshot({ path: process.env.SCREENSHOT_DIR + "/experiment-design-" + name + ".png", fullPage: true, animations: "disabled" });
    }
  }
  await page.getByRole("link", { name: "Nucleosome-C", exact: true }).click();
  await page.waitForURL("**/nucleosome");
  await page.waitForSelector("#history", { state: "attached" });
  await page.waitForSelector("#content", { state: "visible" });
  await page.getByRole("link", { name: "Experiment Design", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.waitForURL("**/experiment-design");
  assert.deepEqual(errors, []);
  process.stdout.write(JSON.stringify({ design_tab_browser_verified: true, native_login: true,
    yellow_Bordeaux_palette: palette, live_updates_without_navigation: true,
    auto_UI_replacement_preserves_cookie_and_expiry: true, blocked_sessionStorage_supported: true,
    keyboard_navigation: true, viewports, page_errors: errors, credentials_recorded: false,
    MD_action: false, watchdog_ACK: false }) + "\n");
  await context.close();
} finally {
  await browser.close();server.closeAllConnections();await new Promise(resolve => server.close(resolve));
}
