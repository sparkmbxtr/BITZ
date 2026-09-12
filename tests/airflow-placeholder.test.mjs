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
  "\nexports.estimate=airflowAdjustmentEstimate;exports.compact=compactAirflowStatus;exports.matches=labDayMatchesNightReference;", context);
const { estimate, compact, matches } = context.exports;

// Synthetic observations only. The placeholder is deliberately not computed
// from concentration ratios or interpreted as a safe ventilation reduction.
function series(date, endMinute = 12 * 60, offset = "+02:00") {
  const midnight = Date.parse(`${date}T00:00:00${offset}`);
  return Array.from({ length: endMinute / 2 + 1 }, (_, index) => ({
    timestamp: midnight + index * 2 * 60_000,
    co2: 500, humidityAbs: 8, temperature: 20, tvoc: 30,
    sound: 68, soundMax: 70, pm1: .1, pm25: .2, pm4: .2, pm10: .3,
    hcho: 2, co: .2, oxygen: 20.6, humidity: 45,
  }));
}
const show = (samples, office = []) => estimate(samples, office, samples.at(-1));
const hasMatch = (samples) => matches(samples, samples.at(-1));
const isDay = (point, samples) => point.timestamp >= samples[0].timestamp + 6 * 60 * 60_000;

test("quiet Saturday and Sunday use the explicit planning placeholder during daytime", () => {
  for (const date of ["2026-09-12", "2026-09-13"]) {
    assert.equal(show(series(date)), "PLACEHOLDER 《−50%》");
  }
});

test("a weekend date alone cannot bypass the night/day evidence requirement", () => {
  const earlySaturday = series("2026-09-12", 30);
  assert.match(new Date(earlySaturday.at(-1).timestamp).toISOString(), /^2026-09-11/);
  assert.equal(show(earlySaturday), "ESTIMATE 《0%》 POSSIBLE");
  assert.equal(show(series("2026-09-12", 6 * 60 + 58)), "ESTIMATE 《0%》 POSSIBLE");
  assert.equal(show(series("2026-09-12", 7 * 60)), "PLACEHOLDER 《−50%》");
  assert.equal(show(series("2026-09-13", 23 * 60)), "PLACEHOLDER 《−50%》");
});

test("weekday equality is not a weekend trigger and night time cannot independently show a reduction", () => {
  assert.equal(show(series("2026-09-11")), "ESTIMATE 《0%》 POSSIBLE");
  assert.equal(show(series("2026-09-14", 2 * 60)), "ESTIMATE 《0%》 POSSIBLE");
});

test("every assessed LAB channel must match its own same-date night median", () => {
  const base = series("2026-09-12");
  const shifts = { co2: 10, tvoc: 10, hcho: .5, co: .02, oxygen: -.02,
    pm1: .2, pm25: .2, pm4: .2, pm10: .2, temperature: .3,
    humidity: 2, humidityAbs: .05, sound: 2, soundMax: 2 };
  for (const [key, delta] of Object.entries(shifts)) {
    const changed = base.map((point) => isDay(point, base) ? { ...point, [key]: point[key] + delta } : point);
    assert.equal(hasMatch(changed), false, key);
    assert.doesNotMatch(show(changed), /PLACEHOLDER/, key);
  }
});

test("matching uses measured night variability rather than exact floating-point equality", () => {
  const base = series("2026-09-12");
  const samples = base.map((point, index) => ({ ...point,
    co2: point.co2 + (isDay(point, base) ? 2 : index % 2 ? -1 : 1),
    temperature: point.temperature + (isDay(point, base) ? .05 : index % 2 ? -.03 : .03),
  }));
  assert.equal(show(samples), "PLACEHOLDER 《−50%》");
});

test("an unstable night cannot inflate the matching tolerance without limit", () => {
  const base = series("2026-09-12");
  const samples = base.map((point, index) => ({ ...point,
    co2: point.co2 + (isDay(point, base) ? 50 : index % 2 ? -100 : 100),
  }));
  assert.equal(hasMatch(samples), false);
});

test("late drift and short sustained activity cannot hide in a matching whole-day median", () => {
  const base = series("2026-09-12");
  const latest = base.at(-1).timestamp;
  for (const [start, end] of [[latest - 30 * 60_000, latest], [latest - 120 * 60_000, latest - 108 * 60_000]]) {
    const samples = base.map((point) => point.timestamp >= start && point.timestamp <= end
      ? { ...point, co2: point.co2 + 15 } : point);
    assert.equal(hasMatch(samples), false);
    assert.doesNotMatch(show(samples), /PLACEHOLDER/);
  }
});

test("the latest raw value and isolated raw sound-max events are not averaged away", () => {
  const base = series("2026-09-12");
  const latestChange = base.map((point, index) => index === base.length - 1 ? { ...point, oxygen: 20.5 } : point);
  assert.equal(hasMatch(latestChange), false);
  const rawPeak = base.map((point, index) => index === 280 ? { ...point, soundMax: 91 } : point);
  assert.equal(hasMatch(rawPeak), false);
});

test("incomplete night, daytime, or channel coverage cannot establish equality", () => {
  const base = series("2026-09-12");
  for (const samples of [base.slice(30), base.filter((_, index) => index < 100 || index > 110),
    base.filter((_, index) => index < 200 || index > 210)]) {
    assert.equal(hasMatch(samples), false);
  }
  for (const invalid of [null, undefined, NaN, Infinity]) {
    const missing = base.map((point) => ({ ...point, oxygen: invalid }));
    assert.equal(hasMatch(missing), false);
    const missingLatest = base.map((point, index) => index === base.length - 1 ? { ...point, soundMax: invalid } : point);
    assert.equal(hasMatch(missingLatest), false);
  }
  // One dropped record within an otherwise complete two-minute series is tolerable.
  assert.equal(hasMatch(base.filter((_, index) => index !== 250)), true);
});

test("neither another date nor OFFICE data can supply a missing LAB night reference", () => {
  const current = series("2026-09-12");
  const missingNight = current.filter((point) => isDay(point, current));
  assert.equal(matches([...series("2026-09-11"), ...missingNight], current.at(-1)), false);
  assert.doesNotMatch(show(missingNight, current), /PLACEHOLDER/);
});

test("future records are excluded and duplicate records cannot manufacture coverage", () => {
  const base = series("2026-09-12");
  const future = { ...base.at(-1), timestamp: base.at(-1).timestamp + 120_000, co2: 5000 };
  assert.equal(matches([...base, future], base.at(-1)), true);
  assert.equal(estimate([...base, future], [], base.at(-1)), "PLACEHOLDER 《−50%》");
  assert.equal(matches([...base, { ...base[200] }], base.at(-1)), false);
  assert.equal(matches([...base].reverse(), base.at(-1)), true);
});

test("night coverage follows Berlin calendar boundaries across both DST changes", () => {
  for (const [date, offset] of [["2026-03-29", "+01:00"], ["2026-10-25", "+02:00"]]) {
    assert.equal(show(series(date, 12 * 60, offset)), "PLACEHOLDER 《−50%》", date);
  }
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
