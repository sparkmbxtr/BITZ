import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dashboardBuildVersion } from "../build/dashboard-version.mjs";
import { loadTypeScriptModule } from "./helpers/typescript-module.mjs";

const oldVersion = "a".repeat(24);
const nextVersion = "b".repeat(24);
const laterVersion = "c".repeat(24);
const { createDisplayUpdateMonitor } = loadTypeScriptModule(new URL("../lib/display-updates.ts", import.meta.url));

function harness() {
  const state = { now: 1_000_000, version: oldVersion, busy: false, persisted: true, error: false, attempt: null, reloads: [] };
  const options = {
    currentVersion: oldVersion,
    now: () => state.now,
    loadVersion: async () => { if (state.error) throw Error("offline"); return state.version; },
    canReload: () => !state.busy,
    prepareReload: async () => state.persisted,
    reload: (version) => state.reloads.push(version),
    readAttempt: () => state.attempt,
    writeAttempt: (attempt) => { state.attempt = attempt; },
  };
  return { state, options, monitor: createDisplayUpdateMonitor(options) };
}

test("loaded build is the baseline; a stable new build updates automatically once", async () => {
  const { state, monitor } = harness();
  state.version = nextVersion; // Already newer on the very first check.
  await monitor.check();
  assert.equal(state.reloads.length, 0);
  state.now += 30_000;
  await monitor.check();
  assert.deepEqual(state.reloads, [nextVersion]);
  await monitor.check();
  assert.equal(state.reloads.length, 1);
});

test("unchanged builds, malformed responses and outages do not navigate", async () => {
  const { state, monitor } = harness();
  for (const version of [oldVersion, null, "https://untrusted.example/update", "development"]) {
    state.version = version;
    await monitor.check();
    state.now += 30_000;
    await monitor.check();
  }
  state.error = true;
  await monitor.check();
  assert.equal(state.reloads.length, 0);
  assert.equal(state.attempt, null);
});

test("deployment changes and network failures require a new stable confirmation", async () => {
  const { state, monitor } = harness();
  state.version = nextVersion;
  await monitor.check();
  state.now += 30_000;
  state.version = laterVersion;
  await monitor.check();
  assert.equal(state.reloads.length, 0);
  state.error = true;
  await monitor.check();
  state.error = false;
  state.now += 30_000;
  await monitor.check();
  assert.equal(state.reloads.length, 0);
  state.now += 30_000;
  await monitor.check();
  assert.deepEqual(state.reloads, [laterVersion]);
});

test("rapid focus events cannot bypass the confirmation interval", async () => {
  const { state, monitor } = harness();
  state.version = nextVersion;
  await monitor.check();
  state.now += 100;
  await monitor.check();
  assert.equal(state.reloads.length, 0);
});

test("an open note or report defers the update until entry is finished", async () => {
  const { state, monitor } = harness();
  state.version = nextVersion;
  state.busy = true;
  await monitor.check();
  state.now += 30_000;
  await monitor.check();
  assert.equal(state.reloads.length, 0);
  state.busy = false;
  await monitor.check();
  assert.deepEqual(state.reloads, [nextVersion]);
});

test("login must survive navigation and new input during preparation still defers", async () => {
  const { state, options } = harness();
  let startTyping = false;
  options.prepareReload = async () => { if (startTyping) state.busy = true; return state.persisted; };
  const monitor = createDisplayUpdateMonitor(options);
  state.version = nextVersion;
  state.persisted = false;
  await monitor.check();
  state.now += 30_000;
  await monitor.check();
  assert.equal(state.reloads.length, 0);
  state.persisted = true;
  startTyping = true;
  await monitor.check();
  assert.equal(state.reloads.length, 0);
  assert.equal(state.attempt, null);
});

test("a stale cached build is protected from a repeated reload loop", async () => {
  const { state, monitor } = harness();
  state.attempt = { version: nextVersion, at: state.now };
  state.version = nextVersion;
  await monitor.check();
  state.now += 30_000;
  await monitor.check();
  assert.equal(state.reloads.length, 0);
  state.now += 10 * 60_000;
  await monitor.check();
  assert.deepEqual(state.reloads, [nextVersion]);
});

test("rollbacks are also recognized as a different available build", async () => {
  const { state, options } = harness();
  options.currentVersion = laterVersion;
  const monitor = createDisplayUpdateMonitor(options);
  await monitor.check();
  state.now += 30_000;
  await monitor.check();
  assert.deepEqual(state.reloads, [oldVersion]);
});

test("overlapping checks are serialized and stopping cancels an outstanding result", async () => {
  const { options, state } = harness();
  let resolve;
  let requests = 0;
  options.loadVersion = () => { requests++; return new Promise((done) => { resolve = done; }); };
  const monitor = createDisplayUpdateMonitor(options);
  const pending = monitor.check();
  await monitor.check();
  assert.equal(requests, 1);
  monitor.stop();
  resolve(nextVersion);
  await pending;
  assert.equal(state.reloads.length, 0);
});

test("version endpoint serves the compiled fingerprint without caching or private data", async () => {
  const { GET } = loadTypeScriptModule(new URL("../app/api/display-version/route.ts", import.meta.url), {
    globals: { __BITZ_BUILD_VERSION__: nextVersion },
  });
  const response = GET();
  assert.deepEqual(await response.json(), { version: nextVersion });
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  assert.equal(response.headers.get("CDN-Cache-Control"), "no-store");
});

test("build fingerprint follows source and style edits, excluding credentials and runtime files", () => {
  const root = mkdtempSync(join(tmpdir(), "bitz-build-version-"));
  try {
    mkdirSync(join(root, "app"));
    writeFileSync(join(root, "app/page.tsx"), "initial source");
    const first = dashboardBuildVersion(root);
    assert.equal(dashboardBuildVersion(root), first);
    writeFileSync(join(root, ".env.local"), "test credential placeholder");
    assert.equal(dashboardBuildVersion(root), first);
    writeFileSync(join(root, "app/globals.css"), "body { color: green }");
    const second = dashboardBuildVersion(root);
    assert.notEqual(second, first);
    writeFileSync(join(root, "app/page.tsx"), "changed source");
    assert.notEqual(dashboardBuildVersion(root), second);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("portable display login survives reload using session storage when local storage is blocked", async () => {
  const saved = new Map();
  const window = {
    get localStorage() { throw Error("blocked"); },
    sessionStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key) },
  };
  const url = new URL("../app/page.tsx", import.meta.url);
  const config = { append: "\nexport { storeDisplaySession, readDisplaySession, clearDisplaySession, preserveDisplayLoginForUpdate };", globals: { window } };
  const first = loadTypeScriptModule(url, config);
  first.storeDisplaySession("signed-test-session");
  assert.equal(await first.preserveDisplayLoginForUpdate(), true);
  const afterReload = loadTypeScriptModule(url, config);
  assert.equal(afterReload.readDisplaySession(), "signed-test-session");
  afterReload.clearDisplaySession();
  assert.equal(saved.size, 0);
});

test("an in-memory-only session requires a verified cookie before automatic navigation", async () => {
  const window = { get localStorage() { throw Error("blocked"); }, get sessionStorage() { throw Error("blocked"); } };
  let cookieValid = false;
  const { storeDisplaySession, preserveDisplayLoginForUpdate } = loadTypeScriptModule(new URL("../app/page.tsx", import.meta.url), {
    append: "\nexport { storeDisplaySession, preserveDisplayLoginForUpdate };",
    globals: { window, fetch: async (_url, options) => {
      assert.equal(options.credentials, "same-origin");
      assert.equal(options.headers, undefined, "verify the cookie without the portable token");
      return Response.json({ authorized: cookieValid });
    } },
  });
  storeDisplaySession("signed-test-session");
  assert.equal(await preserveDisplayLoginForUpdate(), false);
  cookieValid = true;
  assert.equal(await preserveDisplayLoginForUpdate(), true);
});
