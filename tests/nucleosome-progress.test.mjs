import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import vm from "node:vm";
import { DASHBOARD_HTML } from "../worker/nucleosome-page.mjs";
import { INITIAL_SNAPSHOT } from "../worker/nucleosome-snapshot.mjs";
import { allowedProgressClaims, progressWriterAuthorized } from "../worker/nucleosome-oidc.mjs";
import { publicSnapshot, routeNucleosomeProgress, validateSnapshot } from "../worker/nucleosome-progress.mjs";

globalThis.crypto ??= webcrypto;
const clone = value => structuredClone(value);
const origin = "https://spark.bioengineering.workers.dev";

test("saved checkpoints total 72.5%, with four completions and one queued run", () => {
  const snapshot = publicSnapshot(validateSnapshot(INITIAL_SNAPSHOT), "initial_snapshot");
  assert.equal(snapshot.total_steps, 435000);
  assert.equal(snapshot.percent, 72.5);
  assert.equal(snapshot.completed_runs, 4);
  assert.equal(snapshot.current_job, "601-C");
  assert.equal(snapshot.jobs.find(job => job.id === "control-C").status, "queued");
  assert.equal(snapshot.stages.find(stage => stage.id === "baseline").state, "in_progress");
  assert.equal(snapshot.source_revision, undefined);
});

test("stale checkpoint evidence stays visible independently of a fresh feed update", () => {
  const value = clone(INITIAL_SNAPSHOT);
  value.information_updated_at = new Date().toISOString();
  const snapshot = publicSnapshot(value, "automatic");
  assert.equal(snapshot.runtime_confirmed, false);
  assert.equal(snapshot.checkpoint_stale, true);
  assert.equal(snapshot.feed_stale, false);
});

test("runtime confirmation and time estimates require measured progression and expire independently of Git publication", () => {
  const value = clone(INITIAL_SNAPSHOT);
  const now = Date.now();
  value.information_updated_at = new Date(now).toISOString();
  value.runtime_observation = { at: value.information_updated_at, job: "601-C", observed_step: 35020, identity_verified: true, advancing: true, guards_pass: true };
  value.compute_rate = { from: new Date(now - 100000).toISOString(), to: value.information_updated_at, steps: 50,
    steps_per_second: 0.5, cpu_model: "TEST CPU", threads: 4, logical_cpus: 5, cpu_quota: 4, memory_gib: 16 };
  let snapshot = validateSnapshot(value);
  assert.equal(publicSnapshot(snapshot, "automatic", now).runtime_confirmed, true);
  assert.equal(publicSnapshot(snapshot, "automatic", now + 360001).runtime_confirmed, false);
  value.compute_rate.steps_per_second = 2;
  assert.throws(() => validateSnapshot(value), /rate evidence/);
  value.compute_rate.steps_per_second = 0.5;
  value.runtime_observation.observed_step = 34999;
  assert.throws(() => validateSnapshot(value), /Runtime observation/);
});

test("invalid caps, duplicates, failed guards and conflicting history are rejected", () => {
  const mutations = [
    value => { value.jobs[4].step = 100001; },
    value => { value.jobs[4].step = -1; },
    value => { value.jobs[4].status = "completed"; },
    value => { value.jobs[4].guards_pass = false; },
    value => { value.jobs[5].id = "601-C"; },
    value => { value.history.at(-1).step = 600000; },
    value => { value.history[1].step = -10; },
    value => { value.information_updated_at = new Date(Date.now() + 3600000).toISOString(); },
  ];
  for (const mutate of mutations) { const value = clone(INITIAL_SNAPSHOT); mutate(value); assert.throws(() => validateSnapshot(value)); }
});

test("the public schema drops unknown source fields", () => {
  const value = clone(INITIAL_SNAPSHOT);
  value.private_path = "/private/scientific/files";
  value.jobs[0].seed = "private-seed";
  const result = JSON.stringify(publicSnapshot(validateSnapshot(value), "automatic"));
  assert.ok(!result.includes("private"));
  assert.ok(!result.includes(value.source_revision));
});

test("existing airQ and neutral display requests pass through unchanged", async () => {
  assert.equal(await routeNucleosomeProgress(new Request(origin + "/api/airq"), {}), null);
  assert.equal(await routeNucleosomeProgress(new Request(origin + "/api/report"), {}), null);
  assert.equal(await routeNucleosomeProgress(new Request("https://bitz.bioengineering.workers.dev/"), {}), null);
});

test("the root page, snapshot fallback and HEAD work without storage", async () => {
  const page = await routeNucleosomeProgress(new Request(origin), {});
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes("SPARK BMC-LMU"));
  assert.match(page.headers.get("Cache-Control"), /no-store/);
  const head = await routeNucleosomeProgress(new Request(origin, { method: "HEAD" }), {});
  assert.equal(await head.text(), "");
  assert.match(await (await routeNucleosomeProgress(new Request(origin), {})).text(), /type="password"/);
  assert.equal((await routeNucleosomeProgress(new Request(origin + "/api/nucleosome-progress"), {})).status, 401);
  const result = await (await routeNucleosomeProgress(new Request(origin + "/api/nucleosome-progress"), {}, async () => true)).json();
  assert.equal(result.feed_mode, "initial_snapshot");
  assert.equal(result.total_steps, 435000);
});

test("only an authenticated writer can persist a validated snapshot", async () => {
  let stored = null;
  const env = { CONTEXT_LOG: { getByName(name) {
    assert.equal(name, "nucleosome-progress");
    return { async writeNucleosomeProgress(raw) { stored = raw; }, async readNucleosomeProgress() { return stored; } };
  } } };
  const makeRequest = () => new Request(origin + "/api/nucleosome-progress", { method: "PUT",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(INITIAL_SNAPSHOT) });
  assert.equal((await routeNucleosomeProgress(makeRequest(), env, async () => false)).status, 401);
  assert.equal(stored, null);
  const response = await routeNucleosomeProgress(makeRequest(), env, async () => true);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).published, true);
  const readback = await (await routeNucleosomeProgress(new Request(origin + "/api/nucleosome-progress"), env, async () => true)).json();
  assert.equal(readback.feed_mode, "automatic");
  assert.equal(readback.information_updated_at, INITIAL_SNAPSHOT.information_updated_at);
  assert.equal(readback.total_steps, 435000);
});

test("storage errors retain the seed; out-of-order publications fail readback", async () => {
  const badEnv = { CONTEXT_LOG: { getByName() { return { async readNucleosomeProgress() { throw new Error("unavailable"); } }; } } };
  const fallback = await (await routeNucleosomeProgress(new Request(origin + "/api/nucleosome-progress"), badEnv, async () => true)).json();
  assert.equal(fallback.feed_mode, "initial_snapshot");
  const env = { CONTEXT_LOG: { getByName() { return { async writeNucleosomeProgress() {}, async readNucleosomeProgress() { return "newer"; } }; } } };
  const response = await routeNucleosomeProgress(new Request(origin + "/api/nucleosome-progress", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(INITIAL_SNAPSHOT) }), env, async () => true);
  assert.equal(response.status, 409);
});

function claims() {
  const now = Math.floor(Date.now() / 1000);
  return { iss: "https://token.actions.githubusercontent.com", aud: "nucleosome-progress", repository: "sparkmbxtr/nucleosome",
    repository_id: "1439578026", repository_owner_id: "324419950", repository_visibility: "private",
    ref: "refs/heads/codex/nucleosome-c-sync", runner_environment: "github-hosted", event_name: "push",
    workflow_ref: "sparkmbxtr/nucleosome/.github/workflows/publish-nucleosome-progress.yml@refs/heads/codex/nucleosome-c-sync",
    iat: now - 5, nbf: now - 5, exp: now + 295 };
}

test("publisher identity is pinned to the private journal, branch and workflow", () => {
  assert.equal(allowedProgressClaims(claims()), true);
  for (const key of ["iss", "aud", "repository", "repository_id", "repository_owner_id", "repository_visibility", "ref", "workflow_ref", "runner_environment", "event_name"]) {
    assert.equal(allowedProgressClaims({ ...claims(), [key]: "untrusted" }), false, key);
  }
  assert.equal(allowedProgressClaims({ ...claims(), exp: 1 }), false);
  assert.equal(allowedProgressClaims({ ...claims(), nbf: "invalid" }), false);
});

test("OIDC checks the actual RSA signature and rejects a tampered token", async () => {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const key = await crypto.subtle.exportKey("jwk", pair.publicKey);
  key.kid = "progress-test-key"; key.use = "sig";
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const prefix = encode({ alg: "RS256", kid: key.kid }) + "." + encode(claims());
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(prefix));
  const token = prefix + "." + Buffer.from(signature).toString("base64url");
  const fetcher = async url => { assert.equal(url, "https://token.actions.githubusercontent.com/.well-known/jwks"); return Response.json({ keys: [key] }); };
  assert.equal(await progressWriterAuthorized(new Request(origin, { headers: { Authorization: "Bearer " + token } }), fetcher), true);
  const changed = prefix + "." + Buffer.alloc(256).toString("base64url");
  assert.equal(await progressWriterAuthorized(new Request(origin, { headers: { Authorization: "Bearer " + changed } }), fetcher), false);
});

class Element {
  constructor(tag = "div") { this.tagName = tag; this.children = []; this.attributes = {}; this.textContent = ""; this.style = {}; this.events = {}; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, fn) { this.events[key] = fn; }
}

test("the terminal UI renders six runs and the exact Berlin update header", async () => {
  const elements = new Map();
  const document = { hidden: false, getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
    createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag), createTextNode: text => ({ textContent: text }), addEventListener() {} };
  const snapshot = publicSnapshot(INITIAL_SNAPSHOT, "automatic");
  snapshot.information_updated_at = "2026-11-06T15:30:00+00:00";
  const script = DASHBOARD_HTML.match(/<script>([\s\S]*)<\/script>/)[1];
  const intervals = [];
  vm.runInNewContext(script, { document, window: { addEventListener() {} }, Intl, Date, AbortSignal,
    setInterval(fn, delay) { intervals.push({ fn, delay }); }, fetch: async () => Response.json(snapshot) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.get("updated").textContent, "1106261630");
  assert.equal(elements.get("overall").textContent, "72.5%");
  assert.equal(elements.get("finished").textContent, "4 / 6");
  assert.equal(elements.get("runs").children.length, 6);
  assert.equal(elements.get("stages").children.length, 6);
  assert.equal(elements.get("active-name").textContent, "601 C");
  assert.equal(elements.get("runtime").textContent, "Unconfirmed");
  assert.ok(intervals.some(interval => interval.delay === 30000));
  const before = elements.get("updated").textContent;
  await elements.get("refresh").events.click();
  assert.equal(elements.get("updated").textContent, before);
  assert.match(DASHBOARD_HTML, /ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas/);
});
