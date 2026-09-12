import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const start = page.indexOf("function berlinClock(");
const end = page.indexOf("function pointsFor(", start);
assert.ok(start >= 0 && end > start, "Pure-function module boundaries must be present");
const context = { exports: {}, LAB_FLOOR_AREA_ESTIMATE_M2: 18, LAB_VOLUME_ESTIMATE_M3: 50 };
vm.runInNewContext(stripTypeScriptTypes(page.slice(start, end)) +
  "\nexports.estimate=airflowAdjustmentEstimate;exports.compact=compactAirflowStatus;exports.matches=labDaySupportsSavingReview;exports.checksClear=labSavingChecksClear;exports.hepa=hepaAssessment;", context);
const { estimate, compact, matches, checksClear, hepa } = context.exports;

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
const show = (samples, office = [], clear = true) => estimate(samples, office, samples.at(-1), clear);
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

test("contaminant/noise rises and oxygen shifts still block the saving review", () => {
  const base = series("2026-09-12");
  const shifts = { co2: 10, tvoc: 10, hcho: .5, co: .02, oxygen: -.02,
    pm1: .2, pm25: .2, pm4: .2, pm10: .2, sound: 2, soundMax: 2 };
  for (const [key, delta] of Object.entries(shifts)) {
    const changed = base.map((point) => isDay(point, base) ? { ...point, [key]: point[key] + delta } : point);
    assert.equal(hasMatch(changed), false, key);
    assert.doesNotMatch(show(changed), /PLACEHOLDER/, key);
  }
});

test("daytime CO2 clearance and ordinary LAB climate drift can support the planning figure", () => {
  const base = series("2026-09-12");
  const samples = base.map((point, index) => {
    const progress = Math.max(0, (index * 2 - 360) / 360);
    return { ...point, co2: 900 - progress * 400, temperature: 20 + progress * 3,
      humidity: 45 - progress * 3, humidityAbs: 8 + progress * .6,
      sound: 68 - progress * 2, soundMax: 70 - progress * 2 };
  });
  assert.equal(show(samples), "PLACEHOLDER 《−50%》");
});

test("lower contaminant readings are clearance rather than a baseline mismatch", () => {
  const base = series("2026-09-12");
  const lower = { co2: 450, tvoc: 10, hcho: 1, co: .1, pm1: 0, pm25: .1, pm4: .1, pm10: .1, sound: 65, soundMax: 67 };
  for (const [key, value] of Object.entries(lower)) {
    const samples = base.map((point) => isDay(point, base) ? { ...point, [key]: value } : point);
    assert.equal(show(samples), "PLACEHOLDER 《−50%》", key);
  }
});

test("climate adaptation stays inside the existing LAB bands", () => {
  const base = series("2026-09-12");
  for (const change of [{ temperature: 29 }, { temperature: 13 }, { humidity: 80 }, { humidity: 20 }]) {
    const samples = base.map((point) => isDay(point, base) ? { ...point, ...change } : point);
    assert.equal(hasMatch(samples), false);
  }
  for (const key of ["temperature", "humidity", "humidityAbs"]) {
    assert.equal(hasMatch(base.map((point) => ({ ...point, [key]: null }))), false, key);
  }
});

test("renewed accumulation below a high night reference is still a veto", () => {
  const base = series("2026-09-12");
  for (const [key, nightValue, cleared, renewed] of [
    ["co2", 900, 500, 550], ["tvoc", 200, 30, 65], ["hcho", 8, 2, 4],
    ["co", .5, .1, .15], ["pm25", 2, .1, .8], ["soundMax", 78, 65, 71],
  ]) {
    const samples = base.map((point, index) => ({ ...point,
      [key]: !isDay(point, base) ? nightValue : index >= 345 ? renewed : cleared,
    }));
    assert.equal(hasMatch(samples), false, key);
    assert.doesNotMatch(show(samples), /PLACEHOLDER/, key);
  }
});

test("a high night reference never overrides current absolute grades", () => {
  const base = series("2026-09-12");
  for (const change of [{ co2: 1200 }, { tvoc: 600 }, { oxygen: 19.8 }, { pm25: 20 }]) {
    assert.equal(hasMatch(base.map((point) => ({ ...point, ...change }))), false);
  }
});

test("invalid physical values cannot be interpreted as improved air", () => {
  const base = series("2026-09-12");
  for (const change of [{ co2: 0 }, { tvoc: -10 }, { co: -1 }, { humidityAbs: -1 }]) {
    assert.equal(hasMatch(base.map((point) => isDay(point, base) ? { ...point, ...change } : point)), false);
  }
});

test("all existing LAB safety and integrity checks must be present and clear", () => {
  const labels = ["CO release", "O₂ displacement", "Propane-associated pattern", "Nitrogen (N₂) displacement pattern",
    "Volatile-gas pattern", "Formaldehyde elevation", "Particle pattern", "CO₂ accumulation", "Sound peak >90 dB", "Sensor/data integrity"];
  const samples = series("2026-09-12");
  const room = { status: "normal", latest: samples.at(-1), checks: labels.map((label) => ({ label, level: "normal" })) };
  const now = room.latest.timestamp;
  const clear = (candidate) => checksClear(candidate, true, now);
  assert.equal(clear(room), true);
  assert.equal(hepa(samples, [], samples.at(-1), clear(room)).airflow, "PLACEHOLDER 《−50%》");
  for (const label of labels) {
    for (const level of ["watch", "action", "unknown"]) {
      const changed = { ...room, checks: room.checks.map((check) => check.label === label ? { ...check, level } : check) };
      assert.equal(clear(changed), false, `${label}: ${level}`);
      assert.doesNotMatch(show(samples, [], clear(changed)), /PLACEHOLDER/);
    }
    assert.equal(clear({ ...room, checks: room.checks.filter((check) => check.label !== label) }), false);
  }
  for (const status of ["watch", "action", "unknown"]) assert.equal(clear({ ...room, status }), false);
  assert.equal(clear({ ...room, checks: [] }), false);
  assert.equal(checksClear(room, false, now), false, "preview data");
  assert.equal(checksClear(room, true, now + 8 * 60_000 + 1), false, "stale cached CURRENT status");
  assert.equal(checksClear(room, true, now - 1), false, "future timestamp");
  assert.equal(clear({ ...room, latest: null }), false, "missing latest sample");
  assert.doesNotMatch(estimate(samples, [], samples.at(-1)), /PLACEHOLDER/);
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
  assert.equal(estimate([...base, future], [], base.at(-1), true), "PLACEHOLDER 《−50%》");
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
