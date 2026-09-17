import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTypeScriptModule } from "./helpers/typescript-module.mjs";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

const api = loadTypeScriptModule(new URL("../app/api/airq/route.ts", import.meta.url), {
  append: "\nexports.analyseRoomForTest = analyseRoom;",
  globals: {
    require: (name) => {
      if (name === "cloudflare:workers") return { env: {} };
      if (name === "@/lib/dashboard-auth") return {
        apiKeyFromRequest: () => null,
        isAuthorized: async () => false,
        isBearerAuthorized: async () => false,
      };
      if (name === "@/lib/airq-key-store") return { readStoredApiKey: async () => null };
      if (name === "@/lib/github-actions-oidc") return { isGitHubActionsExportAuthorized: async () => false };
      throw new Error(`Unexpected import: ${name}`);
    },
  },
});

function observations({ tvoc = 30, hcho = 2 } = {}) {
  const now = Date.now();
  return Array.from({ length: 31 }, (_, index) => ({
    timestamp: now - (30 - index) * 2 * 60_000,
    temperature: 20,
    humidity: 45,
    humidityAbs: 8,
    co2: 500,
    co: 0.2,
    oxygen: 20.6,
    tvoc: index < 15 ? 30 : tvoc,
    hcho: index < 15 ? 2 : hcho,
    pm1: 0.1,
    pm25: 0.2,
    pm4: 0.2,
    pm10: 0.3,
    pressure: 1_010,
    pressureRel: 1_010,
    dewpt: 8,
    dco2dt: 0,
    dhdt: 0,
    sound: 40,
    soundMax: 50,
    health: 10,
    performance: 10,
  }));
}

test("TVOC and HCHO cannot change room status, summary, or meaningful action", () => {
  for (const roomName of ["LAB", "OFFICE"]) {
    const baseline = api.analyseRoomForTest(roomName, observations());
    const excursion = api.analyseRoomForTest(roomName, observations({ tvoc: 50_000, hcho: 5_000 }));
    assert.equal(excursion.status, "normal", roomName);
    assert.equal(excursion.status, baseline.status, roomName);
    assert.equal(excursion.statusLabel, baseline.statusLabel, roomName);
    assert.equal(excursion.summary, baseline.summary, roomName);
    assert.equal(excursion.action, baseline.action, roomName);
    assert.doesNotMatch(`${excursion.summary} ${excursion.action}`, /TVOC|HCHO|formaldehyde|vapou?r/i, roomName);
    assert.equal(excursion.checks.some((check) => /volatile|formaldehyde/i.test(check.label)), false, roomName);
    assert.equal(excursion.latest.tvoc, 50_000, roomName);
    assert.equal(excursion.latest.hcho, 5_000, roomName);
  }
});

test("TVOC and HCHO chart markings remain while the TVOC cards stay green", () => {
  assert.match(page, /TrendRow label="TVOC \/ HCHO"[\s\S]*?gradeFor=\{tvocGrade\}/);
  assert.match(page, /OfficePairTrend label="TVOC \/ HCHO"[\s\S]*?gradeFor=\{tvocGrade\}/);
  assert.equal((page.match(/grade=\{displayOnlyGasGrade\(latest\?\.tvoc \?\? null\)\}/g) ?? []).length, 2);
  assert.match(page, /\{ label: "MEASURED", level: "great" \}/);
});
