import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/report/route.ts", import.meta.url), "utf8");

test("weekly report gate checks current availability before requesting attribution", () => {
  assert.match(page, />REPORT<\/button>/);
  assert.match(page, /fetch\(\`\/api\/report\?availability=/);
  assert.match(page, /Recent week’s report has not been generated yet/i);
  assert.match(page, /Input your first name to download weekly report/);
  assert.match(page, /RICHARD\/JEFF\/JESS\/LILIANA\/\/Dr\.Itzel\/\/Dr\.Kaarthik\/\/Dr\.Fidelis/);
  assert.match(page, /!reportName \? <span className="report-name-guide"/);
  assert.match(page, /REPORT_ALLOWED_NAMES\.find/);
  assert.match(page, /firstName === REPORT_HIDDEN_TEST_NAME/);
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

test("successful report downloads are attributable, durable and CSV-exportable", () => {
  assert.match(worker, /CREATE TABLE IF NOT EXISTS report_downloads/);
  assert.match(worker, /listReportDownloads/);
  assert.match(route, /acceptedFirstName/);
  assert.match(route, /REPORT_ALLOWED_NAMES/);
  assert.match(route, /value === REPORT_HIDDEN_TEST_NAME/);
  assert.match(route, /firstName !== REPORT_HIDDEN_TEST_NAME/);
  assert.match(route, /Use one of the listed names/);
  assert.match(route, /Dashboard login required/);
  assert.match(route, /airq_weekly_report_downloads\.csv/);
  assert.match(route, /downloadLog.*csv/);
});

test("all chart paths are generated from ascending unique timestamps", () => {
  assert.match(page, /function chronologicalByTimestamp/);
  assert.match(page, /unique\.set\(sample\.timestamp, sample\)/);
  assert.match(page, /sort\(\(left, right\) => left\.timestamp - right\.timestamp\)/);
  assert.match(page, /setData\(normalizeDashboardData\(payload\)\)/);
  assert.match(page, /const orderedSamples = useMemo/);
  assert.match(page, /const proportionalX = .* \* 98/);
  assert.match(page, /Math\.max\(index === 0 \? 0 : previousX, proportionalX\)/);
});

test("current display copy remains aligned", () => {
  assert.match(page, /CO WARNING/);
  assert.doesNotMatch(page, /LATEST COMPLETED WEEK/);
  assert.match(page, /LAB 2 BUILDING CONSTRUCTION · X'27/);
  assert.match(page, /status === "normal" \? ""/);
});
