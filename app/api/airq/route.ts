import { env } from "cloudflare:workers";
import { apiKeyFromRequest, isAuthorized, isBearerAuthorized } from "@/lib/dashboard-auth";
import { readStoredApiKey } from "@/lib/airq-key-store";
import { isGitHubActionsExportAuthorized } from "@/lib/github-actions-oidc";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type RawRecord = Record<string, unknown>;

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
  pm4: number | null;
  pm10: number | null;
  pressure: number | null;
  pressureRel: number | null;
  dewpt: number | null;
  dco2dt: number | null;
  dhdt: number | null;
  sound: number | null;
  soundMax: number | null;
  health: number | null;
  performance: number | null;
  additionalEnvironmental?: Record<string, number>;
};

type OutdoorSample = {
  timestamp: number;
  temperature: number | null;
  humidity: number | null;
};

type OutdoorParticleSample = {
  timestamp: number;
  pm25: number | null;
};

type OutdoorData = {
  location: "Oberschneiding";
  source: "DWD via Bright Sky";
  station: string | null;
  samples: OutdoorSample[];
  latest: OutdoorSample | null;
  particleLatest: OutdoorParticleSample | null;
};

const API_ROOT = "https://air-q-cloud.de/open_api/v3";
const HISTORY_HOURS = 24;
const MAX_EXPORT_HOURS = 48;
const ANALYSIS_MINUTES = 60;
const BRIGHT_SKY_ROOT = "https://api.brightsky.dev";
const OPEN_METEO_AIR_ROOT = "https://air-quality-api.open-meteo.com/v1/air-quality";
const OBERSCHNEIDING_LATITUDE = "48.7957";
const OBERSCHNEIDING_LONGITUDE = "12.6420";
const OUTDOOR_CACHE_MS = 10 * 60_000;
const LIVE_CACHE_MS = 90_000;

let outdoorCache: { expiresAt: number; data: OutdoorData } | null = null;
let liveDashboardCache: { expiresAt: number; data: DashboardPayload } | null = null;
let liveDashboardRequest: Promise<DashboardPayload> | null = null;

const BERLIN_DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

type LocalDate = { year: number; month: number; day: number };

function berlinParts(timestamp: number) {
  const values: Record<string, number> = {};
  for (const part of BERLIN_DATE_TIME.formatToParts(timestamp)) {
    if (["year", "month", "day", "hour", "minute", "second"].includes(part.type)) {
      values[part.type] = Number(part.value);
    }
  }
  return values;
}

function shiftLocalDate(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function berlinEpoch(date: LocalDate, hour: number) {
  const targetAsUtc = Date.UTC(date.year, date.month - 1, date.day, hour, 0, 0);
  let guess = targetAsUtc;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = berlinParts(guess);
    const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    guess += targetAsUtc - representedAsUtc;
  }
  return guess;
}

function completedBerlinCycle(now = Date.now()): TimeRange {
  const parts = berlinParts(now);
  const today = { year: parts.year, month: parts.month, day: parts.day };
  const todayAt1800 = berlinEpoch(today, 18);
  const endDate = now >= todayAt1800 ? today : shiftLocalDate(today, -1);
  const startDate = shiftLocalDate(endDate, -1);
  return { from: berlinEpoch(startDate, 18), to: berlinEpoch(endDate, 18), exact: true };
}

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

const KNOWN_ENVIRONMENTAL_FIELDS = new Set([
  "timestamp", "temperature", "humidity", "humidityabs", "co2", "co", "oxygen", "tvoc",
  "ch2om10", "hcho", "pm1", "pm1m10", "pm1sps30", "pm25", "pm25m10", "pm25sps30",
  "pm4", "pm4m10", "pm4sps30", "pm10", "pm10m10", "pm10sps30", "pressure",
  "pressurerel", "dewpt", "dewpoint", "dco2dt", "dhdt", "sound", "soundmax", "health",
  "performance",
]);

const OPERATIONAL_FIELD = /(?:device|uptime|interval|serial|firmware|version|battery|status|rssi|wifi|ssid|mac|(?:^|_)ip|account|token|key|latitude|longitude|location|gps)/i;

function additionalEnvironmentalFields(record: RawRecord) {
  const fields: Record<string, number> = {};
  for (const [key, rawValue] of Object.entries(record)) {
    const normalized = normalizedFieldName(key);
    if (KNOWN_ENVIRONMENTAL_FIELDS.has(normalized) || OPERATIONAL_FIELD.test(key)) continue;
    const value = numericScalar(rawValue);
    if (value !== null) fields[key] = value;
  }
  return fields;
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

function normalize(record: RawRecord, includeAdditionalEnvironmental = false): Sample | null {
  const timestamp = numberValue(record, "timestamp");
  if (!timestamp) return null;
  const healthRaw = numberValue(record, "health");
  const performanceRaw = numberValue(record, "performance");
  const sample: Sample = {
    timestamp,
    temperature: numberValue(record, "temperature"),
    humidity: numberValue(record, "humidity"),
    humidityAbs: numberValue(record, "humidity_abs"),
    co2: numberValue(record, "co2"),
    co: numberValue(record, "co"),
    oxygen: numberValue(record, "oxygen"),
    tvoc: numberValue(record, "tvoc"),
    hcho: numberValue(record, "ch2o_m10", "hcho"),
    pm1: numberValue(record, "pm1", "pm_1", "pm1_m10", "pm1_sps30"),
    pm25: numberValue(record, "pm2_5", "pm25", "pm_2_5", "pm2_5_m10", "pm2_5_sps30"),
    pm4: numberValue(record, "pm4", "pm_4", "pm4_m10", "pm4_sps30"),
    pm10: numberValue(record, "pm10", "pm_10", "pm10_m10", "pm10_sps30"),
    pressure: numberValue(record, "pressure"),
    pressureRel: numberValue(record, "pressure_rel"),
    dewpt: numberValue(record, "dewpt", "dew_point"),
    dco2dt: numberValue(record, "dco2dt"),
    dhdt: numberValue(record, "dhdt"),
    sound: numberValue(record, "sound"),
    soundMax: numberValue(record, "sound_max"),
    health: healthRaw === null ? null : healthRaw / 10,
    performance: performanceRaw === null ? null : performanceRaw / 10,
  };
  if (includeAdditionalEnvironmental) {
    const additionalEnvironmental = additionalEnvironmentalFields(record);
    if (Object.keys(additionalEnvironmental).length) sample.additionalEnvironmental = additionalEnvironmental;
  }
  return sample;
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
      pm4: existing.pm4 ?? supplemental.pm4,
      pm10: existing.pm10 ?? supplemental.pm10,
    };
    return history;
  }
  history.push(supplemental);
  return history.sort((a, b) => a.timestamp - b.timestamp);
}

function roomSnapshot(name: "LAB" | "OFFICE", history: Sample[]) {
  return { name, samples: history, latest: history.at(-1) ?? null };
}

type TimeRange = { from: number; to: number; exact: boolean };
type DashboardPayload = {
  live: true;
  fetchedAt: number;
  coverage: TimeRange;
  historyHours: number;
  analysisMinutes: number;
  outdoor: OutdoorData | null;
  rooms: {
    lab: ReturnType<typeof roomSnapshot>;
    office: ReturnType<typeof roomSnapshot>;
  };
};

function requestedRange(url: URL, exportRequested: boolean): TimeRange {
  const fromValue = url.searchParams.get("f");
  const toValue = url.searchParams.get("t");
  const cycleRequested = url.searchParams.get("cycle") === "1";
  if (cycleRequested) {
    if (!exportRequested || fromValue !== null || toValue !== null) throw new RangeError("Invalid export range");
    return completedBerlinCycle();
  }
  if (fromValue === null && toValue === null) {
    const to = Date.now();
    return { from: to - HISTORY_HOURS * 60 * 60_000, to, exact: false };
  }
  if (!exportRequested || fromValue === null || toValue === null) throw new RangeError("Invalid export range");
  const from = Number(fromValue);
  const to = Number(toValue);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from <= 0 || to <= from) {
    throw new RangeError("Invalid export range");
  }
  if (to - from > MAX_EXPORT_HOURS * 60 * 60_000) throw new RangeError("Export range is too large");
  return { from, to, exact: true };
}

async function fetchRoom(
  deviceId: string,
  apiKey: string,
  range: TimeRange,
  includeAdditionalEnvironmental: boolean,
) {
  const { from, to } = range;
  const url = new URL(`${API_ROOT}/devices/${encodeURIComponent(deviceId)}/sensordata/timerange`);
  url.searchParams.set("f", String(from));
  url.searchParams.set("t", String(to));
  let latestRequest: Promise<Response | null> | null = null;
  if (!range.exact) {
    const latestUrl = new URL(`${API_ROOT}/devices/${encodeURIComponent(deviceId)}/sensordata/latest`);
    latestRequest = fetch(latestUrl, {
      headers: { "Api-Key": apiKey, Accept: "application/json" },
      cache: "no-store",
    }).catch(() => null);
  }

  const response = await fetch(url, { headers: { "Api-Key": apiKey, Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error("air-Q request failed");
  const payload = await response.json();
  const records = sensorRecords(payload);
  if (!records.length) throw new Error("Unexpected air-Q response");
  const history = records
    .map((record) => normalize(record as RawRecord, includeAdditionalEnvironmental))
    .filter((sample): sample is Sample => sample !== null)
    .filter((sample) => sample.timestamp >= from && sample.timestamp <= to)
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter((sample, index, list) => index === 0 || sample.timestamp !== list[index - 1].timestamp);
  if (range.exact) return history;

  const latestResponse = latestRequest ? await latestRequest : null;
  const latestPayload = latestResponse?.ok ? await latestResponse.json().catch(() => null) : null;
  const supplemental = sensorRecords(latestPayload)
    .map((record) => normalize(record, includeAdditionalEnvironmental))
    .filter((sample): sample is Sample => sample !== null)
    .sort((a, b) => a.timestamp - b.timestamp)
    .at(-1) ?? null;
  return mergeSupplementalSample(history, supplemental);
}

function weatherTimestamp(record: RawRecord) {
  const raw = record.timestamp;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function weatherRecords(payload: unknown): RawRecord[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const weather = (payload as RawRecord).weather;
  if (Array.isArray(weather)) {
    return weather.filter((item): item is RawRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  }
  return weather && typeof weather === "object" && !Array.isArray(weather) ? [weather as RawRecord] : [];
}

function weatherSources(payload: unknown): RawRecord[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const sources = (payload as RawRecord).sources;
  return Array.isArray(sources)
    ? sources.filter((item): item is RawRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function normalizeWeather(record: RawRecord): OutdoorSample | null {
  const timestamp = weatherTimestamp(record);
  if (timestamp === null) return null;
  return {
    timestamp,
    temperature: numberValue(record, "temperature"),
    humidity: numberValue(record, "relative_humidity"),
  };
}

function brightSkyTime(timestamp: number) {
  return new Date(timestamp).toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function weatherPayload(url: URL) {
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" }).catch(() => null);
  if (!response?.ok) return null;
  return response.json().catch(() => null);
}

function openMeteoParticle(payload: unknown): OutdoorParticleSample | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const current = (payload as RawRecord).current;
  if (!current || typeof current !== "object" || Array.isArray(current)) return null;
  const record = current as RawRecord;
  const rawTime = record.time;
  if (typeof rawTime !== "string") return null;
  const timestamp = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(rawTime) ? rawTime : `${rawTime}Z`);
  if (!Number.isFinite(timestamp)) return null;
  return { timestamp, pm25: numberValue(record, "pm2_5") };
}

function latestOutdoorValues(samples: OutdoorSample[]): OutdoorSample | null {
  const newest = samples.at(-1);
  if (!newest) return null;
  const newestTemperature = [...samples].reverse().find((sample) => sample.temperature !== null);
  const newestHumidity = [...samples].reverse().find((sample) => sample.humidity !== null);
  return {
    timestamp: Math.max(newestTemperature?.timestamp ?? newest.timestamp, newestHumidity?.timestamp ?? newest.timestamp),
    temperature: newestTemperature?.temperature ?? null,
    humidity: newestHumidity?.humidity ?? null,
  };
}

async function fetchOutdoor(range: TimeRange): Promise<OutdoorData | null> {
  const now = Date.now();
  if (!range.exact && outdoorCache && outdoorCache.expiresAt > now) return outdoorCache.data;

  const historyUrl = new URL(`${BRIGHT_SKY_ROOT}/weather`);
  historyUrl.searchParams.set("lat", OBERSCHNEIDING_LATITUDE);
  historyUrl.searchParams.set("lon", OBERSCHNEIDING_LONGITUDE);
  historyUrl.searchParams.set("date", brightSkyTime(range.from));
  historyUrl.searchParams.set("last_date", brightSkyTime(range.to));
  historyUrl.searchParams.set("tz", "Europe/Berlin");

  const currentUrl = new URL(`${BRIGHT_SKY_ROOT}/current_weather`);
  currentUrl.searchParams.set("lat", OBERSCHNEIDING_LATITUDE);
  currentUrl.searchParams.set("lon", OBERSCHNEIDING_LONGITUDE);

  const airQualityUrl = new URL(OPEN_METEO_AIR_ROOT);
  airQualityUrl.searchParams.set("latitude", OBERSCHNEIDING_LATITUDE);
  airQualityUrl.searchParams.set("longitude", OBERSCHNEIDING_LONGITUDE);
  airQualityUrl.searchParams.set("current", "pm2_5");
  airQualityUrl.searchParams.set("timezone", "UTC");

  const [historyPayload, currentPayload, airQualityPayload] = await Promise.all([
    weatherPayload(historyUrl),
    range.exact ? Promise.resolve(null) : weatherPayload(currentUrl),
    range.exact ? Promise.resolve(null) : weatherPayload(airQualityUrl),
  ]);
  const payloads = [historyPayload, currentPayload].filter((payload) => payload !== null);
  const samples = payloads
    .flatMap(weatherRecords)
    .map(normalizeWeather)
    .filter((sample): sample is OutdoorSample => sample !== null)
    .filter((sample) => sample.timestamp >= range.from - 2 * 60 * 60_000 && sample.timestamp <= range.to + 2 * 60 * 60_000)
    .sort((left, right) => left.timestamp - right.timestamp)
    .filter((sample, index, list) => index === list.length - 1 || sample.timestamp !== list[index + 1].timestamp);
  if (!samples.length) return null;

  const source = payloads
    .flatMap(weatherSources)
    .sort((left, right) => (numberValue(left, "distance") ?? Infinity) - (numberValue(right, "distance") ?? Infinity))[0];
  const station = source && typeof source.station_name === "string" ? source.station_name : null;
  const data: OutdoorData = {
    location: "Oberschneiding",
    source: "DWD via Bright Sky",
    station,
    samples,
    // DWD observations can occasionally publish temperature and relative
    // humidity in different newest records. Keep each card on the newest
    // valid observation for its own channel instead of hiding the other one.
    latest: latestOutdoorValues(samples),
    particleLatest: openMeteoParticle(airQualityPayload),
  };
  if (!range.exact) outdoorCache = { expiresAt: now + OUTDOOR_CACHE_MS, data };
  return data;
}

async function buildDashboardPayload(
  labId: string,
  officeId: string,
  apiKey: string,
  range: TimeRange,
  includeAdditionalEnvironmental: boolean,
  requireOutdoor: boolean,
): Promise<DashboardPayload> {
  // Outdoor conditions add context, but a slow or unavailable weather service
  // must never delay the two indoor sensor feeds on the live wallboard.
  let outdoor = outdoorCache?.data ?? null;
  let outdoorSettled = false;
  const outdoorRequest = fetchOutdoor(range).then(
    (value) => {
      if (value) outdoor = value;
      outdoorSettled = true;
      return value;
    },
    () => {
      outdoorSettled = true;
      return null;
    },
  );

  const [labResult, officeResult] = await Promise.allSettled([
    fetchRoom(labId, apiKey, range, includeAdditionalEnvironmental),
    fetchRoom(officeId, apiKey, range, includeAdditionalEnvironmental),
  ]);
  const labHistory = labResult.status === "fulfilled" ? labResult.value : [];
  const officeHistory = officeResult.status === "fulfilled" ? officeResult.value : [];

  // Exact exports remain all-or-nothing. The interactive wallboard is room
  // independent so one disconnected sensor cannot hide the other live room.
  if (range.exact && (!labHistory.length || !officeHistory.length)) {
    throw new Error("Exact export requires both room histories");
  }
  if (!range.exact && !labHistory.length && !officeHistory.length) {
    throw new Error("No recent records returned");
  }

  if (requireOutdoor) {
    const requiredOutdoor = await outdoorRequest;
    if (requiredOutdoor) outdoor = requiredOutdoor;
  } else if (!outdoorSettled) {
    // Keep the refresh best-effort for a warm isolate without placing it on the
    // live response's critical path.
    void outdoorRequest;
  }

  return {
    live: true,
    fetchedAt: Date.now(),
    coverage: range,
    historyHours: (range.to - range.from) / (60 * 60_000),
    analysisMinutes: ANALYSIS_MINUTES,
    outdoor,
    rooms: {
      lab: roomSnapshot("LAB", labHistory),
      office: roomSnapshot("OFFICE", officeHistory),
    },
  };
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const exportRequested = requestUrl.searchParams.get("export") === "1";
  const inlineExport = requestUrl.searchParams.get("inline") === "1";
  const runtimeEnv = env as unknown as Record<string, unknown>;
  const sessionSecret = runtimeEnv.DASHBOARD_SESSION_SECRET;
  const sessionAuthorized = typeof sessionSecret === "string" && await isAuthorized(request, sessionSecret);
  const monitorExportToken = runtimeEnv.MONITOR_EXPORT_TOKEN;
  const exportAuthorized = exportRequested && (
    (typeof monitorExportToken === "string" && await isBearerAuthorized(request, monitorExportToken))
    || await isGitHubActionsExportAuthorized(request)
  );
  if (!sessionAuthorized && !exportAuthorized) {
    return Response.json({ error: "Authorization required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const environmentKey = runtimeEnv.AIRQ_API_KEY;
  const storedApiKey = sessionAuthorized && typeof sessionSecret === "string"
    ? await readStoredApiKey(sessionSecret).catch(() => null) ?? await apiKeyFromRequest(request, sessionSecret)
    : null;
  const apiKey = typeof environmentKey === "string"
    ? environmentKey
    : storedApiKey;
  const labId = runtimeEnv.AIRQ_LAB_DEVICE_ID;
  const officeId = runtimeEnv.AIRQ_OFFICE_DEVICE_ID;
  if (typeof apiKey !== "string" || typeof labId !== "string" || typeof officeId !== "string") {
    return Response.json({ error: "Live air-Q connection is not configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  let range: TimeRange;
  try {
    range = requestedRange(requestUrl, exportRequested);
  } catch {
    return Response.json({ error: "Invalid export time range" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const build = () => buildDashboardPayload(
    labId,
    officeId,
    apiKey,
    range,
    exportRequested,
    exportRequested,
  );

  try {
    let payload: DashboardPayload;
    if (exportRequested) {
      payload = await build();
    } else if (liveDashboardCache && liveDashboardCache.expiresAt > Date.now()) {
      payload = liveDashboardCache.data;
    } else {
      let request = liveDashboardRequest;
      if (!request) {
        request = build().then((data) => {
          liveDashboardCache = { expiresAt: Date.now() + LIVE_CACHE_MS, data };
          return data;
        });
        liveDashboardRequest = request;
        const clearRequest = () => {
          if (liveDashboardRequest === request) liveDashboardRequest = null;
        };
        void request.then(clearRequest, clearRequest);
      }
      payload = await request;
    }

    const headers = new Headers({ "Cache-Control": "no-store, max-age=0" });
    if (exportRequested && !inlineExport) {
      headers.set("Content-Disposition", 'attachment; filename="airq-dashboard-data.json"');
    }
    return Response.json(payload, { headers });
  } catch {
    return Response.json({ error: "Recent air-Q readings are temporarily unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
