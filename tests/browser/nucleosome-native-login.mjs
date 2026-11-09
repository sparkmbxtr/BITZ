import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { routeMonitorAuth } from "../../worker/nucleosome-auth.mjs";
import { routeNucleosomeProgress } from "../../worker/nucleosome-progress.mjs";

// Installed browser, pinned external Playwright Core, and non-secret fixtures.
// This never touches production credentials, profiles, molecular Systems or MD.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const executablePath = process.env.CHROMIUM_PATH || ["/usr/bin/chromium", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"].find(existsSync);
assert.ok(executablePath, "An installed Chromium executable is required");
const fixture = "BROWSER-LOGIN-FIXTURE";
const env = { NUCLEOSOME_PASSWORD_HASH: createHash("sha256").update(fixture).digest("hex"),
  DASHBOARD_SESSION_SECRET: "local-browser-fixture-key-not-production" };
const submissions = [];
let base;
const server = createServer(async (incoming, outgoing) => {
  try {
    const headers = Object.fromEntries(Object.entries(incoming.headers).filter(([, value]) => value !== undefined));
    let raw;
    if (incoming.method === "POST") {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      raw = Buffer.concat(chunks);
      submissions.push({ origin: incoming.headers.origin ?? null, fetch_site: incoming.headers["sec-fetch-site"] ?? null });
    }
    const local = new URL(incoming.url, base);
    const request = new Request(local.pathname === "/api/nucleosome-auth" ? local : new URL(incoming.url, "https://spark.bioengineering.workers.dev"),
      { method: incoming.method, headers, ...(raw ? { body: raw } : {}) });
    const response = local.pathname === "/api/nucleosome-auth" ? await routeMonitorAuth(request, env)
      : await routeNucleosomeProgress(request, env);
    if (!response) { outgoing.writeHead(404); outgoing.end(); return; }
    const outputHeaders = Object.fromEntries(response.headers);
    let body = await response.text();
    if (local.searchParams.has("legacy")) {
      outputHeaders["referrer-policy"] = "no-referrer";
      body = body.replace('<meta name="referrer" content="same-origin">', "");
    }
    outgoing.writeHead(response.status, outputHeaders);
    outgoing.end(body);
  } catch {
    outgoing.writeHead(500); outgoing.end("Fixture failed; request body omitted");
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
base = "http://localhost:" + server.address().port;
const browser = await chromium.launch({ executablePath, headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking"], timeout: 20000 });
const cases = [];
try {
  for (const [name, password, viewport] of [["lowercase-phone", fixture.toLowerCase(), { width: 390, height: 844 }],
    ["uppercase-desktop", fixture, { width: 1440, height: 900 }]]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const response = await page.goto(base, { waitUntil: "domcontentloaded" });
    assert.equal(response.headers()["referrer-policy"], "same-origin");
    await page.locator("#password").fill(password);
    await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.getByRole("button", { name: "Open monitor" }).click()]);
    assert.equal(await page.locator("#history").count(), 1);
    const cookie = (await context.cookies(base)).find(value => value.name === "__Host-spark_nucleosome_week");
    assert.ok(cookie && cookie.secure && cookie.httpOnly && cookie.sameSite === "Lax");
    assert.ok(Math.abs(cookie.expires - Date.now() / 1000 - 604800) < 15);
    await page.reload({ waitUntil: "domcontentloaded" });
    assert.equal(await page.locator("#history").count(), 1);
    const api = await page.evaluate(async () => (await fetch("/api/nucleosome-progress?at=" + Date.now())).status);
    assert.equal(api, 200);
    assert.equal(submissions.at(-1).origin, base);
    cases.push({ name, browser_generated_origin_matches: true, protected_page: true,
      protected_API_HTTP: api, reload_keeps_session: true, cookie_days: 7, secure_httpOnly_sameSite: true });
    await context.close();
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(base + "/?legacy=1", { waitUntil: "domcontentloaded" });
  await page.locator("#password").fill(fixture);
  await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.getByRole("button", { name: "Open monitor" }).click()]);
  assert.equal(submissions.at(-1).origin, "null");
  assert.equal(new URL(page.url()).searchParams.get("login"), "refresh");
  assert.match(await page.locator("[role=alert]").textContent(), /login page has been refreshed/);
  assert.equal((await context.cookies(base)).length, 0);
  cases.push({ name: "old-no-referrer-page", browser_generated_origin: "null", session_granted: false,
    safely_refreshed_to_corrected_login: true, raw_JSON_error_shown: false });
  await context.close();
  process.stdout.write(JSON.stringify({ actual_Chromium_native_form_regression: true, cases, credentials_recorded: false,
    MD_action: false, watchdog_ACK: false }) + "\n");
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
