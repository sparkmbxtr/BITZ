import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/airq/route.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");

test("OFFICE is the landing room and both rooms use one shared graph renderer", () => {
  assert.match(page, /useState<RoomName>\("OFFICE"\)/);
  assert.match(page, /\(\["OFFICE", "LAB"\] as const\)\.map/);
  assert.match(page, /className="room-switcher"/);
  assert.match(page, /<RoomGraphs room=\{room\}/);
  assert.equal((page.match(/<RoomGraphs room=/g) ?? []).length, 1);
  assert.match(page, /lab: normalizeRoom\(payload\.rooms\?\.lab, "LAB"\)/);
  assert.match(page, /office: normalizeRoom\(payload\.rooms\?\.office, "OFFICE"\)/);
});

test("the dashboard contains exactly the five full-screen graph definitions", () => {
  for (const title of [
    "TVOC / HCHO",
    "CO₂ / ABSOLUTE HUMIDITY",
    "TEMPERATURE / RELATIVE HUMIDITY",
    "OXYGEN / CO",
    "PARTICLES / SOUND MAX",
  ]) assert.match(page, new RegExp(title));
  assert.equal((page.match(/title: "/g) ?? []).length, 5);
  assert.match(css, /grid-template-rows: repeat\(5, minmax\(142px, 1fr\)\)/);
});

test("predictive and personnel-facing surfaces are absent", () => {
  assert.doesNotMatch(page, /statusLabel|room\.checks|room\.summary|room\.action|prediction|meaningful action|warning card|calculated alert|evacuate|occupancy|peopleRange|STATE1|STATE2|HEPA STATUS|AIRFLOW CHANGE/i);
  assert.doesNotMatch(css, /meaningful-action|warning-card|alert-card|evacuation|occupancy|hepa-status|airflow-status/i);
  assert.doesNotMatch(route, /analyseRoom|statusLabel|checks:|summary:|action:|Propane-associated/i);
});

test("one unavailable room cannot suppress the other room", () => {
  assert.match(route, /Promise\.allSettled/);
  assert.match(route, /labResult\.status === "fulfilled" \? labResult\.value : \[\]/);
  assert.match(route, /officeResult\.status === "fulfilled" \? officeResult\.value : \[\]/);
  assert.match(route, /if \(!range\.exact && !labHistory\.length && !officeHistory\.length\)/);
  assert.match(route, /if \(range\.exact && \(!labHistory\.length \|\| !officeHistory\.length\)\)/);
});

test("public-facing identity is neutral", () => {
  assert.match(layout, /title: "BITZ Air Monitoring"/);
  for (const source of [page, css, layout]) assert.doesNotMatch(source, /SPARK|RICHARD|sparkmbxtr/i);
});
