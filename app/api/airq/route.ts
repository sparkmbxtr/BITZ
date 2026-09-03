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

const API_ROOT = "https://air-q-cloud.de/open_api/v3";
const HISTORY_HOURS = 24;
const MAX_EXPORT_HOURS = 48;
const ANALYSIS_MINUTES = 60;

const BERLIN_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Berlin",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

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

function berlinMinuteOfDay(timestamp: number) {
  const values: Record<string, number> = {};
  for (const part of BERLIN_CLOCK.formatToParts(timestamp)) {
    if (part.type === "hour" || part.type === "minute") values[part.type] = Number(part.value);
  }
  return (values.hour ?? 0) * 60 + (values.minute ?? 0);
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

function latestValue(samples: Sample[], selector: (sample: Sample) => number | null) {
  const list = values(samples, selector);
  return list.length ? list.at(-1)! : null;
}

function median(list: number[]) {
  if (!list.length) return null;
  const ordered = [...list].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function recentMedianShift(samples: Sample[], selector: (sample: Sample) => number | null) {
  if (samples.length < 6) return null;
  const current = median(values(samples.slice(-3), selector));
  const reference = median(values(samples.slice(-15, -3), selector));
  return current === null || reference === null ? null : current - reference;
}

function shareMatching(
  samples: Sample[],
  selector: (sample: Sample) => number | null,
  predicate: (value: number) => boolean,
) {
  const list = values(samples, selector);
  if (!list.length) return null;
  return list.filter(predicate).length / list.length;
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

function check(
  label: string,
  method: "DIRECT" | "PROXY" | "PATTERN" | "RAW" | "SYSTEM" | "COMPUTED UNTIL PROPANE SENSOR IS INSTALLED" | "COMPUTED UNTIL NITROGEN SENSOR IS INSTALLED",
  status: string,
  level: Level,
) {
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
  const hchoDelta = delta(recent, (sample) => sample.hcho);
  const coDelta = delta(recent, (sample) => sample.co);
  const co2Delta = delta(recent, (sample) => sample.co2);
  const o2Delta = delta(recent, (sample) => sample.oxygen);
  const pmDelta = delta(recent, particleValue);
  const humidityDelta = delta(recent, (sample) => sample.humidityAbs);
  const soundDelta = delta(recent, (sample) => sample.sound);
  const temperatureDelta = delta(recent, (sample) => sample.temperature);
  const recentO2Shift = recentMedianShift(recent, (sample) => sample.oxygen);
  const recentCo2Shift = recentMedianShift(recent, (sample) => sample.co2);
  const recentTvocShift = recentMedianShift(recent, (sample) => sample.tvoc);
  const recentHchoShift = recentMedianShift(recent, (sample) => sample.hcho);
  const recentCoShift = recentMedianShift(recent, (sample) => sample.co);
  const recentTvocValues = values(recent, (sample) => sample.tvoc);
  const tvocRise = recentTvocValues.length > 0 && tvocMax !== null ? tvocMax - recentTvocValues[0] : null;
  const finalTwenty = recent.filter((sample) => sample.timestamp >= (latest?.timestamp ?? 0) - 20 * 60_000);
  const tvocNow = latestValue(recent, (sample) => sample.tvoc);
  const hchoNow = latestValue(recent, (sample) => sample.hcho);
  const coNow = latestValue(recent, (sample) => sample.co);
  const co2Now = latestValue(recent, (sample) => sample.co2);
  const o2Now = latestValue(recent, (sample) => sample.oxygen);
  const pmNow = latestValue(recent, particleValue);
  const tvocPersistent = (shareMatching(finalTwenty, (sample) => sample.tvoc, (value) => value > 1_000) ?? 0) >= .5;
  const hchoPersistent = (shareMatching(finalTwenty, (sample) => sample.hcho, (value) => value > 100) ?? 0) >= .5;
  const particlePersistent = currentParticleAvailable &&
    (shareMatching(finalTwenty, particleValue, (value) => value > 35) ?? 0) >= .5;
  const co2Persistent = (shareMatching(finalTwenty, (sample) => sample.co2, (value) => value > 1_400) ?? 0) >= .5;
  const localMinute = latest ? berlinMinuteOfDay(latest.timestamp) : -1;
  const officeClosePattern = name === "OFFICE" &&
    localMinute >= 16 * 60 + 20 &&
    localMinute <= 18 * 60 &&
    (tvocRise ?? 0) >= 25 &&
    (
      (soundDelta ?? 0) <= -2 ||
      ((co2Delta ?? Infinity) <= 15 && (humidityDelta ?? Infinity) <= .08)
    );

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

  const displacementComputable = recentO2Shift !== null && recentCo2Shift !== null;
  const coordinatedDisplacement = displacementComputable && recentO2Shift <= -0.08 && recentCo2Shift <= -75;
  const propaneCorroboration = recentTvocShift !== null && recentTvocShift >= 100;
  const inertPatternComputable = recentTvocShift !== null && recentHchoShift !== null && recentCoShift !== null;
  const noGasChannelRise = inertPatternComputable && recentTvocShift < 100 && recentHchoShift < 20 && recentCoShift < 0.08;
  const propanePattern = name === "LAB"
    ? !displacementComputable || recentTvocShift === null
      ? check("Propane-associated pattern", "COMPUTED UNTIL PROPANE SENSOR IS INSTALLED", "TREND FORMING", "unknown")
      : coordinatedDisplacement && propaneCorroboration
        ? check("Propane-associated pattern", "COMPUTED UNTIL PROPANE SENSOR IS INSTALLED", "POSSIBLE PATTERN — CHECK", "watch")
        : check("Propane-associated pattern", "COMPUTED UNTIL PROPANE SENSOR IS INSTALLED", "NOT INDICATED", "normal")
    : null;
  const nitrogenPattern = name === "LAB"
    ? !displacementComputable || !inertPatternComputable
      ? check("Nitrogen (N₂) displacement pattern", "COMPUTED UNTIL NITROGEN SENSOR IS INSTALLED", "TREND FORMING", "unknown")
      : coordinatedDisplacement && noGasChannelRise
        ? check("Nitrogen (N₂) displacement pattern", "COMPUTED UNTIL NITROGEN SENSOR IS INSTALLED", "POSSIBLE N₂ / INERT-GAS PATTERN", "watch")
        : check("Nitrogen (N₂) displacement pattern", "COMPUTED UNTIL NITROGEN SENSOR IS INSTALLED", "NOT INDICATED", "normal")
    : null;

  const checks = [carbonMonoxide, oxygen, vapour, formaldehyde, carbonDioxide, acoustics, freshness];
  if (particles) checks.splice(4, 0, particles);
  if (name === "LAB" && propanePattern && nitrogenPattern) checks.splice(2, 0, propanePattern, nitrogenPattern);
  const rawStatus = worst(checks.map((item) => item.level));
  const status = rawStatus === "unknown" && freshness.level === "normal" ? "normal" : rawStatus;
  const gasDominant = currentParticleAvailable && pmDelta !== null && (tvocDelta ?? 0) > 150 && pmDelta < 5;
  const occupancyPattern = (co2Delta ?? 0) > 80 && (humidityDelta ?? 0) > 0.15;
  const metabolicPattern = occupancyPattern && (o2Delta ?? 0) < -0.025;
  const ventilationPattern = name === "OFFICE" && (co2Delta ?? 0) < -80 && ((pmDelta ?? 0) > 3 || (tvocDelta ?? 0) > 100);
  const directCritical = oxygen.level === "action" || carbonMonoxide.level === "action";
  const gasSignals = Number(vapour.level !== "normal" && vapour.level !== "unknown") +
    Number(formaldehyde.level !== "normal" && formaldehyde.level !== "unknown") +
    Number(carbonMonoxide.level !== "normal" && carbonMonoxide.level !== "unknown");
  const multiGasPattern = gasSignals >= 2 ||
    ((tvocDelta ?? 0) > 150 && (hchoDelta ?? 0) > 20) ||
    ((tvocDelta ?? 0) > 150 && (coDelta ?? 0) > .08);
  const particleGasPattern = currentParticleAvailable && (pmDelta ?? 0) > 3 &&
    ((tvocDelta ?? 0) > 100 || (coDelta ?? 0) > .08);
  const particleOnly = currentParticleAvailable && (pmDelta ?? 0) > 3 &&
    Math.abs(tvocDelta ?? 0) < 100 && Math.abs(hchoDelta ?? 0) < 20 && (coDelta ?? 0) < .08;
  const coOnly = carbonMonoxide.level === "watch" && vapour.level === "normal" && formaldehyde.level === "normal" &&
    (!particles || particles.level === "normal");
  const oxygenProxyPattern = oxygen.level === "watch" && (co2Delta ?? 0) < 50;
  const humidityLinkedFormaldehyde = (hchoDelta ?? 0) > 20 && Math.abs(humidityDelta ?? 0) > .35 &&
    vapour.level === "normal" && carbonMonoxide.level === "normal";
  const isolatedFormaldehyde = formaldehyde.level === "watch" && vapour.level === "normal" && carbonMonoxide.level === "normal";
  const isolatedVapour = vapour.level === "watch" && formaldehyde.level === "normal" && carbonMonoxide.level === "normal";
  const isolatedGasPersistent = (isolatedFormaldehyde && hchoPersistent) || (isolatedVapour && tvocPersistent);
  const acousticOnly = acoustics.level === "watch" &&
    [oxygen, carbonMonoxide, vapour, formaldehyde, carbonDioxide, ...(particles ? [particles] : [])]
      .every((item) => item.level === "normal" || item.level === "unknown");
  const recoveringGas = tvocMax !== null && tvocNow !== null && tvocMax - tvocNow > 250 &&
    (tvocDelta ?? 0) <= 0 && (hchoDelta ?? 0) <= 0 && (coDelta ?? 0) <= .03;
  const thermalMoisturePattern = Math.abs(temperatureDelta ?? 0) >= 1 && Math.abs(humidityDelta ?? 0) >= .35 &&
    Math.abs(co2Delta ?? 0) < 80 && Math.abs(tvocDelta ?? 0) < 100 && Math.abs(hchoDelta ?? 0) < 20;
  const propanePatternActive = propanePattern?.level === "watch";
  const nitrogenPatternActive = nitrogenPattern?.level === "watch";

  let summary = "The recent pattern is stable across the available channels.";
  if (freshness.level !== "normal") {
    const ageMinutes = Number.isFinite(dataAge) ? Math.max(1, Math.round(dataAge / 60_000)) : null;
    summary = ageMinutes === null
      ? "Current interpretation is paused because a recent validated sample is unavailable; displayed values are last known."
      : `The newest validated sample is ${ageMinutes} minutes old; displayed values are last known, not current.`;
  }
  else if (directCritical) summary = `A direct safety channel requires dedicated verification: ${oxygen.level === "action" ? `oxygen reached ${o2Now?.toFixed(2) ?? "a low value"}%` : `carbon monoxide reached ${coNow?.toFixed(2) ?? "an elevated value"} mg/m³`}. Other channels may provide context but do not cancel the direct reading.`;
  else if (propanePatternActive) summary = "Oxygen and CO₂ fell together while TVOC rose in the same recent window. This is a computed propane-associated early-warning pattern, not compound identification; the dedicated propane system remains decisive.";
  else if (nitrogenPatternActive) summary = "Oxygen and CO₂ fell together without a matching TVOC, formaldehyde or CO rise. This is a computed nitrogen/inert-gas displacement pattern; the dedicated oxygen and nitrogen systems remain decisive.";
  else if (oxygenProxyPattern) summary = `Oxygen moved into the watch range without a matching CO₂ rise. This is an oxygen-displacement proxy pattern, not confirmation of nitrogen or another gas; a dedicated oxygen measurement is the deciding check.`;
  else if (officeClosePattern) summary = "A late-day TVOC rise with the occupancy transition matches the established OFFICE window-closing and synchronized departure signature.";
  else if (coOnly) summary = `The CO channel rose without matching TVOC, formaldehyde or particle movement. A combustion/exhaust input, electrochemical cross-response or local instrument effect remain distinct possibilities.`;
  else if (multiGasPattern) summary = `Two or more gas-related channels moved together within the recent window${tvocPersistent || hchoPersistent ? " and remained elevated through much of the latest 20 minutes" : ""}. This supports a real mixed vapour/process or airflow event, while the sensor set cannot identify a compound.`;
  else if (particleGasPattern) summary = name === "LAB"
    ? `Particles${pmNow === null ? "" : ` (latest ${pmNow.toFixed(1)} µg/m³)`} and gas-related channels rose together${particlePersistent ? " and the particle rise persisted" : ""}. Check whether a process, door or pressure/airflow transition occurred; the combined pattern is not specific to one source.`
    : `Particles${pmNow === null ? "" : ` (latest ${pmNow.toFixed(1)} µg/m³)`} and a gas-related channel rose together${particlePersistent ? " and the particle rise persisted" : ""}. Outdoor-air import and an indoor mixed-source event remain competing explanations; window and construction timing are decisive.`;
  else if (gasDominant && name === "LAB") summary = "Gas channels changed without matching particles, supporting a vapour, process or airflow event; identity remains unresolved.";
  else if (ventilationPattern) summary = "Falling CO₂ with rising PM or VOC supports recent outdoor-air exchange; window state would strengthen the attribution.";
  else if (humidityLinkedFormaldehyde) summary = "The formaldehyde signal moved with absolute humidity while TVOC and CO remained comparatively stable. A climatic influence or cross-response is plausible; persistence after humidity stabilizes would support a separate source.";
  else if (isolatedFormaldehyde) summary = "The formaldehyde channel changed without matching TVOC or CO support. Treat it as an isolated mixture/cross-sensitivity signal until persistence or a second channel corroborates it.";
  else if (isolatedVapour) summary = "TVOC changed without matching formaldehyde, CO or particle support. An intermittent vapour source, airflow change or sensor cross-response remains possible; identity is unresolved.";
  else if (particleOnly) summary = name === "LAB"
    ? `Particles rose without a matching gas pattern. A local particle-generating process, door/pressure transition or delayed filtered-air response is more plausible than a vapour event.`
    : `Particles rose without a matching gas pattern. Open-window outdoor import, nearby road work and a local dust event remain competing explanations.`;
  else if (co2Persistent) summary = `CO₂ remained elevated through most of the latest 20 minutes${co2Now === null ? "" : ` and is ${co2Now.toFixed(0)} ppm`}, supporting sustained occupancy or limited air exchange rather than a brief spike.`;
  else if (metabolicPattern) summary = "CO₂ and absolute humidity rose together while oxygen eased slightly, a coordinated occupancy pattern rather than evidence for an inert-gas release.";
  else if (occupancyPattern) summary = "CO₂ and absolute humidity rose together, supporting an occupancy-related change rather than a single chemical event.";
  else if (acousticOnly) summary = "A brief raw sound-max event occurred without a matching gas, oxygen, CO₂ or particle pattern. It is retained as an acoustic event, not interpreted as an air-quality event.";
  else if (recoveringGas) summary = "An earlier gas-channel excursion is declining toward the recent reference and has not gained CO, formaldehyde or particle support.";
  else if (thermalMoisturePattern) summary = "Temperature and absolute humidity moved together while gas, CO₂ and particle channels remained comparatively stable. This is a room-condition or airflow pattern, not a supported gas event.";
  else if ((co2Delta ?? 0) > 80) summary = currentParticleAvailable
    ? "CO₂ rose gradually while the other available gas and particle channels stayed comparatively stable; routine occupancy is plausible."
    : "CO₂ rose gradually while the other available gas channels stayed comparatively stable; routine occupancy is plausible.";

  const flaggedLabels = checks
    .filter((item) => item.level === "watch" || item.level === "action")
    .map((item) => item.label.toLowerCase());
  const flaggedText = flaggedLabels.length ? flaggedLabels.join(" and ") : "the highlighted condition";
  const action = freshness.level !== "normal"
    ? "Latest readings are last known; connection status merits review."
    : directCritical
      ? `Use the room procedure and a dedicated instrument to verify ${oxygen.level === "action" ? "oxygen" : "carbon monoxide"} now; do not rely on the dashboard alone.`
      : propanePatternActive
        ? "Check the dedicated propane alarm and LAB gas system now. Treat this dashboard result as an early-warning correlation until the direct propane sensor is installed in air-Q."
      : nitrogenPatternActive
        ? "Check the dedicated oxygen/nitrogen alarm and LAB gas system now. Treat this dashboard result as an early-warning displacement correlation until the direct nitrogen sensor is installed in air-Q."
      : oxygenProxyPattern
        ? "Verify oxygen with a dedicated instrument and check nitrogen/process timing. Escalate only if the low reading persists or another independent channel changes."
      : officeClosePattern
        ? "Treat this as CLOSE while TVOC falls toward the OFFICE night reference; check ventilation or another source only if it persists or gains CO, formaldehyde, or PM support."
      : coOnly
        ? "Check combustion, vehicle/exhaust and instrument context; use a dedicated CO measurement if the rise persists or increases."
      : multiGasPattern
        ? `Match the onset to process, hood, pump, door and airflow timestamps. A source check becomes useful if the pattern persists for two more samples or continues rising.`
      : particleGasPattern
        ? `Check the active process and air-path state. Reassess after 10–20 minutes; persistence across both particle and gas channels strengthens the need for intervention.`
      : isolatedFormaldehyde || isolatedVapour
        ? isolatedGasPersistent
          ? "The isolated signal has persisted; check the nearest process, material or window/airflow event and seek an independent channel before assigning a cause."
          : "Record the nearest process or window event and watch two more samples. Act only if the signal persists, rises sharply or gains an independent gas/particle channel."
      : particleOnly
        ? name === "LAB"
          ? "Match the onset to local particle work, doors and pressure/airflow. Review HEPA performance only if the elevation persists or clearance is slower than the LAB's own history."
          : "Check window and road-work timing. Indoor action is useful only if particles stay elevated after the suspected outdoor or local dust event ends."
      : co2Persistent
        ? `Review occupancy and air exchange. A ventilation adjustment becomes useful if CO₂ remains elevated for another 20–30 minutes or continues rising.`
      : acousticOnly
        ? "Retain the event timestamp for equipment or activity review; no air-quality action follows from an isolated sound peak."
      : recoveringGas
        ? "No immediate change is suggested while the decline continues; review only if the trend reverses or gains an independent channel."
      : thermalMoisturePattern
        ? "No gas action is indicated. Observe whether the room-condition change settles with the next ventilation or occupancy transition."
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

type TimeRange = { from: number; to: number; exact: boolean };

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

  const latestUrl = new URL(`${API_ROOT}/devices/${encodeURIComponent(deviceId)}/sensordata/latest`);
  const latestResponse = await fetch(latestUrl, {
    headers: { "Api-Key": apiKey, Accept: "application/json" },
    cache: "no-store",
  }).catch(() => null);
  const latestPayload = latestResponse?.ok ? await latestResponse.json().catch(() => null) : null;
  const supplemental = sensorRecords(latestPayload)
    .map((record) => normalize(record, includeAdditionalEnvironmental))
    .filter((sample): sample is Sample => sample !== null)
    .sort((a, b) => a.timestamp - b.timestamp)
    .at(-1) ?? null;
  return mergeSupplementalSample(history, supplemental);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const exportRequested = requestUrl.searchParams.get("export") === "1";
  const inlineExport = requestUrl.searchParams.get("inline") === "1";
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
  let range: TimeRange;
  try {
    range = requestedRange(requestUrl, exportRequested);
  } catch {
    return Response.json({ error: "Invalid export time range" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const [labHistory, officeHistory] = await Promise.all([
      fetchRoom(labId, apiKey, range, exportRequested),
      fetchRoom(officeId, apiKey, range, exportRequested),
    ]);
    if (!labHistory.length || !officeHistory.length) throw new Error("No recent records returned");
    const headers = new Headers({ "Cache-Control": "no-store, max-age=0" });
    if (exportRequested && !inlineExport) {
      headers.set("Content-Disposition", 'attachment; filename="airq-dashboard-data.json"');
    }
    return Response.json({
      live: true,
      fetchedAt: Date.now(),
      coverage: { from: range.from, to: range.to, exact: range.exact },
      historyHours: (range.to - range.from) / (60 * 60_000),
      analysisMinutes: ANALYSIS_MINUTES,
      rooms: {
        lab: analyseRoom("LAB", labHistory, positiveNumber(runtimeEnv.LAB_VOLUME_M3), positiveNumber(runtimeEnv.LAB_ACH)),
        office: analyseRoom("OFFICE", officeHistory, positiveNumber(runtimeEnv.OFFICE_VOLUME_M3), positiveNumber(runtimeEnv.OFFICE_ACH)),
      },
    }, { headers });
  } catch {
    return Response.json({ error: "Recent air-Q readings are temporarily unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
