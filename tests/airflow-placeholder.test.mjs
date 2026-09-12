import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const start = page.indexOf("function berlinClock(");
const end = page.indexOf("function hepaAssessment(", start);
assert.ok(start >= 0 && end > start, "Pure-function module boundaries must be present");
const context = { exports: {} };
vm.runInNewContext(stripTypeScriptTypes(page.slice(start, end)) +
  "\nexports.estimate=airflowAdjustmentEstimate;exports.compact=compactAirflowStatus;", context);
const { estimate, compact } = context.exports;

// Synthetic observations only. The placeholder is deliberately not computed
// from concentration ratios or interpreted as a safe ventilation reduction.
function series(date, endMinute = 12 * 60) {
  const midnight = Date.parse(`${date}T00:00:00+02:00`);
  return Array.from({ length: endMinute / 2 + 1 }, (_, index) => ({
    timestamp: midnight + index * 2 * 60_000,
    co2: 500, humidityAbs: 8, temperature: 20, tvoc: 30,
    sound: 68, soundMax: 70, pm1: .1, pm25: .2, pm4: .2, pm10: .3,
    hcho: 2, co: .2, oxygen: 20.6, humidity: 45,
  }));
}
const show = (samples, office = []) => estimate(samples, office, samples.at(-1));

test("quiet Saturday and Sunday use the explicit planning placeholder during daytime", () => {
  for (const date of ["2026-09-12", "2026-09-13"]) {
    assert.equal(show(series(date)), "PLACEHOLDER 《−50%》");
  }
});

test("weekend classification follows Europe/Berlin source time, including Friday UTC", () => {
  const earlySaturday = series("2026-09-12", 30);
  assert.match(new Date(earlySaturday.at(-1).timestamp).toISOString(), /^2026-09-11/);
  assert.equal(show(earlySaturday), "PLACEHOLDER 《−50%》");
  assert.equal(show(series("2026-09-13", 23 * 60)), "PLACEHOLDER 《−50%》");
});

test("weekday defaults remain unchanged by the weekend presentation rule", () => {
  assert.equal(show(series("2026-09-11")), "ESTIMATE 《0%》 POSSIBLE");
  assert.equal(show(series("2026-09-14", 2 * 60)), "ESTIMATE 《−50–60%》 POSSIBLE");
});

test("the planning placeholder never replaces an existing excursion assessment", () => {
  const samples = series("2026-09-12").map((point, index) => ({ ...point, tvoc: index >= 350 ? 400 : 30 }));
  assert.match(show(samples), /^ESTIMATE 《\+/);
});

test("a detected weekend LAB visit hides the unoccupied-mode planning figure", () => {
  const samples = series("2026-09-12").map((point, index) => {
    const t = index * 2;
    const elapsed = Math.max(0, Math.min(20, t - 11 * 60 + 2));
    const peak = t >= 11 * 60 && t % 4 === 0;
    return { ...point, co2: 500 + elapsed * 1.5, humidityAbs: 8 + elapsed * .004, soundMax: peak ? 90 : 70 };
  });
  assert.doesNotMatch(show(samples), /PLACEHOLDER/);
});

test("compact and full-size labels both preserve placeholder meaning", () => {
  assert.equal(compact("PLACEHOLDER 《−50%》"), "PLACEHOLDER −50%");
  assert.match(page, /Planning figure \/\/ system design pending/);
});

test("the planning figure leaves sensor observations unchanged", () => {
  const samples = series("2026-09-12");
  const before = JSON.stringify(samples);
  samples.forEach(Object.freeze);
  Object.freeze(samples);
  assert.equal(show(samples), "PLACEHOLDER 《−50%》");
  assert.equal(JSON.stringify(samples), before);
});
