import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTypeScriptModule } from "./helpers/typescript-module.mjs";

const {
  HISTORY_MS, INDOOR_GAP_MS, OUTDOOR_GAP_MS, chronologicalByTimestamp,
  historySeries, isFreshReading, latestReading, observationWindow,
  referenceZones, samplesInWindow, scaleFor,
} = loadTypeScriptModule(new URL("../lib/history-graph.ts", import.meta.url));
const { HistoryGraph, GraphPanel, RoomGraphs, graphDefinitions, normalizeDashboardData, timeTicks } = loadTypeScriptModule(
  new URL("../app/page.tsx", import.meta.url),
  { append: "\nexport { HistoryGraph, GraphPanel, RoomGraphs, graphDefinitions, normalizeDashboardData, timeTicks };" },
);

const MINUTE = 60_000;
const to = Date.UTC(2026, 9, 28, 11, 0);
const from = to - 24 * 60 * MINUTE;
const timeWindow = { from, to };
const copy = (value) => JSON.parse(JSON.stringify(value));
const at = (minutes) => from + minutes * MINUTE;

function sample(minutes, overrides = {}) {
  return {
    timestamp: at(minutes), temperature: 21, humidity: 45, humidityAbs: 8,
    dewpt: null, co2: 800, co: 0, oxygen: 20.9, tvoc: 120, hcho: 12,
    pm1: 1, pm25: 2, pm4: 3, pm10: 4, sound: 40, soundMax: 50,
    health: null, performance: null, ...overrides,
  };
}

// Synthetic measurements only. Different room cadences, channel-specific nulls,
// long outages, duplicates, and a fresh row whose CO2 channel is still stale.
const labSamples = [
  sample(1438, { co2: null }), sample(184, { co2: 1_000 }),
  sample(180, { co2: 800, soundMax: 95 }), sample(70, { co2: 1_400 }),
  sample(68, { co2: 1_300, pm1: null, pm25: null, pm4: null, pm10: null }),
  sample(65, { co2: null }), sample(62, { co2: 1_100 }), sample(60, { co2: 900 }),
];
const officeSamples = [
  sample(720, { co2: 600 }), sample(721.5, { co2: 700 }),
  sample(725.5, { co2: 900, pm1: null, pm25: null, pm4: null, pm10: null }),
  sample(1000, { co2: 1_000 }), sample(1004.5, { co2: null }),
  sample(1439, { co2: 650, pm1: 0, pm25: 0, pm4: 0, pm10: 0 }),
];
const dashboard = normalizeDashboardData({
  live: true, fetchedAt: to + 45_000, historyHours: 24, analysisMinutes: 60,
  coverage: { ...timeWindow, exact: false },
  rooms: {
    lab: { name: "LAB", samples: labSamples, latest: labSamples[0] },
    office: { name: "OFFICE", samples: officeSamples, latest: officeSamples.at(-1) },
  },
});

function definition(room, title = "CO₂ / ABSOLUTE HUMIDITY", outdoor = null) {
  return graphDefinitions(room, outdoor).find((item) => item.title === title);
}

function render(component, props) {
  return renderToStaticMarkup(React.createElement(component, {
    analysisMinutes: 60, outdoor: null, timeWindow, now: to, ...props,
  }));
}

function pathFor(html, className) {
  const tag = (html.match(/<path\b[^>]*>/g) ?? []).find((item) => item.includes(`class="${className}"`));
  return tag?.match(/\bd="([^"]*)"/)?.[1] ?? "";
}

function commands(path) {
  return [...path.matchAll(/([ML])(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)]
    .map(([, command, x, y]) => ({ command, x: Number(x), y: Number(y) }));
}

test("API coverage anchors the full 24 hours, independent of fetch time, cache age, room, or sample count", () => {
  assert.deepEqual(copy(observationWindow(dashboard, to + 10 * MINUTE)), timeWindow);
  for (const room of Object.values(dashboard.rooms)) {
    const html = render(HistoryGraph, { samples: room.samples, definition: definition(room.name) });
    const points = commands(pathFor(html, "sensor-line sensor-line-primary"));
    assert.ok(points[0].x > 0);
    assert.ok(points.at(-1).x < 100);
    assert.match(html, /27\/10, 12:00 to 28\/10, 12:00/);
    assert.match(html, /x="95\.83333333333334"[^>]*class="recent-period"/);
  }
  assert.deepEqual(copy(observationWindow({ fetchedAt: to }, to + MINUTE)), timeWindow);
  assert.deepEqual(copy(observationWindow({ fetchedAt: 0 }, to)), timeWindow);
  assert.deepEqual(copy(observationWindow({ coverage: { from: NaN, to }, fetchedAt: to }, to)), timeWindow);
  assert.deepEqual(copy(observationWindow({ coverage: { from: to, to: from }, fetchedAt: to }, to)), timeWindow);
});

test("sparse and single readings keep their actual horizontal positions", () => {
  const sparse = [sample(720), sample(723, { co2: 900 })];
  const html = render(HistoryGraph, { samples: sparse, definition: definition("LAB") });
  const points = commands(pathFor(html, "sensor-line sensor-line-primary"));
  assert.deepEqual(points.map(({ command, x }) => [command, x]), [["M", 50], ["L", 50.21]]);
  const single = render(HistoryGraph, { samples: [sample(360)], definition: definition("OFFICE") });
  assert.match(single, /<circle cx="25"[^>]*class="sensor-point sensor-point-primary"/);
  assert.doesNotMatch(single, /class="sensor-current"/);
  assert.doesNotMatch(single, /NO DATA IN WINDOW/);
});

test("irregular LAB and OFFICE readings break at channel nulls and extended outages without resampling CO2 or PM", () => {
  for (const room of Object.values(dashboard.rooms)) {
    for (const title of ["CO₂ / ABSOLUTE HUMIDITY", "PARTICLES / SOUND MAX"]) {
      const graph = definition(room.name, title);
      const series = historySeries(room.samples, graph.primary, timeWindow, { min: 0, max: 1_500 });
      const expected = room.samples.filter((item) => graph.primary(item) !== null);
      const points = series.segments.flat();
      assert.deepEqual(Array.from(points, (point) => point.timestamp), Array.from(expected, (item) => item.timestamp));
      assert.deepEqual(Array.from(points, (point) => point.value), Array.from(expected, graph.primary));
      for (const segment of series.segments) {
        for (let index = 1; index < segment.length; index += 1) {
          assert.ok(segment[index].timestamp - segment[index - 1].timestamp <= 5 * MINUTE);
          const between = room.samples.filter((item) => item.timestamp > segment[index - 1].timestamp && item.timestamp < segment[index].timestamp);
          assert.ok(between.every((item) => graph.primary(item) !== null));
        }
      }
      const rendered = commands(pathFor(render(HistoryGraph, { samples: room.samples, definition: graph }), "sensor-line sensor-line-primary"));
      assert.equal(rendered.filter((point) => point.command === "M").length, series.segments.length);
      assert.equal(rendered.length, expected.length);
    }
  }
});

test("a null breaks only its own metric, while the other trace stays continuous", () => {
  const rows = [sample(60), sample(62, { co2: null }), sample(64)];
  const html = render(HistoryGraph, { samples: rows, definition: definition("LAB") });
  assert.deepEqual(commands(pathFor(html, "sensor-line sensor-line-primary")).map((point) => point.command), ["M", "M"]);
  assert.deepEqual(commands(pathFor(html, "sensor-line sensor-line-secondary")).map((point) => point.command), ["M", "L", "L"]);
  assert.equal((html.match(/class="sensor-point sensor-point-primary"/g) ?? []).length, 2);
});

test("five-minute continuity is bounded even for very sparse data and treats zero as a measurement", () => {
  const rows = [sample(60, { co2: 0 }), sample(65), sample(70 + 1 / 60), sample(1000)];
  const series = historySeries(rows, (item) => item.co2, timeWindow, { min: 0, max: 800 });
  assert.equal(INDOOR_GAP_MS, 5 * MINUTE);
  assert.deepEqual(Array.from(series.segments, (segment) => segment.length), [2, 1, 1]);
  assert.equal(series.segments[0][0].value, 0);
  const sparse = historySeries([sample(60), sample(1000)], (item) => item.co2, timeWindow, { min: 0, max: 800 });
  assert.deepEqual(Array.from(sparse.segments, (segment) => segment.length), [1, 1]);
});

test("nonfinite/missing values create gaps; invalid and duplicate timestamps cannot reorder paths", () => {
  const rows = [sample(64), sample(60), sample(62, { co2: NaN }), sample(66, { co2: Infinity }),
    sample(68), sample(70, { co2: undefined }), sample(72), sample(60, { co2: 950 }),
    sample(63, { timestamp: NaN }), sample(63, { timestamp: Infinity })];
  const normalized = chronologicalByTimestamp(rows);
  assert.equal(normalized[0].co2, 950);
  assert.deepEqual(Array.from(normalized, (item) => item.timestamp), [60, 62, 64, 66, 68, 70, 72].map(at));
  const series = historySeries(rows, (item) => item.co2, timeWindow, { min: 800, max: 950 });
  assert.deepEqual(Array.from(series.segments, (segment) => segment.length), [1, 1, 1, 1]);
  assert.doesNotMatch(series.path, /NaN|Infinity/);
});

test("out-of-window and future supplemental readings affect neither plot positions nor scales", () => {
  const rows = [sample(-60, { co2: 10_000 }), sample(720), sample(723, { co2: 900 }), sample(1441, { co2: 20_000 })];
  const visible = samplesInWindow(rows, timeWindow);
  assert.deepEqual(Array.from(visible, (item) => item.timestamp), [at(720), at(723)]);
  const html = render(HistoryGraph, { samples: rows, definition: definition("OFFICE") });
  assert.doesNotMatch(html, /10,000|20,000/);
  assert.deepEqual(copy(latestReading(rows, (item) => item.co2, to)), { timestamp: at(723), value: 900 });
  const endpoints = historySeries([sample(0), sample(1440)], (item) => item.co2, timeWindow, { min: 800, max: 800 });
  assert.deepEqual(Array.from(endpoints.isolated, (point) => point.x), [0, 100]);
  assert.doesNotMatch(endpoints.path, /NaN|Infinity/);
});

test("threshold bands stop at measured segment boundaries and never colour a missing interval", () => {
  const rows = [sample(60, { co2: 900 }), sample(62, { co2: 1_100 }), sample(64, { co2: 1_500 }),
    sample(65, { co2: null }), sample(68, { co2: 1_600 }), sample(70, { co2: 1_600 }), sample(600)];
  const graph = definition("LAB");
  const series = historySeries(rows, graph.primary, timeWindow, { min: 0, max: 1_600 });
  const zones = referenceZones(series.segments, graph.band);
  assert.deepEqual(Array.from(new Set(zones.map((zone) => zone.band))), ["base", "middle", "upper"]);
  for (const zone of zones) {
    assert.ok(series.segments.some((segment) => zone.from >= segment[0].x && zone.to <= segment.at(-1).x));
    assert.ok(zone.from >= (60 / 1440) * 100 && zone.to <= (70 / 1440) * 100);
  }
  const html = render(HistoryGraph, { samples: rows, definition: graph });
  assert.match(html, /class="reference-band band-unknown"/);
  assert.match(html, /class="reference-band band-upper"/);
  const renderedZones = (html.match(/<rect\b[^>]*class="reference-band band-(?:base|middle|upper)"[^>]*>/g) ?? [])
    .map((tag) => ({ from: Number(tag.match(/\bx="([^"]*)"/)[1]), width: Number(tag.match(/\bwidth="([^"]*)"/)[1]) }));
  assert.equal(renderedZones.length, zones.length);
  for (let index = 0; index < zones.length; index += 1) {
    assert.ok(Math.abs(renderedZones[index].from - zones[index].from) < 1e-9);
    assert.ok(Math.abs(renderedZones[index].width - (zones[index].to - zones[index].from)) < 1e-9);
  }
  const particles = render(HistoryGraph, { samples: labSamples, definition: definition("LAB", "PARTICLES / SOUND MAX") });
  assert.equal((particles.match(/class="raw-marker"/g) ?? []).length, 1);
});

test("a fresh row cannot make an older channel look current; timestamps and ages remain channel-specific", () => {
  const rows = [sample(1420, { co2: 1_200 }), sample(1439, { co2: null })];
  const room = { name: "LAB", samples: rows, latest: rows.at(-1) };
  const html = render(GraphPanel, { room, definition: definition("LAB") });
  assert.ok(isFreshReading(room.latest, to));
  assert.ok(!isFreshReading(latestReading(rows, (item) => item.co2, to), to));
  assert.match(html, new RegExp(`dateTime="${new Date(at(1420)).toISOString()}"`, "i"));
  assert.match(html, /STALE · 20 MIN/);
  assert.match(html, /Last measured 28\/10, 11:40 Europe\/Berlin/);
  assert.doesNotMatch(html, /class="sensor-current"/);
  assert.match(html, />1 MIN<\/time>/);
});

test("fresh current markers expire against the clock without changing the measurement timestamp", () => {
  const row = sample(1439);
  const props = { samples: [row], definition: definition("OFFICE") };
  const fresh = render(HistoryGraph, props);
  const stale = render(HistoryGraph, { ...props, now: to + 6 * MINUTE });
  assert.match(fresh, /class="sensor-current"/);
  assert.doesNotMatch(stale, /class="sensor-current"/);
  assert.equal(pathFor(fresh, "sensor-line sensor-line-primary"), pathFor(stale, "sensor-line sensor-line-primary"));
  assert.ok(isFreshReading(row, row.timestamp + INDOOR_GAP_MS));
  assert.ok(!isFreshReading(row, row.timestamp + INDOOR_GAP_MS + 1));
  assert.ok(!isFreshReading(row, row.timestamp - 1));
});

test("a missing newest channel hides its current marker even when the preceding reading is still fresh", () => {
  const rows = [sample(1437), sample(1439, { co2: null })];
  assert.ok(isFreshReading(rows[0], to));
  const html = render(GraphPanel, { room: { name: "OFFICE", samples: rows, latest: rows.at(-1) }, definition: definition("OFFICE") });
  assert.doesNotMatch(html, /class="sensor-current"/);
  assert.ok(html.includes(new Date(rows[0].timestamp).toISOString()));
  assert.match(html, />3 MIN<\/time>/);
});

test("empty/all-null histories retain the time axis and do not invent zero readings", () => {
  for (const rows of [[], [sample(60, { co2: null, humidityAbs: null })]]) {
    const html = render(HistoryGraph, { samples: rows, definition: definition("OFFICE") });
    assert.match(html, /NO DATA IN WINDOW/);
    assert.match(html, /class="sensor-time-axis"/);
    assert.doesNotMatch(html, /class="sensor-line sensor-line-|class="sensor-current"/);
  }
  const old = sample(-30);
  const html = render(GraphPanel, { room: { name: "LAB", samples: [old], latest: old }, definition: definition("LAB") });
  assert.match(html, /NO DATA IN WINDOW/);
  assert.match(html, /STALE · 1[,.]?470 MIN|STALE · 1470 MIN/);
  assert.ok(html.includes(new Date(old.timestamp).toISOString()));
  assert.equal(scaleFor([null, undefined, NaN, Infinity]), null);
});

test("outdoor references use their own real timestamps, gaps and hourly cadence, and remain thin lines", () => {
  const outdoor = { samples: [
    { timestamp: at(45), temperature: 10, humidity: 70 },
    { timestamp: at(105), temperature: 11, humidity: 71 },
    { timestamp: at(165), temperature: null, humidity: 72 },
    { timestamp: at(225), temperature: 13, humidity: 73 },
    { timestamp: at(500), temperature: 12, humidity: 74 },
  ], latest: null };
  const html = render(HistoryGraph, { samples: [sample(60), sample(62)], outdoor,
    definition: definition("LAB", "TEMPERATURE / RELATIVE HUMIDITY", outdoor) });
  const primary = commands(pathFor(html, "outdoor-reference outdoor-reference-primary"));
  assert.deepEqual(primary.map(({ command, x }) => [command, x]), [["M", 3.13], ["L", 7.29], ["M", 15.63], ["M", 34.72]]);
  assert.deepEqual(commands(pathFor(html, "outdoor-reference outdoor-reference-secondary")).map((point) => point.command), ["M", "L", "L", "L", "M"]);
  assert.doesNotMatch(pathFor(html, "outdoor-reference outdoor-reference-primary"), /Z/);
  assert.ok(primary.every((point) => point.y >= 5 && point.y <= 28));
  assert.equal(OUTDOOR_GAP_MS, 90 * MINUTE);
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.outdoor-reference \{[^}]*fill: none;[^}]*stroke-width: \.8px/);
});

test("all five graphs in both rooms share ticks and recent-window placement, including the DST change", () => {
  for (const end of [to, Date.UTC(2026, 9, 25, 11)]) {
    const window = { from: end - HISTORY_MS, to: end };
    const axes = [];
    for (const room of Object.values(dashboard.rooms)) {
      const html = render(RoomGraphs, { room, timeWindow: window, now: end });
      assert.equal((html.match(/class="sensor-chart"/g) ?? []).length, 5);
      axes.push(...html.match(/<div class="sensor-time-axis">[\s\S]*?<\/div>/g));
      assert.equal((html.match(/x="95\.83333333333334"[^>]*class="recent-period"/g) ?? []).length, 5);
    }
    assert.equal(axes.length, 10);
    assert.equal(new Set(axes).size, 1);
    const ticks = timeTicks(window.from, window.to);
    assert.ok(ticks.every((tick) => tick.x >= 0 && tick.x <= 100));
    assert.equal(window.to - window.from, 86_400_000);
  }
});

test("a successful refresh advances coverage while sensor timestamps and stale ages stay unchanged", () => {
  const later = to + 10 * MINUTE;
  const refreshed = normalizeDashboardData({ ...dashboard, fetchedAt: later + 45_000, coverage: { from: from + 10 * MINUTE, to: later } });
  const window = observationWindow(refreshed, later);
  assert.deepEqual(copy(window), { from: from + 10 * MINUTE, to: later });
  const before = render(GraphPanel, { room: dashboard.rooms.office, definition: definition("OFFICE") });
  const after = render(GraphPanel, { room: refreshed.rooms.office, definition: definition("OFFICE"), timeWindow: window, now: later });
  const timestamp = new Date(at(1439)).toISOString();
  assert.ok(before.includes(timestamp) && after.includes(timestamp));
  assert.match(after, /STALE · 11 MIN/);
  assert.ok(commands(pathFor(after, "sensor-line sensor-line-primary")).at(-1).x < commands(pathFor(before, "sensor-line sensor-line-primary")).at(-1).x);
});
