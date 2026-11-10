import assert from "node:assert/strict";
import test from "node:test";
import { createHash, pbkdf2Sync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { MonitorPasswordStorage } from "../worker/monitor-password-storage.mjs";
import { allowedExtraAccessClaims, EXTRA_ACCESS_ENROLLMENT, routeExtraMonitorAccess } from "../worker/monitor-extra-password.mjs";
import { monitorSession, routeMonitorAuth } from "../worker/nucleosome-auth.mjs";

const origin = "https://spark.bioengineering.workers.dev";
const original = "ORIGINAL-TEST-ACCESS", extra = "SUPPLEMENTAL-TEST-ACCESS";
const salt = "ecb2d141f8f416be0f35f37b2f05c68d";
const record = { version: 1, enrollment: EXTRA_ACCESS_ENROLLMENT, algorithm: "PBKDF2-SHA256", iterations: 100000,
  salt, hash: pbkdf2Sync(extra, Buffer.from(salt, "hex"), 100000, 32, "sha256").toString("hex") };
const sha = value => createHash("sha256").update(value).digest("hex");
function fixture() {
  const db = new DatabaseSync(":memory:");
  const storage = new MonitorPasswordStorage({ exec(query, ...args) {
    const stmt = db.prepare(query);
    if (query.startsWith("SELECT")) return { toArray: () => stmt.all(...args) };
    stmt.run(...args); return { toArray: () => [] };
  } });
  const env = { NUCLEOSOME_PASSWORD_HASH: sha(original), DASHBOARD_SESSION_SECRET: "unchanged-fixture-session-key",
    CONTEXT_LOG: { getByName: name => { assert.equal(name, "nucleosome-progress"); return {
      readExtraMonitorAccess: async id => storage.read(id), putExtraMonitorAccess: async (id, raw) => storage.put(id, raw),
    }; } } };
  const login = (password, form = false) => routeMonitorAuth(new Request(origin + "/api/nucleosome-auth", { method: "POST",
    headers: { Origin: origin, "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json" },
    body: form ? new URLSearchParams({ password }) : JSON.stringify({ password }) }), env);
  const enroll = (value = record, authorized = true) => routeExtraMonitorAccess(new Request(origin + "/api/nucleosome-extra-access",
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }), env, async () => authorized);
  return { db, storage, env, login, enroll };
}

test("additional private enrollment preserves original login and an existing cookie", async () => {
  const s = fixture(); try {
    const before = await s.login(original), cookie = before.headers.get("set-cookie");
    assert.equal(before.status, 200);
    assert.equal((await s.login(extra)).status, 401);
    assert.deepEqual(await (await s.enroll()).json(), { enrolled: true, readback_verified: true, existing_access_preserved: true });
    for (const value of [original, original.toLowerCase(), extra, extra.toLowerCase()]) {
      const json = await s.login(value), form = await s.login(value, true);
      assert.equal(json.status, 200); assert.equal(form.status, 303); assert.equal(form.headers.get("location"), "/");
      assert.match(json.headers.get("set-cookie"), /Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800/);
    }
    assert.equal(await monitorSession.authorized(new Request(origin, { headers: { Cookie: cookie.split(";", 1)[0] } }), s.env.DASHBOARD_SESSION_SECRET), true);
    assert.equal(s.env.NUCLEOSOME_PASSWORD_HASH, sha(original));
    assert.equal((await s.login("wrong")).status, 401);
    const readiness = JSON.stringify(await (await routeMonitorAuth(new Request(origin + "/api/nucleosome-auth"), s.env)).json());
    assert.ok(!readiness.includes(record.hash) && !readiness.includes(record.salt) && !readiness.includes(extra));
  } finally { s.db.close(); }
});

test("only the separate authorized enrollment can write; immutable replay cannot replace access", async () => {
  const s = fixture(); try {
    assert.equal((await s.enroll(record, false)).status, 401);
    assert.equal(s.storage.read(EXTRA_ACCESS_ENROLLMENT), null);
    assert.equal((await s.enroll()).status, 200); assert.equal((await s.enroll()).status, 200);
    const prior = s.storage.read(EXTRA_ACCESS_ENROLLMENT);
    assert.equal((await s.enroll({ ...record, hash: "0".repeat(64) })).status, 409);
    assert.equal(s.storage.read(EXTRA_ACCESS_ENROLLMENT), prior);
    assert.equal((await routeExtraMonitorAccess(new Request(origin + "/api/nucleosome-extra-access"), s.env)).status, 405);
    assert.equal(await routeExtraMonitorAccess(new Request("https://bitz.bioengineering.workers.dev/api/nucleosome-extra-access"), s.env), null);
  } finally { s.db.close(); }
});

test("malformed or oversized enrollment fails closed without changing stored access", async () => {
  const s = fixture(); try {
    for (const value of [{ ...record, enrollment: "another" }, { ...record, hash: "x" }, { ...record, salt: 1 },
      { ...record, iterations: 1 }, { ...record, password: "not-accepted" }]) assert.equal((await s.enroll(value)).status, 400);
    assert.equal((await s.enroll({ ...record, extra: "x".repeat(1500) })).status, 413);
    assert.equal(s.storage.read(EXTRA_ACCESS_ENROLLMENT), null);
  } finally { s.db.close(); }
});

test("supplemental storage failure never disables original login or grants unknown passwords", async () => {
  const s = fixture(); try {
    s.env.CONTEXT_LOG = { getByName() { throw new Error("fixture unavailable"); } };
    assert.equal((await s.login(original)).status, 200);
    assert.equal((await s.login(extra)).status, 401);
    delete s.env.DASHBOARD_SESSION_SECRET;
    assert.equal((await s.login(original)).status, 503);
  } finally { s.db.close(); }
});

test("OIDC identity is restricted to the private repository, branch, audience and own-file push workflow", () => {
  const now = 1800000000;
  const claims = { iss: "https://token.actions.githubusercontent.com", aud: "nucleosome-extra-access-20261110",
    repository: "sparkmbxtr/nucleosome", repository_id: "1439578026", repository_owner_id: "324419950",
    repository_visibility: "private", ref: "refs/heads/codex/nucleosome-c-sync", runner_environment: "github-hosted",
    workflow_ref: "sparkmbxtr/nucleosome/.github/workflows/enroll-extra-monitor-login-20261110.yml@refs/heads/codex/nucleosome-c-sync",
    event_name: "push", iat: now - 10, exp: now + 300 };
  assert.equal(allowedExtraAccessClaims(claims, now), true);
  for (const change of [{ aud: "nucleosome-progress" }, { event_name: "workflow_dispatch" }, { repository_visibility: "public" },
    { ref: "refs/heads/main" }, { repository_id: "0" }, { workflow_ref: claims.workflow_ref.replace("enroll-extra-monitor-login-20261110", "publish-historical-pilots-20261110") },
    { exp: now - 1 }, { iat: now - 1000 }]) assert.equal(allowedExtraAccessClaims({ ...claims, ...change }, now), false);
});
