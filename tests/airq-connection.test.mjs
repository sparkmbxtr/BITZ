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
