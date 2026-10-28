"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { DASHBOARD_BUILD_VERSION } from "@/lib/dashboard-version";
import {
  chronologicalByTimestamp,
  historySeries,
  isFreshReading,
  latestReading,
  observationWindow,
  OUTDOOR_GAP_MS,
  referenceZones,
  samplesInWindow,
  scaleFor,
  timePosition,
  type ObservationWindow,
  type Reading,
} from "@/lib/history-graph";
import {
  createDisplayUpdateMonitor,
  DISPLAY_UPDATE_ATTEMPT_KEY,
  DISPLAY_UPDATE_VIEW_KEY,
  readDisplayUpdateValue,
  writeDisplayUpdateValue,
  type DisplayUpdateView,
} from "@/lib/display-updates";

type RoomName = "LAB" | "OFFICE";

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

type OutdoorData = {
  samples: OutdoorSample[];
  latest: OutdoorSample | null;
};

type RoomData = {
  name: RoomName;
  samples: Sample[];
  latest: Sample | null;
};

type DashboardData = {
  live: boolean;
  fetchedAt: number;
  coverage?: ObservationWindow;
  historyHours: number;
  analysisMinutes: number;
  outdoor?: OutdoorData | null;
  rooms: { lab: RoomData; office: RoomData };
};

type DisplayPairing = {
  pairingId: string;
  pollSecret: string;
  code: string;
  expiresAt: number;
};

type ReferenceBand = "base" | "middle" | "upper" | "unknown";
type Selector = (sample: Sample) => number | null;

type GraphDefinition = {
  title: string;
  primaryLabel: string;
  primaryUnit: string;
  primary: Selector;
  secondaryLabel?: string;
  secondaryUnit?: string;
  secondary?: Selector;
  band: (value: number | null) => ReferenceBand;
  markSecondary?: (value: number) => boolean;
  outdoor?: {
    primary: (sample: OutdoorSample) => number | null;
    secondary?: (sample: OutdoorSample) => number | null;
  };
};

const DISPLAY_SESSION_STORAGE_KEY = "bitz-display-session-v1";
const DISPLAY_SESSION_HEADER = "X-BITZ-Display-Session";
const EMPTY_ROOM = (name: RoomName): RoomData => ({ name, samples: [], latest: null });
const EMPTY_DATA: DashboardData = {
  live: false,
  fetchedAt: 0,
  historyHours: 24,
  analysisMinutes: 60,
  outdoor: null,
  rooms: { lab: EMPTY_ROOM("LAB"), office: EMPTY_ROOM("OFFICE") },
};

let inMemoryDisplaySession = "";

function isTizenDisplay() {
  return typeof window !== "undefined" && /Tizen|SMART-TV|TizenBrowser/i.test(window.navigator.userAgent);
}

function readDisplaySession() {
  if (inMemoryDisplaySession) return inMemoryDisplaySession;
  if (typeof window === "undefined") return "";
  try { inMemoryDisplaySession = window.localStorage.getItem(DISPLAY_SESSION_STORAGE_KEY) ?? ""; }
  catch { inMemoryDisplaySession = ""; }
  if (!inMemoryDisplaySession) {
    try { inMemoryDisplaySession = window.sessionStorage.getItem(DISPLAY_SESSION_STORAGE_KEY) ?? ""; }
    catch { /* The cookie can still authorize this display. */ }
  }
  return inMemoryDisplaySession;
}

function storeDisplaySession(token: string) {
  inMemoryDisplaySession = token;
  try { window.localStorage.setItem(DISPLAY_SESSION_STORAGE_KEY, token); }
  catch { /* Keep the in-memory session. */ }
  try { window.sessionStorage.setItem(DISPLAY_SESSION_STORAGE_KEY, token); }
  catch { /* Keep the local or in-memory session. */ }
}

function clearDisplaySession() {
  inMemoryDisplaySession = "";
  try { window.localStorage.removeItem(DISPLAY_SESSION_STORAGE_KEY); }
  catch { /* Storage can be disabled on managed displays. */ }
  try { window.sessionStorage.removeItem(DISPLAY_SESSION_STORAGE_KEY); }
  catch { /* Storage can be disabled on managed displays. */ }
}

async function preserveDisplayLoginForUpdate() {
  const token = readDisplaySession();
  if (!token) return true;
  storeDisplaySession(token);
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try { if (window[name].getItem(DISPLAY_SESSION_STORAGE_KEY) === token) return true; }
    catch { /* Try the other persistence mechanism. */ }
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch("/api/auth", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
    return response.ok && (await response.json()).authorized === true;
  } finally {
    clearTimeout(timeout);
  }
}

function dashboardFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const session = readDisplaySession();
  if (session) headers.set(DISPLAY_SESSION_HEADER, session);
  return fetch(input, { ...init, headers, credentials: "same-origin" });
}

function normalizeRoom(room: RoomData | undefined, name: RoomName): RoomData {
  const samples = chronologicalByTimestamp(Array.isArray(room?.samples) ? room.samples : []);
  return { name, samples, latest: samples.at(-1) ?? room?.latest ?? null };
}

function normalizeDashboardData(payload: DashboardData): DashboardData {
  const outdoorSamples = payload.outdoor ? chronologicalByTimestamp(payload.outdoor.samples ?? []) : [];
  return {
    ...payload,
    outdoor: payload.outdoor
      ? { ...payload.outdoor, samples: outdoorSamples, latest: outdoorSamples.at(-1) ?? payload.outdoor.latest }
      : null,
    rooms: {
      lab: normalizeRoom(payload.rooms?.lab, "LAB"),
      office: normalizeRoom(payload.rooms?.office, "OFFICE"),
    },
  };
}

function formatValue(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function berlinDateTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
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

function timeTicks(start: number, end: number) {
  const hours = Math.max((end - start) / 3_600_000, 0);
  const interval = hours >= 18 ? 6 : hours >= 9 ? 3 : 1;
  const ticks: Array<{ x: number; label: string }> = [];
  for (let timestamp = Math.ceil(start / 3_600_000) * 3_600_000; timestamp <= end; timestamp += 3_600_000) {
    if (berlinHour(timestamp) % interval !== 0) continue;
    ticks.push({
      x: ((timestamp - start) / Math.max(end - start, 1)) * 100,
      label: new Intl.DateTimeFormat("en-US", {
        timeZone: "Europe/Berlin",
        hour: "numeric",
        hour12: true,
      }).format(timestamp).toUpperCase(),
    });
  }
  return ticks;
}

function pmBalance(sample: Sample) {
  const available = [sample.pm1, sample.pm25, sample.pm4, sample.pm10]
    .filter((value): value is number => value !== null && Number.isFinite(value));
  return available.length ? available.reduce((sum, value) => sum + value, 0) / available.length : null;
}

function bandForCo2(value: number | null): ReferenceBand {
  if (value === null) return "unknown";
  if (value < 1_000) return "base";
  if (value < 1_400) return "middle";
  return "upper";
}

function bandForTvoc(value: number | null): ReferenceBand {
  if (value === null) return "unknown";
  if (value < 500) return "base";
  if (value < 1_000) return "middle";
  return "upper";
}

function bandForTemperature(room: RoomName, value: number | null): ReferenceBand {
  if (value === null) return "unknown";
  const preferred = room === "LAB" ? value >= 18 && value <= 22 : value >= 20 && value <= 25;
  if (preferred) return "base";
  if (value >= 16 && value <= 26) return "middle";
  return "upper";
}

function bandForOxygen(value: number | null): ReferenceBand {
  if (value === null) return "unknown";
  if (value >= 20) return "base";
  if (value >= 19.5) return "middle";
  return "upper";
}

function bandForParticles(value: number | null): ReferenceBand {
  if (value === null) return "unknown";
  if (value <= 15) return "base";
  if (value <= 35) return "middle";
  return "upper";
}

function graphDefinitions(room: RoomName, outdoor: OutdoorData | null): GraphDefinition[] {
  return [
    {
      title: "TVOC / HCHO",
      primaryLabel: "TVOC",
      primaryUnit: "ppb",
      primary: (sample) => sample.tvoc,
      secondaryLabel: "HCHO",
      secondaryUnit: "µg/m³",
      secondary: (sample) => sample.hcho,
      band: bandForTvoc,
    },
    {
      title: "CO₂ / ABSOLUTE HUMIDITY",
      primaryLabel: "CO₂",
      primaryUnit: "ppm",
      primary: (sample) => sample.co2,
      secondaryLabel: "ABS. HUMIDITY",
      secondaryUnit: "g/m³",
      secondary: (sample) => sample.humidityAbs,
      band: bandForCo2,
    },
    {
      title: "TEMPERATURE / RELATIVE HUMIDITY",
      primaryLabel: "TEMPERATURE",
      primaryUnit: "°C",
      primary: (sample) => sample.temperature,
      secondaryLabel: "REL. HUMIDITY",
      secondaryUnit: "% RH",
      secondary: (sample) => sample.humidity,
      band: (value) => bandForTemperature(room, value),
      outdoor: outdoor ? {
        primary: (sample) => sample.temperature,
        secondary: (sample) => sample.humidity,
      } : undefined,
    },
    {
      title: "OXYGEN / CO",
      primaryLabel: "OXYGEN",
      primaryUnit: "%",
      primary: (sample) => sample.oxygen,
      secondaryLabel: "CO",
      secondaryUnit: "mg/m³",
      secondary: (sample) => sample.co,
      band: bandForOxygen,
    },
    {
      title: "PARTICLES / SOUND MAX",
      primaryLabel: "PM BALANCE",
      primaryUnit: "µg/m³",
      primary: pmBalance,
      secondaryLabel: "SOUND MAX",
      secondaryUnit: "dB",
      secondary: (sample) => sample.soundMax,
      band: bandForParticles,
      markSecondary: (value) => value > 90,
    },
  ];
}

function HistoryGraph({ samples, definition, outdoor, analysisMinutes, timeWindow, now }: {
  samples: Sample[];
  definition: GraphDefinition;
  outdoor: OutdoorData | null;
  analysisMinutes: number;
  timeWindow: ObservationWindow;
  now: number;
}) {
  const geometry = useMemo(() => {
    const ordered = samplesInWindow(samples, timeWindow);
    const weather = samplesInWindow(outdoor?.samples ?? [], timeWindow);
    const outdoorPrimary = definition.outdoor ? weather.map(definition.outdoor.primary) : [];
    const outdoorSecondary = definition.outdoor?.secondary ? weather.map(definition.outdoor.secondary) : [];
    const primaryScale = scaleFor([...ordered.map(definition.primary), ...outdoorPrimary]);
    const secondaryScale = definition.secondary ? scaleFor([...ordered.map(definition.secondary), ...outdoorSecondary]) : null;
    const primary = historySeries(ordered, definition.primary, timeWindow, primaryScale);
    const secondary = historySeries(ordered, definition.secondary ?? (() => null), timeWindow, secondaryScale);
    const primaryPoints = primary.segments.flat();
    const secondaryPoints = secondary.segments.flat();
    const lastPrimary = primaryPoints.at(-1) ?? null;
    // A missing last channel value must not leave an older point looking current.
    const primaryCurrent = lastPrimary?.timestamp === ordered.at(-1)?.timestamp && isFreshReading(lastPrimary, now) ? lastPrimary : null;
    return {
      primaryScale,
      secondaryScale,
      primary,
      secondary,
      primaryCurrent,
      zones: referenceZones(primary.segments, definition.band),
      markers: definition.markSecondary ? secondaryPoints.filter((point) => definition.markSecondary!(point.value)) : [],
      ticks: timeTicks(timeWindow.from, timeWindow.to),
      recentBoundary: Math.min(100, Math.max(0, timePosition(timeWindow.to - analysisMinutes * 60_000, timeWindow))),
      primaryOutdoor: definition.outdoor ? historySeries(weather, definition.outdoor.primary, timeWindow, primaryScale, OUTDOOR_GAP_MS) : null,
      secondaryOutdoor: definition.outdoor?.secondary ? historySeries(weather, definition.outdoor.secondary, timeWindow, secondaryScale, OUTDOOR_GAP_MS) : null,
      empty: primaryPoints.length === 0 && secondaryPoints.length === 0,
    };
  }, [samples, definition, outdoor, analysisMinutes, timeWindow, now]);

  return (
    <div className="sensor-chart" role="img" aria-label={`${definition.title}, 24-hour history in Europe/Berlin local time, ${berlinDateTime(timeWindow.from)} to ${berlinDateTime(timeWindow.to)}. Gaps indicate missing measurements; dots indicate isolated measurements.`}>
      <Scale scale={geometry.primaryScale} unit={definition.primaryUnit} />
      <div className="sensor-plot">
        {geometry.empty ? <div className="sensor-empty">NO DATA IN WINDOW</div> : null}
        <svg viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
          <rect x="0" y="3" width="100" height="25" className="reference-band band-unknown" />
          {geometry.zones.map((zone, index) => <rect key={`${zone.from}-${index}`} x={zone.from} y="3" width={zone.to - zone.from} height="25" className={`reference-band band-${zone.band}`} />)}
          {geometry.primaryOutdoor?.path ? <path d={geometry.primaryOutdoor.path} className="outdoor-reference outdoor-reference-primary" /> : null}
          {geometry.secondaryOutdoor?.path ? <path d={geometry.secondaryOutdoor.path} className="outdoor-reference outdoor-reference-secondary" /> : null}
          {geometry.primaryOutdoor?.isolated.map((point) => <circle key={point.timestamp} cx={point.x} cy={point.y} r=".3" className="outdoor-point outdoor-point-primary" />)}
          {geometry.secondaryOutdoor?.isolated.map((point) => <circle key={point.timestamp} cx={point.x} cy={point.y} r=".3" className="outdoor-point outdoor-point-secondary" />)}
          {[5, 16.5, 28].map((y) => <line key={y} x1="0" y1={y} x2="100" y2={y} className="sensor-grid" />)}
          {geometry.ticks.map((tick, index) => <line key={index} x1={tick.x} y1="3" x2={tick.x} y2="28" className="sensor-time-grid" />)}
          <rect x={geometry.recentBoundary} y="3" width={100 - geometry.recentBoundary} height="25" className="recent-period" />
          {geometry.secondary.path ? <path d={geometry.secondary.path} className="sensor-line sensor-line-secondary" /> : null}
          {geometry.primary.path ? <path d={geometry.primary.path} className="sensor-line sensor-line-primary" /> : null}
          {geometry.secondary.isolated.map((point) => <circle key={point.timestamp} cx={point.x} cy={point.y} r=".4" className="sensor-point sensor-point-secondary" />)}
          {geometry.primary.isolated.map((point) => <circle key={point.timestamp} cx={point.x} cy={point.y} r=".4" className="sensor-point sensor-point-primary" />)}
          {geometry.markers.map((marker) => <circle key={marker.timestamp} cx={marker.x} cy={marker.y} r=".7" className="raw-marker" vectorEffect="non-scaling-stroke" />)}
          {geometry.primaryCurrent ? <circle cx={geometry.primaryCurrent.x} cy={geometry.primaryCurrent.y} r=".6" className="sensor-current" /> : null}
        </svg>
        <div className="sensor-time-axis">{geometry.ticks.map((tick, index) => <span key={index} style={{ left: `${Math.min(96, Math.max(4, tick.x))}%` }}>{tick.label}</span>)}</div>
      </div>
      <Scale scale={geometry.secondaryScale} unit={definition.secondaryUnit ?? ""} secondary />
    </div>
  );
}

function Scale({ scale, unit, secondary = false }: { scale: { min: number; max: number } | null; unit: string; secondary?: boolean }) {
  if (!scale) return <div className={`sensor-axis ${secondary ? "axis-secondary" : "axis-primary"}`} />;
  const marks = scale.min === scale.max
    ? [{ value: scale.min, top: 52 }]
    : [
        { value: scale.max, top: 15.5 },
        { value: (scale.min + scale.max) / 2, top: 51.5 },
        { value: scale.min, top: 87 },
      ];
  const digits = unit === "%" || unit === "mg/m³" ? 2 : unit === "µg/m³" || unit === "g/m³" || unit === "°C" ? 1 : 0;
  return <div className={`sensor-axis ${secondary ? "axis-secondary" : "axis-primary"}`}>{marks.map((mark, index) => <span key={index} style={{ top: `${mark.top}%` }}>{formatValue(mark.value, digits)}</span>)}</div>;
}

function ReadingTime({ reading, now }: { reading: Reading | null; now: number }) {
  if (!reading) return null;
  const ageMinutes = Math.max(0, Math.floor((now - reading.timestamp) / 60_000));
  const stale = !isFreshReading(reading, now);
  const measuredAt = `Last measured ${berlinDateTime(reading.timestamp)} Europe/Berlin, ${ageMinutes} ${ageMinutes === 1 ? "minute" : "minutes"} ago`;
  return <time className={`reading-age${stale ? " is-stale" : ""}`} dateTime={new Date(reading.timestamp).toISOString()} title={measuredAt} aria-label={`${measuredAt}${stale ? ", stale" : ""}`}>{stale ? "STALE · " : ""}{ageMinutes} MIN</time>;
}

function GraphPanel({ room, definition, outdoor, analysisMinutes, timeWindow, now }: {
  room: RoomData;
  definition: GraphDefinition;
  outdoor: OutdoorData | null;
  analysisMinutes: number;
  timeWindow: ObservationWindow;
  now: number;
}) {
  const primaryReading = latestReading(room.samples, definition.primary, timeWindow.to);
  const secondaryReading = definition.secondary ? latestReading(room.samples, definition.secondary, timeWindow.to) : null;
  const primaryDigits = definition.primaryUnit === "%" ? 2 : ["°C", "µg/m³", "g/m³", "mg/m³"].includes(definition.primaryUnit) ? 1 : 0;
  const secondaryDigits = definition.secondaryUnit === "mg/m³" ? 2 : ["µg/m³", "g/m³"].includes(definition.secondaryUnit ?? "") ? 1 : 0;
  return (
    <section className="graph-panel">
      <header className="graph-heading">
        <strong>{definition.title}</strong>
        <div className="graph-values">
          <span className="graph-primary-value"><b>{definition.primaryLabel}</b> {formatValue(primaryReading?.value, primaryDigits)} {definition.primaryUnit} <ReadingTime reading={primaryReading} now={now} /></span>
          {definition.secondary ? <span className="graph-secondary-value"><b>{definition.secondaryLabel}</b> {formatValue(secondaryReading?.value, secondaryDigits)} {definition.secondaryUnit} <ReadingTime reading={secondaryReading} now={now} /></span> : null}
        </div>
      </header>
      <HistoryGraph samples={room.samples} definition={definition} outdoor={outdoor} analysisMinutes={analysisMinutes} timeWindow={timeWindow} now={now} />
    </section>
  );
}

function RoomGraphs({ room, outdoor, analysisMinutes, timeWindow, now }: { room: RoomData; outdoor: OutdoorData | null; analysisMinutes: number; timeWindow: ObservationWindow; now: number }) {
  const definitions = useMemo(() => graphDefinitions(room.name, outdoor), [room.name, outdoor]);
  return <div className="graphs-shell">{definitions.map((definition) => <GraphPanel key={definition.title} room={room} definition={definition} outdoor={outdoor} analysisMinutes={analysisMinutes} timeWindow={timeWindow} now={now} />)}</div>;
}

export default function Home() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [passwordVerifierReady, setPasswordVerifierReady] = useState<boolean | null>(null);
  const [apiConnected, setApiConnected] = useState<boolean | null>(null);
  const [ownerSetup] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("setup") === "owner");
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [selectedRoom, setSelectedRoom] = useState<RoomName>("OFFICE");
  const [clock, setClock] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [connectionChecking, setConnectionChecking] = useState(false);
  const [presentationMode, setPresentationMode] = useState(false);

  const grantDashboardAccess = useCallback((sessionToken?: string) => {
    if (sessionToken) storeDisplaySession(sessionToken);
    setApiConnected(true);
    setAuthorized(true);
  }, []);

  useEffect(() => {
    if (authorized !== true) return;
    let request: AbortController | null = null;
    const requestedVersion = new URL(window.location.href).searchParams.get("_display_build");
    let fallbackAttempt = requestedVersion && requestedVersion !== DASHBOARD_BUILD_VERSION ? { version: requestedVersion, at: Date.now() } : null;
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
          const response = await fetch(`/api/display-version?at=${Date.now()}`, { cache: "no-store", credentials: "same-origin", signal: request.signal });
          if (!response.ok) return null;
          const payload = await response.json() as { version?: string };
          return typeof payload.version === "string" ? payload.version : null;
        } finally { window.clearTimeout(timeout); }
      },
      canReload: () => document.visibilityState === "visible",
      prepareReload: preserveDisplayLoginForUpdate,
      readAttempt: () => readDisplayUpdateValue<{ version: string; at: number }>(DISPLAY_UPDATE_ATTEMPT_KEY) ?? fallbackAttempt,
      writeAttempt: (attempt) => { fallbackAttempt = attempt; writeDisplayUpdateValue(DISPLAY_UPDATE_ATTEMPT_KEY, attempt); },
      reload: (version) => {
        writeDisplayUpdateValue(DISPLAY_UPDATE_VIEW_KEY, { presentationMode, x: window.scrollX, y: window.scrollY });
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
  }, [authorized, presentationMode]);

  useEffect(() => {
    const view = readDisplayUpdateValue<DisplayUpdateView>(DISPLAY_UPDATE_VIEW_KEY);
    if (!view?.presentationMode) return;
    const timer = window.setTimeout(() => setPresentationMode(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

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
      if (payload.rooms) {
        setData(normalizeDashboardData(payload));
        setClock(Date.now());
        setApiConnected(true);
      }
    } catch {
      // Keep the last successful graph rather than replacing it with a banner.
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    dashboardFetch("/api/auth", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { authorized?: boolean; passwordVerifierReady?: boolean }) => {
        if (!active) return;
        const sessionAuthorized = payload.authorized === true;
        if (!sessionAuthorized) clearDisplaySession();
        setAuthorized(sessionAuthorized);
        setPasswordVerifierReady(payload.passwordVerifierReady === true);
        if (sessionAuthorized) setApiConnected(true);
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
      if (payload.reauthenticate) {
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
    const immediate = window.setTimeout(() => void checkConnection(), 0);
    const timer = window.setInterval(() => void checkConnection(), 15_000);
    return () => { window.clearTimeout(immediate); window.clearInterval(timer); };
  }, [authorized, apiConnected, checkConnection]);

  useEffect(() => {
    if (!authorized || !apiConnected) return;
    const immediate = window.setTimeout(() => void loadData(), 0);
    const refresh = window.setInterval(() => void loadData(), 120_000);
    const ticker = window.setInterval(() => setClock(Date.now()), 15_000);
    return () => { window.clearTimeout(immediate); window.clearInterval(refresh); window.clearInterval(ticker); };
  }, [authorized, apiConnected, loadData]);

  useEffect(() => {
    const onFullscreenChange = () => { if (!document.fullscreenElement) setPresentationMode(false); };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  async function toggleFullscreen() {
    if (presentationMode) {
      setPresentationMode(false);
      if (document.fullscreenElement) await document.exitFullscreen?.().catch(() => undefined);
    } else {
      setPresentationMode(true);
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.().catch(() => undefined);
    }
  }

  async function lockBoard() {
    if (document.fullscreenElement) await document.exitFullscreen?.().catch(() => undefined);
    await dashboardFetch("/api/auth", { method: "DELETE" }).catch(() => undefined);
    clearDisplaySession();
    setAuthorized(false);
    setApiConnected(null);
  }

  if (authorized !== true) return <AccessGate checking={authorized === null} verifierReady={passwordVerifierReady} onGranted={grantDashboardAccess} />;
  if (apiConnected !== true) {
    if (ownerSetup && apiConnected === false) return <ApiKeySetup onConnected={() => setApiConnected(true)} />;
    return <ConnectionPending checking={apiConnected === null || connectionChecking} onRetry={checkConnection} />;
  }

  const room = selectedRoom === "OFFICE" ? data.rooms.office : data.rooms.lab;
  const ageMinutes = room.latest ? Math.max(0, Math.floor((clock - room.latest.timestamp) / 60_000)) : null;
  const fresh = isFreshReading(room.latest, clock);
  const timeWindow = observationWindow(data, clock);

  return (
    <main className={`sensor-board ${presentationMode ? "is-fullscreen" : ""}`}>
      <header className="sensor-toolbar">
        <nav className="room-switcher" aria-label="Select monitored room">
          {(["OFFICE", "LAB"] as const).map((name) => (
            <button key={name} type="button" className={selectedRoom === name ? "is-selected" : ""} aria-pressed={selectedRoom === name} onClick={() => setSelectedRoom(name)}>{name}</button>
          ))}
        </nav>
        <strong className="sensor-title">BITZ AIR MONITORING</strong>
        <div className="sensor-controls">
          <span className={`feed-dot ${fresh ? "has-data" : ""}`} aria-hidden="true" />
          <span className="feed-time">{room.latest ? `${berlinDateTime(room.latest.timestamp)} · ${ageMinutes} MIN${fresh ? "" : " · STALE"}` : `${selectedRoom} · NO CURRENT DATA`}</span>
          {refreshing ? <span className="refreshing">UPDATING</span> : null}
          <button type="button" onClick={lockBoard}>LOCK</button>
          <button type="button" onClick={toggleFullscreen}>{presentationMode ? "EXIT" : "FULL SCREEN"}</button>
        </div>
      </header>
      <RoomGraphs room={room} outdoor={data.outdoor ?? null} analysisMinutes={data.analysisMinutes || 60} timeWindow={timeWindow} now={clock} />
    </main>
  );
}

function AccessGate({ checking, verifierReady, onGranted }: { checking: boolean; verifierReady: boolean | null; onGranted: (sessionToken?: string) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pairing, setPairing] = useState<DisplayPairing | null>(null);
  const [pairingRefresh, setPairingRefresh] = useState(0);

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("login");
    const message = reason === "incorrect"
      ? "Not accepted"
      : reason === "unavailable"
        ? "Connection unavailable — try again"
        : "";
    if (!message) return;
    const timer = window.setTimeout(() => setError(message), 0);
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
        const payload = await response.json().catch(() => ({})) as { status?: string; sessionToken?: string };
        if (!active) return;
        if (response.ok && payload.status === "approved" && payload.sessionToken) {
          onGranted(payload.sessionToken);
          return;
        }
        if (response.status === 410 || payload.status === "expired") {
          setPairing(null);
          pollTimer = window.setTimeout(() => { if (active) setPairingRefresh((value) => value + 1); }, 1_000);
          return;
        }
      } catch { /* Retry below. */ }
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
        const payload = await response.json().catch(() => ({})) as DisplayPairing;
        if (!response.ok) throw new Error("Pairing unavailable");
        if (!active) return;
        setPairing(payload);
        void poll(payload);
      } catch {
        if (active) pollTimer = window.setTimeout(() => { if (active) setPairingRefresh((value) => value + 1); }, 30_000);
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
      const response = await dashboardFetch("/api/auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(isTizenDisplay() ? { "X-BITZ-Session-Mode": "portable" } : {}),
        },
        body: JSON.stringify({ password }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; sessionToken?: string };
      if (!response.ok) throw new Error(response.status === 401 ? "Not accepted" : payload.error ?? "Connection unavailable — try again");
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
        <h1>BITZ AIR MONITORING</h1>
        {checking ? <div className="access-checking">Checking saved display session…</div> : (
          <form className="access-password-choice" method="post" action="/api/auth" onSubmit={submit}>
            {verifierReady === false ? <div className="access-config-error" role="alert">Display access configuration needs correction.</div> : null}
            <input
              id="dashboard-password"
              name="password"
              type="password"
              aria-label="Display access"
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
        )}
      </section>
    </main>
  );
}

function ConnectionPending({ checking, onRetry }: { checking: boolean; onRetry: () => void | Promise<void> }) {
  return (
    <main className="access-shell">
      <section className="access-card connection-pending" aria-live="polite">
        <div className="access-kicker">BITZ AIR MONITORING</div>
        <div className="pending-state"><span className="connection-dot" /><strong>{checking ? "Checking live sensor feed" : "Live sensor feed is being initialized"}</strong></div>
        <button className="connection-retry" type="button" onClick={() => void onRetry()} disabled={checking}>{checking ? "CHECKING CONNECTION…" : "RETRY CONNECTION"}</button>
      </section>
    </main>
  );
}

function ApiKeySetup({ onConnected }: { onConnected: () => void }) {
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
        <label htmlFor="airq-api-key">air-Q API key</label>
        <input id="airq-api-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" autoFocus />
        {error ? <div className="access-error" role="alert">{error}</div> : null}
        <button type="submit" disabled={!apiKey || submitting}>{submitting ? "Connecting…" : "Connect live data"}</button>
      </form>
    </main>
  );
}
