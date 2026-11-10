import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { routeMonitorAuth } from "../../worker/nucleosome-auth.mjs";
import { routeNucleosomeProgress } from "../../worker/nucleosome-progress.mjs";
import { INITIAL_SNAPSHOT } from "../../worker/nucleosome-snapshot.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const executablePath = process.env.CHROMIUM_PATH || ["/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync);
const fixture = "LAYOUT-ONLY-BROWSER-FIXTURE";
const state = structuredClone(INITIAL_SNAPSHOT);
state.information_updated_at = new Date().toISOString();
const env = { NUCLEOSOME_PASSWORD_HASH: createHash("sha256").update(fixture).digest("hex"),
  DASHBOARD_SESSION_SECRET: "only-a-layout-fixture-key",
  CONTEXT_LOG: { getByName: () => ({ readNucleosomeProgress: async () => JSON.stringify(state) }) } };
let base;
const server = createServer(async (incoming, outgoing) => {
  try {
    const local = new URL(incoming.url, base);
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const request = new Request(local.pathname === "/api/nucleosome-auth" ? local : new URL(incoming.url, "https://spark.bioengineering.workers.dev"),
      { method: incoming.method, headers: Object.fromEntries(Object.entries(incoming.headers).filter(([, v]) => v !== undefined)),
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
    const response = local.pathname === "/api/nucleosome-auth" ? await routeMonitorAuth(request, env) : await routeNucleosomeProgress(request, env);
    if (!response) { outgoing.writeHead(404); outgoing.end(); return; }
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(await response.text());
  } catch { outgoing.writeHead(500); outgoing.end("Layout fixture failure; body omitted"); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
base = "http://localhost:" + server.address().port;
const browser = await chromium.launch({ executablePath, headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking"] });
const baseline = process.env.CAPTURE_LAYOUT_BASELINE === "1";
const output = process.env.LAYOUT_QA_DIR;
if (output) mkdirSync(output, { recursive: true });

async function geometry(page) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const rect = selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return { header: rect("header"), brand: rect(".brand"), navigation: rect(".workspace-tabs"),
      tabs: [rect("#tab-nucleosome-c"), rect("#tab-experiment-design")], main: rect("main"),
      title: rect("h1"), page_width: document.documentElement.scrollWidth, viewport_width: innerWidth,
      viewport_height: innerHeight, outer_scroll_y: scrollY, viewport_scale: visualViewport.scale };
  });
}
function sameRect(a, b, label, includeWidth = true) {
  for (const key of includeWidth ? ["x", "y", "width", "height"] : ["x", "y", "height"]) {
    assert.ok(Math.abs(a[key] - b[key]) <= .5, `${label} ${key}: ${a[key]} vs ${b[key]}`);
  }
}
function sameShell(a, b, label) {
  for (const key of ["header", "brand", "navigation", "main"]) sameRect(a[key], b[key], label + " " + key);
  sameRect(a.title, b.title, label + " title", false);
  a.tabs.forEach((tab, index) => sameRect(tab, b.tabs[index], label + " tab " + index));
}
const results = [], errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.name));
  await page.goto(base);
  await page.locator("#password").fill(fixture);
  await Promise.all([page.waitForNavigation(), page.getByRole("button", { name: "Open monitor" }).click()]);
  const cookie = (await context.cookies(base)).find(c => c.name === "__Host-spark_nucleosome_week");
  for (const [width, height] of [[320,568],[390,844],[600,900],[768,1024],[1024,768],[1440,900],[1920,1080],[2560,1440],[844,390]]) {
    await page.setViewportSize({ width, height });
    await page.goto(base + "/nucleosome");
    await page.waitForSelector("#content", { state: "visible" });
    const monitor = await geometry(page);
    if (output && [390,1440].includes(width)) await page.screenshot({ path: output + `/monitor-${width}.png`, animations: "disabled" });
    await page.getByRole("link", { name: "Experiment Design", exact: true }).click();
    await page.waitForURL("**/experiment-design");
    await page.waitForFunction(() => document.getElementById("design-live-summary").textContent.includes("saved steps"));
    const design = await geometry(page);
    if (output && [390,1440].includes(width)) await page.screenshot({ path: output + `/design-${width}.png`, animations: "disabled" });
    await page.locator("#references").scrollIntoViewIfNeeded();
    const designScrolled = await geometry(page);
    await page.getByRole("link", { name: "Nucleosome-C", exact: true }).click();
    await page.waitForURL("**/nucleosome");
    await page.waitForSelector("#content", { state: "visible" });
    const returned = await geometry(page);
    if (!baseline) {
      sameShell(monitor, design, `${width}×${height} switch`);
      sameShell(monitor, designScrolled, `${width}×${height} document scroll`);
      sameShell(monitor, returned, `${width}×${height} return`);
      assert.equal(designScrolled.outer_scroll_y, 0, "the document scrolls inside the fixed workspace");
      for (const bounds of [monitor, design, returned]) {
        assert.ok(bounds.page_width <= width + 1, "no page-wide horizontal overflow");
        assert.equal(bounds.viewport_scale, 1, "switching tabs does not zoom the viewport");
      }
      const content = await page.locator("#content").boundingBox();
      assert.ok(content.y + content.height <= height + 1, "the overview remains inside the workspace");
    }
    results.push({ width, height, monitor, design, design_scrolled: designScrolled, returned });
  }
  const after = (await context.cookies(base)).find(c => c.name === cookie.name);
  assert.equal(after.value, cookie.value);
  assert.equal(after.expires, cookie.expires);
  assert.deepEqual(errors, []);
  const result = { capture_before_change: baseline, shared_layout_verified: !baseline, viewports: results,
    cookie_and_expiry_preserved: true, page_errors: errors, synthetic_fixture: true, credentials_recorded: false,
    MD_action: false, watchdog_ACK: false };
  if (output) writeFileSync(output + "/layout-geometry.json", JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ ...result, viewports: results.map(({width,height}) => ({width,height})) }));
  await context.close();
} finally {
  await browser.close();server.closeAllConnections();await new Promise(resolve => server.close(resolve));
}
