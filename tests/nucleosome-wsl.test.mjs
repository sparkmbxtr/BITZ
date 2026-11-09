import assert from "node:assert/strict";
import test from "node:test";
import { INITIAL_SNAPSHOT } from "../worker/nucleosome-snapshot.mjs";
import { publicSnapshot, validateSnapshot } from "../worker/nucleosome-progress.mjs";
import { validateWslConnection, wslConnectionStatus } from "../worker/nucleosome-wsl.mjs";

test("WSL presence expires independently of a fresh feed and missing evidence stays unconfirmed", () => {
  const now = Date.now();
  const at = new Date(now).toISOString();
  const value = structuredClone(INITIAL_SNAPSHOT);
  value.information_updated_at = at;
  assert.equal(publicSnapshot(validateSnapshot(value), "automatic", now).wsl_status, "unconfirmed");
  value.wsl_connection = { reported_state: "connected", observed_at: at, last_seen_at: at, evidence: "original-wsl-relay" };
  const validated = validateSnapshot(value);
  assert.equal(publicSnapshot(validated, "automatic", now).wsl_status, "connected");
  validated.information_updated_at = new Date(now + 16 * 60_000).toISOString();
  const stale = publicSnapshot(validated, "automatic", now + 16 * 60_000);
  assert.equal(stale.feed_stale, false);
  assert.equal(stale.wsl_status, "disconnected");
  assert.equal(stale.wsl_connection.observed_at, at, "new website publication never renews WSL presence");
  assert.equal(wslConnectionStatus({ ...value.wsl_connection, reported_state: "disconnected" }, now), "disconnected");
});

test("WSL evidence rejects future/inconsistent times and removes private identifiers", () => {
  const now = Date.now(), at = new Date(now).toISOString();
  const value = { reported_state: "connected", observed_at: at, last_seen_at: at, evidence: "original-wsl-relay", hostname: "private-host", thread: "private-thread" };
  assert.ok(!JSON.stringify(validateWslConnection(value, now)).includes("private"));
  assert.throws(() => validateWslConnection({ ...value, observed_at: new Date(now + 120000).toISOString() }, now));
  assert.throws(() => validateWslConnection({ ...value, last_seen_at: null }, now));
  assert.throws(() => validateWslConnection({ ...value, evidence: "cloud-feed" }, now));
});
