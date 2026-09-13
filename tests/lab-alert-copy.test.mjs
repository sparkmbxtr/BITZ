import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const apiSource = await readFile(new URL("../app/api/airq/route.ts", import.meta.url), "utf8");

test("LAB critical panel remains a calculated test-system advisory", () => {
  assert.match(pageSource, /Calculated early-warning ALERT will be displayed here\./);
  assert.match(pageSource, /This is a test system; follow official instructions from authorised managers and directors\./);
  assert.match(pageSource, /Follow regulated safety systems alarms\. This system is NOT a alarm\./);
  assert.doesNotMatch(pageSource, /EVACUATE/i);
  assert.doesNotMatch(pageSource, /Leave the LAB/i);
});

test("dashboard exposes no transition, personnel, or free-text context surface", () => {
  assert.doesNotMatch(pageSource, /STATE1|STATE2|activityCycles|ActivityCycle|peopleRange|approximatePeopleAfterBegin|occupancyText/);
  assert.doesNotMatch(apiSource, /occupancyEstimate|officeLateStatePattern|LAB_VOLUME_M3|OFFICE_VOLUME_M3/);
  assert.equal(existsSync(new URL("../app/api/context/route.ts", import.meta.url)), false);
  assert.equal(existsSync(new URL("../app/api/context-auth/route.ts", import.meta.url)), false);
  assert.equal(existsSync(new URL("../.github/workflows/archive-monitoring.yml", import.meta.url)), false);
});
