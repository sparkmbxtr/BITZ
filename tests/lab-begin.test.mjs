import assert from "node:assert/strict";
import test from "node:test";
import { loadActivityModule } from "./helpers/activity-module.mjs";

const { activityCycles } = loadActivityModule();
const minute = 60_000;

// Synthetic regression fixtures only: no private measurements or context.
function series({ date = "2026-09-12", begin = 10 * 60 + 44, end = begin + 80,
  sound = "repeated", gas = "rise", delay = 0, drift = false } = {}) {
  const midnight = Date.parse(`${date}T00:00:00+02:00`);
  return Array.from({ length: Math.floor(end / 2) + 1 }, (_, index) => {
    const t = index * 2;
    const elapsed = Math.max(0, Math.min(60, t - begin - delay + 2));
    const ambient = drift ? Math.max(0, t - 360) : 0;
    const peak = t >= begin && t <= begin + 12 &&
      (sound === "sustained" || (sound === "repeated" && (t - begin) % 4 === 0) ||
       (sound === "single" && t === begin));
    return {
      timestamp: midnight + t * minute,
      co2: 800 - ambient * .25 + (gas === "rise" || gas === "co2" ? elapsed * 1.5 : 0),
      humidityAbs: 7 + ambient * .0015 + (gas === "rise" || gas === "humidity" ? elapsed * .004 : 0),
      temperature: 19 + ambient * .0025, tvoc: 50 + ambient * .5,
      sound: 68, soundMax: sound === "missing" ? null : peak ? 90 : 70,
      hcho: 3, pm1: .1, pm25: .2, pm4: .2, pm10: .2, oxygen: 20.6,
      humidity: 45, dewpt: 7, co: .2, health: 90, performance: 90,
    };
  });
}

const begins = (samples, room = "LAB") => activityCycles(samples, room).filter((cycle) => cycle.begin !== null);
const expected = (date, t) => Date.parse(`${date}T00:00:00+02:00`) + t * minute;

test("silent environmental drift cannot create LAB BEGIN on weekdays or weekends", () => {
  for (const date of ["2026-09-11", "2026-09-12", "2026-09-13"]) {
    assert.equal(begins(series({ date, begin: 7 * 60, sound: "quiet", gas: "none", drift: true })).length, 0, date);
  }
});

test("even a coordinated chemical rise cannot bypass the LAB sound requirement", () => {
  for (const sound of ["quiet", "missing"]) {
    assert.equal(begins(series({ sound, drift: true })).length, 0);
  }
});

test("one isolated sound-max peak cannot establish LAB occupancy", () => {
  assert.equal(begins(series({ sound: "single" })).length, 0);
});

test("repeated noise alone or noise with ongoing ambient drift is not LAB BEGIN", () => {
  for (const drift of [false, true]) assert.equal(begins(series({ gas: "none", drift })).length, 0);
});

test("existing positive CO2/humidity trends are not a new entry when noise starts", () => {
  const samples = series({ gas: "none" }).map((point, index) => ({
    ...point, co2: 800 + index * .5, humidityAbs: 7 + index * .003,
  }));
  assert.equal(begins(samples).length, 0);
});

test("falling CO2 plus temperature/VOC changes cannot corroborate entry", () => {
  const samples = series({ gas: "none" }).map((point) => {
    const elapsed = Math.max(0, (point.timestamp - expected("2026-09-12", 644)) / minute);
    return { ...point, co2: 800 - elapsed, temperature: 19 + elapsed * .05, tvoc: 50 + elapsed * 3 };
  });
  assert.equal(begins(samples).length, 0);
});

test("a sustained visit uses the first changed raw sound sample, not an earlier forward window", () => {
  for (const sound of ["repeated", "sustained"]) {
    const visits = begins(series({ sound }));
    assert.equal(visits.length, 1);
    assert.equal(visits[0].begin, expected("2026-09-12", 644));
    assert.equal(visits[0].beginMethod, "ACOUSTIC");
  }
});

test("quiet average sound does not erase repeated corroborated sound-max activity", () => {
  const samples = series();
  assert.ok(samples.every((point) => point.sound === 68));
  assert.equal(begins(samples)[0].begin, expected("2026-09-12", 644));
});

test("each LAB day uses its own baseline and keeps weekday/weekend onset identical", () => {
  for (const date of ["2026-09-11", "2026-09-12", "2026-09-13"]) {
    assert.equal(begins(series({ date, begin: 7 * 60 + 18 }))[0].begin, expected(date, 438));
  }
});

test("a nearby chemical response can confirm entry without moving its acoustic timestamp", () => {
  assert.equal(begins(series({ delay: 4 }))[0].begin, expected("2026-09-12", 644));
});

test("a much later chemical event cannot retrospectively turn an earlier noise into entry", () => {
  assert.equal(begins(series({ delay: 30 })).length, 0);
});

test("either positive CO2 or absolute humidity can corroborate a repeated LAB sound onset", () => {
  for (const gas of ["co2", "humidity"]) {
    assert.equal(begins(series({ gas }))[0].begin, expected("2026-09-12", 644));
  }
});

test("a missing, non-finite, or gapped confirmation window fails closed", () => {
  const at = expected("2026-09-12", 650);
  for (const invalid of [null, NaN, Infinity]) {
    const samples = series().map((point) => point.timestamp === at ? { ...point, soundMax: invalid } : point);
    assert.equal(begins(samples).length, 0);
  }
  const gap = series().filter((point) => point.timestamp < expected("2026-09-12", 640) || point.timestamp >= expected("2026-09-12", 648));
  assert.equal(begins(gap).length, 0);
});

test("no night reference and duplicate timestamps cannot manufacture a supported onset", () => {
  assert.equal(begins(series().filter((point) => point.timestamp >= expected("2026-09-12", 600))).length, 0);
  const duplicate = series().flatMap((point) => [point, { ...point }]);
  assert.equal(begins(duplicate).length, 0);
});

test("confirmation delays publication, never shifts the recorded BEGIN timestamp", () => {
  assert.equal(begins(series({ end: 654 })).length, 0);
  for (const end of [660, 662, 680, 724]) {
    assert.equal(begins(series({ end }))[0].begin, expected("2026-09-12", 644));
  }
});

test("chronological sorting does not change a validated onset", () => {
  assert.equal(begins(series().reverse())[0].begin, expected("2026-09-12", 644));
});

test("weekend people uncertainty remains 0–1, not a fabricated one person", () => {
  const visit = begins(series({ gas: "humidity" }))[0];
  assert.equal(visit.peopleRange, "0–1");
});

test("Saturday's two-person prior never forces a count or caps stronger evidence", () => {
  const samples = series().map((point) => ({ ...point, co2: (point.co2 - 800) * 5 + 800 }));
  assert.notEqual(begins(samples)[0].peopleRange, "1–2");
  assert.equal(begins(series({ end: 670 }))[0].peopleRange, null);
});

test("LAB evidence never creates an OFFICE BEGIN when OFFICE is quiet", () => {
  assert.equal(begins(series()).length, 1);
  assert.equal(begins(series({ sound: "quiet", gas: "none" }), "OFFICE").length, 0);
});
