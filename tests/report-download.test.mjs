import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTypeScriptModule } from "./helpers/typescript-module.mjs";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/report/route.ts", import.meta.url), "utf8");

test("weekly report uses one OK/Cancel confirmation without asking for a name", () => {
  assert.match(page, />REPORT<\/button>/);
  assert.match(page, /dashboardFetch\(\`\/api\/report\?availability=/);
  assert.match(page, /Recent week’s report has not been generated yet/i);
  assert.match(page, /Download the weekly report/);
  assert.match(page, /type="button" onClick={closeReportInput} disabled={reportState === "sending"}>CANCEL/);
  assert.match(page, /type="submit" disabled={reportState === "sending"}>\{reportState === "sending" \? "DOWNLOADING…" : "OK"\}/);
  assert.match(page, /reportDownloading\.current \|\|/);
  assert.match(page, /dashboardFetch\("\/api\/report", \{\s*method: "POST"/);
  assert.doesNotMatch(page, /reportName|REPORT_ALLOWED_NAMES|REPORT_HIDDEN_TEST_NAME|report-name-guide|Enter your first name/);
});

test("only the exact latest Monday-Saturday report can be served", () => {
  assert.match(route, /function expectedWeeklyReport/);
  assert.match(route, /const daysSinceSaturday = \(\(weekday - 6 \+ 7\) % 7\) \|\| 7/);
  assert.match(route, /headWeeklyReport\(report\.fileName\)/);
  assert.match(route, /getWeeklyReport\(report\.fileName\)/);
  assert.doesNotMatch(route, /083126-090526/);
});

test("weekly report publication verifies before the current pointer is switched", () => {
  assert.match(route, /export async function PUT/);
  assert.match(route, /contentType !== "application\/pdf"/);
  assert.match(route, /validPdf\(bytes\)/);
  assert.match(route, /calculatedSha256 !== suppliedSha256/);
  assert.match(route, /stageWeeklyReport\(staged\)/);
  assert.match(route, /getStagedWeeklyReport\(reportId\)/);
  assert.match(route, /sha256Hex\(storedBytes\)/);
  assert.match(route, /activateWeeklyReport\(reportId\)/);
  assert.match(worker, /weekly_report_state/);
  assert.match(worker, /This single pointer write is the activation boundary/);
});

test("new downloads do not log names; historical export remains separate", () => {
  assert.match(worker, /CREATE TABLE IF NOT EXISTS report_downloads/);
  assert.match(worker, /listReportDownloads/);
  assert.doesNotMatch(route, /acceptedFirstName|REPORT_ALLOWED_NAMES|REPORT_HIDDEN_TEST_NAME|addReportDownload\(/);
  assert.match(route, /Dashboard login required/);
  assert.match(route, /airq_weekly_report_downloads\.csv/);
  assert.match(route, /downloadLog.*csv/);
});

const auth = loadTypeScriptModule(new URL("../lib/dashboard-auth.ts", import.meta.url), { globals: { btoa, atob } });

async function reportFixture({ sessionSecret = "report-test-session-secret", reportAvailable = true } = {}) {
  const calls = { load: 0, head: 0, logs: 0, nameWrites: 0 };
  const pdf = new TextEncoder().encode("%PDF-1.7\n" + "x".repeat(1100) + "\n%%EOF");
  const stub = {
    headWeeklyReport: async (reportName) => { calls.head++; return reportAvailable ? { reportName, byteSize: pdf.length } : null; },
    getWeeklyReport: async (reportName) => {
      calls.load++;
      return reportAvailable ? { reportName, byteSize: pdf.length, chunks: [Buffer.from(pdf).toString("base64")] } : null;
    },
    listReportDownloads: async () => { calls.logs++; return []; },
    addReportDownload: async () => { calls.nameWrites++; throw new Error("Name collection must stay disabled"); },
  };
  const api = loadTypeScriptModule(new URL("../app/api/report/route.ts", import.meta.url), { globals: {
    btoa, atob, Uint8Array,
    require: (name) => {
      if (name === "cloudflare:workers") return { env: {
        DASHBOARD_SESSION_SECRET: sessionSecret,
        MONITOR_EXPORT_TOKEN: "report-test-export-token",
        CONTEXT_LOG: { getByName: () => stub },
      } };
      if (name === "@/lib/dashboard-auth") return auth;
      if (name === "@/lib/github-actions-oidc") return { isGitHubActionsExportAuthorized: async () => false };
      throw new Error(`Unexpected import: ${name}`);
    },
  } });
  const grant = await auth.sessionGrant("report-test-session-secret");
  const request = (method, path = "", options = {}) => new Request(`https://example.test/api/report${path}`, { method, ...options });
  return { api, calls, pdf, request, cookie: grant.cookie.split(";")[0], token: grant.token };
}

test("anonymous availability, POST and direct GET download attempts fail closed", async () => {
  const { api, calls, request } = await reportFixture();
  for (const [method, path] of [["GET", "?availability=1"], ["GET", "?download=1"], ["POST", ""]]) {
    const result = await api[method](request(method, path));
    assert.equal(result.status, 401);
    assert.match(result.headers.get("cache-control"), /no-store/);
  }
  assert.deepEqual(calls, { load: 0, head: 0, logs: 0, nameWrites: 0 });
});

test("cookie and signed display-session users can download without sending a name", async () => {
  for (const mode of ["cookie", "header"]) {
    const { api, calls, request, cookie, token, pdf } = await reportFixture();
    const headers = mode === "cookie" ? { cookie } : { "x-bitz-display-session": token };
    const available = await api.GET(request("GET", "?availability=1", { headers }));
    assert.equal((await available.json()).available, true);
    const result = await api.POST(request("POST", "", { headers }));
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("content-type"), "application/pdf");
    assert.match(result.headers.get("content-disposition"), /^attachment;/);
    assert.match(result.headers.get("cache-control"), /private, no-store/);
    assert.deepEqual(new Uint8Array(await result.arrayBuffer()), pdf);
    assert.equal(calls.nameWrites, 0);
    assert.equal(calls.load, 1);
  }
});

test("legacy name payloads are ignored and never logged", async () => {
  const { api, calls, request, cookie } = await reportFixture();
  const result = await api.POST(request("POST", "", {
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ firstName: "Test-only identity" }),
  }));
  assert.equal(result.status, 200);
  assert.equal(calls.nameWrites, 0);
});

test("GET cannot download even with a valid dashboard session", async () => {
  const { api, calls, request, cookie } = await reportFixture();
  assert.equal((await api.GET(request("GET", "?download=1", { headers: { cookie } }))).status, 405);
  assert.equal(calls.load, 0);
});

test("cross-origin POST and missing or invalid session secrets cannot load a PDF", async () => {
  const { api, calls, request, cookie } = await reportFixture();
  assert.equal((await api.POST(request("POST", "", { headers: { cookie, origin: "https://untrusted.test" } }))).status, 403);
  assert.equal((await api.POST(request("POST", "", { headers: { cookie: "airq_wallboard_session=invalid" } }))).status, 401);
  assert.equal(calls.load, 0);
  const unconfigured = await reportFixture({ sessionSecret: "" });
  assert.equal((await unconfigured.api.POST(unconfigured.request("POST", "", { headers: { cookie } }))).status, 401);
  assert.equal(unconfigured.calls.load, 0);
});

test("missing current report returns a clear unavailable response", async () => {
  const { api, request, cookie } = await reportFixture({ reportAvailable: false });
  const result = await api.POST(request("POST", "", { headers: { cookie } }));
  assert.equal(result.status, 404);
  assert.match((await result.json()).error, /not been generated yet/);
});

test("dashboard login alone cannot export historical names or publish reports", async () => {
  const { api, calls, request, cookie } = await reportFixture();
  for (const headers of [{}, { cookie }]) {
    assert.equal((await api.GET(request("GET", "?downloadLog=csv&download=1", { headers }))).status, 401);
    assert.equal((await api.PUT(request("PUT", "", { headers }))).status, 401);
  }
  assert.equal(calls.logs, 0);
  const headers = { authorization: "Bearer report-test-export-token" };
  assert.equal((await api.GET(request("GET", "?downloadLog=csv", { headers }))).status, 200);
  assert.equal(calls.logs, 1);
});

test("all chart paths are generated from ascending unique timestamps", () => {
  assert.match(page, /function chronologicalByTimestamp/);
  assert.match(page, /unique\.set\(sample\.timestamp, sample\)/);
  assert.match(page, /sort\(\(left, right\) => left\.timestamp - right\.timestamp\)/);
  assert.match(page, /setData\(normalizeDashboardData\(payload\)\)/);
  assert.match(page, /const orderedSamples = useMemo/);
  assert.match(page, /const proportionalX = .* \* 100/);
  assert.match(page, /Math\.max\(index === 0 \? 0 : previousX, proportionalX\)/);
});

test("current display copy remains aligned", () => {
  assert.match(page, /CO WARNING/);
  assert.doesNotMatch(page, /LATEST COMPLETED WEEK/);
  assert.match(page, /LAB 2 BUILDING CONSTRUCTION · X'27/);
  assert.match(page, /status === "action" \? "!" : ""/);
});
