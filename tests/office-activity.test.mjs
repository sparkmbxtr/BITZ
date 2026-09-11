import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Execute the production detector and chart component, including every BEGIN
// selection path. Checking for strings in the source cannot catch a skipped path.
const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source + `
export { activityCycles, officeCorroboratedBeginEventTime, HistoryTrend };
`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
const exports = {};
vm.runInNewContext(compiled.outputText, { exports, require: createRequire(import.meta.url) });
const { activityCycles, officeCorroboratedBeginEventTime, HistoryTrend } = exports;
const minute = 60_000;
const midnight = Date.parse("2026-09-11T00:00:00+02:00");
const onset = 7 * 60;
const centres = new Map([["co2", 450], ["humidityAbs", 8.2], ["sound", 35], ["soundMax", 40]]);
const scales = new Map([["co2", 20], ["humidityAbs", .12], ["sound", 2.5], ["soundMax", 4]]);

function series({ day = midnight, begin = onset, end = 10 * 60, loudAt = null, intermittent = false } = {}) {
  return Array.from({ length: end / 2 + 1 }, (_, index) => {
    const t = index * 2;
    const elapsed = Math.max(0, Math.min(60, t - begin + 2));
    const active = t >= begin;
    const loud = loudAt !== null && t >= loudAt;
    return {
      timestamp: day + t * minute,
      co2: 450 - Math.min(t, begin - 2) * .05 + elapsed * 2,
      humidityAbs: 8.2 + t * .0002 + elapsed * .012,
      sound: 35 + (active && !intermittent ? .7 : 0) + (loud ? 4 : 0),
      soundMax: 40 + (active && t < begin + 20 && t % 4 === 0 ? 6 : 0) + (loud ? 12 : 0),
      temperature: 22, humidity: 50, tvoc: 120,
      co: null, oxygen: null, dewpt: null, hcho: null,
      pm1: null, pm25: null, pm4: null, pm10: null, health: null, performance: null,
    };
  });
}

function assertAtOnset(actual, expected = midnight + onset * minute) {
  assert.ok(actual !== null, "BEGIN must be detected");
  assert.equal(actual, expected, `BEGIN offset from first sustained rising record: ${(actual - expected) / minute} minutes`);
}

test("OFFICE multichannel fallback marks the first rising record, before later accumulation", () => {
  const cycles = activityCycles(series(), "OFFICE");
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].beginMethod, "MULTICHANNEL");
  assertAtOnset(cycles[0].begin);
});

test("OFFICE sound-triggered BEGIN returns to the earlier CO2/humidity onset", () => {
  const cycles = activityCycles(series({ loudAt: onset + 38 }), "OFFICE");
  assertAtOnset(cycles[0]?.begin);
});

test("intermittent sound-max corroborates onset even when average sound remains quiet", () => {
  const samples = series({ intermittent: true, loudAt: onset + 38 });
  assertAtOnset(activityCycles(samples, "OFFICE")[0]?.begin);
});

test("forward confirmation does not put BEGIN on a still-flat sample before the rise", () => {
  assertAtOnset(officeCorroboratedBeginEventTime(series(), midnight + (onset + 30) * minute, centres, scales));
});

test("the search covers an onset almost an hour after an early acoustic anchor", () => {
  assertAtOnset(officeCorroboratedBeginEventTime(series(), midnight + (onset - 58) * minute, centres, scales));
});

test("an isolated CO2/humidity spike and sound spike cannot move BEGIN", () => {
  const samples = series({ begin: 900 });
  const spike = samples.find((sample) => sample.timestamp === midnight + onset * minute);
  spike.co2 += 30;
  spike.humidityAbs += .3;
  spike.soundMax += 10;
  const anchor = midnight + (onset + 30) * minute;
  assert.equal(officeCorroboratedBeginEventTime(samples, anchor, centres, scales), anchor);
});

test("live data needs sustained observations and keeps the same onset as more arrive", () => {
  const anchor = midnight + (onset + 30) * minute;
  assert.equal(officeCorroboratedBeginEventTime(series({ end: onset + 4 }), anchor, centres, scales), anchor);
  assertAtOnset(officeCorroboratedBeginEventTime(series({ end: onset + 18 }), anchor, centres, scales));
  assertAtOnset(officeCorroboratedBeginEventTime(series(), anchor, centres, scales));
});

test("Saturday and Sunday use the same OFFICE onset correction", () => {
  for (const date of ["2026-09-12", "2026-09-13"]) {
    const day = Date.parse(`${date}T00:00:00+02:00`);
    const samples = series({ day, loudAt: onset + 38 });
    assertAtOnset(activityCycles(samples, "OFFICE")[0]?.begin, day + onset * minute);
  }
});

test("weekend multichannel entries also use the early onset without sustained loud sound", () => {
  const day = Date.parse("2026-09-12T00:00:00+02:00");
  const samples = series({ day }).map((sample) => ({
    ...sample, tvoc: sample.tvoc + Math.max(0, (sample.timestamp - day) / minute - onset) * 2,
  }));
  const cycle = activityCycles(samples, "OFFICE")[0];
  assert.equal(cycle?.beginMethod, "MULTICHANNEL");
  assertAtOnset(cycle.begin, day + onset * minute);
});

test("later weekend visits cannot backtrack into the previous visit", () => {
  const samples = series();
  const anchor = midnight + (onset + 40) * minute;
  const afterPreviousClose = midnight + (onset + 24) * minute;
  assert.equal(officeCorroboratedBeginEventTime(samples, anchor, centres, scales, afterPreviousClose), anchor);
});

test("an established gradual CO2 trend is not a new onset", () => {
  const samples = series().map((sample, index) => ({
    ...sample, co2: 450 + index * 2, humidityAbs: 8.2 + index * .02,
  }));
  const anchor = midnight + (onset + 30) * minute;
  assert.equal(officeCorroboratedBeginEventTime(samples, anchor, centres, scales), anchor);
});

test("missing observations across the rise do not invent an earlier onset", () => {
  const samples = series().filter((sample) => {
    const t = (sample.timestamp - midnight) / minute;
    return t < onset - 12 || t >= onset;
  });
  const anchor = midnight + (onset + 30) * minute;
  assert.equal(officeCorroboratedBeginEventTime(samples, anchor, centres, scales), anchor);
});

test("all OFFICE curves put the BEGIN line at the rising record's actual x coordinate", () => {
  const samples = series();
  const at = samples.findIndex((sample) => sample.timestamp === midnight + onset * minute);
  for (const key of ["co2", "humidityAbs", "temperature", "tvoc", "sound"]) {
    const html = renderToStaticMarkup(createElement(HistoryTrend, {
      samples, primary: (sample) => sample[key], label: key, room: "OFFICE",
      levelFor: () => ({ label: "GOOD", level: "good" }),
    }));
    const eventX = Number(html.match(/<line x1="([^"]+)"[^>]*class="activity-time-grid activity-begin"/)?.[1]);
    const path = html.match(/<path d="([^"]+)" class="trend-primary trend-history"/)?.[1];
    assert.ok(path, "the sensor history must render");
    const points = [...path.matchAll(/[ML]([\d.]+),/g)].map((match) => Number(match[1]));
    assert.ok(Math.abs(eventX - points[at]) <= .005, `${key}: marker ${eventX}, rising record ${points[at]}`);
    assert.equal(points.at(-1), 100, "the sensor curve uses the complete time axis");
    assert.match(html, /BEGIN 07:00/);
    assert.match(html, /class="current-point"[^>]*left:100%/);
  }
});
