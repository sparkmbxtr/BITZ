import assert from "node:assert/strict";
import test from "node:test";
import { loadActivityModule } from "./helpers/activity-module.mjs";

const { labDepartureCloseEventTime, activityCycles } = loadActivityModule();
const minute = 60_000;
const midnight = Date.parse("2026-09-11T00:00:00+02:00");
const closeMinute = 16 * 60 + 44;
const centres = new Map([["soundMax", 70], ["sound", 68]]);
const scales = new Map([["soundMax", 4], ["co2", 20], ["humidityAbs", .12]]);

// Synthetic calibration pattern; no private sensor export is committed.
function series() {
  return Array.from({ length: 18 * 30 + 1 }, (_, index) => {
    const t = index * 2;
    const occupied = t >= 7 * 60 && t < closeMinute;
    const peak = occupied && (t % 10 === 0 || t === closeMinute - 2);
    return { timestamp: midnight + t * minute, sound: occupied ? 68.5 : 67.5,
      soundMax: peak ? 92 : 70, co2: 500, humidityAbs: 8.5,
      temperature: 22, humidity: 50, tvoc: 150 };
  });
}
const resolve = (samples) => labDepartureCloseEventTime(samples, midnight + 15.5 * 60 * minute, midnight + 18 * 60 * minute, centres, scales);

test("LAB uses first quiet raw sample after intermittent departure peaks, not median confirmation time", () => {
  assert.equal(resolve(series()), midnight + closeMinute * minute);
  assert.equal(activityCycles(series(), "LAB")[0].close, midnight + closeMinute * minute);
});

test("LAB requires the confirmation tail but retains the original onset as records arrive", () => {
  const samples = series();
  assert.equal(resolve(samples.filter((sample) => sample.timestamp <= midnight + (closeMinute + 20) * minute)), null);
  assert.equal(resolve(samples.filter((sample) => sample.timestamp <= midnight + (closeMinute + 30) * minute)), midnight + closeMinute * minute);
  assert.equal(resolve([...samples].reverse()), midnight + closeMinute * minute);
});

test("LAB rejects internal dips and waits for the last departure peak", () => {
  const samples = series();
  samples.find((sample) => sample.timestamp === midnight + (closeMinute + 8) * minute).soundMax = 90;
  assert.equal(resolve(samples), midnight + (closeMinute + 10) * minute);
});

test("LAB does not infer departure from one isolated spike, missing data, or an unobserved boundary", () => {
  const isolated = series().map((sample) => ({ ...sample, soundMax: 70 }));
  isolated.find((sample) => sample.timestamp === midnight + (closeMinute - 2) * minute).soundMax = 92;
  assert.equal(resolve(isolated), null);
  const missing = series();
  missing.find((sample) => sample.timestamp === midnight + (closeMinute + 10) * minute).soundMax = null;
  assert.equal(resolve(missing), null);
  assert.equal(resolve(series().filter((sample) => sample.timestamp < midnight + (closeMinute - 4) * minute || sample.timestamp >= midnight + (closeMinute + 4) * minute)), null);
});
