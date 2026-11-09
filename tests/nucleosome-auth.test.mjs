import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { sessionGrant } from "../lib/dashboard-auth.ts";
import { monitorPasswordCasePolicy, monitorSession } from "../worker/nucleosome-auth.mjs";
import { routeNucleosomeProgress } from "../worker/nucleosome-progress.mjs";

const origin = "https://spark.bioengineering.workers.dev";
const env = { DASHBOARD_PASSWORD_HASH: createHash("sha256").update("EXAMPLE-TEST-PASSWORD").digest("hex"), DASHBOARD_SESSION_SECRET: "only-a-test-secret-never-used-for-production" };
const request = (path, options) => new Request(origin + path, options);
const post = (password, extras = {}) => request("/api/nucleosome-auth", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...extras }, body: JSON.stringify({ password }) });

test("password grants a seven-day device cookie; anonymous page and JSON stay protected", async () => {
  const page = await routeNucleosomeProgress(request("/"), env);
  const html = await page.text();
  assert.match(html, /type="password"/);
  assert.doesNotMatch(html, /id="history"/);
  assert.equal((await routeNucleosomeProgress(request("/api/nucleosome-progress"), env)).status, 401);
  assert.equal((await routeNucleosomeProgress(post("wrong"), env)).status, 401);
  const login = await routeNucleosomeProgress(post("EXAMPLE-TEST-PASSWORD"), env);
  assert.equal(login.status, 200);
  assert.equal((await login.json()).session_days, 7);
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /^__Host-spark_nucleosome_week=/);
  for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Max-Age=604800", "Path=/"]) assert.ok(cookie.includes(flag));
  const browser = { headers: { Cookie: cookie.split(";", 1)[0] } };
  const dashboard = await routeNucleosomeProgress(request("/", browser), env);
  assert.match(await dashboard.text(), /id="history"/);
  assert.equal(dashboard.headers.get("set-cookie"), null, "reading never extends the week");
  const api = await routeNucleosomeProgress(request("/api/nucleosome-progress", browser), env);
  assert.equal((await api.json()).jobs.length, 6);
  assert.equal(api.headers.get("set-cookie"), null);
  assert.equal((await routeNucleosomeProgress(request("/api/nucleosome-progress", { ...browser, method: "PUT", body: "{}" }), env)).status, 401, "a reader cannot publish");
});

test("cookies survive six days, expire at seven, reject tampering and exclude longer wallboard sessions", async () => {
  const realNow = Date.now;
  const now = realNow();
  try {
    Date.now = () => now;
    const cookie = (await monitorSession.grant(env.DASHBOARD_SESSION_SECRET)).split(";", 1)[0];
    const browser = request("/", { headers: { Cookie: cookie } });
    Date.now = () => now + 6 * 86400000;
    assert.equal(await monitorSession.authorized(browser, env.DASHBOARD_SESSION_SECRET), true);
    Date.now = () => now + 7 * 86400000;
    assert.equal(await monitorSession.authorized(browser, env.DASHBOARD_SESSION_SECRET), false);
    Date.now = () => now;
    assert.equal(await monitorSession.authorized(request("/", { headers: { Cookie: cookie + "x" } }), env.DASHBOARD_SESSION_SECRET), false);
    const old = await sessionGrant(env.DASHBOARD_SESSION_SECRET);
    assert.match(old.cookie, /Max-Age=7776000/, "existing signage retains its own expiry");
    assert.equal(await monitorSession.authorized(request("/", { headers: { Cookie: "__Host-spark_nucleosome_week=" + old.token } }), env.DASHBOARD_SESSION_SECRET), false);
    assert.equal(await monitorSession.authorized(request("/", { headers: { Cookie: old.cookie } }), env.DASHBOARD_SESSION_SECRET), false);
  } finally { Date.now = realNow; }
});

test("native forms redirect once, same-origin checks protect changes, missing secrets fail closed", async () => {
  assert.equal((await routeNucleosomeProgress(post("EXAMPLE-TEST-PASSWORD", { Origin: "https://other.example" }), env)).status, 403);
  const login = await routeNucleosomeProgress(request("/api/nucleosome-auth", { method: "POST", headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" }, body: "password=EXAMPLE-TEST-PASSWORD" }), env);
  assert.equal(login.status, 303);
  assert.equal(login.headers.get("location"), "/");
  const locked = await routeNucleosomeProgress(request("/api/nucleosome-auth", { method: "DELETE", headers: { Origin: origin } }), env);
  assert.match(locked.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await routeNucleosomeProgress(post("EXAMPLE-TEST-PASSWORD"), {})).status, 503);
  const access = await (await routeNucleosomeProgress(request("/api/nucleosome-auth"), env)).json();
  assert.deepEqual(access, { configured: true, authorized: false, session_days: 7, password_verifier_ready: true, session_signing_ready: true,
    password_case_policy: monitorPasswordCasePolicy, password_verifier_scope: "dashboard_legacy" });
});

test("both keyboard cases log in with either a lowercase or uppercase saved verifier", async () => {
  const upper = "AUDIT-ACCESS-EXAMPLE";
  const lower = upper.toLowerCase();
  for (const saved of [lower, upper]) {
    const configured = { ...env, DASHBOARD_PASSWORD_HASH: createHash("sha256").update(saved).digest("hex") };
    for (const supplied of [lower, upper]) {
      const login = await routeNucleosomeProgress(post(supplied), configured);
      assert.equal(login.status, 200);
      const cookie = login.headers.get("set-cookie");
      assert.match(cookie, /Max-Age=604800/);
      const reader = request("/api/nucleosome-progress", { headers: { Cookie: cookie.split(";", 1)[0] } });
      assert.equal((await routeNucleosomeProgress(reader, configured)).status, 200);
      const form = await routeNucleosomeProgress(request("/api/nucleosome-auth", { method: "POST",
        headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ password: supplied }).toString() }), configured);
      assert.equal(form.status, 303);
      assert.equal(form.headers.get("location"), "/");
      assert.match(form.headers.get("set-cookie"), /HttpOnly/);
    }
    for (const rejected of ["wrong-password", "", null, 123, "x".repeat(257)]) {
      assert.equal((await routeNucleosomeProgress(post(rejected), configured)).status, 401);
    }
  }
});

test("the monitor-specific verifier overrides a different legacy dashboard verifier", async () => {
  const fixture = "MONITOR-ONLY-EXAMPLE";
  const dedicated = { ...env, NUCLEOSOME_PASSWORD_HASH: createHash("sha256").update(fixture).digest("hex") };
  for (const value of [fixture, fixture.toLowerCase()]) assert.equal((await routeNucleosomeProgress(post(value), dedicated)).status, 200);
  assert.equal((await routeNucleosomeProgress(post("EXAMPLE-TEST-PASSWORD"), dedicated)).status, 401);
  const status = await (await routeNucleosomeProgress(request("/api/nucleosome-auth"), dedicated)).json();
  assert.equal(status.password_verifier_scope, "monitor");
  assert.equal(env.DASHBOARD_PASSWORD_HASH, dedicated.DASHBOARD_PASSWORD_HASH);
});

test("the weekly monitor reuses an existing signing key without imposing a new length policy", async () => {
  const existing = { ...env, DASHBOARD_SESSION_SECRET: "test-legacy-key" };
  const login = await routeNucleosomeProgress(post("EXAMPLE-TEST-PASSWORD"), existing);
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /Max-Age=604800/);
  const reader = request("/api/nucleosome-progress", { headers: { Cookie: cookie.split(";", 1)[0] } });
  assert.equal((await routeNucleosomeProgress(reader, existing)).status, 200);
  assert.equal((await routeNucleosomeProgress(reader, { ...existing, DASHBOARD_SESSION_SECRET: "different-test-key" })).status, 401);
  for (const missing of ["", undefined, null]) {
    const invalid = { ...existing, DASHBOARD_SESSION_SECRET: missing };
    assert.equal((await routeNucleosomeProgress(post("EXAMPLE-TEST-PASSWORD"), invalid)).status, 503);
    const status = await (await routeNucleosomeProgress(request("/api/nucleosome-auth"), invalid)).json();
    assert.equal(status.session_signing_ready, false);
    assert.equal(status.configured, false);
    assert.ok(!JSON.stringify(status).includes(existing.DASHBOARD_SESSION_SECRET));
  }
});
