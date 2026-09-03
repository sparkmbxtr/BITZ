import { env } from "cloudflare:workers";
import { apiKeyFromRequest, isAuthorized } from "@/lib/dashboard-auth";
import { readStoredApiKey } from "@/lib/airq-key-store";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type RawRecord = Record<string, unknown>;
type Level = "normal" | "watch" | "action" | "unknown";

type Sample = {
  timestamp: number;
  temperature: number | null;
  humidity: number | null;
  humidityAbs: number | null;
  co2: number | null;
  co: number | null;
  oxygen: number | null;
  tvoc: number | null;
  hcho: number | null;
  pm1: number | null;
  pm25: number | null;
  pm10: number | null;
  sound: number | null;
  soundMax: number | null;
  health: number | null;
  performance: number | null;
};

const API_ROOT = "https://air-q-cloud.de/open_api/v3";
const HISTORY_HOURS = 24;
const ANALYSIS_MINUTES = 60;

function numberValue(record: RawRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function normalize(record: RawRecord): Sample | null {
  const timestamp = numberValue(record, "timestamp");
  if (!timestamp) return null;
  const healthRaw = numberValue(record, "health");
  const performanceRaw = numberValue(record, "performance");
  return {
    timestamp,
    temperature: numberValue(record, "temperature"),
    humidity: numberValue(record, "humidity"),
    humidityAbs: numberValue(record, "humidity_abs"),
    co2: numberValue(record, "co2"),
    co: numberValue(record, "co"),
    oxygen: numberValue(record, "oxygen"),
    tvoc: numberValue(record, "tvoc"),
    hcho: numberValue(record, "ch2o_m10", "hcho"),
    pm1: numberValue(record, "pm1"),
    pm25: numberValue(record, "pm2_5", "pm25"),
    pm10: numberValue(record, "pm10"),
    sound: numberValue(record, "sound"),
    soundMax: numberValue(record, "sound_max"),
    health: healthRaw === null ? null : healthRaw / 10,
    performance: performanceRaw === null ? null : performanceRaw / 10,
  };
}

function values(samples: Sample[], selector: (sample: Sample) => number | null) {
  return samples.map(selector).filter((value): value is number => value !== null && Number.isFinite(value));
}

function maxValue(samples: Sample[], selector: (sample: Sample) => number | null) {
  const list = values(samples, selector);
  return list.length ? Math.max(...list) : null;
}

function minValue(samples: Sample[], selector: (sample: Sample) => number | null) {
  const list = values(samples, selector);
  return list.length ? Math.min(...list) : null;
}

function delta(samples: Sample[], selector: (sample: Sample) => number | null) {
  const list = values(samples, selector);
  return list.length > 1 ? list.at(-1)! - list[0] : null;
}

function check(label: string, method: "DIRECT" | "PROXY" | "PATTERN" | "RAW" | "SYSTEM", status: string, level: Level) {
  return { label, method, status, level };
}

function worst(levels: Level[]): Level {
  const order: Level[] = ["normal", "unknown", "watch", "action"];
  return levels.reduce((current, level) => order.indexOf(level) > order.indexOf(current) ? level : current, "normal");
}

function positiveNumber(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function occupancyEstimate(samples: Sample[], volumeM3: number | null, airChangesPerHour: number | null) {
  if (!volumeM3 || !airChangesPerHour || samples.length < 4) {
    return { label: "CO₂ activity trend", confidence: "occupancy estimate not displayed" };
  }
  const first = samples[0];
  const last = samples.at(-1)!;
  if (first.co2 === null || last.co2 === null) return { label: "unavailable", confidence: "CO₂ missing" };
  const hours = Math.max((last.timestamp - first.timestamp) / 3_600_000, 0.25);
  const meanPpm = (first.co2 + last.co2) / 2;
  const accumulation = ((last.co2 - first.co2) * 1e-6) / hours;
  const ventilation = airChangesPerHour * Math.max(0, meanPpm - 430) * 1e-6;
  const generationM3PerHour = Math.max(0, volumeM3 * (accumulation + ventilation));
  const people = generationM3PerHour / 0.016;
  const low = Math.max(0, Math.floor(people * 0.65));
  const high = Math.max(low + 1, Math.ceil(people * 1.45));
  return { label: `${low}–${high} likely`, confidence: high - low <= 3 ? "medium confidence" : "low confidence" };
}

function analyseRoom(name: "LAB" | "OFFICE", history: Sample[], volumeM3: number | null, ach: number | null) {
  const latest = history.at(-1) ?? null;
  const recentStart = (latest?.timestamp ?? Date.now()) - ANALYSIS_MINUTES * 60_000;
  const recent = history.filter((sample) => sample.timestamp >= recentStart);
  const dataAge = latest ? Date.now() - latest.timestamp : Infinity;
  const o2Min = minValue(recent, (sample) => sample.oxygen);
  const coMax = maxValue(recent, (sample) => sample.co);
  const tvocMax = maxValue(recent, (sample) => sample.tvoc);
  const hchoMax = maxValue(recent, (sample) => sample.hcho);
  const pm25Max = maxValue(recent, (sample) => sample.pm25);
  const soundMax = maxValue(recent, (sample) => sample.soundMax);
  const co2Max = maxValue(recent, (sample) => sample.co2);
  const tvocDelta = delta(recent, (sample) => sample.tvoc);
  const co2Delta = delta(recent, (sample) => sample.co2);
  const pmDelta = delta(recent, (sample) => sample.pm25);
  const humidityDelta = delta(recent, (sample) => sample.humidityAbs);

  const freshness = dataAge <= 8 * 60_000
    ? check("Sensor/data integrity", "SYSTEM", "CURRENT", "normal")
    : check("Sensor/data integrity", "SYSTEM", "DATA STALE", "unknown");
  const oxygen = o2Min === null
    ? check("O₂ displacement", "PROXY", "UNAVAILABLE", "unknown")
    : o2Min < 19.5
      ? check("O₂ displacement", "PROXY", "CHECK NOW", "action")
      : o2Min < 20.0
        ? check("O₂ displacement", "PROXY", "WATCH", "watch")
        : check("O₂ displacement", "PROXY", "NOT INDICATED", "normal");
  const carbonMonoxide = coMax === null
    ? check("CO release", "DIRECT", "UNAVAILABLE", "unknown")
    : coMax >= 23
      ? check("CO release", "DIRECT", "CHECK NOW", "action")
      : coMax >= 5
        ? check("CO release", "DIRECT", "ELEVATED", "watch")
        : check("CO release", "DIRECT", "NO ELEVATION", "normal");
  const vapour = tvocMax === null
    ? check("Volatile-gas pattern", "PATTERN", "UNAVAILABLE", "unknown")
    : tvocMax > 1_000 || (tvocDelta ?? 0) > 500
      ? check("Volatile-gas pattern", "PATTERN", "VERIFY SOURCE", "watch")
      : check("Volatile-gas pattern", "PATTERN", "NORMAL", "normal");
  const formaldehyde = hchoMax === null
    ? check("Formaldehyde elevation", "DIRECT", "UNAVAILABLE", "unknown")
    : hchoMax > 100
      ? check("Formaldehyde elevation", "DIRECT", "ELEVATED", "watch")
      : check("Formaldehyde elevation", "DIRECT", "NOT DETECTED", "normal");
  const particles = pm25Max === null
    ? check("Particle plume", "DIRECT", "UNAVAILABLE", "unknown")
    : pm25Max > 35 || (pmDelta ?? 0) > 15
      ? check("Particle plume", "DIRECT", "PLUME PATTERN", "watch")
      : check("Particle plume", "DIRECT", "NONE", "normal");
  const carbonDioxide = co2Max === null
    ? check("CO₂ accumulation", "PATTERN", "UNAVAILABLE", "unknown")
    : co2Max > 1_400 || (co2Delta ?? 0) > 450
      ? check("CO₂ accumulation", "PATTERN", "VENTILATE/CHECK", "watch")
      : check("CO₂ accumulation", "PATTERN", "STABLE", "normal");
  const acoustics = soundMax === null
    ? check("Sound peak >90 dB", "RAW", "UNAVAILABLE", "unknown")
    : soundMax > 90
      ? check("Sound peak >90 dB", "RAW", `${soundMax.toFixed(0)} dB EVENT`, "watch")
      : check("Sound peak >90 dB", "RAW", "NONE", "normal");

  const checks = [carbonMonoxide, oxygen, vapour, formaldehyde, particles, carbonDioxide, acoustics, freshness];
  const rawStatus = worst(checks.map((item) => item.level));
  const status = rawStatus === "unknown" && freshness.level === "normal" ? "normal" : rawStatus;
  const gasDominant = (tvocDelta ?? 0) > 150 && (pmDelta ?? 0) < 5;
  const occupancyPattern = (co2Delta ?? 0) > 80 && (humidityDelta ?? 0) > 0.15;
  const ventilationPattern = name === "OFFICE" && (co2Delta ?? 0) < -80 && ((pmDelta ?? 0) > 3 || (tvocDelta ?? 0) > 100);

  let summary = "The recent pattern is stable across the available channels.";
  if (gasDominant && name === "LAB") summary = "A gas-dominant change without a matching particle rise supports an internal vapour, process or airflow explanation; compound identity remains unresolved.";
  else if (ventilationPattern) summary = "Falling CO₂ with rising PM or VOC supports recent outdoor-air exchange; window state would strengthen the attribution.";
  else if (occupancyPattern) summary = "CO₂ and absolute humidity rose together, supporting an occupancy-related change rather than a single chemical event.";
  else if ((co2Delta ?? 0) > 80) summary = "CO₂ rose gradually while critical gas and particle channels stayed comparatively stable; routine occupancy is plausible.";

  const action = status === "action"
    ? "Follow the room procedure and verify the indicated source with an appropriate dedicated instrument."
    : status === "watch"
      ? "Check the indicated condition; persistence in the next 10–30 minutes would strengthen the need for intervention."
      : "None now. Reassess only if the pattern reverses, persists or gains an independent corroborating channel.";

  return {
    name,
    status,
    statusLabel: status === "normal" ? "AVAILABLE CHANNELS NORMAL" : status === "watch" ? "NOTABLE PATTERN — CHECK" : status === "action" ? "ACTIONABLE CONDITION" : "DATA DELAY — CHECK CONNECTION",
    samples: history,
    latest,
    checks,
    occupancy: occupancyEstimate(recent, volumeM3, ach),
    summary,
    action,
  };
}

async function fetchRoom(deviceId: string, apiKey: string) {
  const to = Date.now();
  const from = to - HISTORY_HOURS * 60 * 60_000;
  const url = new URL(`${API_ROOT}/devices/${encodeURIComponent(deviceId)}/sensordata/timerange`);
  url.searchParams.set("f", String(from));
  url.searchParams.set("t", String(to));
  const response = await fetch(url, { headers: { "Api-Key": apiKey, Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error("air-Q request failed");
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error("Unexpected air-Q response");
  return payload
    .map((record) => normalize(record as RawRecord))
    .filter((sample): sample is Sample => sample !== null)
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter((sample, index, list) => index === 0 || sample.timestamp !== list[index - 1].timestamp);
}

export async function GET(request: Request) {
  const runtimeEnv = env as unknown as Record<string, unknown>;
  const sessionSecret = runtimeEnv.DASHBOARD_SESSION_SECRET;
  if (typeof sessionSecret !== "string" || !await isAuthorized(request, sessionSecret)) {
    return Response.json({ error: "Authorization required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const environmentKey = runtimeEnv.AIRQ_API_KEY;
  const apiKey = typeof environmentKey === "string"
    ? environmentKey
    : await readStoredApiKey(sessionSecret).catch(() => null) ?? await apiKeyFromRequest(request, sessionSecret);
  const labId = runtimeEnv.AIRQ_LAB_DEVICE_ID;
  const officeId = runtimeEnv.AIRQ_OFFICE_DEVICE_ID;
  if (typeof apiKey !== "string" || typeof labId !== "string" || typeof officeId !== "string") {
    return Response.json({ error: "Live air-Q connection is not configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const [labHistory, officeHistory] = await Promise.all([fetchRoom(labId, apiKey), fetchRoom(officeId, apiKey)]);
    if (!labHistory.length || !officeHistory.length) throw new Error("No recent records returned");
    return Response.json({
      live: true,
      fetchedAt: Date.now(),
      historyHours: HISTORY_HOURS,
      analysisMinutes: ANALYSIS_MINUTES,
      rooms: {
        lab: analyseRoom("LAB", labHistory, positiveNumber(runtimeEnv.LAB_VOLUME_M3), positiveNumber(runtimeEnv.LAB_ACH)),
        office: analyseRoom("OFFICE", officeHistory, positiveNumber(runtimeEnv.OFFICE_VOLUME_M3), positiveNumber(runtimeEnv.OFFICE_ACH)),
      },
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    return Response.json({ error: "Recent air-Q readings are temporarily unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
