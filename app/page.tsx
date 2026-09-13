"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DASHBOARD_BUILD_VERSION } from "@/lib/dashboard-version";
import { createDisplayUpdateMonitor, DISPLAY_UPDATE_ATTEMPT_KEY, DISPLAY_UPDATE_VIEW_KEY, readDisplayUpdateValue, writeDisplayUpdateValue, type DisplayUpdateView } from "@/lib/display-updates";

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
  pm4: number | null;
  pm10: number | null;
  sound: number | null;
  soundMax: number | null;
  health: number | null;
  performance: number | null;
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

type Check = {
  label: string;
  method: "DIRECT" | "PROXY" | "PATTERN" | "RAW" | "SYSTEM" | "COMPUTED UNTIL PROPANE SENSOR IS INSTALLED" | "COMPUTED UNTIL NITROGEN SENSOR IS INSTALLED";
  status: string;
  level: "normal" | "watch" | "action" | "unknown";
};

type RoomData = {
  name: "LAB" | "OFFICE";
  status: "normal" | "watch" | "action" | "unknown";
  statusLabel: string;
  samples: Sample[];
  latest: Sample | null;
  checks: Check[];
  summary: string;
  action: string;
};

type DashboardData = {
  live: boolean;
  fetchedAt: number;
  historyHours: number;
  analysisMinutes: number;
  message?: string;
  outdoor?: OutdoorData | null;
  rooms: { lab: RoomData; office: RoomData };
};

type GradeLevel = "great" | "good" | "watch" | "action" | "unknown";
type Grade = { label: string; level: GradeLevel };

const ACOUSTIC_CHECK_LABEL = "Sound peak >90 dB";
const REPORT_PENDING_MESSAGE = "Recent week’s report has not been generated yet.";
// Retain the authenticated weekly-report flow while feedback determines whether
// the dashboard should expose its download control again.
const SHOW_WEEKLY_REPORT_DOWNLOAD = false;
const DISPLAY_SESSION_STORAGE_KEY = "bitz-display-session-v1";
const DISPLAY_SESSION_HEADER = "X-BITZ-Display-Session";
const LAB_FLOOR_AREA_ESTIMATE_M2 = 18;
const LAB_VOLUME_ESTIMATE_M3 = 50;

let inMemoryDisplaySession = "";

function isTizenDisplay() {
  return typeof window !== "undefined" && /Tizen|SMART-TV|TizenBrowser/i.test(window.navigator.userAgent);
}

function readDisplaySession() {
  if (inMemoryDisplaySession) return inMemoryDisplaySession;
  if (typeof window === "undefined") return "";
  try {
    inMemoryDisplaySession = window.localStorage.getItem(DISPLAY_SESSION_STORAGE_KEY) ?? "";
  } catch {
    inMemoryDisplaySession = "";
  }
  if (!inMemoryDisplaySession) {
    try { inMemoryDisplaySession = window.sessionStorage.getItem(DISPLAY_SESSION_STORAGE_KEY) ?? ""; }
    catch { /* Keep the cookie-based session when browser storage is restricted. */ }
  }
  return inMemoryDisplaySession;
}

function storeDisplaySession(token: string) {
  inMemoryDisplaySession = token;
  try {
    window.localStorage.setItem(DISPLAY_SESSION_STORAGE_KEY, token);
  } catch {
    // The in-memory copy still keeps the current kiosk session open.
  }
  try { window.sessionStorage.setItem(DISPLAY_SESSION_STORAGE_KEY, token); }
  catch { /* The local or in-memory copy can still authorize this display. */ }
}

function clearDisplaySession() {
  inMemoryDisplaySession = "";
  try {
    window.localStorage.removeItem(DISPLAY_SESSION_STORAGE_KEY);
  } catch {
    // Some managed signage configurations disable persistent web storage.
  }
  try { window.sessionStorage.removeItem(DISPLAY_SESSION_STORAGE_KEY); }
  catch { /* Storage may be disabled. */ }
}

async function preserveDisplayLoginForUpdate() {
  const token = readDisplaySession();
  if (!token) return true; // This display was authorized by its saved cookie.
  storeDisplaySession(token);
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try { if (window[name].getItem(DISPLAY_SESSION_STORAGE_KEY) === token) return true; }
    catch { /* Try the other persistence mechanism. */ }
  }
  // Verify the cookie alone before navigating away from an in-memory token.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch("/api/auth", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
    return response.ok && (await response.json()).authorized === true;
  } finally { clearTimeout(timeout); }
}

function dashboardFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const session = readDisplaySession();
  if (session) headers.set(DISPLAY_SESSION_HEADER, session);
  return fetch(input, { ...init, headers, credentials: "same-origin" });
}

type ReportAvailability = { available: boolean; fileName?: string; periodLabel?: string; message?: string };

function latestAcousticEventAt(samples: Sample[]) {
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const sample = samples[index];
    if (sample.soundMax !== null && sample.soundMax > 90) return sample.timestamp;
  }
  return null;
}

function roomAtTime(room: RoomData, now: number, analysisMinutes: number): RoomData {
  const acousticCheck = room.checks.find((check) => check.label === ACOUSTIC_CHECK_LABEL);
  if (!acousticCheck || acousticCheck.level !== "watch") return room;

  const eventAt = latestAcousticEventAt(room.samples);
  if (eventAt !== null && now < eventAt + analysisMinutes * 60_000) return room;

  const checks = room.checks.map((check) => check.label === ACOUSTIC_CHECK_LABEL
    ? { ...check, status: "NONE", level: "normal" as const }
    : check);
  const anotherActiveCheck = checks.some((check) => check.level === "watch" || check.level === "action" || check.level === "unknown");
  if (anotherActiveCheck) return { ...room, checks };

  return {
    ...room,
    status: "normal",
    statusLabel: "AVAILABLE CHANNELS NORMAL",
    checks,
    summary: "The recent pattern is stable across the available channels.",
    action: "No immediate change is suggested; review again if the pattern persists or gains a second signal.",
  };
}

// Keep the server and first client render identical. Live timestamps replace this
// deterministic preview anchor immediately after hydration when the feed is set.
const createdAt = Date.UTC(2026, 8, 3, 14, 0, 0);

function demoSeries(room: "LAB" | "OFFICE"): Sample[] {
  const lab = room === "LAB";
  return Array.from({ length: 145 }, (_, index) => {
    const wave = Math.sin(index / 8.5);
    const workday = Math.max(0, Math.sin(((index - 39) / 84) * Math.PI));
    const vapourEvent = Math.exp(-Math.pow((index - 116) / 8, 2));
    const timestamp = createdAt - (144 - index) * 10 * 60_000;
    return {
      timestamp,
      temperature: lab ? 18.4 + wave * 0.18 : 24.2 + workday * 1.1 + wave * 0.2,
      humidity: lab ? 56.6 + wave * 0.9 : 48.4 + workday * 2.4 + wave,
      humidityAbs: lab ? 8.9 + wave * 0.12 : 11 + workday * 0.7 + wave * 0.1,
      dewpt: lab ? 10.0 + wave * 0.2 : 13.0 + workday * 0.7 + wave * 0.2,
      co2: lab ? 690 + workday * 165 + index * 0.4 : 430 + workday * 120 + Math.max(0, index - 136) * 3,
      co: lab ? 0.18 + wave * 0.02 : 0.39 + wave * 0.03,
      oxygen: lab ? 20.53 + wave * 0.015 : 20.44 + wave * 0.012,
      tvoc: lab ? 85 + workday * 60 + vapourEvent * 225 : 72 + workday * 70 + Math.max(0, index - 136) * 2,
      hcho: lab ? 7.8 + workday * 2 + vapourEvent * 6 : 3.2 + workday * 1.4,
      pm1: lab ? 0 : 0.8 + Math.max(0, wave),
      pm25: lab ? 0 : 1 + Math.max(0, wave * 1.5),
      pm4: lab ? 0 : 1.1 + Math.max(0, wave * 1.65),
      pm10: lab ? 0 : 1.2 + Math.max(0, wave * 1.8),
      sound: lab ? 42 + workday * 14 + Math.abs(wave) * 6 : 31 + workday * 5,
      soundMax: lab ? (index === 119 ? 81 : 59 + workday * 12) : 39 + workday * 7,
      health: lab ? 94 - vapourEvent * 9 : 97 - workday,
      performance: lab ? 76 - workday * 6 - vapourEvent * 7 : 86 - workday * 4,
    };
  });
}

function demoRoom(name: "LAB" | "OFFICE"): RoomData {
  const samples = demoSeries(name);
  const lab = name === "LAB";
  return {
    name,
    status: "normal",
    statusLabel: "AVAILABLE CHANNELS NORMAL",
    samples,
    latest: samples.at(-1) ?? null,
    summary: lab
      ? "An earlier vapour response is returning toward the LAB reference without a particle rise."
      : "A gentle CO₂ rise with stable PM is visible; no unusual outdoor-air pattern is visible.",
    action: lab
      ? "No immediate change is suggested; revisit the hood or process only if TVOC reverses or remains elevated for 30 minutes."
      : "No immediate change is suggested; revisit if CO₂ and VOC rise together or PM enters with a ventilation change.",
    checks: [
      { label: "CO release", method: "DIRECT", status: "NO ELEVATION", level: "normal" },
      { label: "O₂ displacement", method: "PROXY", status: "NOT INDICATED", level: "normal" },
      { label: "Volatile-gas pattern", method: "PATTERN", status: "NORMAL", level: "normal" },
      { label: "Formaldehyde elevation", method: "DIRECT", status: "NOT DETECTED", level: "normal" },
      { label: "Particle pattern", method: "RAW", status: "NO RISE", level: "normal" },
      { label: "CO₂ accumulation", method: "PATTERN", status: "STABLE", level: "normal" },
      { label: "Sound peak >90 dB", method: "RAW", status: "NONE", level: "normal" },
      { label: "Sensor/data integrity", method: "SYSTEM", status: "CURRENT", level: "normal" },
    ],
  };
}

const DEMO_DATA: DashboardData = {
  live: false,
  fetchedAt: createdAt,
  historyHours: 24,
  analysisMinutes: 60,
  message: "Establishing secure airQ connection · Preparing LIVE data display",
  outdoor: {
    location: "Oberschneiding",
    source: "DWD via Bright Sky",
    station: null,
    samples: demoSeries("OFFICE").filter((_, index) => index % 6 === 0).map((sample, index) => ({
      timestamp: sample.timestamp,
      temperature: 13.8 + Math.sin(index / 2.7) * 4.1,
      humidity: 74 - Math.sin(index / 2.7) * 18,
    })),
    latest: { timestamp: createdAt, temperature: 14.1, humidity: 73 },
    particleLatest: { timestamp: createdAt, pm25: 7.2 },
  },
  rooms: { lab: demoRoom("LAB"), office: demoRoom("OFFICE") },
};

function fmt(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function chronologicalByTimestamp<T extends { timestamp: number }>(samples: T[]) {
  // The live API already returns strictly ordered, deduplicated records.
  // Preserve that array identity when no normalization is needed.
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  let alreadyChronological = true;
  for (const sample of samples) {
    if (!Number.isFinite(sample.timestamp) || sample.timestamp <= previousTimestamp) {
      alreadyChronological = false;
      break;
    }
    previousTimestamp = sample.timestamp;
  }
  if (alreadyChronological) return samples;

  const unique = new Map<number, T>();
  for (const sample of samples) {
    if (Number.isFinite(sample.timestamp)) unique.set(sample.timestamp, sample);
  }
  return [...unique.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function normalizeDashboardData(payload: DashboardData): DashboardData {
  const labSamples = chronologicalByTimestamp(payload.rooms.lab.samples);
  const officeSamples = chronologicalByTimestamp(payload.rooms.office.samples);
  const outdoorSamples = payload.outdoor ? chronologicalByTimestamp(payload.outdoor.samples) : [];

  return {
    ...payload,
    outdoor: payload.outdoor
      ? {
          ...payload.outdoor,
          samples: outdoorSamples,
          latest: outdoorSamples.at(-1) ?? payload.outdoor.latest,
        }
      : payload.outdoor,
    rooms: {
      lab: { ...payload.rooms.lab, samples: labSamples, latest: labSamples.at(-1) ?? payload.rooms.lab.latest },
      office: { ...payload.rooms.office, samples: officeSamples, latest: officeSamples.at(-1) ?? payload.rooms.office.latest },
    },
  };
}

function berlinClock(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

function berlinHour(timestamp: number) {
  const part = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(timestamp).find((item) => item.type === "hour");
  return Number(part?.value ?? 0);
}

function berlinWeekday(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    weekday: "short",
  }).format(timestamp);
}

function berlinAxisLabel(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    hour: "numeric",
    hour12: true,
  }).format(timestamp).toUpperCase();
}

function roundedTimeTicks(start: number, end: number) {
  const durationHours = Math.max((end - start) / 3_600_000, 0);
  const intervalHours = durationHours >= 18 ? 6 : durationHours >= 9 ? 3 : 1;
  const ticks: Array<{ x: number; labelX: number; label: string; midnight: boolean }> = [];
  const firstWholeHour = Math.ceil(start / 3_600_000) * 3_600_000;
  for (let timestamp = firstWholeHour; timestamp <= end; timestamp += 3_600_000) {
    const hour = berlinHour(timestamp);
    if (hour % intervalHours !== 0) continue;
    const x = ((timestamp - start) / Math.max(end - start, 1)) * 100;
    ticks.push({
      x,
      labelX: Math.min(96, Math.max(4, x)),
      label: berlinAxisLabel(timestamp),
      midnight: hour === 0,
    });
  }
  return ticks;
}

const BERLIN_CALENDAR = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function berlinCalendar(timestamp: number) {
  const values: Record<string, string> = {};
  for (const part of BERLIN_CALENDAR.formatToParts(timestamp)) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  const hour = Number(values.hour ?? 0);
  const minute = Number(values.minute ?? 0);
  return {
    dayKey: [values.year, values.month, values.day].join("-"),
    minuteOfDay: hour * 60 + minute,
  };
}

function berlinShortTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(timestamp);
}

function berlinCompactDate(timestamp: number) {
  const [year, month, day] = berlinCalendar(timestamp).dayKey.split("-");
  return `${month}${day}${year.slice(-2)}`;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function latestValue(samples: Sample[], selector: (sample: Sample) => number | null) {
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const value = selector(samples[index]);
    if (value !== null && Number.isFinite(value)) return value;
  }
  return null;
}

function latestObservation(samples: Sample[], selector: (sample: Sample) => number | null) {
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const value = selector(samples[index]);
    if (value !== null && Number.isFinite(value)) return { value, timestamp: samples[index].timestamp };
  }
  return null;
}

function pmBalanceValue(sample: Sample) {
  const channels = [sample.pm1, sample.pm25, sample.pm4, sample.pm10]
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (!channels.length) return null;
  return channels.reduce((sum, value) => sum + value, 0) / channels.length;
}

function pmBalanceObservation(samples: Sample[]) {
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const sample = samples[index];
    const value = pmBalanceValue(sample);
    if (value !== null) {
      return {
        value,
        pm1: sample.pm1,
        pm25: sample.pm25,
        pm4: sample.pm4,
        pm10: sample.pm10,
        timestamp: sample.timestamp,
      };
    }
  }
  return null;
}

function empiricalDecayRate(samples: Sample[], selector: (sample: Sample) => number | null, baseline: number, floor: number, period: "NIGHT" | "DAY") {
  const ordered = [...samples].sort((left, right) => left.timestamp - right.timestamp);
  const rates: number[] = [];
  for (const start of ordered) {
    const minute = berlinCalendar(start.timestamp).minuteOfDay;
    if (period === "NIGHT" ? minute >= 6 * 60 : minute < 7 * 60 || minute > 18 * 60) continue;
    const startValue = selector(start);
    if (startValue === null || startValue - baseline < floor) continue;
    const end = ordered.find((sample) => sample.timestamp >= start.timestamp + 30 * 60_000 && sample.timestamp <= start.timestamp + 45 * 60_000);
    if (!end) continue;
    const endValue = selector(end);
    if (endValue === null || endValue >= startValue) continue;
    const interval = ordered.filter((sample) => sample.timestamp >= start.timestamp && sample.timestamp <= end.timestamp)
      .map(selector).filter((value): value is number => value !== null && Number.isFinite(value));
    if (interval.length < 6) continue;
    const fallingSteps = interval.slice(1).filter((value, index) => value <= interval[index]).length;
    if (fallingSteps / (interval.length - 1) < .6) continue;
    const hours = (end.timestamp - start.timestamp) / 3_600_000;
    const rate = Math.log((startValue - baseline) / Math.max(endValue - baseline, floor * .1)) / hours;
    if (Number.isFinite(rate) && rate > 0) rates.push(rate);
  }
  return median(rates);
}

function labDaySupportsSavingReview(samples: Sample[], latest: Sample) {
  if (!Number.isFinite(latest.timestamp)) return false;
  const latestCalendar = berlinCalendar(latest.timestamp);
  // A completed night reference plus at least one hour of daytime evidence.
  if (latestCalendar.minuteOfDay < 7 * 60) return false;
  const day = samples.filter((sample) => Number.isFinite(sample.timestamp) && sample.timestamp <= latest.timestamp)
    .map((sample) => ({ sample, ...berlinCalendar(sample.timestamp) }))
    .filter((point) => point.dayKey === latestCalendar.dayKey)
    .sort((left, right) => left.sample.timestamp - right.sample.timestamp);
  if (new Set(day.map((point) => point.sample.timestamp)).size !== day.length) return false;
  const night = day.filter((point) => point.minuteOfDay < 6 * 60);
  const daytime = day.filter((point) => point.minuteOfDay >= 6 * 60);
  if (!night.length || !daytime.length || night[0].minuteOfDay > 5) return false;
  // Derive each boundary from its local source time, including DST nights.
  const nightStart = Math.floor(night[0].sample.timestamp / 60_000) * 60_000 - night[0].minuteOfDay * 60_000;
  const dayStart = Math.floor(daytime[0].sample.timestamp / 60_000) * 60_000 - (daytime[0].minuteOfDay - 6 * 60) * 60_000;
  const recentStart = latest.timestamp - 60 * 60_000;
  const hasCoverage = (points: Sample[], start: number, end: number) =>
    points.length >= Math.ceil((end - start) / 120_000 * .8) &&
    points[0].timestamp <= start + 5 * 60_000 &&
    points[points.length - 1].timestamp >= end - 5 * 60_000 &&
    points.every((point, index) => index === 0 || point.timestamp - points[index - 1].timestamp <= 5 * 60_000);

  // Current conditions must also pass the existing LAB display bands. A high
  // operational night reference cannot redefine an elevated level as clear.
  const withinLabBands = (sample: Sample) => [
    co2Grade(sample.co2), tvocGrade(sample.tvoc), oxygenGrade(sample.oxygen),
    temperatureGrade(sample.temperature, "LAB"), humidityGrade(sample.humidity), labPmSampleGrade(sample),
  ].every((grade) => grade.level === "great" || grade.level === "good");
  if (!withinLabBands(latest) || !daytime.filter((point) => point.sample.timestamp >= recentStart)
    .every((point) => withinLabBands(point.sample))) return false;

  // These are comparison bands, not sensor accuracy or safety limits. Lower
  // contaminant/noise readings are compatible with clearance. Climate follows
  // the existing LAB bands; oxygen retains a bounded two-sided stability check.
  const channels: Array<{ key: keyof Sample; resolution: number; maxDrift: number; mode: "upper" | "stable" | "climate" }> = [
    { key: "co2", resolution: 1, maxDrift: 20, mode: "upper" },
    { key: "tvoc", resolution: 1, maxDrift: 25, mode: "upper" },
    { key: "hcho", resolution: .1, maxDrift: 1, mode: "upper" },
    { key: "co", resolution: .01, maxDrift: .03, mode: "upper" },
    { key: "oxygen", resolution: .01, maxDrift: .03, mode: "stable" },
    { key: "pm1", resolution: .1, maxDrift: .3, mode: "upper" },
    { key: "pm25", resolution: .1, maxDrift: .3, mode: "upper" },
    { key: "pm4", resolution: .1, maxDrift: .3, mode: "upper" },
    { key: "pm10", resolution: .1, maxDrift: .5, mode: "upper" },
    { key: "temperature", resolution: .1, maxDrift: .4, mode: "climate" },
    { key: "humidity", resolution: 1, maxDrift: 3, mode: "climate" },
    { key: "humidityAbs", resolution: .01, maxDrift: .12, mode: "climate" },
    { key: "sound", resolution: 1, maxDrift: 2.5, mode: "upper" },
    { key: "soundMax", resolution: 1, maxDrift: 4, mode: "upper" },
  ];
  return channels.every(({ key, resolution, maxDrift, mode }) => {
    const valid = (sample: Sample) => typeof sample[key] === "number" && Number.isFinite(sample[key]) &&
      (key === "temperature" || sample[key]! >= 0) && (key !== "co2" || sample[key]! > 0);
    const nightPoints = night.map((point) => point.sample).filter(valid);
    const dayPoints = daytime.map((point) => point.sample).filter(valid);
    const recentPoints = dayPoints.filter((sample) => sample.timestamp >= recentStart);
    if (!valid(latest) || !hasCoverage(nightPoints, nightStart, dayStart) ||
      !hasCoverage(recentPoints, recentStart, latest.timestamp)) return false;
    // Temperature, RH and absolute humidity can move together with air handling
    // and daily weather. They remain observed, without requiring night equality
    // or making an external weather service part of this gate.
    if (mode === "climate") return true;
    const centre = median(nightPoints.map((sample) => sample[key]!))!;
    const deviation = median(nightPoints.map((sample) => Math.abs(sample[key]! - centre)))!;
    const tolerance = Math.max(resolution, Math.min(maxDrift, deviation * 3));
    const matches = (value: number) => (mode === "upper" ? value - centre : Math.abs(value - centre)) <= tolerance + 1e-9;
    if (!matches(median(recentPoints.map((sample) => sample[key]!))!) || !matches(latest[key]!)) return false;
    // Short sustained changes must not disappear inside the current review
    // window. Old, fully recovered drift must not pin the display to 0%.
    const blocks = new Map<number, number[]>();
    for (const sample of recentPoints) {
      const block = Math.floor((sample.timestamp - recentStart) / (15 * 60_000));
      const values = blocks.get(block) ?? [];
      values.push(sample[key]!);
      blocks.set(block, values);
    }
    if (![...blocks.values()].every((values) => matches(median(values)!))) return false;
    // A new accumulation can sit below an elevated night baseline. Compare
    // consecutive 15-minute windows in the latest hour and the current raw
    // value against the recent low, so falling overnight CO2 cannot mask it.
    if (mode === "upper") {
      const trajectory: number[] = [];
      for (let start = recentStart; start < latest.timestamp; start += 15 * 60_000) {
        const values = recentPoints.filter((sample) => sample.timestamp >= start && sample.timestamp < start + 15 * 60_000)
          .map((sample) => sample[key]!);
        const value = median(values);
        if (value === null) return false;
        trajectory.push(value);
      }
      const recentLow = Math.min(...trajectory);
      let previousLow = trajectory[0];
      for (const value of trajectory.slice(1)) {
        if (value - previousLow > maxDrift + 1e-9) return false;
        previousLow = Math.min(previousLow, value);
      }
      if (latest[key]! - recentLow > maxDrift + 1e-9) return false;
    }
    // Preserve isolated raw acoustic events rather than averaging them away.
    return key !== "soundMax" || recentPoints.every((sample) => sample.soundMax! <= 90);
  });
}

function labSavingChecksClear(room: Pick<RoomData, "status" | "checks" | "latest">, live = false, now = Date.now()) {
  // Recheck the feed at render time: a cached CURRENT check cannot keep a
  // planning figure visible after a paused feed exceeds the existing 8-minute freshness rule.
  if (!live || !room.latest || !Number.isFinite(now) || !Number.isFinite(room.latest.timestamp) ||
    room.latest.timestamp > now || now - room.latest.timestamp > 8 * 60_000) return false;
  const required = ["CO release", "O₂ displacement", "Propane-associated pattern", "Nitrogen (N₂) displacement pattern",
    "Volatile-gas pattern", "Formaldehyde elevation", "Particle pattern", "CO₂ accumulation", "Sound peak >90 dB", "Sensor/data integrity"];
  return room.status === "normal" && room.checks.every((check) => check.level === "normal") &&
    required.every((label) => room.checks.some((check) => check.label === label && check.level === "normal"));
}

function airflowAdjustmentEstimate(samples: Sample[], officeSamples: Sample[], latest: Sample, savingChecksClear = false) {
  const latestCalendar = berlinCalendar(latest.timestamp);
  const sameDay = samples.filter((sample) => Number.isFinite(sample.timestamp) && sample.timestamp <= latest.timestamp &&
    berlinCalendar(sample.timestamp).dayKey === latestCalendar.dayKey);
  const night = sameDay.filter((sample) => berlinCalendar(sample.timestamp).minuteOfDay < 6 * 60);
  const recent = sameDay.filter((sample) => sample.timestamp >= latest.timestamp - 15 * 60_000);
  const channelMedian = (source: Sample[], selector: (sample: Sample) => number | null) =>
    median(source.map(selector).filter((value): value is number => value !== null && Number.isFinite(value)));
  const step = (rise: number, thresholds: [number, number, number, number]) =>
    rise >= thresholds[3] ? 20 : rise >= thresholds[2] ? 15 : rise >= thresholds[1] ? 10 : rise >= thresholds[0] ? 5 : 0;

  const tvoc = channelMedian(recent, (sample) => sample.tvoc);
  const tvocNight = channelMedian(night, (sample) => sample.tvoc);
  const co2 = channelMedian(recent, (sample) => sample.co2);
  const pm25 = channelMedian(recent, (sample) => sample.pm25);
  const pm25Night = channelMedian(night, (sample) => sample.pm25);
  const pm10 = channelMedian(recent, (sample) => sample.pm10);
  const pm10Night = channelMedian(night, (sample) => sample.pm10);

  const candidates = [
    { adjustment: tvoc !== null && tvocNight !== null ? step(tvoc - tvocNight, [30, 75, 150, 300]) : 0, select: (sample: Sample) => sample.tvoc, floor: 30 },
    { adjustment: co2 === null ? 0 : step(co2 - 800, [50, 200, 600, 1200]), select: (sample: Sample) => sample.co2, floor: 50 },
    { adjustment: pm25 !== null && pm25Night !== null ? step(pm25 - pm25Night, [3, 7, 15, 25]) : 0, select: (sample: Sample) => sample.pm25, floor: 3 },
    { adjustment: pm10 !== null && pm10Night !== null ? step(pm10 - pm10Night, [5, 12, 25, 40]) : 0, select: (sample: Sample) => sample.pm10, floor: 5 },
  ];
  const strongest = candidates.reduce((best, candidate) => candidate.adjustment > best.adjustment ? candidate : best);
  if (strongest.adjustment > 0) {
    const officeNight = officeSamples.filter((sample) => berlinCalendar(sample.timestamp).minuteOfDay < 6 * 60);
    const officeBaseline = channelMedian(officeNight, strongest.select);
    const closedRate = officeBaseline === null ? null : empiricalDecayRate(officeSamples, strongest.select, officeBaseline, strongest.floor, "NIGHT");
    const ventilatedRate = officeBaseline === null ? null : empiricalDecayRate(officeSamples, strongest.select, officeBaseline, strongest.floor, "DAY");
    const recoverySpread = closedRate !== null && ventilatedRate !== null && ventilatedRate > closedRate
      ? Math.min(30, Math.max(5, Math.ceil((ventilatedRate / closedRate - 1)) * 5))
      : 10;
    const maximum = Math.min(50, strongest.adjustment + recoverySpread);
    return `ESTIMATE 《+${strongest.adjustment}–${maximum}%》 REQUIRED`;
  }
  // This is the user's planning figure for the future control system, not a
  // measured saving, a safe operating limit, or a command to change airflow.
  const weekday = berlinWeekday(latest.timestamp);
  if (savingChecksClear && (weekday === "Sat" || weekday === "Sun") && labDaySupportsSavingReview(sameDay, latest)) {
    return "ESTIMATE 《−50–60%》 POSSIBLE";
  }
  return "ESTIMATE 《0%》 POSSIBLE";
}

function compactAirflowStatus(status: string) {
  return status
    .replace("ESTIMATE 《", "EST. ")
    .replace("》 POSSIBLE", " POSS.")
    .replace("》 REQUIRED", " REQ.");
}

function hepaAssessment(samples: Sample[], officeSamples: Sample[], latest: Sample | null, savingChecksClear = false) {
  const observation = pmBalanceObservation(samples);
  if (!latest || !observation || latest.timestamp - observation.timestamp > 10 * 60_000) return null;
  if (observation.pm25 === null || observation.pm10 === null) return null;

  const paired = samples
    .filter((sample) => sample.pm25 !== null && sample.pm10 !== null)
    .map((sample) => ({ timestamp: sample.timestamp, pm25: sample.pm25!, pm10: sample.pm10! }));
  const night = paired.filter((sample) => berlinCalendar(sample.timestamp).minuteOfDay < 6 * 60);
  const baseline25 = median(night.map((sample) => sample.pm25));
  const baseline10 = median(night.map((sample) => sample.pm10));
  const limit25 = Math.max(5, (baseline25 ?? 0) + 3);
  const limit10 = Math.max(10, (baseline10 ?? 0) + 5);
  const withinBand = (sample: { pm25: number; pm10: number }) => sample.pm25 <= limit25 && sample.pm10 <= limit10;
  const currentWithin = withinBand(observation);
  const airflow = airflowAdjustmentEstimate(samples, officeSamples, latest, savingChecksClear);

  if (!currentWithin) {
    return {
      status: "CHECK",
      airflow,
      level: "watch" as const,
      note: "PM₂.₅ + PM₁₀ above LAB band",
      airflowNote: `≈${LAB_FLOOR_AREA_ESTIMATE_M2} m² // ≈${LAB_VOLUME_ESTIMATE_M3} m³ provisional`,
    };
  }

  const recent = paired.filter((sample) => sample.timestamp >= observation.timestamp - 6 * 60 * 60_000);
  let lastAboveIndex = -1;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    if (!withinBand(recent[index])) {
      lastAboveIndex = index;
      break;
    }
  }
  if (lastAboveIndex >= 0) {
    let episodeStart = lastAboveIndex;
    while (
      episodeStart > 0 &&
      !withinBand(recent[episodeStart - 1]) &&
      recent[episodeStart].timestamp - recent[episodeStart - 1].timestamp <= 10 * 60_000
    ) {
      episodeStart -= 1;
    }
    const recovery = recent.slice(lastAboveIndex + 1).find((sample, offset, list) =>
      withinBand(sample) && (offset === list.length - 1 || withinBand(list[offset + 1]))
    );
    if (recovery) {
      const clearanceMinutes = Math.round((recovery.timestamp - recent[episodeStart].timestamp) / 60_000);
      if (clearanceMinutes > 60) {
        return {
          status: "CHECK",
          airflow,
          level: "watch" as const,
          note: "Particle return exceeded 60 min",
          airflowNote: `≈${LAB_FLOOR_AREA_ESTIMATE_M2} m² // ≈${LAB_VOLUME_ESTIMATE_M3} m³ provisional`,
        };
      }
      return {
        status: "GOOD",
        airflow,
        level: "normal" as const,
        note: `PM returned within ${clearanceMinutes} min`,
        airflowNote: `≈${LAB_FLOOR_AREA_ESTIMATE_M2} m² // ≈${LAB_VOLUME_ESTIMATE_M3} m³ provisional`,
      };
    }
  }

  return {
    status: "GOOD",
    airflow,
    level: "normal" as const,
    note: "PM₂.₅ + PM₁₀ within LAB band",
    airflowNote: `≈${LAB_FLOOR_AREA_ESTIMATE_M2} m² // ≈${LAB_VOLUME_ESTIMATE_M3} m³ provisional`,
  };
}

function indexGrade(value: number | null): Grade {
  if (value === null) return { label: "NO DATA", level: "unknown" };
  if (value >= 90) return { label: "GREAT", level: "great" };
  if (value > 50) return { label: "GOOD", level: "great" };
  return { label: "LOW", level: "watch" };
}

function co2Grade(value: number | null): Grade {
  if (value === null) return { label: "NO DATA", level: "unknown" };
  if (value < 800) return { label: "GREAT", level: "great" };
  if (value < 1_000) return { label: "GOOD", level: "good" };
  if (value < 1_400) return { label: "CHECK", level: "watch" };
  return { label: "VENTILATE", level: "action" };
}

function tvocGrade(value: number | null): Grade {
  if (value === null) return { label: "NO DATA", level: "unknown" };
  if (value <= 50) return { label: "PRISTINE", level: "great" };
  if (value < 250) return { label: "CLEAR", level: "great" };
  if (value < 500) return { label: "GOOD", level: "good" };
  if (value < 1_000) return { label: "CHECK", level: "watch" };
  return { label: "SOURCE", level: "action" };
}

function oxygenGrade(value: number | null): Grade {
  if (value === null) return { label: "NO DATA", level: "unknown" };
  if (value >= 20.3) return { label: "GREAT", level: "great" };
  if (value >= 20.0) return { label: "GOOD", level: "good" };
  if (value >= 19.5) return { label: "CHECK", level: "watch" };
  return { label: "ACT", level: "action" };
}

function temperatureGrade(value: number | null, room: "LAB" | "OFFICE"): Grade {
  if (value === null) return { label: "NO DATA", level: "unknown" };
  const ideal = room === "LAB" ? value >= 18 && value <= 22 : value >= 20 && value <= 25;
  if (ideal) return { label: "GREAT", level: "great" };
  if (value >= 16 && value <= 26) return { label: "GOOD", level: "good" };
  if (value >= 14 && value <= 28) return { label: "CHECK", level: "watch" };
  return { label: "ACT", level: "action" };
}

function humidityGrade(value: number | null): Grade {
  if (value === null) return { label: "NO DATA", level: "unknown" };
  if (value >= 40 && value <= 60) return { label: "GREAT", level: "great" };
  if (value >= 30 && value <= 65) return { label: "GOOD", level: "good" };
  if (value >= 25 && value <= 70) return { label: "CHECK", level: "watch" };
  return { label: "ACT", level: "action" };
}

function labHumidityAdaptation(room: RoomData, outdoor: OutdoorData | null) {
  const latest = room.latest;
  const outdoorLatest = outdoor?.latest ?? null;
  if (!latest || !outdoor || outdoorLatest?.humidity === null || outdoorLatest?.humidity === undefined) return false;

  const dayKey = berlinCalendar(latest.timestamp).dayKey;
  const currentOutdoorHigh = outdoorLatest.humidity > 70;
  const indoorIsTenLower = latest.humidity !== null && outdoorLatest.humidity - latest.humidity >= 10;
  const outdoorWasVeryHighToday = outdoor.samples.some((sample) =>
    sample.timestamp <= latest.timestamp &&
    berlinCalendar(sample.timestamp).dayKey === dayKey &&
    sample.humidity !== null &&
    sample.humidity > 80
  );
  return currentOutdoorHigh || indoorIsTenLower || outdoorWasVeryHighToday;
}

function labHumidityGrade(value: number | null, adaptationActive: boolean): Grade {
  const indoorGrade = humidityGrade(value);
  if (
    value !== null &&
    value > 65 &&
    adaptationActive &&
    (indoorGrade.level === "watch" || indoorGrade.level === "action")
  ) {
    return { label: "ADAPT", level: "watch" };
  }
  return indoorGrade;
}

function labPerformanceGrade(
  value: number | null,
  sample: Sample | null,
  humidityAdaptationActive: boolean,
  checks: Check[],
): Grade {
  const base = indexGrade(value);
  if ((base.level !== "watch" && base.level !== "action") || !sample || !humidityAdaptationActive) {
    return base;
  }
  const independentChecksClear = checks.every((check) => check.level === "normal");
  const independentGrades = [
    indexGrade(sample.health),
    co2Grade(sample.co2),
    tvocGrade(sample.tvoc),
    oxygenGrade(sample.oxygen),
    temperatureGrade(sample.temperature, "LAB"),
    labPmGrade(sample.pm1),
    labPmGrade(sample.pm25),
  ];
  const independentMetricsClear = independentGrades.every((grade) => grade.level === "great" || grade.level === "good");
  return independentChecksClear && independentMetricsClear
    ? { label: "ADAPT", level: "watch" }
    : base;
}

function labPmGrade(value: number | null): Grade {
  if (value === null) return { label: "NO DATA", level: "unknown" };
  if (value <= 1) return { label: "PRISTINE", level: "great" };
  if (value <= 5) return { label: "CLEAN", level: "great" };
  if (value <= 15) return { label: "GOOD", level: "good" };
  if (value <= 35) return { label: "CHECK", level: "watch" };
  return { label: "HIGH", level: "action" };
}

function officePmGrade(value: number | null): Grade {
  if (value === null) return { label: "NO DATA", level: "unknown" };
  if (value < 10) return { label: "PRISTINE", level: "great" };
  if (value <= 15) return { label: "GOOD", level: "good" };
  if (value <= 35) return { label: "CHECK", level: "watch" };
  return { label: "HIGH", level: "action" };
}

function pmSampleGrade(sample: Pick<Sample, "pm1" | "pm25" | "pm4" | "pm10">, room: "LAB" | "OFFICE"): Grade {
  const gradeFor = room === "LAB" ? labPmGrade : officePmGrade;
  const grades = [sample.pm1, sample.pm25, sample.pm4, sample.pm10]
    .filter((value): value is number => value !== null && Number.isFinite(value))
    .map(gradeFor);
  if (!grades.length) return { label: "NO DATA", level: "unknown" };
  const levelRank: Record<GradeLevel, number> = { unknown: -1, great: 0, good: 1, watch: 2, action: 3 };
  const labelRank: Record<string, number> = { PRISTINE: 0, CLEAN: 1, GOOD: 2, CHECK: 3, HIGH: 4 };
  return grades.reduce((worstGrade, grade) => {
    const levelDifference = levelRank[grade.level] - levelRank[worstGrade.level];
    if (levelDifference > 0) return grade;
    if (levelDifference < 0) return worstGrade;
    return (labelRank[grade.label] ?? 0) > (labelRank[worstGrade.label] ?? 0) ? grade : worstGrade;
  });
}

function labPmSampleGrade(sample: Sample) {
  return pmSampleGrade(sample, "LAB");
}

function officePmSampleGrade(sample: Sample) {
  return pmSampleGrade(sample, "OFFICE");
}

function soundMaxGrade(value: number | null): Grade {
  if (value === null) return { label: "NO DATA", level: "unknown" };
  if (value > 90) return { label: "LOUD", level: "action" };
  if (value > 80) return { label: "NOISY", level: "watch" };
  return { label: "GOOD", level: "great" };
}

function activeSoundGrade(value: number | null): Grade | null {
  if (value === null || value <= 80) return null;
  return soundMaxGrade(value);
}

function pointsFor(
  samples: Sample[],
  selector: (sample: Sample) => number | null,
  domainStart: number,
  domainEnd: number,
  valueMin: number,
  valueMax: number,
) {
  const range = valueMax - valueMin || 1;
  const timeRange = domainEnd - domainStart || 1;
  const ordered = samples
    .map((sample) => ({ sample, value: selector(sample) }))
    .filter((point): point is { sample: Sample; value: number } => point.value !== null && Number.isFinite(point.value))
    .sort((left, right) => left.sample.timestamp - right.sample.timestamp);
  let previousX = 0;
  return ordered.map((point, index) => {
    // Curves and clock ticks share the entire time axis.
    const proportionalX = ((point.sample.timestamp - domainStart) / timeRange) * 100;
    const x = Math.min(100, Math.max(index === 0 ? 0 : previousX, proportionalX));
    previousX = x;
    const y = 25 - ((point.value - valueMin) / range) * 18;
    return { x, y, command: index === 0 ? "M" : "L" };
  });
}

type ClimateReference = {
  samples: OutdoorSample[];
  primary: (sample: OutdoorSample) => number | null;
  secondary?: (sample: OutdoorSample) => number | null;
};

function outdoorValueAt(
  samples: OutdoorSample[],
  selector: (sample: OutdoorSample) => number | null,
  timestamp: number,
) {
  const available = samples
    .map((sample) => ({ timestamp: sample.timestamp, value: selector(sample) }))
    .filter((sample): sample is { timestamp: number; value: number } => sample.value !== null && Number.isFinite(sample.value))
    .sort((left, right) => left.timestamp - right.timestamp);
  if (!available.length) return null;
  let before: { timestamp: number; value: number } | null = null;
  let after: { timestamp: number; value: number } | null = null;
  for (const sample of available) {
    if (sample.timestamp <= timestamp) before = sample;
    if (sample.timestamp >= timestamp) {
      after = sample;
      break;
    }
  }
  if (before && after) {
    if (after.timestamp === before.timestamp) return before.value;
    if (after.timestamp - before.timestamp > 3 * 60 * 60_000) return null;
    const fraction = (timestamp - before.timestamp) / (after.timestamp - before.timestamp);
    return before.value + (after.value - before.value) * fraction;
  }
  const nearest = before ?? after;
  return nearest && Math.abs(nearest.timestamp - timestamp) <= 90 * 60_000 ? nearest.value : null;
}

function HistoryTrend({
  samples,
  primary,
  secondary,
  primaryUnit,
  secondaryUnit,
  label,
  levelFor,
  analysisMinutes = 60,
  noSeriesLabel,
  climateReference,
  sampleGrade,
}: {
  samples: Sample[];
  primary: (sample: Sample) => number | null;
  secondary?: (sample: Sample) => number | null;
  primaryUnit?: string;
  secondaryUnit?: string;
  label: string;
  levelFor: (value: number | null) => Grade;
  analysisMinutes?: number;
  noSeriesLabel?: string;
  climateReference?: ClimateReference;
  sampleGrade?: (sample: Sample) => Grade;
}) {
  const orderedSamples = useMemo(() => chronologicalByTimestamp(samples), [samples]);
  const geometry = useMemo(() => {
    const start = orderedSamples[0]?.timestamp ?? 0;
    const end = orderedSamples.at(-1)?.timestamp ?? start + 1;
    const recentStart = end - analysisMinutes * 60_000;
    function build(selector?: (sample: Sample) => number | null, referenceSelector?: (sample: OutdoorSample) => number | null) {
      if (!selector) return { all: "", recent: "", current: null as { x: number; y: number } | null, count: 0, scale: null as { min: number; max: number } | null };
      const indoorValues = orderedSamples.map(selector).filter((value): value is number => value !== null && Number.isFinite(value));
      const outdoorValues = referenceSelector && climateReference
        ? climateReference.samples.map(referenceSelector).filter((value): value is number => value !== null && Number.isFinite(value))
        : [];
      const values = [...indoorValues, ...outdoorValues];
      if (values.length < 2) {
        const observation = latestObservation(orderedSamples, selector);
        const x = observation ? ((observation.timestamp - start) / Math.max(end - start, 1)) * 100 : 0;
        return { all: "", recent: "", current: observation ? { x, y: 15 } : null, count: indoorValues.length, scale: observation ? { min: observation.value, max: observation.value } : null };
      }
      const min = Math.min(...values);
      const max = Math.max(...values);
      const allPoints = pointsFor(orderedSamples, selector, start, end, min, max);
      const recentPoints = pointsFor(orderedSamples.filter((sample) => sample.timestamp >= recentStart), selector, start, end, min, max);
      return {
        all: allPoints.map((point) => `${point.command}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" "),
        recent: recentPoints.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" "),
        current: allPoints.at(-1) ?? null,
        count: indoorValues.length,
        scale: { min, max },
      };
    }
    function referenceArea(
      referenceSelector: ((sample: OutdoorSample) => number | null) | undefined,
      scale: { min: number; max: number } | null,
    ) {
      if (!climateReference || !referenceSelector || !scale) return "";
      const valueRange = scale.max - scale.min || 1;
      const points = orderedSamples.flatMap((sample) => {
        const outdoor = outdoorValueAt(climateReference.samples, referenceSelector, sample.timestamp);
        if (outdoor === null || !Number.isFinite(outdoor)) return [];
        return [{
          x: ((sample.timestamp - start) / timeRange) * 100,
          y: 25 - ((outdoor - scale.min) / valueRange) * 18,
        }];
      });
      if (points.length < 2) return "";
      const first = points[0];
      const last = points.at(-1)!;
      return `M${first.x.toFixed(2)},25 L${points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" L")} L${last.x.toFixed(2)},25 Z`;
    }
    const timeRange = Math.max(end - start, 1);
    const graded = orderedSamples.map((sample, index) => {
      const x = ((sample.timestamp - start) / timeRange) * 100;
      const previousX = index === 0 ? 0 : ((orderedSamples[index - 1].timestamp - start) / timeRange) * 100;
      const nextX = index === orderedSamples.length - 1 ? 100 : ((orderedSamples[index + 1].timestamp - start) / timeRange) * 100;
      return {
        from: index === 0 ? 0 : (previousX + x) / 2,
        to: index === orderedSamples.length - 1 ? 100 : (x + nextX) / 2,
        level: (sampleGrade ? sampleGrade(sample) : levelFor(primary(sample))).level,
      };
    });
    const zones = graded.reduce<Array<{ from: number; to: number; level: GradeLevel }>>((result, item) => {
      const previous = result.at(-1);
      if (previous?.level === item.level) previous.to = item.to;
      else result.push({ ...item });
      return result;
    }, []);
    const ticks = roundedTimeTicks(start, end);
    const primaryGeometry = build(primary, climateReference?.primary);
    const secondaryGeometry = build(secondary, climateReference?.secondary);
    return {
      primary: primaryGeometry,
      secondary: secondaryGeometry,
      primaryReferenceArea: referenceArea(climateReference?.primary, primaryGeometry.scale),
      secondaryReferenceArea: secondary ? referenceArea(climateReference?.secondary, secondaryGeometry.scale) : "",
      zones,
      ticks,
      recentBoundary: Math.max(0, ((recentStart - start) / timeRange) * 100),
    };
  }, [orderedSamples, primary, secondary, analysisMinutes, levelFor, climateReference, sampleGrade]);

  const showPrimaryAxis = Boolean(primaryUnit);
  const showSecondaryAxis = Boolean(secondaryUnit && secondary);
  const axisLayout = showPrimaryAxis ? (showSecondaryAxis ? "trend-chart-with-axes" : "trend-chart-with-left-axis") : "";

  return (
    <div className={`trend-chart ${axisLayout} ${climateReference ? "trend-chart-climate" : ""}`}>
      {showPrimaryAxis ? <TrendScale scale={geometry.primary.scale} unit={primaryUnit!} side="primary" /> : null}
      <div className="trend-plot">
        <svg className="trend-svg" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={`${label}; x axis is Europe/Berlin local time`}>
          {geometry.zones.map((zone, index) => <rect key={`${zone.from}-${index}`} x={zone.from} y="2" width={Math.max(zone.to - zone.from, .1)} height="24" className={`trend-zone zone-${zone.level}`} />)}
          {geometry.primaryReferenceArea ? <path d={geometry.primaryReferenceArea} className="outdoor-reference-area outdoor-primary" /> : null}
          {geometry.secondaryReferenceArea ? <path d={geometry.secondaryReferenceArea} className="outdoor-reference-area outdoor-secondary" /> : null}
          {showPrimaryAxis ? [7, 16, 25].map((y) => <line key={`y-grid-${y}`} x1="0" y1={y} x2="100" y2={y} className="trend-y-grid" />) : null}
          {geometry.ticks.map((tick, index) => <line key={`tick-${index}`} x1={tick.x} y1="2" x2={tick.x} y2="26" className="trend-time-grid" />)}
          <line x1="0" y1="25" x2="100" y2="25" className="trend-grid" />
          <rect x={geometry.recentBoundary} y="3" width={100 - geometry.recentBoundary} height="23" className="recent-window" />
          {geometry.secondary.all ? <path d={geometry.secondary.all} className="trend-secondary trend-history" /> : null}
          {geometry.primary.all ? <path d={geometry.primary.all} className="trend-primary trend-history" /> : null}
          {geometry.secondary.recent ? <path d={geometry.secondary.recent} className="trend-secondary trend-recent" /> : null}
          {geometry.primary.recent ? <path d={geometry.primary.recent} className="trend-primary trend-recent" /> : null}
        </svg>
        {geometry.primary.current ? (
          <span
            className="current-point"
            aria-hidden="true"
            style={{ left: `${geometry.primary.current.x}%`, top: `${(geometry.primary.current.y / 30) * 100}%` }}
          />
        ) : null}
        {geometry.primary.count < 2 && noSeriesLabel ? <div className="trend-last-valid">{noSeriesLabel}</div> : null}
      </div>
      {showSecondaryAxis && secondaryUnit ? <TrendScale scale={geometry.secondary.scale} unit={secondaryUnit} side="secondary" /> : null}
      <div className="time-axis" aria-label="Europe/Berlin local time">
        {geometry.ticks.map((tick, index) => (
          <span
            key={`axis-${index}`}
            className={tick.midnight ? "axis-midnight" : ""}
            style={{ left: `${tick.labelX}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function trendScaleValue(value: number, unit: string) {
  const digits = unit === "%" || unit === "mg/m³" ? 2 : unit === "µg/m³" || unit === "g/m³" ? 1 : 0;
  return fmt(value, digits);
}

function TrendScale({ scale, unit, side }: { scale: { min: number; max: number } | null; unit: string; side: "primary" | "secondary" }) {
  if (!scale) return <div className={`trend-y-axis axis-${side}`} aria-hidden="true" />;
  const marks = scale.min === scale.max
    ? [{ value: scale.min, top: 53.33 }]
    : [
        { value: scale.max, top: 23.33 },
        { value: (scale.min + scale.max) / 2, top: 53.33 },
        { value: scale.min, top: 83.33 },
      ];
  return <div className={`trend-y-axis axis-${side}`} aria-label={`${side === "primary" ? "Cyan" : "Amber"} scale in ${unit}`}>{marks.map((mark, index) => <span key={`${mark.value}-${index}`} style={{ top: `${mark.top}%` }}>{trendScaleValue(mark.value, unit)}</span>)}</div>;
}

function LevelMark({ status }: { status: RoomData["status"] }) {
  return <span className={`level-mark level-${status}`} aria-hidden="true">{status === "action" ? "!" : ""}</span>;
}

function checkDisplayLabel(check: Check) {
  const method = check.method.toLowerCase();
  return check.label.toLowerCase().endsWith(method) ? check.label : `${check.label} · ${method}`;
}

function meaningEvidenceStatus(check: Check) {
  if (["Propane-associated pattern", "Nitrogen (N₂) displacement pattern"].includes(check.label) && check.status === "NOT INDICATED") return "NOT INFERRED";
  if (check.label === "CO release" && check.status === "NO ELEVATION") return "SAFE";
  if (check.label === "Volatile-gas pattern" && check.status === "VERIFY SOURCE") return "VERIFY\nSOURCE";
  if (check.label === "O₂ displacement" && check.status === "NOT INDICATED") return "NORMAL";
  if (check.label === "Formaldehyde elevation" && check.status === "NOT DETECTED") return "NORMAL";
  return check.status;
}

function TrafficLight({ status }: { status: RoomData["status"] }) {
  const active = status === "normal" ? "green" : status === "action" ? "red" : "amber";
  return (
    <div className="traffic-light" role="img" aria-label={`${status} room status`}>
      <span className={active === "red" ? "light-red is-active" : "light-red"} />
      <span className={active === "amber" ? "light-amber is-active" : "light-amber"} />
      <span className={active === "green" ? "light-green is-active" : "light-green"} />
    </div>
  );
}

function OutdoorWeather({ outdoor }: { outdoor: OutdoorData }) {
  const latest = outdoor.latest;
  if (!latest || (latest.temperature === null && latest.humidity === null)) return null;
  const station = outdoor.station ? ` · nearest reporting station ${outdoor.station}` : "";
  const particleSource = outdoor.particleLatest?.pm25 !== null && outdoor.particleLatest?.pm25 !== undefined ? " · outdoor PM₂.₅ context: CAMS via Open-Meteo" : "";
  return (
    <div className="outdoor-weather" title={`${outdoor.source}${station}${particleSource}`}>
      <strong>OUTDOOR · OBERSCHNEIDING</strong>
      <span>{fmt(latest.temperature, 1)}°C · {fmt(latest.humidity)}% RH</span>
      <small>DWD · {berlinShortTime(latest.timestamp)}</small>
    </div>
  );
}

function PersistentEnvironmentNotices({ now }: { now: number }) {
  const dayKey = berlinCalendar(now).dayKey;
  const notices = [
    dayKey <= "2026-12-15" ? "PERSISTENT ENVIRONMENT CONTEXT · ROAD CONSTRUCTION · UP TO DEC'26" : null,
    dayKey <= "2027-08-08" ? "PERSISTENT ENVIRONMENT CONTEXT · LAB 2 BUILDING CONSTRUCTION · X'27" : null,
  ].filter((notice): notice is string => notice !== null);
  if (!notices.length) return null;
  return <div className="environment-context" aria-label="Persistent external activity context">{notices.map((notice) => <span key={notice}>{notice}</span>)}</div>;
}

export default function Home() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [passwordVerifierReady, setPasswordVerifierReady] = useState<boolean | null>(null);
  const [apiConnected, setApiConnected] = useState<boolean | null>(null);
  const [ownerSetup] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("setup") === "owner");
  const [data, setData] = useState<DashboardData>(DEMO_DATA);
  const [clock, setClock] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [connectionChecking, setConnectionChecking] = useState(false);
  const [compactViewport, setCompactViewport] = useState(false);
  const [fitViewport, setFitViewport] = useState(false);
  const [presentationMode, setPresentationMode] = useState(() => readDisplayUpdateValue<DisplayUpdateView>(DISPLAY_UPDATE_VIEW_KEY)?.presentationMode === true);
  const [reportOpen, setReportOpen] = useState(false);
  const reportDownloading = useRef(false);
  const [reportState, setReportState] = useState<"idle" | "checking" | "ready" | "unavailable" | "sending" | "sent" | "error">("idle");
  const [reportError, setReportError] = useState("");
  const [reportAvailability, setReportAvailability] = useState<ReportAvailability | null>(null);
  const updateState = useRef({ busy: false, presentationMode: false });
  const restoredUpdateView = useRef(false);

  useEffect(() => {
    updateState.current = { busy: reportOpen, presentationMode };
  }, [reportOpen, presentationMode]);

  useEffect(() => {
    if (authorized !== true) return;
    let request: AbortController | null = null;
    // If storage is unavailable, the cache-busting navigation target still
    // prevents a stale document from immediately trying the same update again.
    const requestedVersion = new URL(window.location.href).searchParams.get("_display_build");
    let fallbackAttempt = requestedVersion && requestedVersion !== DASHBOARD_BUILD_VERSION
      ? { version: requestedVersion, at: Date.now() } : null;
    if (requestedVersion === DASHBOARD_BUILD_VERSION) {
      const url = new URL(window.location.href);
      url.searchParams.delete("_display_build");
      window.history.replaceState(window.history.state, "", url.toString());
    }
    const monitor = createDisplayUpdateMonitor({
      currentVersion: DASHBOARD_BUILD_VERSION,
      loadVersion: async () => {
        request = new AbortController();
        const timeout = window.setTimeout(() => request?.abort(), 12_000);
        try {
          const response = await fetch(`/api/display-version?at=${Date.now()}`, {
            cache: "no-store", credentials: "same-origin", signal: request.signal,
          });
          if (!response.ok) return null;
          const payload = await response.json() as { version?: string };
          return typeof payload.version === "string" ? payload.version : null;
        } finally { window.clearTimeout(timeout); }
      },
      canReload: () => !updateState.current.busy && document.visibilityState === "visible",
      prepareReload: preserveDisplayLoginForUpdate,
      readAttempt: () => readDisplayUpdateValue<{ version: string; at: number }>(DISPLAY_UPDATE_ATTEMPT_KEY) ?? fallbackAttempt,
      writeAttempt: (attempt) => {
        fallbackAttempt = attempt;
        writeDisplayUpdateValue(DISPLAY_UPDATE_ATTEMPT_KEY, attempt);
      },
      reload: (version) => {
        writeDisplayUpdateValue(DISPLAY_UPDATE_VIEW_KEY, {
          presentationMode: updateState.current.presentationMode, x: window.scrollX, y: window.scrollY,
        });
        const url = new URL(window.location.href);
        url.searchParams.set("_display_build", version);
        window.location.replace(url.toString());
      },
    });
    const check = () => { void monitor.check(); };
    check();
    const timer = window.setInterval(check, 30_000);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      monitor.stop();
      request?.abort();
      window.clearInterval(timer);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [authorized]);

  useEffect(() => {
    if (restoredUpdateView.current || !data.live || authorized !== true || apiConnected !== true) return;
    const view = readDisplayUpdateValue<DisplayUpdateView>(DISPLAY_UPDATE_VIEW_KEY);
    const frame = window.requestAnimationFrame(() => {
      restoredUpdateView.current = true;
      if (view && Number.isFinite(view.x) && Number.isFinite(view.y)) window.scrollTo(view.x, view.y);
      try { window.sessionStorage.removeItem(DISPLAY_UPDATE_VIEW_KEY); }
      catch { /* Storage may be disabled. */ }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [authorized, apiConnected, data.live]);

  const closeReportInput = useCallback(() => {
    setReportOpen(false);
    setReportState("idle");
    setReportError("");
    setReportAvailability(null);
  }, []);

  const grantDashboardAccess = useCallback((sessionToken?: string) => {
    if (sessionToken) storeDisplaySession(sessionToken);
    setApiConnected(true);
    setAuthorized(true);
  }, []);

  useEffect(() => {
    const syncViewportLayout = () => {
      // Use the layout viewport here. Pinch zoom changes visualViewport width;
      // treating that as a device resize made the dashboard reflow mid-gesture.
      const availableWidth = Math.max(320, Math.floor(document.documentElement.clientWidth || window.innerWidth));
      const availableHeight = Math.max(320, Math.floor(document.documentElement.clientHeight || window.innerHeight));
      const signage = /Tizen|SMART-TV|SmartTV/i.test(window.navigator.userAgent);
      const desktopInput = window.matchMedia("(pointer: fine)").matches || window.matchMedia("(hover: hover)").matches;
      const touchFirstViewport = !signage && !desktopInput;
      const compact = touchFirstViewport && (availableWidth <= 900 || availableHeight > availableWidth);
      const fitted = !compact
        && availableWidth > availableHeight
        && (availableWidth < 1920 || availableHeight < 960);
      setCompactViewport(compact);
      setFitViewport(fitted);
      document.documentElement.dataset.dashboardLayout = compact ? "compact" : "wide";
    };

    syncViewportLayout();
    window.addEventListener("resize", syncViewportLayout);
    window.addEventListener("orientationchange", syncViewportLayout);
    return () => {
      window.removeEventListener("resize", syncViewportLayout);
      window.removeEventListener("orientationchange", syncViewportLayout);
      delete document.documentElement.dataset.dashboardLayout;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (!presentationMode && !fitViewport) {
      delete root.dataset.dashboardFullscreen;
      delete root.dataset.dashboardFullscreenOrientation;
      root.style.removeProperty("--fullscreen-scale");
      root.style.removeProperty("--fullscreen-canvas-width");
      root.style.removeProperty("--fullscreen-canvas-height");
      return;
    }

    const syncFullscreenCanvas = () => {
      // Full-screen fitting also follows the layout viewport so a zoom gesture
      // does not repeatedly recalculate and cancel itself.
      const availableWidth = Math.max(320, document.documentElement.clientWidth || window.innerWidth);
      const availableHeight = Math.max(320, document.documentElement.clientHeight || window.innerHeight);
      const portrait = availableWidth < availableHeight;
      const minimumCanvasWidth = 1920;
      const minimumCanvasHeight = portrait ? 2400 : presentationMode ? 1080 : 960;
      const scale = Math.min(availableWidth / minimumCanvasWidth, availableHeight / minimumCanvasHeight);
      const canvasWidth = availableWidth / scale;
      const canvasHeight = availableHeight / scale;
      root.dataset.dashboardFullscreen = "true";
      root.dataset.dashboardFullscreenOrientation = portrait ? "portrait" : "landscape";
      root.style.setProperty("--fullscreen-scale", scale.toFixed(6));
      root.style.setProperty("--fullscreen-canvas-width", `${canvasWidth.toFixed(2)}px`);
      root.style.setProperty("--fullscreen-canvas-height", `${canvasHeight.toFixed(2)}px`);
    };

    syncFullscreenCanvas();
    window.addEventListener("resize", syncFullscreenCanvas);
    window.addEventListener("orientationchange", syncFullscreenCanvas);
    return () => {
      window.removeEventListener("resize", syncFullscreenCanvas);
      window.removeEventListener("orientationchange", syncFullscreenCanvas);
      delete root.dataset.dashboardFullscreen;
      delete root.dataset.dashboardFullscreenOrientation;
      root.style.removeProperty("--fullscreen-scale");
      root.style.removeProperty("--fullscreen-canvas-width");
      root.style.removeProperty("--fullscreen-canvas-height");
    };
  }, [fitViewport, presentationMode]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) setPresentationMode(false);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (!reportOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (reportOpen && reportState !== "sending") closeReportInput();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [reportOpen, reportState, closeReportInput]);

  const loadData = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await dashboardFetch("/api/airq", { cache: "no-store" });
      if (response.status === 401) {
        clearDisplaySession();
        setApiConnected(null);
        setAuthorized(false);
        return;
      }
      if (response.status === 503) {
        setApiConnected(false);
        return;
      }
      if (!response.ok) throw new Error("Live feed unavailable");
      const payload = (await response.json()) as DashboardData;
      if (payload.rooms?.lab && payload.rooms?.office) {
        setData(normalizeDashboardData(payload));
        setApiConnected(true);
      }
    } catch {
      setData((current) => current.live ? { ...current, live: false, message: "Live refresh unavailable — showing last received values" } : current);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    dashboardFetch("/api/auth", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { authorized?: boolean; passwordVerifierReady?: boolean }) => {
        if (active) {
          const sessionAuthorized = payload.authorized === true;
          if (!sessionAuthorized) clearDisplaySession();
          setAuthorized(sessionAuthorized);
          setPasswordVerifierReady(payload.passwordVerifierReady === true);
          // The protected live-data route performs the same session check, so
          // begin loading immediately instead of adding a separate round trip.
          if (sessionAuthorized) setApiConnected(true);
        }
      })
      .catch(() => {
        if (active) {
          setAuthorized(false);
          setPasswordVerifierReady(null);
        }
      });
    return () => { active = false; };
  }, []);

  const checkConnection = useCallback(async () => {
    if (authorized !== true) return;
    setConnectionChecking(true);
    try {
      const response = await dashboardFetch(`/api/key?check=${Date.now()}`, { cache: "no-store" });
      if (response.status === 401) {
        clearDisplaySession();
        setApiConnected(null);
        setAuthorized(false);
        return;
      }
      if (!response.ok) throw new Error("Connection check failed");
      const payload = await response.json() as { configured?: boolean; reauthenticate?: boolean };
      if (payload.reauthenticate === true) {
        clearDisplaySession();
        setApiConnected(null);
        setAuthorized(false);
        return;
      }
      setApiConnected(payload.configured === true);
    } catch {
      setApiConnected(false);
    } finally {
      setConnectionChecking(false);
    }
  }, [authorized]);

  useEffect(() => {
    if (authorized !== true || apiConnected === true) return;
    const initialCheck = window.setTimeout(() => void checkConnection(), 0);
    const timer = window.setInterval(() => void checkConnection(), 15_000);
    const retryWhenVisible = () => {
      if (document.visibilityState === "visible") void checkConnection();
    };
    window.addEventListener("focus", retryWhenVisible);
    document.addEventListener("visibilitychange", retryWhenVisible);
    return () => {
      window.clearTimeout(initialCheck);
      window.clearInterval(timer);
      window.removeEventListener("focus", retryWhenVisible);
      document.removeEventListener("visibilitychange", retryWhenVisible);
    };
  }, [authorized, apiConnected, checkConnection]);

  useEffect(() => {
    if (authorized !== true || apiConnected !== false) return;
    const watchdog = window.setTimeout(() => {
      const now = Date.now();
      const storageKey = "bitz-connection-watchdog-reload";
      try {
        const previous = Number(window.sessionStorage.getItem(storageKey) ?? "0");
        if (!Number.isFinite(previous) || now - previous >= 5 * 60_000) {
          window.sessionStorage.setItem(storageKey, String(now));
          window.location.reload();
          return;
        }
      } catch {
        window.location.reload();
        return;
      }
      void checkConnection();
    }, 90_000);
    return () => window.clearTimeout(watchdog);
  }, [authorized, apiConnected, checkConnection]);

  useEffect(() => {
    if (!authorized || !apiConnected) return;
    const kickoffTimer = window.setTimeout(loadData, 0);
    const refreshTimer = window.setInterval(loadData, 120_000);
    const clockTimer = window.setInterval(() => setClock(Date.now()), 15_000);
    return () => { window.clearTimeout(kickoffTimer); window.clearInterval(refreshTimer); window.clearInterval(clockTimer); };
  }, [authorized, apiConnected, loadData]);

  useEffect(() => {
    if (!authorized || !apiConnected || !data.live) return;
    const now = Date.now();
    const expiryTimes = [
      latestAcousticEventAt(data.rooms.lab.samples),
      latestAcousticEventAt(data.rooms.office.samples),
    ]
      .filter((timestamp): timestamp is number => timestamp !== null)
      .map((timestamp) => timestamp + data.analysisMinutes * 60_000)
      .filter((timestamp) => timestamp > now);
    if (!expiryTimes.length) return;

    // The normal data poll follows the sensor cadence. This one-shot update
    // clears an acoustic review at its exact wall-clock expiry instead of
    // allowing it to linger until the next two-minute poll.
    const expiryTimer = window.setTimeout(() => {
      setClock(Date.now());
      void loadData();
    }, Math.min(...expiryTimes) - now + 50);
    return () => window.clearTimeout(expiryTimer);
  }, [authorized, apiConnected, data.live, data.analysisMinutes, data.rooms.lab.samples, data.rooms.office.samples, loadData]);

  const displayedLabRoom = useMemo(
    () => roomAtTime(data.rooms.lab, clock, data.analysisMinutes),
    [data.rooms.lab, clock, data.analysisMinutes],
  );
  const displayedOfficeRoom = useMemo(
    () => roomAtTime(data.rooms.office, clock, data.analysisMinutes),
    [data.rooms.office, clock, data.analysisMinutes],
  );

  const newestTimestamp = Math.max(data.rooms.lab.latest?.timestamp ?? 0, data.rooms.office.latest?.timestamp ?? 0);
  const ageMinutes = newestTimestamp ? Math.max(0, Math.floor((clock - newestTimestamp) / 60_000)) : null;
  const sourceTime = newestTimestamp ? berlinClock(newestTimestamp) : "—";

  async function toggleFullscreen() {
    if (presentationMode) {
      setPresentationMode(false);
      if (document.fullscreenElement) await document.exitFullscreen?.().catch(() => undefined);
      return;
    }

    setPresentationMode(true);
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.().catch(() => undefined);
  }

  async function lockBoard() {
    setPresentationMode(false);
    if (document.fullscreenElement) await document.exitFullscreen?.().catch(() => undefined);
    await dashboardFetch("/api/auth", { method: "DELETE" }).catch(() => undefined);
    clearDisplaySession();
    setAuthorized(false);
    setApiConnected(null);
  }

  async function openReportInput() {
    if (reportDownloading.current) return;
    setReportState("checking");
    setReportError("");
    setReportAvailability(null);
    setReportOpen(true);
    try {
      const response = await dashboardFetch(`/api/report?availability=${Date.now()}`, {
        cache: "no-store",
      });
      if (response.status === 401) {
        closeReportInput();
        clearDisplaySession();
        setAuthorized(false);
        return;
      }
      const payload = await response.json().catch(() => ({})) as ReportAvailability & { error?: string };
      if (response.ok && payload.available === true) {
        setReportAvailability(payload);
        setReportState("ready");
        return;
      }
      setReportAvailability({ available: false, message: payload.message ?? REPORT_PENDING_MESSAGE });
      setReportState("unavailable");
    } catch {
      setReportAvailability({ available: false, message: REPORT_PENDING_MESSAGE });
      setReportState("unavailable");
    }
  }

  async function downloadWeeklyReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reportDownloading.current || (reportState !== "ready" && reportState !== "error")) return;

    reportDownloading.current = true;
    setReportState("sending");
    setReportError("");
    try {
      const response = await dashboardFetch("/api/report", {
        method: "POST",
        cache: "no-store",
      });
      if (response.status === 401) {
        closeReportInput();
        clearDisplaySession();
        setAuthorized(false);
        return;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        if (response.status === 404) {
          setReportAvailability((current) => ({ ...(current ?? { available: false }), available: false, message: payload.error ?? REPORT_PENDING_MESSAGE }));
          setReportState("unavailable");
          return;
        }
        throw new Error(payload.error ?? "Weekly report could not be downloaded");
      }

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = reportAvailability?.fileName ?? "airq_monitoring_weekly_report.pdf";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 2_000);
      setReportState("sent");
      window.setTimeout(closeReportInput, 1_200);
    } catch (error) {
      setReportState("error");
      setReportError(error instanceof Error ? error.message : "Weekly report could not be downloaded");
    } finally {
      reportDownloading.current = false;
    }
  }

  if (authorized !== true) return <AccessGate checking={authorized === null} verifierReady={passwordVerifierReady} onGranted={grantDashboardAccess} />;
  if (apiConnected !== true) {
    if (ownerSetup && apiConnected === false) return <ApiKeySetup checking={false} onConnected={() => setApiConnected(true)} />;
    return <ConnectionPending checking={apiConnected === null || connectionChecking} onRetry={checkConnection} />;
  }

  const fittedWallboard = presentationMode || fitViewport;

  return (
    <main className={`wallboard ${compactViewport && !fittedWallboard ? "wallboard-compact" : ""} ${fittedWallboard ? "wallboard-fullscreen" : ""} ${fitViewport && !presentationMode ? "wallboard-auto-fit" : ""}`} data-live={data.live ? "true" : "false"} data-password-verifier={passwordVerifierReady === false ? "invalid" : passwordVerifierReady === true ? "ready" : "checking"}>
      <header className="wallboard-header">
        <div className="identity"><strong>BITZ LAB AIR MONITORING</strong><span>LIVE READINGS · 24-HOUR HISTORY · LATEST 60-MINUTE ANALYSIS</span></div>
        <div className="header-state" aria-live="polite">
          {data.outdoor ? <OutdoorWeather outdoor={data.outdoor} /> : null}
          <PersistentEnvironmentNotices now={clock} />
          <span className={`connection-dot ${data.live ? "is-live" : "is-preview"}`} />
          <span>{data.live ? "LIVE" : "PREVIEW"}</span>
          <span>{data.live ? `Source ${sourceTime} Europe/Berlin` : "24-hour sample history"}</span>
          <span>{data.live ? (ageMinutes === null ? "age unknown" : `${ageMinutes} min old`) : "recent hour highlighted"}</span>
          <button type="button" onClick={lockBoard}>Lock</button>
          {!presentationMode ? <button className="fullscreen-button" type="button" onClick={toggleFullscreen}>Full screen</button> : null}
        </div>
      </header>
      {!data.live ? <div className="preview-banner">{data.message ?? "Establishing secure airQ connection · Preparing LIVE data display"}</div> : null}
      <div className="room-layout">
        <LabPanel room={displayedLabRoom} officeSamples={data.rooms.office.samples} outdoor={data.outdoor ?? null} refreshing={refreshing} analysisMinutes={data.analysisMinutes} live={data.live} />
        <OfficeRail room={displayedOfficeRoom} outdoor={data.outdoor ?? null} analysisMinutes={data.analysisMinutes} />
      </div>
      <footer className="wallboard-footer">
        <div className="footer-pair-cluster">
          <a className="pair-trigger" href="/pair" aria-label="Pair a wall display">PAIR</a>
        </div>
        <span>24-hour history shown · latest 60 minutes highlighted · rooms evaluated independently · Direct API access graced by air-Q until 12/2026 · Code Engine: https://github.com/sparkmbxtr/BITZ · If this is not your own device, select Lock (top right) before leaving.</span>
        <div className="footer-report-cluster">
          <strong>SPARK RICHARD BIOENGINEERING · {berlinCompactDate(clock)}</strong>
          {SHOW_WEEKLY_REPORT_DOWNLOAD ? <button className="report-trigger" type="button" onClick={openReportInput} aria-haspopup="dialog">REPORT</button> : null}
        </div>
        {SHOW_WEEKLY_REPORT_DOWNLOAD && reportOpen ? (
          <section className="report-popover" role="dialog" aria-modal="true" aria-labelledby="report-title">
            <div className="report-popover-heading">
              <div>
                <strong id="report-title">WEEKLY REPORT AUTOMATICALLY GENERATED BY GITHUB CODE</strong>
              </div>
              <button type="button" onClick={closeReportInput} disabled={reportState === "sending"} aria-label="Close weekly report download">×</button>
            </div>
            {reportState === "checking" ? <p className="report-pending">CHECKING REPORT…</p> : null}
            {reportState === "unavailable" ? <p className="report-pending">{reportAvailability?.message ?? REPORT_PENDING_MESSAGE}</p> : null}
            {reportState !== "checking" && reportState !== "unavailable" && reportState !== "sent" ? (
              <>
                <p id="report-confirmation">Download the weekly report{reportAvailability?.periodLabel ? ` (${reportAvailability.periodLabel})` : ""}?</p>
                <form className="report-confirm-actions" onSubmit={downloadWeeklyReport} aria-describedby="report-confirmation">
                  <button autoFocus type="button" onClick={closeReportInput} disabled={reportState === "sending"}>CANCEL</button>
                  <button type="submit" disabled={reportState === "sending"}>{reportState === "sending" ? "DOWNLOADING…" : "OK"}</button>
                </form>
              </>
            ) : null}
            {reportState === "sent" ? <small className="report-result is-sent">DOWNLOAD STARTED</small> : null}
            {reportState === "error" ? <small className="report-result is-error">{reportError}</small> : null}
          </section>
        ) : null}
      </footer>
    </main>
  );
}

type DisplayPairing = {
  pairingId: string;
  pollSecret: string;
  code: string;
  expiresAt: number;
};

function AccessGate({ checking, verifierReady, onGranted }: { checking: boolean; verifierReady: boolean | null; onGranted: (sessionToken?: string) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pairing, setPairing] = useState<DisplayPairing | null>(null);
  const [pairingRefresh, setPairingRefresh] = useState(0);

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("login");
    const timer = window.setTimeout(() => {
      if (reason === "incorrect") setError("Password not accepted");
      if (reason === "unavailable") setError("Connection unavailable — try again");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (checking) return;
    let active = true;
    let pollTimer: number | undefined;

    async function poll(current: DisplayPairing) {
      try {
        const response = await fetch("/api/device-pair", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ action: "poll", pairingId: current.pairingId, pollSecret: current.pollSecret }),
        });
        const payload = await response.json().catch(() => ({})) as { status?: string; sessionToken?: string; error?: string };
        if (!active) return;
        if (response.ok && payload.status === "approved" && payload.sessionToken) {
          onGranted(payload.sessionToken);
          return;
        }
        if (response.status === 410 || payload.status === "expired") {
          setPairing(null);
          pollTimer = window.setTimeout(() => {
            if (active) setPairingRefresh((value) => value + 1);
          }, 1_000);
          return;
        }
      } catch {}
      if (active) pollTimer = window.setTimeout(() => void poll(current), 2_000);
    }

    async function start() {
      setPairing(null);
      try {
        const response = await fetch("/api/device-pair", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ action: "start" }),
        });
        const payload = await response.json().catch(() => ({})) as DisplayPairing & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Phone approval could not be started");
        if (!active) return;
        setPairing(payload);
        void poll(payload);
      } catch {
        if (active) {
          pollTimer = window.setTimeout(() => {
            if (active) setPairingRefresh((value) => value + 1);
          }, 30_000);
        }
      }
    }

    void start();
    return () => {
      active = false;
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
    };
  }, [checking, onGranted, pairingRefresh]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const portableSession = isTizenDisplay();
      const response = await dashboardFetch("/api/auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(portableSession ? { "X-BITZ-Session-Mode": "portable" } : {}),
        },
        body: JSON.stringify({ password }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; sessionToken?: string };
      if (!response.ok) {
        throw new Error(response.status === 401 ? "Password not accepted" : payload.error ?? "Connection unavailable — try again");
      }
      setPassword("");
      onGranted(payload.sessionToken);
    } catch (reason) {
      setPassword("");
      setError(reason instanceof Error ? reason.message : "Connection unavailable — try again");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="access-shell">
      <section className="access-card access-card-paired">
        <h1>BITZ LAB AIR MONITORING</h1>
        {checking ? <div className="access-checking">Checking saved display session…</div> : (
          <div className="access-choice-grid">
            <form className="access-password-choice" method="post" action="/api/auth" onSubmit={submit}>
            {verifierReady === false ? <div className="access-config-error" role="alert">Display password configuration needs correction.</div> : null}
            <input
              id="dashboard-password"
              name="password"
              type="password"
              aria-label="Display password"
              inputMode="text"
              value={password}
              onInput={(event) => setPassword(event.currentTarget.value)}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              autoFocus
            />
            <div className="pairing-code" aria-live="polite">{pairing ? <b>{pairing.code}</b> : null}</div>
            {error ? <div className="access-error" role="alert">{error}</div> : null}
            <button type="submit" disabled={!password || submitting || verifierReady === false}>{submitting ? "Opening…" : "Open monitor"}</button>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}

function ConnectionPending({ checking, onRetry }: { checking: boolean; onRetry: () => void | Promise<void> }) {
  return (
    <main className="access-shell">
      <section className="access-card connection-pending" aria-live="polite">
        <div className="access-kicker">BITZ LAB AIR MONITORING</div>
        <div className="pending-state"><span className="connection-dot" /><strong>{checking ? "Checking live sensor feed" : "Live sensor feed is being initialized"}</strong></div>
        <p>The display retries automatically. If it remains here, use the large touch control below.</p>
        <button className="connection-retry" type="button" onClick={() => void onRetry()} disabled={checking}>
          {checking ? "CHECKING CONNECTION…" : "RETRY CONNECTION"}
        </button>
        <div className="connection-auto-note">Automatic recovery remains active while this page is open.</div>
      </section>
    </main>
  );
}

function ApiKeySetup({ checking, onConnected }: { checking: boolean; onConnected: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!apiKey || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await dashboardFetch("/api/key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Connection failed");
      setApiKey("");
      onConnected();
    } catch (reason) {
      setApiKey("");
      setError(reason instanceof Error ? reason.message : "Connection failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="access-shell">
      <form className="access-card api-setup-card" onSubmit={submit}>
        <div className="access-kicker">ONE-TIME OWNER SETUP</div>
        <h1>Connect air-Q once</h1>
        <p>After this key is validated, it is encrypted in shared server storage. Future visitors will only enter the display password.</p>
        {checking ? <div className="access-checking">Checking saved air-Q connection…</div> : (
          <>
            <label htmlFor="airq-api-key">air-Q API key</label>
            <input
              id="airq-api-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="off"
              autoFocus
            />
            {error ? <div className="access-error" role="alert">{error}</div> : null}
            <button type="submit" disabled={!apiKey || submitting}>{submitting ? "Validating both rooms…" : "Connect live data"}</button>
          </>
        )}
      </form>
    </main>
  );
}

function LabPanel({ room, officeSamples, outdoor, refreshing, analysisMinutes, live = false }: { room: RoomData; officeSamples: Sample[]; outdoor: OutdoorData | null; refreshing: boolean; analysisMinutes: number; live?: boolean }) {
  const latest = room.latest;
  const pmObservation = pmBalanceObservation(room.samples);
  const currentSoundGrade = activeSoundGrade(latest?.soundMax ?? null);
  const currentParticleAvailable = Boolean(pmObservation && latest && latest.timestamp - pmObservation.timestamp <= 10 * 60_000);
  const outdoorLatest = outdoor?.latest ?? null;
  const outdoorParticles = outdoor?.particleLatest ?? null;
  const humidityAdaptationActive = labHumidityAdaptation(room, outdoor);
  const performanceGrade = labPerformanceGrade(latest?.performance ?? null, latest, humidityAdaptationActive, room.checks);
  const hepa = hepaAssessment(room.samples, officeSamples, latest, labSavingChecksClear(room, live));
  const normalCount = room.checks.filter((check) => check.level === "normal").length;
  const condensationPotential = outdoorLatest?.humidity !== null && outdoorLatest?.humidity !== undefined && outdoorLatest.humidity > 90;
  const condensationPrimary = room.status === "normal" && condensationPotential;
  const condensationText = condensationPotential
    ? `Outdoor RH is ${fmt(outdoorLatest.humidity)}%. LAB RH is ${fmt(latest?.humidity)}%. LAB temperature is ${fmt(latest?.temperature, 1)}°C. LAB dew point is ${fmt(latest?.dewpt, 1)}°C.`
    : "";
  const labAction = condensationPrimary
    ? {
        label: "CONDENSATION POTENTIAL HIGH",
        level: "watch",
        text: condensationText,
      }
    : {
        label: room.status === "normal" ? "NEXT REVIEW" : room.status === "watch" ? "SUGGESTED CHECK" : room.status === "action" ? "PRIORITY CHECK" : "DATA CHECK",
        level: room.status,
        text: room.action,
      };
  const evidenceOrder = ["Propane-associated pattern", "Nitrogen (N₂) displacement pattern", "CO release", "Volatile-gas pattern", "O₂ displacement", "Formaldehyde elevation"];
  const evidenceLabels: Record<string, string> = {
    "Propane-associated pattern": "PROPANE WARNING",
    "Nitrogen (N₂) displacement pattern": "NITROGEN WARNING",
    "CO release": "CO WARNING",
    "Volatile-gas pattern": "GAS / VAPOUR",
    "O₂ displacement": "OXYGEN",
    "Formaldehyde elevation": "FORMALDEHYDE",
    "CO₂ accumulation": "CO₂ / VENTILATION",
    "Sound peak >90 dB": "ACOUSTIC PEAK",
    "Sensor/data integrity": "LIVE SENSOR FEED",
  };
  const evidenceChecks = room.checks
    .filter((check) => evidenceOrder.includes(check.label))
    .sort((left, right) => evidenceOrder.indexOf(left.label) - evidenceOrder.indexOf(right.label));
  const oxygenEmergency = room.checks.some((check) => check.label === "O₂ displacement" && check.level === "action");
  const officialAlertAdvice = "This is a test system; follow official instructions from authorised managers and directors. Follow regulated safety systems alarms. This system is NOT a alarm.";
  const criticalDisplay = oxygenEmergency
    ? { label: "ALERT", level: "critical", note: `Calculated early-warning ALERT. ${officialAlertAdvice}` }
    : room.status === "action"
      ? { label: "ALERT", level: "action", note: `Calculated early-warning ALERT. ${officialAlertAdvice}` }
      : room.status === "watch"
        ? { label: "CHECK", level: "watch", note: `A check condition is active; a calculated early-warning ALERT will replace this status if triggered. ${officialAlertAdvice}` }
        : room.status === "unknown"
          ? { label: "STATUS CHECK", level: "unknown", note: "Current status is being verified." }
          : { label: "SAFE", level: "normal", note: `Calculated early-warning ALERT will be displayed here. ${officialAlertAdvice}` };
  return (
    <section className="lab-panel" aria-labelledby="lab-heading">
      <div className="room-heading"><div className="room-titleline"><TrafficLight status={room.status} /><h1 id="lab-heading">BIOENGINEERING S1 LAB</h1></div>{refreshing ? <span className="refresh-label">UPDATING</span> : null}</div>
      <div className={`overall-state overall-${room.status}`}>
        <LevelMark status={room.status} />
        <div><strong>{room.statusLabel}</strong><span>{normalCount}/{room.checks.length} monitored conditions currently clear</span></div>
        <div className="state-detail"><strong>{latest ? `Updated ${berlinClock(latest.timestamp)} · ${berlinCompactDate(latest.timestamp)}` : "Update pending"}</strong><span>latest LAB sample · Europe/Berlin</span></div>
      </div>
      <div className={`critical-grid ${room.checks.length === 7 ? "critical-grid-seven" : room.checks.length === 9 ? "critical-grid-nine" : room.checks.length === 10 ? "critical-grid-ten" : ""}`}>
        {room.checks.map((check) => <article className={`critical-check check-${check.level}`} key={check.label}><span>{checkDisplayLabel(check)}</span><strong>{check.status}</strong></article>)}
      </div>
      <div className="metric-grid">
        <Metric label="Health" value={fmt(latest?.health)} scale="/100" source="airQ™" note="airQ™ secondary index; raw channels drive operational interpretation" grade={indexGrade(latest?.health ?? null)} />
        <Metric label="Performance" value={fmt(latest?.performance)} scale="/100" source="airQ™" note="airQ™ secondary index; raw channels drive operational interpretation" grade={performanceGrade} />
        <Metric label="CO₂" value={`${fmt(latest?.co2)} ppm`} note="CO₂ / ventilation trend" grade={co2Grade(latest?.co2 ?? null)} />
        <Metric label="TVOC" value={`${fmt(latest?.tvoc)} ppb`} note="gas-pattern context" grade={tvocGrade(latest?.tvoc ?? null)} />
        <Metric label="PM₁" value={`${fmt(latest?.pm1, 1)} µg/m³`} note="measured fine-particle channel" grade={labPmGrade(latest?.pm1 ?? null)} />
        <Metric label="PM₂.₅" value={`${fmt(latest?.pm25, 1)} µg/m³`} comparison={outdoorParticles?.pm25 !== null && outdoorParticles?.pm25 !== undefined ? `≈${fmt(outdoorParticles.pm25, 1)}` : undefined} note="measured fine-particle channel; outdoor comparison is CAMS model context via Open-Meteo rather than a local outdoor sensor" grade={labPmGrade(latest?.pm25 ?? null)} />
        <Metric label="Oxygen" value={`${fmt(latest?.oxygen, 2)}%`} note="displacement proxy" grade={oxygenGrade(latest?.oxygen ?? null)} />
        <Metric label="Temperature" value={`${fmt(latest?.temperature, 1)}°C`} comparison={outdoorLatest?.temperature !== null && outdoorLatest?.temperature !== undefined ? `${fmt(outdoorLatest.temperature, 1)}°C` : undefined} note="LAB thermal band" grade={temperatureGrade(latest?.temperature ?? null, "LAB")} />
        <Metric label="Humidity" value={`${fmt(latest?.humidity)}%`} comparison={outdoorLatest?.humidity !== null && outdoorLatest?.humidity !== undefined ? `${fmt(outdoorLatest.humidity)}%` : undefined} note="Indoor RH grade; outdoor RH is context only. ADAPT applies only when LAB RH is above the normal band and outdoor conditions support it" grade={labHumidityGrade(latest?.humidity ?? null, humidityAdaptationActive)} />
      </div>
      <div className="evidence-layout">
        <section className="evidence-panel" aria-labelledby="evidence-heading">
          <div className="panel-heading"><h2 id="evidence-heading">24-hour evidence tail</h2><div className="colour-key"><span className="key-great">GOOD</span><span className="key-watch">CHECK</span><span className="key-action">ACT</span></div></div>
          <TrendRow label="TVOC / HCHO" primaryUnit="ppb" secondaryUnit="µg/m³" samples={room.samples} primary={(s) => s.tvoc} secondary={(s) => s.hcho} gradeFor={tvocGrade} analysisMinutes={analysisMinutes} />
          <TrendRow label="CO₂ / abs. humidity" primaryUnit="ppm" secondaryUnit="g/m³" samples={room.samples} primary={(s) => s.co2} secondary={(s) => s.humidityAbs} gradeFor={co2Grade} analysisMinutes={analysisMinutes} />
          <TrendRow
            label="Temperature / rel. humidity"
            primaryUnit="°C"
            secondaryUnit="% RH"
            samples={room.samples}
            primary={(s) => s.temperature}
            secondary={(s) => s.humidity}
            gradeFor={(value) => temperatureGrade(value, "LAB")}
            climateReference={outdoor ? { samples: outdoor.samples, primary: (sample) => sample.temperature, secondary: (sample) => sample.humidity } : undefined}
            analysisMinutes={analysisMinutes}
            reading={outdoorLatest ? `OUTDOOR ${fmt(outdoorLatest.temperature, 1)}°C · ${fmt(outdoorLatest.humidity)}% RH` : undefined}
          />
          <TrendRow label="O₂ / CO" primaryUnit="%" secondaryUnit="mg/m³" samples={room.samples} primary={(s) => s.oxygen} secondary={(s) => s.co} gradeFor={oxygenGrade} analysisMinutes={analysisMinutes} />
          {currentParticleAvailable && pmObservation
            ? <TrendRow label="PM balance / sound max" primaryUnit="µg/m³" secondaryUnit="dB" samples={room.samples} primary={pmBalanceValue} secondary={(s) => s.soundMax} gradeFor={labPmGrade} sampleGrade={labPmSampleGrade} analysisMinutes={analysisMinutes} reading={`PM balance ${fmt(pmObservation.value, 1)} µg/m³`} secondaryGrade={currentSoundGrade} />
            : <TrendRow label="Sound max" primaryUnit="dB" samples={room.samples} primary={(s) => s.soundMax} gradeFor={soundMaxGrade} analysisMinutes={analysisMinutes} />}
        </section>
        <aside className={`meaning-panel meaning-panel-${room.status} ${hepa ? "meaning-with-hepa" : ""}`} aria-labelledby="meaning-heading">
          <h2 id="meaning-heading">Meaningful action</h2>
          <div className="meaning-copy"><strong>RECENT PATTERN</strong><p>{room.summary}</p><span>COMPUTED · PAST HOUR</span></div>
          {hepa ? (
            <div className={`hepa-status hepa-${hepa.level}`}>
              <div className="hepa-status-half">
                <span>HEPA STATUS</span>
                <strong>{hepa.status}</strong>
                <small>{hepa.note}</small>
              </div>
              <div className="hepa-status-half airflow-rate-half">
                <span>AIRFLOW CHANGE<br />TO SAVE POWER</span>
                <strong aria-label={hepa.airflow} title={hepa.airflow}>
                  <span className="airflow-status-full">{hepa.airflow}</span>
                  <span className="airflow-status-short">{compactAirflowStatus(hepa.airflow)}</span>
                </strong>
                <small>{hepa.airflow.startsWith("ESTIMATE 《−") ? "Planning estimate // system design pending" : hepa.airflowNote}</small>
              </div>
            </div>
          ) : null}
          <div className="meaning-evidence" aria-label="Signals supporting the current interpretation">
            {evidenceChecks.map((check) => {
              const status = meaningEvidenceStatus(check);
              return (
                <div className={`meaning-signal meaning-signal-${check.level}`} key={check.label}>
                  <span className="meaning-signal-label">
                    {check.label === "Formaldehyde elevation" ? (
                      <>
                        <span className="formaldehyde-label formaldehyde-label-full">FORMALDEHYDE</span>
                        <span className="formaldehyde-label formaldehyde-label-short">FORMALD.</span>
                        <span className="formaldehyde-label formaldehyde-label-tiny">HCHO</span>
                      </>
                    ) : evidenceLabels[check.label] ?? check.label}
                  </span>
                  <b className="meaning-status" data-status={status} aria-label={check.status} title={check.status}>
                    {status === "NOT INFERRED" ? (
                      <>
                        <span className="not-inferred-full">NOT INFERRED</span>
                        <span className="not-inferred-short">NOT INF</span>
                      </>
                    ) : status}
                  </b>
                </div>
              );
            })}
          </div>
          <div className={`action-copy action-${labAction.level} ${condensationPrimary ? "action-condensation" : ""}`}>
            <strong>{labAction.label}</strong><p>{labAction.text}</p>
            {condensationPotential && !condensationPrimary ? (
              <div className="action-secondary-warning">
                <strong>CONDENSATION POTENTIAL HIGH</strong>
                <p>{condensationText}</p>
              </div>
            ) : null}
          </div>
          <div className={`critical-message critical-message-${criticalDisplay.level}`} role="status" aria-live="polite">
            <strong>{criticalDisplay.label}</strong><span>{criticalDisplay.note}</span>
          </div>
        </aside>
      </div>
    </section>
  );
}

function Metric({ label, value, scale, comparison, source, note, grade }: { label: string; value: string; scale?: string; comparison?: string; source?: string; note: string; grade: Grade }) {
  return <article className={`metric metric-${grade.level}`} title={`${label}: ${value}${scale ?? ""} — ${grade.label}. ${note}${comparison ? ` Outdoor: ${comparison}.` : ""}`}><div className="metric-label"><span>{label}</span>{source ? <small className="metric-source">{source}</small> : null}</div><div className={`metric-value-line ${comparison ? "has-comparison" : ""}`}><strong>{value}</strong>{scale ? <span className="metric-scale">{scale}</span> : null}{comparison ? <span className="metric-comparison"><small>OUT</small><span className="metric-comparison-value">{comparison}</span></span> : null}</div><div className="metric-foot"><b className={`grade-word grade-${grade.level}`}><i />{grade.label}</b></div></article>;
}

function TrendRow({ label, primaryUnit, secondaryUnit, samples, primary, secondary, gradeFor, sampleGrade, climateReference, analysisMinutes, reading, secondaryGrade }: { label: string; primaryUnit: string; secondaryUnit?: string; samples: Sample[]; primary: (sample: Sample) => number | null; secondary?: (sample: Sample) => number | null; gradeFor: (value: number | null) => Grade; sampleGrade?: (sample: Sample) => Grade; climateReference?: ClimateReference; analysisMinutes: number; reading?: string; secondaryGrade?: Grade | null }) {
  const latestGradedSample = sampleGrade ? [...samples].reverse().find((sample) => primary(sample) !== null) : null;
  const grade = latestGradedSample && sampleGrade ? sampleGrade(latestGradedSample) : gradeFor(latestValue(samples, primary));
  const [primaryLabel, secondaryLabel] = label.split(" / ", 2);
  return <div className={`trend-row trend-row-${grade.level}`}><strong className="trend-series-label"><span className="trend-series-key trend-label-primary"><span>{primaryLabel}</span><small>{primaryUnit}</small></span>{secondaryLabel ? <><span className="trend-label-separator" aria-hidden="true" /><span className="trend-series-key trend-label-secondary"><span>{secondaryLabel}</span><small>{secondaryUnit}</small></span></> : null}</strong><HistoryTrend samples={samples} primary={primary} secondary={secondary} primaryUnit={primaryUnit} secondaryUnit={secondaryUnit} levelFor={gradeFor} sampleGrade={sampleGrade} climateReference={climateReference} label={climateReference ? `${label} across 24 hours; strong lines are indoor measurements and faint area fills rise from the x axis to the outdoor references` : `${label} across 24 hours; background colour follows the primary reading`} analysisMinutes={analysisMinutes} /><span className="trend-reading"><b className={`grade-pill grade-${grade.level}`}><i />{grade.label}</b>{reading ? <small>{reading}</small> : null}{secondaryGrade ? <b className={`grade-pill grade-${secondaryGrade.level} trend-secondary-grade`}><i />{secondaryGrade.label}</b> : null}{climateReference ? <small className="climate-fill-key">PALE FILL = OUTDOOR</small> : null}</span></div>;
}

function OfficeRail({ room, outdoor, analysisMinutes }: { room: RoomData; outdoor: OutdoorData | null; analysisMinutes: number }) {
  const latest = room.latest;
  const pmObservation = pmBalanceObservation(room.samples);
  const actionLabel = room.status === "normal" ? "NEXT REVIEW" : room.status === "watch" ? "SUGGESTED CHECK" : room.status === "action" ? "PRIORITY CHECK" : "DATA CHECK";
  const outdoorLatest = outdoor?.latest ?? null;
  const outdoorParticles = outdoor?.particleLatest ?? null;
  const visibleChecks = room.checks.filter((check) => ["CO release", "O₂ displacement", "Volatile-gas pattern", "Sound peak >90 dB"].includes(check.label));
  return (
    <aside className="office-rail" aria-labelledby="office-heading">
      <div className="office-heading"><div className="room-titleline"><TrafficLight status={room.status} /><h2 id="office-heading">OFFICE</h2></div></div>
      <div className={`office-state overall-${room.status}`}><LevelMark status={room.status} /><div><strong>{room.statusLabel}</strong><span>{room.checks.filter((check) => check.level === "normal").length}/{room.checks.length} checks clear</span></div></div>
      <div className="office-metrics">
        <Metric label="Health" value={fmt(latest?.health)} scale="/100" source="airQ™" note="airQ™ secondary index; raw channels drive operational interpretation" grade={indexGrade(latest?.health ?? null)} />
        <Metric label="Performance" value={fmt(latest?.performance)} scale="/100" source="airQ™" note="airQ™ secondary index; raw channels drive operational interpretation" grade={indexGrade(latest?.performance ?? null)} />
        <Metric label="CO₂" value={`${fmt(latest?.co2)} ppm`} note="CO₂ / ventilation trend" grade={co2Grade(latest?.co2 ?? null)} />
        <Metric label="TVOC" value={`${fmt(latest?.tvoc)} ppb`} note="vapour pattern" grade={tvocGrade(latest?.tvoc ?? null)} />
        <Metric label="PM₁" value={`${fmt(latest?.pm1, 1)} µg/m³`} note="measured fine-particle channel" grade={officePmGrade(latest?.pm1 ?? null)} />
        <Metric label="PM₂.₅" value={`${fmt(latest?.pm25, 1)} µg/m³`} comparison={outdoorParticles?.pm25 !== null && outdoorParticles?.pm25 !== undefined ? `≈${fmt(outdoorParticles.pm25, 1)}` : undefined} note="measured fine-particle channel; outdoor comparison is CAMS model context via Open-Meteo rather than a local outdoor sensor" grade={officePmGrade(latest?.pm25 ?? null)} />
        <Metric label="Oxygen" value={`${fmt(latest?.oxygen, 2)}%`} note="displacement proxy" grade={oxygenGrade(latest?.oxygen ?? null)} />
        <Metric label="Temperature" value={`${fmt(latest?.temperature, 1)}°C`} comparison={outdoorLatest?.temperature !== null && outdoorLatest?.temperature !== undefined ? `${fmt(outdoorLatest.temperature, 1)}°C` : undefined} note="OFFICE thermal band" grade={temperatureGrade(latest?.temperature ?? null, "OFFICE")} />
        <Metric label="Humidity" value={`${fmt(latest?.humidity)}%`} comparison={outdoorLatest?.humidity !== null && outdoorLatest?.humidity !== undefined ? `${fmt(outdoorLatest.humidity)}%` : undefined} note="OFFICE humidity band" grade={humidityGrade(latest?.humidity ?? null)} />
      </div>
      <section className="office-trends" aria-label="OFFICE 24-hour compact trends">
        <div className="office-trend-title"><strong>24-hour colour history</strong></div>
        <OfficePairTrend label="TVOC / HCHO" primaryUnit="ppb" secondaryUnit="µg/m³" reading={`${fmt(latest?.tvoc)} ppb · ${fmt(latest?.hcho, 1)} µg/m³`} samples={room.samples} primary={(s) => s.tvoc} secondary={(s) => s.hcho} gradeFor={tvocGrade} analysisMinutes={analysisMinutes} />
        <OfficePairTrend label="CO₂ / abs. humidity" primaryUnit="ppm" secondaryUnit="g/m³" reading={`${fmt(latest?.co2)} ppm · ${fmt(latest?.humidityAbs, 1)} g/m³`} samples={room.samples} primary={(s) => s.co2} secondary={(s) => s.humidityAbs} gradeFor={co2Grade} analysisMinutes={analysisMinutes} />
        <OfficePairTrend
          label="Temperature / rel. humidity"
          primaryUnit="°C"
          secondaryUnit="% RH"
          reading={`${fmt(latest?.temperature, 1)}°C · ${fmt(latest?.humidity)}%`}
          samples={room.samples}
          primary={(s) => s.temperature}
          secondary={(s) => s.humidity}
          gradeFor={(value) => temperatureGrade(value, "OFFICE")}
          climateReference={outdoor ? { samples: outdoor.samples, primary: (sample) => sample.temperature, secondary: (sample) => sample.humidity } : undefined}
          climateReading={outdoorLatest ? `OUTDOOR ${fmt(outdoorLatest.temperature, 1)}°C · ${fmt(outdoorLatest.humidity)}% RH · PALE FILL` : undefined}
          analysisMinutes={analysisMinutes}
        />
        <OfficePairTrend label="O₂ / CO" primaryUnit="%" secondaryUnit="mg/m³" reading={`${fmt(latest?.oxygen, 2)}% · ${fmt(latest?.co, 2)} mg/m³`} samples={room.samples} primary={(s) => s.oxygen} secondary={(s) => s.co} gradeFor={oxygenGrade} analysisMinutes={analysisMinutes} />
        <OfficePairTrend label="PM balance / sound max" primaryUnit="µg/m³" secondaryUnit="dB" reading={pmObservation ? `${fmt(pmObservation.value, 1)} µg/m³ · ${fmt(latest?.soundMax)} dB` : undefined} samples={room.samples} primary={pmBalanceValue} secondary={(s) => s.soundMax} gradeFor={officePmGrade} sampleGrade={officePmSampleGrade} analysisMinutes={analysisMinutes} />
      </section>
      <div className="office-checks">{visibleChecks.map((check) => <div key={check.label}><span>{check.label}</span><strong className={`text-${check.level}`}>{check.status}</strong></div>)}</div>
      <div className={`office-summary office-meaning action-${room.status}`}>
        <strong>MEANINGFUL ACTION · {actionLabel}</strong>
        <p className="office-action-text">{room.action}</p>
        <small>{room.summary}</small>
      </div>
    </aside>
  );
}

function OfficePairTrend({ label, primaryUnit, secondaryUnit, reading, samples, primary, secondary, gradeFor, sampleGrade, climateReference, climateReading, analysisMinutes }: { label: string; primaryUnit: string; secondaryUnit: string; reading?: string; samples: Sample[]; primary: (sample: Sample) => number | null; secondary: (sample: Sample) => number | null; gradeFor: (value: number | null) => Grade; sampleGrade?: (sample: Sample) => Grade; climateReference?: ClimateReference; climateReading?: string; analysisMinutes: number }) {
  const latestGradedSample = sampleGrade ? [...samples].reverse().find((sample) => primary(sample) !== null) : null;
  const grade = latestGradedSample && sampleGrade ? sampleGrade(latestGradedSample) : gradeFor(latestValue(samples, primary));
  const [primaryLabel, secondaryLabel] = label.split(" / ", 2);
  return (
    <div className={`office-trend-row office-pair-row trend-row-${grade.level}`}>
      <div className="office-pair-heading">
        <strong className="office-series-name office-series-pair"><span className="trend-label-primary">{primaryLabel}<small>{primaryUnit}</small></span><i aria-hidden="true" /><span className="trend-label-secondary">{secondaryLabel}<small>{secondaryUnit}</small></span></strong>
        <span className="office-trend-reading"><b className={`grade-pill grade-${grade.level}`}><i /><span>{grade.label}</span></b>{reading ? <small>{reading}</small> : null}</span>
        {climateReading ? <small className="climate-outdoor-reading">{climateReading}</small> : null}
      </div>
      <HistoryTrend
        samples={samples}
        primary={primary}
        secondary={secondary}
        primaryUnit={primaryUnit}
        secondaryUnit={secondaryUnit}
        levelFor={gradeFor}
        sampleGrade={sampleGrade}
        climateReference={climateReference}
        label={climateReference ? `${label} across 24 hours; strong lines are indoor measurements and faint area fills rise from the x axis to the outdoor references` : `${label} across 24 hours; background colour follows the primary reading`}
        analysisMinutes={analysisMinutes}
      />
    </div>
  );
}
