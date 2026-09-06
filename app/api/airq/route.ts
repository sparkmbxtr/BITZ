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
  dewpt: number | null;
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

type OutdoorConditions = {
  humidity: number | null;
};

const API_ROOT = "https://air-q-cloud.de/open_api/v3";
const HISTORY_HOURS = 24;
const ANALYSIS_MINUTES = 60;
const OUTDOOR_LATITUDE = 48.7933;
const OUTDOOR_LONGITUDE = 12.6433;

function numericScalar(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const scalar = numericScalar(item);
      if (scalar !== null) return scalar;
    }
  }
  if (value && typeof value === "object") {
    const candidate = value as Record<string, unknown>;
    const scalarKeys = new Set(["value", "reading", "mean", "average", "avg", "median", "current"]);
    for (const [key, nestedValue] of Object.entries(candidate)) {
      if (!scalarKeys.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""))) continue;
      const scalar = numericScalar(nestedValue);
      if (scalar !== null) return scalar;
    }
  }
  return null;
}

function normalizedFieldName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function numberValue(record: RawRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = numericScalar(record[key]);
    if (value !== null) return value;
  }
  const aliases = new Set(keys.map(normalizedFieldName));
  for (const [recordKey, rawValue] of Object.entries(record)) {
    if (!aliases.has(normalizedFieldName(recordKey))) continue;
    const value = numericScalar(rawValue);
    if (value !== null) return value;
  }
  return null;
}

function sensorRecords(payload: unknown): RawRecord[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is RawRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  }
  if (!payload || typeof payload !== "object") return [];
  const record = payload as RawRecord;
  if (numberValue(record, "timestamp") !== null) return [record];
  for (const key of ["data", "result", "records", "sensordata", "sensor_data", "values"]) {
    const nested = record[key];
    const records = sensorRecords(nested);
    if (records.length) return records;
  }
  return [];
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
    dewpt: numberValue(record, "dewpt", "dew_point"),
    co2: numberValue(record, "co2"),
    co: numberValue(record, "co"),
    oxygen: numberValue(record, "oxygen"),
    tvoc: numberValue(record, "tvoc"),
    hcho: numberValue(record, "ch2o_m10", "hcho"),
    pm1: numberValue(record, "pm1", "pm_1", "pm1_m10"),
    pm25: numberValue(record, "pm2_5", "pm25", "pm_2_5", "pm2_5_m10"),
    pm10: numberValue(record, "pm10", "pm_10", "pm10_m10"),
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

function particleValue(sample: Sample) {
  return sample.pm25 ?? sample.pm10 ?? sample.pm1;
}

function mergeSupplementalSample(history: Sample[], supplemental: Sample | null) {
  if (!supplemental) return history;
  const existingIndex = history.findIndex((sample) => sample.timestamp === supplemental.timestamp);
  if (existingIndex >= 0) {
    const existing = history[existingIndex];
    history[existingIndex] = {
      ...existing,
      pm1: existing.pm1 ?? supplemental.pm1,
      pm25: existing.pm25 ?? supplemental.pm25,
      pm10: existing.pm10 ?? supplemental.pm10,
    };
    return history;
  }
  history.push(supplemental);
  return history.sort((a, b) => a.timestamp - b.timestamp);
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
  const particleMax = maxValue(recent, particleValue);
  const particleLatest = [...recent].reverse().find((sample) => particleValue(sample) !== null) ?? null;
  const currentParticleAvailable = Boolean(latest && particleLatest && latest.timestamp - particleLatest.timestamp <= 10 * 60_000);
  const soundMax = maxValue(recent, (sample) => sample.soundMax);
  const co2Max = maxValue(recent, (sample) => sample.co2);
  const tvocDelta = delta(recent, (sample) => sample.tvoc);
  const co2Delta = delta(recent, (sample) => sample.co2);
  const pmDelta = delta(recent, particleValue);
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
  const particles = currentParticleAvailable && particleMax !== null
    ? particleMax > 35 || (pmDelta ?? 0) > 15
      ? check("Particle pattern", "RAW", "RISE — CHECK", "watch")
      : check("Particle pattern", "RAW", "NO RISE", "normal")
    : null;
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

  const checks = [carbonMonoxide, oxygen, vapour, formaldehyde, carbonDioxide, acoustics, freshness];
  if (particles) checks.splice(4, 0, particles);
  const rawStatus = worst(checks.map((item) => item.level));
  const status = rawStatus === "unknown" && freshness.level === "normal" ? "normal" : rawStatus;
  const gasDominant = currentParticleAvailable && pmDelta !== null && (tvocDelta ?? 0) > 150 && pmDelta < 5;
  const occupancyPattern = (co2Delta ?? 0) > 80 && (humidityDelta ?? 0) > 0.15;
  const ventilationPattern = name === "OFFICE" && (co2Delta ?? 0) < -80 && ((pmDelta ?? 0) > 3 || (tvocDelta ?? 0) > 100);

  let summary = "The recent pattern is stable across the available channels.";
  if (freshness.level !== "normal") {
    const ageMinutes = Number.isFinite(dataAge) ? Math.max(1, Math.round(dataAge / 60_000)) : null;
    summary = ageMinutes === null
      ? "Current interpretation is paused because a recent validated sample is unavailable; displayed values are last known."
      : `The newest validated sample is ${ageMinutes} minutes old; displayed values are last known, not current.`;
  }
  else if (gasDominant && name === "LAB") summary = "Gas channels changed without matching particles, supporting a vapour, process or airflow event; identity remains unresolved.";
  else if (ventilationPattern) summary = "Falling CO₂ with rising PM or VOC supports recent outdoor-air exchange; window state would strengthen the attribution.";
  else if (occupancyPattern) summary = "CO₂ and absolute humidity rose together, supporting an occupancy-related change rather than a single chemical event.";
  else if ((co2Delta ?? 0) > 80) summary = currentParticleAvailable
    ? "CO₂ rose gradually while the other available gas and particle channels stayed comparatively stable; routine occupancy is plausible."
    : "CO₂ rose gradually while the other available gas channels stayed comparatively stable; routine occupancy is plausible.";

  const flaggedLabels = checks
    .filter((item) => item.level === "watch" || item.level === "action")
    .map((item) => item.label.toLowerCase());
  const flaggedText = flaggedLabels.length ? flaggedLabels.join(" and ") : "the highlighted condition";
  const action = freshness.level !== "normal"
    ? "Latest readings are last known; connection status merits review."
    : status === "action"
      ? `Room procedure and dedicated verification are appropriate for ${flaggedText}.`
      : status === "watch"
        ? `A source check becomes useful if ${flaggedText} persists for 10–30 minutes or gains a second signal.`
        : "No immediate change is suggested; review again if the pattern persists or gains a second signal.";

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
  const latestUrl = new URL(`${API_ROOT}/devices/${encodeURIComponent(deviceId)}/sensordata/latest`);
  const [response, latestResponse] = await Promise.all([
    fetch(url, { headers: { "Api-Key": apiKey, Accept: "application/json" }, cache: "no-store" }),
    fetch(latestUrl, { headers: { "Api-Key": apiKey, Accept: "application/json" }, cache: "no-store" }).catch(() => null),
  ]);
  if (!response.ok) throw new Error("air-Q request failed");
  const payload = await response.json();
  const records = sensorRecords(payload);
  if (!records.length) throw new Error("Unexpected air-Q response");
  const history = records
    .map((record) => normalize(record as RawRecord))
    .filter((sample): sample is Sample => sample !== null)
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter((sample, index, list) => index === 0 || sample.timestamp !== list[index - 1].timestamp);
  const latestPayload = latestResponse?.ok ? await latestResponse.json().catch(() => null) : null;
  const supplemental = sensorRecords(latestPayload)
    .map((record) => normalize(record))
    .filter((sample): sample is Sample => sample !== null)
    .sort((a, b) => a.timestamp - b.timestamp)
    .at(-1) ?? null;
  return mergeSupplementalSample(history, supplemental);
}

async function fetchOutdoorConditions(): Promise<OutdoorConditions | null> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(OUTDOOR_LATITUDE));
  url.searchParams.set("longitude", String(OUTDOOR_LONGITUDE));
  url.searchParams.set("current", "relative_humidity_2m");
  url.searchParams.set("timezone", "Europe/Berlin");

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const current = (payload as RawRecord).current;
  if (!current || typeof current !== "object" || Array.isArray(current)) return null;
  const humidity = numberValue(current as RawRecord, "relative_humidity_2m");
  return humidity === null ? null : { humidity };
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
    const [labHistory, officeHistory, outdoor] = await Promise.all([
      fetchRoom(labId, apiKey),
      fetchRoom(officeId, apiKey),
      fetchOutdoorConditions().catch(() => null),
    ]);
    if (!labHistory.length || !officeHistory.length) throw new Error("No recent records returned");
    return Response.json({
      live: true,
      fetchedAt: Date.now(),
      historyHours: HISTORY_HOURS,
      analysisMinutes: ANALYSIS_MINUTES,
      outdoor,
      rooms: {
        lab: analyseRoom("LAB", labHistory, positiveNumber(runtimeEnv.LAB_VOLUME_M3), positiveNumber(runtimeEnv.LAB_ACH)),
        office: analyseRoom("OFFICE", officeHistory, positiveNumber(runtimeEnv.OFFICE_VOLUME_M3), positiveNumber(runtimeEnv.OFFICE_ACH)),
      },
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    return Response.json({ error: "Recent air-Q readings are temporarily unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
