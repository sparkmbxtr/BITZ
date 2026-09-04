"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

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
  occupancy: { label: string; confidence: string };
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
type ActivityCycle = {
  dayKey: string;
  begin: number | null;
  close: number | null;
  end: number | null;
  peopleRange: string | null;
};
type ActivityEvent = { timestamp: number; label: "BEGIN" | "CLOSE"; x: number; peopleRange: string | null };

const ACOUSTIC_CHECK_LABEL = "Sound peak >90 dB";

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
    statusLabel: lab ? "MONITORED CONDITIONS NORMAL" : "MONITORED STATE NORMAL",
    samples,
    latest: samples.at(-1) ?? null,
    occupancy: { label: lab ? "2–4 likely" : "1–3 likely", confidence: "medium confidence" },
    summary: lab
      ? "An earlier vapour response is returning toward the LAB reference without a particle rise."
      : "A gentle CO₂ rise with stable PM is consistent with light occupancy; no unusual outdoor-air pattern is visible.",
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
  message: "Preview data — live air-Q connection is not yet configured",
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

function beganWording(beginTimestamp: number, latestTimestamp: number | null | undefined, currentDayWording: "TODAY BEGAN" | "DAY BEGAN") {
  if (latestTimestamp && berlinCalendar(beginTimestamp).dayKey !== berlinCalendar(latestTimestamp).dayKey) return "YESTERDAY BEGAN";
  return currentDayWording;
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

type ActivitySignal = {
  key: "co2" | "tvoc" | "humidityAbs" | "temperature" | "sound";
  select: (sample: Sample) => number | null;
  changeFloor: number;
  settleFloor: number;
};

const ACTIVITY_SIGNALS: ActivitySignal[] = [
  { key: "co2", select: (sample) => sample.co2, changeFloor: 20, settleFloor: 45 },
  { key: "tvoc", select: (sample) => sample.tvoc, changeFloor: 25, settleFloor: 80 },
  { key: "humidityAbs", select: (sample) => sample.humidityAbs, changeFloor: .12, settleFloor: .3 },
  { key: "temperature", select: (sample) => sample.temperature, changeFloor: .15, settleFloor: .4 },
  { key: "sound", select: (sample) => sample.sound, changeFloor: 2.5, settleFloor: 4 },
];

const activityCycleCache: Record<"LAB" | "OFFICE", WeakMap<Sample[], ActivityCycle[]>> = {
  LAB: new WeakMap<Sample[], ActivityCycle[]>(),
  OFFICE: new WeakMap<Sample[], ActivityCycle[]>(),
};

function valuesBetween(samples: Sample[], signal: ActivitySignal, start: number, end: number) {
  return samples
    .filter((sample) => sample.timestamp >= start && sample.timestamp <= end)
    .map(signal.select)
    .filter((value): value is number => value !== null && Number.isFinite(value));
}

function transitionScore(
  samples: Sample[],
  timestamp: number,
  scales: Map<ActivitySignal["key"], number>,
) {
  let changed = 0;
  let score = 0;
  for (const signal of ACTIVITY_SIGNALS) {
    const before = median(valuesBetween(samples, signal, timestamp - 14 * 60_000, timestamp - 2 * 60_000));
    const after = median(valuesBetween(samples, signal, timestamp + 2 * 60_000, timestamp + 14 * 60_000));
    if (before === null || after === null) continue;
    const ratio = Math.abs(after - before) / (scales.get(signal.key) ?? signal.changeFloor);
    if (ratio >= 1) changed += 1;
    score += Math.min(ratio, 2.5);
  }
  return { changed, score };
}

function signedWindowDelta(
  samples: Sample[],
  signal: ActivitySignal,
  timestamp: number,
) {
  const before = median(valuesBetween(samples, signal, timestamp - 14 * 60_000, timestamp - 2 * 60_000));
  const after = median(valuesBetween(samples, signal, timestamp + 2 * 60_000, timestamp + 14 * 60_000));
  return before === null || after === null ? null : after - before;
}

function officeCloseSignature(
  samples: Sample[],
  timestamp: number,
  scales: Map<ActivitySignal["key"], number>,
) {
  const minuteOfDay = berlinCalendar(timestamp).minuteOfDay;
  if (minuteOfDay < 16 * 60 + 20 || minuteOfDay > 18 * 60) return { matched: false, score: 0 };

  const byKey = new Map(ACTIVITY_SIGNALS.map((signal) => [signal.key, signal] as const));
  const tvocChange = signedWindowDelta(samples, byKey.get("tvoc")!, timestamp);
  const soundChange = signedWindowDelta(samples, byKey.get("sound")!, timestamp);
  const co2Change = signedWindowDelta(samples, byKey.get("co2")!, timestamp);
  const humidityChange = signedWindowDelta(samples, byKey.get("humidityAbs")!, timestamp);
  const tvocThreshold = Math.max(25, (scales.get("tvoc") ?? 25) * .75);

  if (tvocChange === null || tvocChange < tvocThreshold) return { matched: false, score: 0 };

  const soundDrop = soundChange !== null && soundChange <= -Math.max(2, (scales.get("sound") ?? 2.5) * .5);
  const co2NotAccumulating = co2Change !== null && co2Change <= Math.max(15, (scales.get("co2") ?? 20) * .5);
  const humidityNotAccumulating = humidityChange !== null && humidityChange <= Math.max(.08, (scales.get("humidityAbs") ?? .12) * .5);
  const occupancyDeparture = co2NotAccumulating && humidityNotAccumulating;
  const matched = soundDrop || occupancyDeparture;
  const support = Number(soundDrop) + Number(co2NotAccumulating) + Number(humidityNotAccumulating);

  return {
    matched,
    score: Math.min(tvocChange / tvocThreshold, 3) + support * .55,
  };
}

function officeCloseEventTime(
  samples: Sample[],
  candidateTimestamp: number,
  scales: Map<ActivitySignal["key"], number>,
) {
  const byKey = new Map(ACTIVITY_SIGNALS.map((signal) => [signal.key, signal] as const));
  const tvocSignal = byKey.get("tvoc")!;
  const soundSignal = byKey.get("sound")!;
  const tvocScale = Math.max(25, scales.get("tvoc") ?? 25);
  const soundScale = Math.max(2.5, scales.get("sound") ?? 2.5);
  const candidates = samples.filter((sample) => {
    const minute = berlinCalendar(sample.timestamp).minuteOfDay;
    return Math.abs(sample.timestamp - candidateTimestamp) <= 24 * 60_000 &&
      minute >= 16 * 60 + 20 &&
      minute <= 18 * 60;
  });

  // First find the most clearly corroborated TVOC-rise / occupancy-departure
  // transition. This remains the anchor that prevents an unrelated fluctuation
  // from becoming a CLOSE event.
  let best = { timestamp: candidateTimestamp, score: Number.NEGATIVE_INFINITY };
  for (const sample of candidates) {
    const timestamp = sample.timestamp;
    const tvocBefore = median(valuesBetween(samples, tvocSignal, timestamp - 8 * 60_000, timestamp - 2 * 60_000));
    const tvocAfter = median(valuesBetween(samples, tvocSignal, timestamp, timestamp + 6 * 60_000));
    if (tvocBefore === null || tvocAfter === null) continue;
    const tvocRise = tvocAfter - tvocBefore;
    if (tvocRise <= 0) continue;

    const soundBefore = median(valuesBetween(samples, soundSignal, timestamp - 8 * 60_000, timestamp - 2 * 60_000));
    const soundAfter = median(valuesBetween(samples, soundSignal, timestamp, timestamp + 6 * 60_000));
    const soundDrop = soundBefore === null || soundAfter === null ? 0 : Math.max(0, soundBefore - soundAfter);
    const score = tvocRise / tvocScale + (soundDrop / soundScale) * .7;

    if (score > best.score) best = { timestamp, score };
  }

  // Report when the sustained TVOC spike starts, not its later maximum or the
  // centre of the change window. Two or more cloud records in the following
  // six minutes must remain above the local pre-event reference.
  const anchor = best.timestamp;
  const localReference = median(valuesBetween(
    samples,
    tvocSignal,
    anchor - 22 * 60_000,
    anchor - 10 * 60_000,
  ));
  if (localReference === null) return anchor;

  const onsetDelta = Math.max(10, tvocScale * .25);
  const onsetLevel = localReference + onsetDelta;
  const onsetCandidates = candidates
    .filter((sample) => sample.timestamp >= anchor - 20 * 60_000 && sample.timestamp <= anchor + 2 * 60_000)
    .sort((left, right) => left.timestamp - right.timestamp);

  for (const sample of onsetCandidates) {
    const timestamp = sample.timestamp;
    const current = tvocSignal.select(sample);
    if (current === null || current < onsetLevel) continue;

    const previous = median(valuesBetween(samples, tvocSignal, timestamp - 6 * 60_000, timestamp - 2 * 60_000));
    const following = samples
      .filter((entry) => entry.timestamp >= timestamp && entry.timestamp <= timestamp + 6 * 60_000)
      .map(tvocSignal.select)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const sustained = following.filter((value) => value >= onsetLevel);

    if (
      previous !== null &&
      current - previous >= onsetDelta * .6 &&
      sustained.length >= 2
    ) return timestamp;
  }

  return anchor;
}

function departureScore(
  samples: Sample[],
  timestamp: number,
  centres: Map<ActivitySignal["key"], number>,
  scales: Map<ActivitySignal["key"], number>,
) {
  let changed = 0;
  let score = 0;
  for (const signal of ACTIVITY_SIGNALS) {
    const centre = centres.get(signal.key);
    const after = median(valuesBetween(samples, signal, timestamp, timestamp + 15 * 60_000));
    if (centre === undefined || after === null) continue;
    const ratio = Math.abs(after - centre) / (scales.get(signal.key) ?? signal.changeFloor);
    if (ratio >= 1) changed += 1;
    score += Math.min(ratio, 2.5);
  }
  return { changed, score };
}

function approximatePeopleAfterBegin(
  samples: Sample[],
  begin: number,
  baselineCentres: Map<ActivitySignal["key"], number>,
) {
  const end = begin + 60 * 60_000;
  const hour = samples.filter((sample) => sample.timestamp >= begin && sample.timestamp <= end);
  if (!hour.length || (hour.at(-1)?.timestamp ?? 0) < begin + 50 * 60_000) return null;

  const co2Signal = ACTIVITY_SIGNALS.find((signal) => signal.key === "co2")!;
  const humiditySignal = ACTIVITY_SIGNALS.find((signal) => signal.key === "humidityAbs")!;
  const soundSignal = ACTIVITY_SIGNALS.find((signal) => signal.key === "sound")!;
  const co2Start = median(valuesBetween(hour, co2Signal, begin, begin + 12 * 60_000));
  const co2End = median(valuesBetween(hour, co2Signal, end - 12 * 60_000, end));
  if (co2Start === null || co2End === null) return null;

  const humidityStart = median(valuesBetween(hour, humiditySignal, begin, begin + 12 * 60_000));
  const humidityEnd = median(valuesBetween(hour, humiditySignal, end - 12 * 60_000, end));
  const soundHour = median(valuesBetween(hour, soundSignal, begin, end));
  const soundBaseline = baselineCentres.get("sound");
  const co2Rise = Math.max(0, co2End - co2Start);

  // Initial exploratory range: CO₂ supplies the main signal; absolute humidity
  // and occupied-period sound only widen/support the range. Room volume and
  // measured air exchange can replace this coarse calibration later.
  let centre = Math.max(0, (co2Rise - 10) / 45);
  if (humidityStart !== null && humidityEnd !== null && humidityEnd - humidityStart > .12) centre += .55;
  if (soundHour !== null && soundBaseline !== undefined && soundHour - soundBaseline > 2.5) centre += .75;

  if (centre < .75) return "0–1";
  const low = Math.max(1, Math.min(12, Math.floor(centre * .65)));
  const high = Math.max(low + 1, Math.min(12, Math.ceil(centre * 1.55)));
  return String(low) + "–" + String(high);
}

function activityCycles(samples: Sample[], room: "LAB" | "OFFICE") {
  const cached = activityCycleCache[room].get(samples);
  if (cached) return cached;

  const grouped = new Map<string, Sample[]>();
  for (const sample of samples) {
    const key = berlinCalendar(sample.timestamp).dayKey;
    const day = grouped.get(key) ?? [];
    day.push(sample);
    grouped.set(key, day);
  }

  const cycles: ActivityCycle[] = [];
  for (const [dayKey, rawDay] of grouped) {
    const day = [...rawDay].sort((left, right) => left.timestamp - right.timestamp);
    const baseline = day.filter((sample) => berlinCalendar(sample.timestamp).minuteOfDay < 6 * 60);
    if (baseline.length < 10) continue;

    const scales = new Map<ActivitySignal["key"], number>();
    const centres = new Map<ActivitySignal["key"], number>();
    for (const signal of ACTIVITY_SIGNALS) {
      const values = baseline.map(signal.select).filter((value): value is number => value !== null && Number.isFinite(value));
      const centre = median(values);
      if (centre === null) continue;
      const deviation = median(values.map((value) => Math.abs(value - centre))) ?? 0;
      centres.set(signal.key, centre);
      scales.set(signal.key, Math.max(signal.changeFloor, deviation * 5));
    }

    const transitionCandidates = day.map((sample) => ({
      timestamp: sample.timestamp,
      minuteOfDay: berlinCalendar(sample.timestamp).minuteOfDay,
      ...transitionScore(day, sample.timestamp, scales),
    }));
    const morningCandidates = day.map((sample) => ({
      timestamp: sample.timestamp,
      minuteOfDay: berlinCalendar(sample.timestamp).minuteOfDay,
      ...departureScore(day, sample.timestamp, centres, scales),
    }));

    const morningWindow = morningCandidates.filter((candidate) =>
      candidate.minuteOfDay >= 6 * 60 + 45 &&
      candidate.minuteOfDay <= 10 * 60 + 30
    );
    const morning = morningWindow.filter((candidate) =>
      (candidate.changed >= 3 && candidate.score >= 3.4) ||
      (candidate.changed >= 2 && candidate.score >= 2.25)
    );
    let begin: number | null = null;
    if (morning.length) {
      const firstEpisode = morning.filter((candidate) => candidate.timestamp <= morning[0].timestamp + 20 * 60_000);
      begin = firstEpisode.reduce((best, candidate) => candidate.score > best.score ? candidate : best).timestamp;
    }

    const eveningWindow = transitionCandidates.filter((candidate) =>
      candidate.minuteOfDay >= 15 * 60 + 30 &&
      candidate.minuteOfDay <= 19 * 60 + 30 &&
      (!begin || candidate.timestamp >= begin + 4 * 60 * 60_000)
    );
    const officeCloseCandidates = room === "OFFICE"
      ? eveningWindow
          .map((candidate) => ({ ...candidate, closeSignature: officeCloseSignature(day, candidate.timestamp, scales) }))
          .filter((candidate) => candidate.closeSignature.matched)
      : [];
    const strictEvening = eveningWindow.filter((candidate) => candidate.changed >= 3 && candidate.score >= 3.4);
    const evening = strictEvening.length
      ? strictEvening
      : eveningWindow.filter((candidate) => candidate.changed >= 2 && candidate.score >= 2.25);
    let close: number | null = null;
    if (officeCloseCandidates.length) {
      const closeCandidate = officeCloseCandidates.reduce((best, candidate) => {
        const bestWeighted = best.score + best.closeSignature.score - Math.abs(best.minuteOfDay - (16 * 60 + 50)) / 300;
        const candidateWeighted = candidate.score + candidate.closeSignature.score - Math.abs(candidate.minuteOfDay - (16 * 60 + 50)) / 300;
        return candidateWeighted > bestWeighted ? candidate : best;
      });
      close = officeCloseEventTime(day, closeCandidate.timestamp, scales);
    } else if (evening.length) {
      close = evening.reduce((best, candidate) => {
        const targetMinute = room === "OFFICE" ? 16 * 60 + 50 : 17 * 60;
        const bestWeighted = best.score - Math.abs(best.minuteOfDay - targetMinute) / 360;
        const candidateWeighted = candidate.score - Math.abs(candidate.minuteOfDay - targetMinute) / 360;
        return candidateWeighted > bestWeighted ? candidate : best;
      }).timestamp;
    }

    function settledWindow(start: number, end: number) {
      const relevant = ACTIVITY_SIGNALS.filter((signal) =>
        signal.key === "co2" || signal.key === "humidityAbs" || signal.key === "temperature" || signal.key === "sound"
      );
      const checks = relevant.map((signal) => {
        const centre = centres.get(signal.key);
        const current = median(valuesBetween(day, signal, start, end));
        if (centre === undefined || current === null) return null;
        const baselineScale = scales.get(signal.key) ?? signal.changeFloor;
        return {
          key: signal.key,
          within: Math.abs(current - centre) <= Math.max(signal.settleFloor, baselineScale * 1.6),
        };
      }).filter((check): check is { key: ActivitySignal["key"]; within: boolean } => check !== null);
      if (checks.length < 3) return false;
      const core = checks.filter((check) => check.key === "co2" || check.key === "sound");
      return core.every((check) => check.within) && checks.filter((check) => check.within).length >= 3;
    }

    let end: number | null = null;
    if (close) {
      const afterClose = day.filter((sample) =>
        sample.timestamp >= close + 20 * 60_000 &&
        berlinCalendar(sample.timestamp).minuteOfDay <= 23 * 60 + 30
      );
      for (const sample of afterClose) {
        if (
          settledWindow(sample.timestamp, sample.timestamp + 15 * 60_000) &&
          settledWindow(sample.timestamp + 15 * 60_000, sample.timestamp + 35 * 60_000)
        ) {
          end = sample.timestamp;
          break;
        }
      }
    }

    const peopleRange = begin ? approximatePeopleAfterBegin(day, begin, centres) : null;
    if (begin || close || end) cycles.push({ dayKey, begin, close, end, peopleRange });
  }

  activityCycleCache[room].set(samples, cycles);
  return cycles;
}

function latestCycle(samples: Sample[], room: "LAB" | "OFFICE") {
  return [...activityCycles(samples, room)].reverse().find((cycle) => cycle.begin || cycle.close || cycle.end) ?? null;
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

function hepaAssessment(samples: Sample[], latest: Sample | null) {
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

  if (!currentWithin) {
    return {
      status: "CHECK",
      level: "watch" as const,
      note: "PM₂.₅ + PM₁₀ remain above the expected LAB band",
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
          level: "watch" as const,
          note: "Particle return exceeded the 60 min review window",
        };
      }
      return {
        status: "GOOD",
        level: "normal" as const,
        note: `PM₂.₅ + PM₁₀ returned within ${clearanceMinutes} min`,
      };
    }
  }

  return {
    status: "GOOD",
    level: "normal" as const,
    note: "PM₂.₅ + PM₁₀ are within the expected LAB band",
  };
}

function ageLabel(timestamp: number, newestTimestamp: number | null | undefined) {
  if (!newestTimestamp) return "LAST VALID";
  const minutes = Math.max(0, Math.round((newestTimestamp - timestamp) / 60_000));
  if (minutes <= 5) return "CURRENT SAMPLE";
  if (minutes < 60) return `LAST VALID · ${minutes} MIN EARLIER`;
  const hours = Math.round(minutes / 60);
  return `LAST VALID · ${hours} H EARLIER`;
}

function indexGrade(value: number | null): Grade {
  if (value === null) return { label: "NO DATA", level: "unknown" };
  if (value >= 90) return { label: "GREAT", level: "great" };
  if (value >= 75) return { label: "GOOD", level: "good" };
  if (value >= 50) return { label: "WATCH", level: "watch" };
  return { label: "ACT", level: "action" };
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
  const ideal = room === "LAB" ? value >= 18 && value <= 22 : value >= 20 && value <= 24;
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
  const cycle = activityCycles(room.samples, "LAB").find((candidate) => candidate.dayKey === dayKey) ?? null;
  if (cycle?.close && latest.timestamp >= cycle.close) return false;

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
  if (value !== null && adaptationActive) return { label: "ADAPT", level: "watch" };
  return humidityGrade(value);
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
  return samples
    .map((sample) => ({ sample, value: selector(sample) }))
    .filter((point): point is { sample: Sample; value: number } => point.value !== null && Number.isFinite(point.value))
    .map((point, index) => {
      const x = ((point.sample.timestamp - domainStart) / timeRange) * 100;
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
    .filter((sample): sample is { timestamp: number; value: number } => sample.value !== null && Number.isFinite(sample.value));
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
  room,
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
  room: "LAB" | "OFFICE";
  climateReference?: ClimateReference;
  sampleGrade?: (sample: Sample) => Grade;
}) {
  const geometry = useMemo(() => {
    const start = samples[0]?.timestamp ?? 0;
    const end = samples.at(-1)?.timestamp ?? start + 1;
    const recentStart = end - analysisMinutes * 60_000;
    function build(selector?: (sample: Sample) => number | null, referenceSelector?: (sample: OutdoorSample) => number | null) {
      if (!selector) return { all: "", recent: "", current: null as { x: number; y: number } | null, count: 0, scale: null as { min: number; max: number } | null };
      const indoorValues = samples.map(selector).filter((value): value is number => value !== null && Number.isFinite(value));
      const outdoorValues = referenceSelector && climateReference
        ? climateReference.samples.map(referenceSelector).filter((value): value is number => value !== null && Number.isFinite(value))
        : [];
      const values = [...indoorValues, ...outdoorValues];
      if (values.length < 2) {
        const observation = latestObservation(samples, selector);
        const x = observation ? ((observation.timestamp - start) / Math.max(end - start, 1)) * 100 : 0;
        return { all: "", recent: "", current: observation ? { x, y: 15 } : null, count: indoorValues.length, scale: observation ? { min: observation.value, max: observation.value } : null };
      }
      const min = Math.min(...values);
      const max = Math.max(...values);
      const allPoints = pointsFor(samples, selector, start, end, min, max);
      const recentPoints = pointsFor(samples.filter((sample) => sample.timestamp >= recentStart), selector, start, end, min, max);
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
      const points = samples.flatMap((sample) => {
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
    const graded = samples.map((sample, index) => {
      const x = ((sample.timestamp - start) / timeRange) * 100;
      const previousX = index === 0 ? 0 : ((samples[index - 1].timestamp - start) / timeRange) * 100;
      const nextX = index === samples.length - 1 ? 100 : ((samples[index + 1].timestamp - start) / timeRange) * 100;
      return {
        from: index === 0 ? 0 : (previousX + x) / 2,
        to: index === samples.length - 1 ? 100 : (x + nextX) / 2,
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
    const events: ActivityEvent[] = activityCycles(samples, room).flatMap((cycle) => [
      ...(cycle.begin ? [{ timestamp: cycle.begin, label: "BEGIN" as const, peopleRange: cycle.peopleRange }] : []),
      ...(cycle.close ? [{ timestamp: cycle.close, label: "CLOSE" as const, peopleRange: null }] : []),
    ]).filter((event) => event.timestamp >= start && event.timestamp <= end)
      .map((event) => ({ ...event, x: ((event.timestamp - start) / timeRange) * 100 }));
    const primaryGeometry = build(primary, climateReference?.primary);
    const secondaryGeometry = build(secondary, climateReference?.secondary);
    return {
      primary: primaryGeometry,
      secondary: secondaryGeometry,
      primaryReferenceArea: referenceArea(climateReference?.primary, primaryGeometry.scale),
      secondaryReferenceArea: secondary ? referenceArea(climateReference?.secondary, secondaryGeometry.scale) : "",
      zones,
      ticks,
      events,
      recentBoundary: Math.max(0, ((recentStart - start) / timeRange) * 100),
    };
  }, [samples, primary, secondary, analysisMinutes, levelFor, room, climateReference, sampleGrade]);

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
          {geometry.events.map((event, index) => <line key={`event-${event.label}-${index}`} x1={event.x} y1="2" x2={event.x} y2="26" className={`activity-time-grid activity-${event.label.toLowerCase()}`} />)}
          <line x1="0" y1="25" x2="100" y2="25" className="trend-grid" />
          <rect x={geometry.recentBoundary} y="3" width={100 - geometry.recentBoundary} height="23" className="recent-window" />
          {geometry.secondary.all ? <path d={geometry.secondary.all} className="trend-secondary trend-history" /> : null}
          {geometry.primary.all ? <path d={geometry.primary.all} className="trend-primary trend-history" /> : null}
          {geometry.secondary.recent ? <path d={geometry.secondary.recent} className="trend-secondary trend-recent" /> : null}
          {geometry.primary.recent ? <path d={geometry.primary.recent} className="trend-primary trend-recent" /> : null}
        </svg>
        {geometry.events.map((event, index) => {
          const alignment = event.x <= 20 ? "start" : event.x >= 80 ? "end" : "centre";
          return (
            <span
              key={`event-label-${event.label}-${index}`}
              className={`activity-event-label activity-${event.label.toLowerCase()} event-align-${alignment}`}
              style={{ left: `${Math.min(98, Math.max(2, event.x))}%` }}
              title={
                event.label === "BEGIN"
                  ? `${beganWording(event.timestamp, samples.at(-1)?.timestamp, room === "LAB" && labPmGrade(pmBalanceObservation(samples)?.value ?? null).label === "PRISTINE" ? "TODAY BEGAN" : "DAY BEGAN")} ${berlinShortTime(event.timestamp)}`
                  : room === "OFFICE"
                    ? `CLOSE ${berlinShortTime(event.timestamp)} · sustained TVOC-rise onset with departure support`
                    : `CLOSE ${berlinShortTime(event.timestamp)} · coordinated late-day transition`
              }
            >{event.label} {berlinShortTime(event.timestamp)}{event.label === "BEGIN" && event.peopleRange ? ` · ≈${event.peopleRange}` : ""}</span>
          );
        })}
        {geometry.primary.current ? (
          <span
            className="current-point"
            aria-hidden="true"
            style={{ left: `${Math.min(98, Math.max(2, geometry.primary.current.x))}%`, top: `${(geometry.primary.current.y / 30) * 100}%` }}
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
  return <span className={`level-mark level-${status}`} aria-hidden="true">{status === "normal" ? "✓" : status === "action" ? "!" : "•"}</span>;
}

function checkDisplayLabel(check: Check) {
  const method = check.method.toLowerCase();
  return check.label.toLowerCase().endsWith(method) ? check.label : `${check.label} · ${method}`;
}

function meaningEvidenceStatus(check: Check) {
  if (["Propane-associated pattern", "Nitrogen (N₂) displacement pattern"].includes(check.label) && check.status === "NOT INDICATED") return "NOT INF";
  if (check.label === "CO release" && check.status === "NO ELEVATION") return "SAFE";
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

function occupancyText(room: RoomData) {
  return room.occupancy.label.includes("likely") ? `${room.occupancy.label} · estimate` : "occupancy / ventilation signal";
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
    dayKey <= "2027-08-08" ? "PERSISTENT ENVIRONMENT CONTEXT · LAB BUILDING CONSTRUCTION" : null,
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
  const [presentationMode, setPresentationMode] = useState(false);

  useEffect(() => {
    const syncViewportLayout = () => {
      // Use the layout viewport here. Pinch zoom changes visualViewport width;
      // treating that as a device resize made the dashboard reflow mid-gesture.
      const availableWidth = Math.max(320, Math.floor(document.documentElement.clientWidth || window.innerWidth));
      const compact = availableWidth < 1700;
      setCompactViewport(compact);
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
    if (!presentationMode) {
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
      const minimumCanvasHeight = portrait ? 2400 : 1080;
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
  }, [presentationMode]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) setPresentationMode(false);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const loadData = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/airq", { cache: "no-store" });
      if (response.status === 401) {
        setAuthorized(false);
        return;
      }
      if (!response.ok) throw new Error("Live feed unavailable");
      const payload = (await response.json()) as DashboardData;
      if (payload.rooms?.lab && payload.rooms?.office) setData(payload);
    } catch {
      setData((current) => current.live ? { ...current, live: false, message: "Live refresh unavailable — showing last received values" } : current);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/auth", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { authorized?: boolean; passwordVerifierReady?: boolean }) => {
        if (active) {
          setAuthorized(payload.authorized === true);
          setPasswordVerifierReady(payload.passwordVerifierReady === true);
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
      const response = await fetch(`/api/key?check=${Date.now()}`, { cache: "no-store" });
      if (response.status === 401) {
        setApiConnected(null);
        setAuthorized(false);
        return;
      }
      if (!response.ok) throw new Error("Connection check failed");
      const payload = await response.json() as { configured?: boolean; reauthenticate?: boolean };
      if (payload.reauthenticate === true) {
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
    void checkConnection();
    const timer = window.setInterval(() => void checkConnection(), 15_000);
    const retryWhenVisible = () => {
      if (document.visibilityState === "visible") void checkConnection();
    };
    window.addEventListener("focus", retryWhenVisible);
    document.addEventListener("visibilitychange", retryWhenVisible);
    return () => {
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
  const newestDayKey = newestTimestamp ? berlinCalendar(newestTimestamp).dayKey : null;
  const labCycle = newestDayKey
    ? activityCycles(data.rooms.lab.samples, "LAB").find((cycle) => cycle.dayKey === newestDayKey) ?? null
    : null;
  const officeCycle = newestDayKey
    ? activityCycles(data.rooms.office.samples, "OFFICE").find((cycle) => cycle.dayKey === newestDayKey) ?? null
    : null;
  const beginTimes = [labCycle?.begin, officeCycle?.begin]
    .filter((timestamp): timestamp is number => timestamp !== null && timestamp !== undefined);
  const closeTimes = [labCycle?.close, officeCycle?.close]
    .filter((timestamp): timestamp is number => timestamp !== null && timestamp !== undefined);
  const bioengineeringBegin = beginTimes.length ? Math.min(...beginTimes) : null;
  const bioengineeringClose = closeTimes.length ? Math.min(...closeTimes) : null;
  const bioengineeringDayStatus = [
    bioengineeringBegin !== null ? `BEGIN: ${berlinShortTime(bioengineeringBegin)}` : null,
    bioengineeringClose !== null ? `CLOSE: ${berlinShortTime(bioengineeringClose)}` : null,
  ].filter((part): part is string => part !== null).join(" · ");

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
    await fetch("/api/auth", { method: "DELETE" }).catch(() => undefined);
    setAuthorized(false);
    setApiConnected(null);
  }

  if (authorized !== true) return <AccessGate checking={authorized === null} verifierReady={passwordVerifierReady} onGranted={() => { setApiConnected(null); setAuthorized(true); }} />;
  if (apiConnected !== true) {
    if (ownerSetup && apiConnected === false) return <ApiKeySetup checking={false} onConnected={() => setApiConnected(true)} />;
    return <ConnectionPending checking={apiConnected === null || connectionChecking} onRetry={checkConnection} />;
  }

  return (
    <main className={`wallboard ${compactViewport && !presentationMode ? "wallboard-compact" : ""} ${presentationMode ? "wallboard-fullscreen" : ""}`} data-live={data.live ? "true" : "false"} data-password-verifier={passwordVerifierReady === false ? "invalid" : passwordVerifierReady === true ? "ready" : "checking"}>
      <header className="wallboard-header">
        <div className="identity"><strong>BITZ LAB AIR MONITORING</strong><span>LIVE READINGS · 24-HOUR HISTORY · LATEST 60-MINUTE ANALYSIS</span></div>
        <div className="header-state" aria-live="polite">
          {data.outdoor ? <OutdoorWeather outdoor={data.outdoor} /> : null}
          <PersistentEnvironmentNotices now={clock} />
          {bioengineeringDayStatus ? (
            <div className="day-end-stamps" aria-label="Earliest computed LAB or OFFICE workday transitions">
              <span>{bioengineeringDayStatus}</span>
            </div>
          ) : null}
          <span className={`connection-dot ${data.live ? "is-live" : "is-preview"}`} />
          <span>{data.live ? "LIVE" : "PREVIEW"}</span>
          <span>{data.live ? `Source ${sourceTime} Europe/Berlin` : "24-hour sample history"}</span>
          <span>{data.live ? (ageMinutes === null ? "age unknown" : `${ageMinutes} min old`) : "recent hour highlighted"}</span>
          <a className="header-export" href="/api/airq?export=1&inline=1&cycle=1" target="_blank" rel="noreferrer" data-testid="data-export">Daily data</a>
          <button type="button" onClick={lockBoard}>Lock</button>
          {!presentationMode ? <button className="fullscreen-button" type="button" onClick={toggleFullscreen}>Full screen</button> : null}
        </div>
      </header>
      {!data.live ? <div className="preview-banner">{data.message ?? "Preview data — live connection pending"}</div> : null}
      <div className="room-layout">
        <LabPanel room={displayedLabRoom} outdoor={data.outdoor ?? null} refreshing={refreshing} analysisMinutes={data.analysisMinutes} />
        <OfficeRail room={displayedOfficeRoom} outdoor={data.outdoor ?? null} analysisMinutes={data.analysisMinutes} />
      </div>
      <footer className="wallboard-footer">
        <span>24-hour history shown · latest 60 minutes highlighted · rooms evaluated independently · Direct API access graced by air-Q until 12/2026 | Corant GmbH | 04229 Leipzig</span>
        <strong>SPARK RICHARD BIOENGINEERING · {berlinCompactDate(clock)}</strong>
      </footer>
    </main>
  );
}

function AccessGate({ checking, verifierReady, onGranted }: { checking: boolean; verifierReady: boolean | null; onGranted: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        throw new Error(response.status === 401 ? "Password not accepted" : payload.error ?? "Connection unavailable — try again");
      }
      setPassword("");
      onGranted();
    } catch (reason) {
      setPassword("");
      setError(reason instanceof Error ? reason.message : "Connection unavailable — try again");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="access-shell">
      <form className="access-card" onSubmit={submit}>
        <div className="access-kicker">SPARK RICHARD BIOENGINEERING</div>
        <h1>BITZ LAB AIR MONITORING</h1>
        <p>Protected display access for the LAB and OFFICE wallboard.</p>
        {checking ? <div className="access-checking">Checking saved display session…</div> : (
          <>
            {verifierReady === false ? <div className="access-config-error" role="alert">Display password configuration needs correction.</div> : null}
            <label htmlFor="dashboard-password">Display password</label>
            <input
              id="dashboard-password"
              name="display-password"
              type="password"
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
            {error ? <div className="access-error" role="alert">{error}</div> : null}
            <button type="submit" disabled={!password || submitting || verifierReady === false}>{submitting ? "Opening…" : "Open monitor"}</button>
          </>
        )}
      </form>
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
      const response = await fetch("/api/key", {
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

function LabPanel({ room, outdoor, refreshing, analysisMinutes }: { room: RoomData; outdoor: OutdoorData | null; refreshing: boolean; analysisMinutes: number }) {
  const latest = room.latest;
  const pmObservation = pmBalanceObservation(room.samples);
  const currentSoundGrade = activeSoundGrade(latest?.soundMax ?? null);
  const currentParticleAvailable = Boolean(pmObservation && latest && latest.timestamp - pmObservation.timestamp <= 10 * 60_000);
  const outdoorLatest = outdoor?.latest ?? null;
  const outdoorParticles = outdoor?.particleLatest ?? null;
  const humidityAdaptationActive = labHumidityAdaptation(room, outdoor);
  const performanceGrade = labPerformanceGrade(latest?.performance ?? null, latest, humidityAdaptationActive, room.checks);
  const hepa = hepaAssessment(room.samples, latest);
  const normalCount = room.checks.filter((check) => check.level === "normal").length;
  const cycle = latestCycle(room.samples, "LAB");
  const beginWording = cycle?.begin
    ? beganWording(cycle.begin, latest?.timestamp, currentParticleAvailable && labPmGrade(pmObservation?.value ?? null).label === "PRISTINE" ? "TODAY BEGAN" : "DAY BEGAN")
    : "DAY BEGAN";
  const routineClosed = Boolean(cycle?.close && latest && latest.timestamp >= cycle.close && room.status !== "action" && room.status !== "unknown");
  const condensationPotential = outdoorLatest?.humidity !== null && outdoorLatest?.humidity !== undefined && outdoorLatest.humidity > 90;
  const condensationPrimary = room.status === "normal" && condensationPotential;
  const condensationText = condensationPotential
    ? `Outdoor RH is ${fmt(outdoorLatest.humidity)}%. LAB RH is ${fmt(latest?.humidity)}%.`
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
    "CO release": "CO SAFETY",
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
  const criticalDisplay = routineClosed
    ? { label: "CLOSED", level: "normal", note: "Routine action prompts are paused after CLOSE; sensor trends remain visible for the next active period." }
    : oxygenEmergency
    ? { label: "EVACUATE", level: "evacuate", note: "Leave the LAB and follow the LAB emergency procedure." }
    : room.status === "action"
      ? { label: "ALERT", level: "action", note: "Critical warning active — follow the highlighted LAB procedure." }
      : room.status === "watch"
        ? { label: "CHECK", level: "watch", note: "A check condition is active; ALERT or EVACUATE will replace this status if triggered." }
        : room.status === "unknown"
          ? { label: "STATUS CHECK", level: "unknown", note: "Current status is being verified." }
          : { label: "SAFE", level: "normal", note: "Critical warnings such as ALERT or EVACUATE will be displayed here." };
  return (
    <section className="lab-panel" aria-labelledby="lab-heading">
      <div className="room-heading"><div className="room-titleline"><TrafficLight status={room.status} /><h1 id="lab-heading">BIOENGINEERING S1 LAB</h1></div>{refreshing ? <span className="refresh-label">UPDATING</span> : null}</div>
      <div className={`overall-state overall-${room.status}`}>
        <LevelMark status={room.status} />
        <div><strong>{room.statusLabel}</strong><span>{normalCount}/{room.checks.length} monitored conditions currently clear</span></div>
        <div className="state-detail"><strong>{latest ? `Updated ${berlinClock(latest.timestamp)}` : "Update pending"}</strong><span>latest LAB sample · Europe/Berlin</span>{cycle?.begin ? <span className="cycle-begin-stamp">{beginWording} {berlinShortTime(cycle.begin)} · COMPUTED</span> : null}</div>
      </div>
      <div className={`critical-grid ${room.checks.length === 7 ? "critical-grid-seven" : room.checks.length === 9 ? "critical-grid-nine" : room.checks.length === 10 ? "critical-grid-ten" : ""}`}>
        {room.checks.map((check) => <article className={`critical-check check-${check.level}`} key={check.label}><span>{checkDisplayLabel(check)}</span><strong>{check.status}</strong></article>)}
      </div>
      <div className="metric-grid">
        <Metric label="Health" value={fmt(latest?.health)} scale="/100" note="air-Q index + raw channels" grade={indexGrade(latest?.health ?? null)} />
        <Metric label="Performance" value={fmt(latest?.performance)} scale="/100" note={performanceGrade.label === "ADAPT" ? "air-Q workday index; outdoor-driven humidity is the only active condition" : "air-Q workday index"} grade={performanceGrade} />
        <Metric label="CO₂" value={`${fmt(latest?.co2)} ppm`} note={occupancyText(room)} grade={co2Grade(latest?.co2 ?? null)} />
        <Metric label="TVOC" value={`${fmt(latest?.tvoc)} ppb`} note="gas-pattern context" grade={tvocGrade(latest?.tvoc ?? null)} />
        <Metric label="PM₁" value={`${fmt(latest?.pm1, 1)} µg/m³`} note="measured fine-particle channel" grade={labPmGrade(latest?.pm1 ?? null)} />
        <Metric label="PM₂.₅" value={`${fmt(latest?.pm25, 1)} µg/m³`} comparison={outdoorParticles?.pm25 !== null && outdoorParticles?.pm25 !== undefined ? `≈${fmt(outdoorParticles.pm25, 1)}` : undefined} note="measured fine-particle channel; outdoor comparison is CAMS model context via Open-Meteo rather than a local outdoor sensor" grade={labPmGrade(latest?.pm25 ?? null)} />
        <Metric label="Oxygen" value={`${fmt(latest?.oxygen, 2)}%`} note="displacement proxy" grade={oxygenGrade(latest?.oxygen ?? null)} />
        <Metric label="Temperature" value={`${fmt(latest?.temperature, 1)}°C`} comparison={outdoorLatest?.temperature !== null && outdoorLatest?.temperature !== undefined ? `${fmt(outdoorLatest.temperature, 1)}°C` : undefined} note="LAB thermal band" grade={temperatureGrade(latest?.temperature ?? null, "LAB")} />
        <Metric label="Humidity" value={`${fmt(latest?.humidity)}%`} comparison={outdoorLatest?.humidity !== null && outdoorLatest?.humidity !== undefined ? `${fmt(outdoorLatest.humidity)}%` : undefined} note="LAB supply has no dehumidification; ADAPT reflects the current or retained outdoor-humidity context until CLOSE" grade={labHumidityGrade(latest?.humidity ?? null, humidityAdaptationActive)} />
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
        <aside className={`meaning-panel meaning-panel-${room.status} ${hepa ? "meaning-with-hepa" : ""} ${routineClosed ? "meaning-panel-closed" : ""}`} aria-labelledby="meaning-heading">
          <h2 id="meaning-heading">{routineClosed ? "Closed-period monitoring" : "Meaningful action"}</h2>
          <div className="meaning-copy"><strong>RECENT PATTERN</strong><p>{room.summary}</p><span>COMPUTED · PAST HOUR</span></div>
          {hepa ? (
            <div className={`hepa-status hepa-${hepa.level}`}>
              <span>HEPA STATUS</span><strong>{hepa.status}</strong><small>{hepa.note}</small>
            </div>
          ) : null}
          <div className="meaning-evidence" aria-label="Signals supporting the current interpretation">
            {evidenceChecks.map((check) => <div className={`meaning-signal meaning-signal-${check.level}`} key={check.label}><span>{evidenceLabels[check.label] ?? check.label}</span><b className="meaning-status" data-status={meaningEvidenceStatus(check)} aria-label={check.status} title={check.status}>{meaningEvidenceStatus(check)}</b></div>)}
          </div>
          {routineClosed
            ? <div className="closed-period-copy"><strong>ROUTINE ACTIONS PAUSED</strong><p>No operational action step is displayed after CLOSE. The live channels and recent pattern remain visible for trend review.</p></div>
            : <div className={`action-copy action-${labAction.level} ${condensationPrimary ? "action-condensation" : ""}`}>
                <strong>{labAction.label}</strong><p>{labAction.text}</p>
                {condensationPotential && !condensationPrimary ? (
                  <div className="action-secondary-warning">
                    <strong>CONDENSATION POTENTIAL HIGH</strong>
                    <p>{condensationText}</p>
                  </div>
                ) : null}
              </div>}
          <div className={`critical-message critical-message-${criticalDisplay.level}`} role="status" aria-live="polite">
            <strong>{criticalDisplay.label}</strong><span>{criticalDisplay.note}</span>
          </div>
        </aside>
      </div>
    </section>
  );
}

function Metric({ label, value, scale, comparison, note, grade }: { label: string; value: string; scale?: string; comparison?: string; note: string; grade: Grade }) {
  return <article className={`metric metric-${grade.level}`} title={`${label}: ${value}${scale ?? ""} — ${grade.label}. ${note}${comparison ? ` Outdoor: ${comparison}.` : ""}`}><div className="metric-label"><span>{label}</span></div><div className={`metric-value-line ${comparison ? "has-comparison" : ""}`}><strong>{value}</strong>{scale ? <span className="metric-scale">{scale}</span> : null}{comparison ? <span className="metric-comparison"><small>OUT</small> {comparison}</span> : null}</div><div className="metric-foot"><b className={`grade-word grade-${grade.level}`}><i />{grade.label}</b></div></article>;
}

function TrendRow({ label, primaryUnit, secondaryUnit, samples, primary, secondary, gradeFor, sampleGrade, climateReference, analysisMinutes, reading, secondaryGrade }: { label: string; primaryUnit: string; secondaryUnit?: string; samples: Sample[]; primary: (sample: Sample) => number | null; secondary?: (sample: Sample) => number | null; gradeFor: (value: number | null) => Grade; sampleGrade?: (sample: Sample) => Grade; climateReference?: ClimateReference; analysisMinutes: number; reading?: string; secondaryGrade?: Grade | null }) {
  const latestGradedSample = sampleGrade ? [...samples].reverse().find((sample) => primary(sample) !== null) : null;
  const grade = latestGradedSample && sampleGrade ? sampleGrade(latestGradedSample) : gradeFor(latestValue(samples, primary));
  const [primaryLabel, secondaryLabel] = label.split(" / ", 2);
  return <div className={`trend-row trend-row-${grade.level}`}><strong className="trend-series-label"><span className="trend-series-key trend-label-primary"><span>{primaryLabel}</span><small>{primaryUnit}</small></span>{secondaryLabel ? <><span className="trend-label-separator" aria-hidden="true" /><span className="trend-series-key trend-label-secondary"><span>{secondaryLabel}</span><small>{secondaryUnit}</small></span></> : null}</strong><HistoryTrend samples={samples} primary={primary} secondary={secondary} primaryUnit={primaryUnit} secondaryUnit={secondaryUnit} levelFor={gradeFor} sampleGrade={sampleGrade} climateReference={climateReference} label={climateReference ? `${label} across 24 hours; strong lines are indoor measurements and faint area fills rise from the x axis to the outdoor references` : `${label} across 24 hours; background colour follows the primary reading`} analysisMinutes={analysisMinutes} room="LAB" /><span className="trend-reading"><b className={`grade-pill grade-${grade.level}`}><i />{grade.label}</b>{reading ? <small>{reading}</small> : null}{secondaryGrade ? <b className={`grade-pill grade-${secondaryGrade.level} trend-secondary-grade`}><i />{secondaryGrade.label}</b> : null}{climateReference ? <small className="climate-fill-key">PALE FILL = OUTDOOR</small> : null}</span></div>;
}

function OfficeRail({ room, outdoor, analysisMinutes }: { room: RoomData; outdoor: OutdoorData | null; analysisMinutes: number }) {
  const latest = room.latest;
  const pmObservation = pmBalanceObservation(room.samples);
  const actionLabel = room.status === "normal" ? "NEXT REVIEW" : room.status === "watch" ? "SUGGESTED CHECK" : room.status === "action" ? "PRIORITY CHECK" : "DATA CHECK";
  const cycle = latestCycle(room.samples, "OFFICE");
  const beginWording = cycle?.begin ? beganWording(cycle.begin, latest?.timestamp, "DAY BEGAN") : "DAY BEGAN";
  const outdoorLatest = outdoor?.latest ?? null;
  const outdoorParticles = outdoor?.particleLatest ?? null;
  const visibleChecks = room.checks.filter((check) => ["CO release", "O₂ displacement", "Volatile-gas pattern", "Sound peak >90 dB"].includes(check.label));
  return (
    <aside className="office-rail" aria-labelledby="office-heading">
      <div className="office-heading"><div className="room-titleline"><TrafficLight status={room.status} /><h2 id="office-heading">OFFICE</h2></div></div>
      <div className={`office-state overall-${room.status}`}><LevelMark status={room.status} /><div><strong>{room.statusLabel}</strong><span>{room.checks.filter((check) => check.level === "normal").length}/{room.checks.length} checks clear</span>{cycle?.begin ? <span className="cycle-begin-stamp">{beginWording} {berlinShortTime(cycle.begin)} · COMPUTED</span> : null}</div></div>
      <div className="office-metrics">
        <Metric label="Health" value={fmt(latest?.health)} scale="/100" note="air-Q index" grade={indexGrade(latest?.health ?? null)} />
        <Metric label="Performance" value={fmt(latest?.performance)} scale="/100" note="air-Q index" grade={indexGrade(latest?.performance ?? null)} />
        <Metric label="CO₂" value={`${fmt(latest?.co2)} ppm`} note={occupancyText(room)} grade={co2Grade(latest?.co2 ?? null)} />
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
        <span><b className={`grade-pill grade-${grade.level}`}><i />{grade.label}</b>{reading ? ` ${reading}` : ""}</span>
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
        room="OFFICE"
      />
    </div>
  );
}
