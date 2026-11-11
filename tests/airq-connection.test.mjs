import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./helpers/typescript-module.mjs";

function fixture(fetch, authorized = true) {
  const api = loadTypeScriptModule(new URL("../app/api/airq/route.ts", import.meta.url), { globals: {
    fetch, AbortSignal,
    require: (name) => {
      if (name === "cloudflare:workers") return { env: {
        AIRQ_API_KEY: "fixture-key-private", AIRQ_LAB_DEVICE_ID: "fixture-lab-private",
        AIRQ_OFFICE_DEVICE_ID: "fixture-office-private", DASHBOARD_SESSION_SECRET: "fixture-session-private",
      } };
      if (name === "@/lib/dashboard-auth") return {
        isAuthorized: async () => authorized, isBearerAuthorized: async () => false, apiKeyFromRequest: async () => null,
      };
      if (name === "@/lib/airq-key-store") return { readStoredApiKey: async () => null };
      if (name === "@/lib/github-actions-oidc") return { isGitHubActionsExportAuthorized: async () => false };
      throw Error(`Unexpected import: ${name}`);
    },
  } });
  return (query = "") => api.GET(new Request(`https://bitz.example/api/airq${query}`));
}

test("sensor diagnostics require login and never expose upstream credentials or payload values", async () => {
  let calls = 0;
  const upstream = async () => { calls++; return Response.json({ error: "fixture-key-private" }, { status: 401 }); };
  const denied = await fixture(upstream, false)("?diagnostics=1");
  assert.equal(denied.status, 401);
  assert.equal(calls, 0);
  const result = await fixture(upstream)("?diagnostics=1");
  assert.equal(result.status, 200);
  assert.match(result.headers.get("cache-control"), /no-store/);
  const body = await result.json();
  assert.equal(body.rooms.office.latest.status, 401);
  assert.deepEqual(body.rooms.lab.timerange.fields, ["error"]);
  assert.doesNotMatch(JSON.stringify(body), /fixture-/);
  assert.equal(calls, 4);
});

test("diagnostics distinguish an empty LAB from timestamped OFFICE measurements", async () => {
  const now = Date.now();
  const get = fixture(async (url) => Response.json(url.pathname.includes("fixture-lab-private") ? [] : [{ timestamp: now, co2: 500 }]));
  const body = await (await get("?diagnostics=1")).json();
  assert.equal(body.rooms.lab.latest.records, 0);
  assert.equal(body.rooms.office.latest.records, 1);
  assert.equal(body.rooms.office.timerange.latestTimestamp, now);
});

test("a live OFFICE latest sample survives empty or failed history while LAB is offline", async () => {
  for (const failure of ["empty", "http", "network", "invalid-json"]) {
    const now = Date.now();
    const get = fixture(async (url) => {
      if (url.hostname !== "air-q-cloud.de") return Response.json({});
      if (url.pathname.includes("fixture-lab-private")) return Response.json([]);
      if (url.pathname.endsWith("/latest")) return Response.json({ timestamp: now, co2: 515, temperature: 21.5 });
      if (failure === "network") throw Error("upstream unavailable");
      if (failure === "http") return Response.json({ error: "unavailable" }, { status: 503 });
      if (failure === "invalid-json") return new Response("not json");
      return Response.json([]);
    });
    const response = await get();
    assert.equal(response.status, 200, failure);
    const body = await response.json();
    assert.equal(body.rooms.lab.latest, null);
    assert.equal(body.rooms.lab.samples.length, 0);
    assert.equal(body.rooms.office.latest.timestamp, now);
    assert.equal(body.rooms.office.latest.co2, 515);
    assert.equal(body.rooms.office.samples.length, 1);
    assert.equal(body.coverage.to - body.coverage.from, 24 * 60 * 60_000);
  }
});

test("history remains visible when latest fails, and exact exports never substitute a latest sample", async () => {
  const now = Date.now();
  const history = fixture(async (url) => {
    if (url.hostname !== "air-q-cloud.de") return Response.json({});
    return url.pathname.endsWith("/latest") ? Response.json({}, { status: 503 }) : Response.json([{ timestamp: now - 120_000, co2: 510 }]);
  });
  const body = await (await history()).json();
  assert.equal(body.rooms.office.latest.timestamp, now - 120_000);
  const exact = fixture(async (url) => {
    if (url.hostname !== "air-q-cloud.de") return Response.json({});
    assert.ok(!url.pathname.endsWith("/latest"));
    return Response.json([], { status: 503 });
  });
  assert.equal((await exact(`?export=1&f=${now - 3600_000}&t=${now}`)).status, 502);
});

test("an old latest reading keeps its real age and never enters the 24-hour graph samples", async () => {
  const timestamp = Date.now() - 12 * 24 * 3600_000;
  const get = fixture(async (url) => {
    if (url.hostname !== "air-q-cloud.de") return Response.json({});
    return Response.json(url.pathname.endsWith("/latest") ? { timestamp, co2: 540 } : []);
  });
  const response = await get();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.rooms.office.latest.timestamp, timestamp);
  assert.equal(body.rooms.office.samples.length, 0);
  assert.ok(body.rooms.office.latest.timestamp < body.coverage.from);
});
