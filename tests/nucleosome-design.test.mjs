import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { BOUND_GUARD_DEFINITIONS, EXPERIMENT_DESIGN_HTML } from "../worker/nucleosome-design.mjs";
import { WORKSPACE_TABS, workspaceNavigation } from "../worker/dashboard-tabs.mjs";
import { routeNucleosomeProgress, publicSnapshot } from "../worker/nucleosome-progress.mjs";
import { INITIAL_SNAPSHOT } from "../worker/nucleosome-snapshot.mjs";

const origin = "https://spark.bioengineering.workers.dev";
const fixture = "DESIGN-ONLY-FIXTURE";
const env = { NUCLEOSOME_PASSWORD_HASH: createHash("sha256").update(fixture).digest("hex"),
  DASHBOARD_SESSION_SECRET: "design-fixture-key" };

async function cookie() {
  const response = await routeNucleosomeProgress(new Request(origin + "/api/nucleosome-auth", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ password: fixture }),
  }), env);
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";", 1)[0];
}

test("the new section shares navigation with the Bordeaux monitor", () => {
  assert.equal(WORKSPACE_TABS.length, 2);
  const nav = workspaceNavigation("experiment-design");
  assert.match(nav, /href="\/nucleosome"/);
  assert.match(nav, /id="tab-experiment-design" href="\/experiment-design" aria-current="page"/);
  assert.equal((nav.match(/aria-current=/g) || []).length, 1);
});

test("design content requires the existing weekly session and keeps no-store policy", async () => {
  const locked = await routeNucleosomeProgress(new Request(origin + "/experiment-design"), env);
  assert.match(await locked.text(), /action="\/api\/nucleosome-auth"/);
  const response = await routeNucleosomeProgress(new Request(origin + "/experiment-design", {
    headers: { Cookie: await cookie() },
  }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("referrer-policy"), "same-origin");
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.headers.get("cdn-cache-control"), "no-store");
  assert.match(await response.text(), /data-workspace="experiment-design"/);
  assert.equal(response.headers.get("set-cookie"), null, "visiting a tab does not renew the week");
});

test("design HEAD, methods, and neutral host preserve the existing access boundary", async () => {
  const head = await routeNucleosomeProgress(new Request(origin + "/experiment-design", { method: "HEAD" }), env);
  assert.equal(await head.text(), "");
  const post = await routeNucleosomeProgress(new Request(origin + "/experiment-design", { method: "POST" }), env);
  assert.equal(post.status, 405);
  assert.equal(await routeNucleosomeProgress(new Request("https://bitz.bioengineering.workers.dev/experiment-design"), env), null);
});

test("the scientific definition keeps six guards and distinguishes the control and conditional capacity", () => {
  assert.equal(BOUND_GUARD_DEFINITIONS.length, 6);
  assert.deepEqual(BOUND_GUARD_DEFINITIONS.map(row => row[1]), ["≤ 0.65 nm", "≥ 0.70", "≥ 0.85", "≤ 0.30 nm", "≤ 0.25 nm", "≤ 1.20 nm"]);
  for (const term of ["not GC matched", "56.46%", "40.82%", "≤600 total technical steps per system", "69-row / 6.9-ns ceiling", "150-minute cloud-controller communication lease"]) {
    assert.ok(EXPERIMENT_DESIGN_HTML.includes(term), "Reviewed protocol term retained: " + term);
  }
  assert.doesNotMatch(EXPERIMENT_DESIGN_HTML, /bd2191e46892|ff82a474-aa58|ccarenv_b64|202611013/);
});

test("yellow and Bordeaux text have readable contrast", () => {
  const luminance = hex => {
    const rgb = hex.match(/\w\w/g).map(value => parseInt(value, 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
  assert.ok(contrast("f3d780", "4b1b31") >= 7);
  assert.ok(contrast("f3d780", "704153") >= 4.5);
});

test("a queued baseline is not described as terminal", async () => {
  const state = structuredClone(INITIAL_SNAPSHOT);
  state.information_updated_at = new Date().toISOString();
  state.jobs.forEach(job => Object.assign(job, { status: "queued", step: 0, guards_pass: null, checkpoint_at: null }));
  const elements = new Map();
  const document = { hidden: false, getElementById(id) { if (!elements.has(id)) elements.set(id, { textContent: "" }); return elements.get(id); }, addEventListener() {} };
  const script = EXPERIMENT_DESIGN_HTML.match(/<script>([\s\S]*)<\/script>/)[1];
  vm.runInNewContext(script, { document, window: { addEventListener() {} }, Intl, Date, AbortSignal,
    setInterval() {}, fetch: async () => Response.json(publicSnapshot(state, "automatic")) });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(elements.get("design-live-summary").textContent, /Awaiting the next bound branch/);
  assert.doesNotMatch(elements.get("design-live-summary").textContent, /All bound branches are terminal/);
});
