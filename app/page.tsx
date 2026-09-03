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
  pm10: number | null;
  sound: number | null;
  soundMax: number | null;
  health: number | null;
  performance: number | null;
};

type Check = {
  label: string;
  method: "DIRECT" | "PROXY" | "PATTERN" | "RAW" | "SYSTEM";
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
  rooms: { lab: RoomData; office: RoomData };
};

type GradeLevel = "great" | "good" | "watch" | "action" | "unknown";
type Grade = { label: string; level: GradeLevel };

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
      ? "Keep monitoring. Check the hood or process only if TVOC reverses or remains elevated for 30 minutes."
      : "None now. Reassess if CO₂ and VOC rise together or PM enters with a ventilation change.",
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
  rooms: { lab: demoRoom("LAB"), office: demoRoom("OFFICE") },
};

function fmt(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });
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

function particleValue(sample: Sample) {
  return sample.pm25 ?? sample.pm10 ?? sample.pm1;
}

function particleObservation(samples: Sample[]) {
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const sample = samples[index];
    if (sample.pm25 !== null) return { value: sample.pm25, timestamp: sample.timestamp, channel: "PM₂.₅" };
    if (sample.pm10 !== null) return { value: sample.pm10, timestamp: sample.timestamp, channel: "PM₁₀" };
    if (sample.pm1 !== null) return { value: sample.pm1, timestamp: sample.timestamp, channel: "PM₁" };
  }
  return null;
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
  if (value < 250) return { label: "LOW", level: "great" };
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

function pmGrade(value: number | null): Grade {
  if (value === null) return { label: "NO DATA", level: "unknown" };
  if (value <= 5) return { label: "LOW", level: "great" };
  if (value <= 15) return { label: "GOOD", level: "good" };
  if (value <= 35) return { label: "CHECK", level: "watch" };
  return { label: "HIGH", level: "action" };
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

function HistoryTrend({
  samples,
  primary,
  secondary,
  label,
  levelFor,
  analysisMinutes = 60,
  noSeriesLabel,
}: {
  samples: Sample[];
  primary: (sample: Sample) => number | null;
  secondary?: (sample: Sample) => number | null;
  label: string;
  levelFor: (value: number | null) => Grade;
  analysisMinutes?: number;
  noSeriesLabel?: string;
}) {
  const geometry = useMemo(() => {
    const start = samples[0]?.timestamp ?? 0;
    const end = samples.at(-1)?.timestamp ?? start + 1;
    const recentStart = end - analysisMinutes * 60_000;
    function build(selector?: (sample: Sample) => number | null) {
      if (!selector) return { all: "", recent: "", current: null as { x: number; y: number } | null, count: 0 };
      const values = samples.map(selector).filter((value): value is number => value !== null && Number.isFinite(value));
      if (values.length < 2) {
        const observation = latestObservation(samples, selector);
        const x = observation ? ((observation.timestamp - start) / Math.max(end - start, 1)) * 100 : 0;
        return { all: "", recent: "", current: observation ? { x, y: 15 } : null, count: values.length };
      }
      const min = Math.min(...values);
      const max = Math.max(...values);
      const allPoints = pointsFor(samples, selector, start, end, min, max);
      const recentPoints = pointsFor(samples.filter((sample) => sample.timestamp >= recentStart), selector, start, end, min, max);
      return {
        all: allPoints.map((point) => `${point.command}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" "),
        recent: recentPoints.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" "),
        current: allPoints.at(-1) ?? null,
        count: values.length,
      };
    }
    const timeRange = Math.max(end - start, 1);
    const graded = samples.map((sample, index) => {
      const x = ((sample.timestamp - start) / timeRange) * 100;
      const previousX = index === 0 ? 0 : ((samples[index - 1].timestamp - start) / timeRange) * 100;
      const nextX = index === samples.length - 1 ? 100 : ((samples[index + 1].timestamp - start) / timeRange) * 100;
      return {
        from: index === 0 ? 0 : (previousX + x) / 2,
        to: index === samples.length - 1 ? 100 : (x + nextX) / 2,
        level: levelFor(primary(sample)).level,
      };
    });
    const zones = graded.reduce<Array<{ from: number; to: number; level: GradeLevel }>>((result, item) => {
      const previous = result.at(-1);
      if (previous?.level === item.level) previous.to = item.to;
      else result.push({ ...item });
      return result;
    }, []);
    return {
      primary: build(primary),
      secondary: build(secondary),
      zones,
      recentBoundary: Math.max(0, ((recentStart - start) / timeRange) * 100),
    };
  }, [samples, primary, secondary, analysisMinutes, levelFor]);

  return (
    <div className="trend-chart">
      <svg className="trend-svg" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={label}>
        {geometry.zones.map((zone, index) => <rect key={`${zone.from}-${index}`} x={zone.from} y="2" width={Math.max(zone.to - zone.from, .1)} height="24" className={`trend-zone zone-${zone.level}`} />)}
        <line x1="0" y1="25" x2="100" y2="25" className="trend-grid" />
        <rect x={geometry.recentBoundary} y="3" width={100 - geometry.recentBoundary} height="23" className="recent-window" />
        {geometry.secondary.all ? <path d={geometry.secondary.all} className="trend-secondary trend-history" /> : null}
        {geometry.primary.all ? <path d={geometry.primary.all} className="trend-primary trend-history" /> : null}
        {geometry.secondary.recent ? <path d={geometry.secondary.recent} className="trend-secondary trend-recent" /> : null}
        {geometry.primary.recent ? <path d={geometry.primary.recent} className="trend-primary trend-recent" /> : null}
        {geometry.primary.current ? <circle cx={geometry.primary.current.x} cy={geometry.primary.current.y} r="2.2" className="current-point" /> : null}
      </svg>
      {geometry.primary.count < 2 && noSeriesLabel ? <div className="trend-last-valid">{noSeriesLabel}</div> : null}
    </div>
  );
}

function LevelMark({ status }: { status: RoomData["status"] }) {
  return <span className={`level-mark level-${status}`} aria-hidden="true">{status === "normal" ? "✓" : status === "action" ? "!" : "•"}</span>;
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

export default function Home() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [apiConnected, setApiConnected] = useState<boolean | null>(null);
  const [ownerSetup] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("setup") === "owner");
  const [data, setData] = useState<DashboardData>(DEMO_DATA);
  const [clock, setClock] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);

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
      .then((payload: { authorized?: boolean }) => {
        if (active) setAuthorized(payload.authorized === true);
      })
      .catch(() => { if (active) setAuthorized(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!authorized) return;
    let active = true;
    const checkConnection = () => fetch("/api/key", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { configured?: boolean }) => { if (active) setApiConnected(payload.configured === true); })
      .catch(() => { if (active) setApiConnected(false); });
    checkConnection();
    const timer = window.setInterval(checkConnection, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [authorized]);

  useEffect(() => {
    if (!authorized || !apiConnected) return;
    const kickoffTimer = window.setTimeout(loadData, 0);
    const refreshTimer = window.setInterval(loadData, 120_000);
    const clockTimer = window.setInterval(() => setClock(Date.now()), 15_000);
    return () => { window.clearTimeout(kickoffTimer); window.clearInterval(refreshTimer); window.clearInterval(clockTimer); };
  }, [authorized, apiConnected, loadData]);

  const newestTimestamp = Math.max(data.rooms.lab.latest?.timestamp ?? 0, data.rooms.office.latest?.timestamp ?? 0);
  const ageMinutes = newestTimestamp ? Math.max(0, Math.floor((clock - newestTimestamp) / 60_000)) : null;
  const sourceTime = newestTimestamp
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(newestTimestamp)
    : "—";

  function requestFullscreen() {
    document.documentElement.requestFullscreen?.().catch(() => undefined);
  }

  async function lockBoard() {
    await fetch("/api/auth", { method: "DELETE" }).catch(() => undefined);
    setAuthorized(false);
    setApiConnected(null);
  }

  if (authorized !== true) return <AccessGate checking={authorized === null} onGranted={() => setAuthorized(true)} />;
  if (apiConnected !== true) {
    if (ownerSetup && apiConnected === false) return <ApiKeySetup checking={false} onConnected={() => setApiConnected(true)} />;
    return <ConnectionPending checking={apiConnected === null} />;
  }

  return (
    <main className="wallboard">
      <header className="wallboard-header">
        <div className="identity"><strong>BITZ LAB AIR MONITORING</strong><span>LIVE READINGS · 24-HOUR HISTORY · LATEST 60-MINUTE ANALYSIS</span></div>
        <div className="header-state" aria-live="polite">
          <span className={`connection-dot ${data.live ? "is-live" : "is-preview"}`} />
          <span>{data.live ? "LIVE" : "PREVIEW"}</span>
          <span>{data.live ? `Source ${sourceTime} Europe/Berlin` : "24-hour sample history"}</span>
          <span>{data.live ? (ageMinutes === null ? "age unknown" : `${ageMinutes} min old`) : "recent hour highlighted"}</span>
          <button type="button" onClick={lockBoard}>Lock</button>
          <button type="button" onClick={requestFullscreen}>Full screen</button>
        </div>
      </header>
      {!data.live ? <div className="preview-banner">{data.message ?? "Preview data — live connection pending"}</div> : null}
      <div className="room-layout">
        <LabPanel room={data.rooms.lab} refreshing={refreshing} analysisMinutes={data.analysisMinutes} />
        <OfficeRail room={data.rooms.office} analysisMinutes={data.analysisMinutes} />
      </div>
      <footer className="wallboard-footer">
        <span>24-hour history shown · latest 60 minutes highlighted · rooms evaluated independently</span>
        <strong>SPARK RICHARD BIOENGINEERING</strong>
      </footer>
    </main>
  );
}

function AccessGate({ checking, onGranted }: { checking: boolean; onGranted: () => void }) {
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
      if (!response.ok) throw new Error("Incorrect password");
      setPassword("");
      onGranted();
    } catch {
      setPassword("");
      setError("Password not accepted");
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
            <label htmlFor="dashboard-password">Display password</label>
            <input
              id="dashboard-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              autoFocus
            />
            {error ? <div className="access-error" role="alert">{error}</div> : null}
            <button type="submit" disabled={!password || submitting}>{submitting ? "Opening…" : "Open monitor"}</button>
          </>
        )}
      </form>
    </main>
  );
}

function ConnectionPending({ checking }: { checking: boolean }) {
  return (
    <main className="access-shell">
      <section className="access-card connection-pending" aria-live="polite">
        <div className="access-kicker">BITZ LAB AIR MONITORING</div>
        <div className="pending-state"><span className="connection-dot" /><strong>{checking ? "Checking live sensor feed" : "Live sensor feed is being initialized"}</strong></div>
        <p>No visitor input is required. This display will open automatically when the secure data connection is ready.</p>
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

function LabPanel({ room, refreshing, analysisMinutes }: { room: RoomData; refreshing: boolean; analysisMinutes: number }) {
  const latest = room.latest;
  const normalCount = room.checks.filter((check) => check.level === "normal").length;
  const evidenceChecks = [...room.checks]
    .sort((left, right) => {
      const priority = { action: 0, watch: 1, unknown: 2, normal: 3 };
      return priority[left.level] - priority[right.level];
    })
    .slice(0, 2);
  return (
    <section className="lab-panel" aria-labelledby="lab-heading">
      <div className="room-heading"><div className="room-titleline"><TrafficLight status={room.status} /><h1 id="lab-heading">BIOENGINEERING S1 LAB</h1></div>{refreshing ? <span className="refresh-label">UPDATING</span> : null}</div>
      <div className={`overall-state overall-${room.status}`}>
        <LevelMark status={room.status} />
        <div><strong>{room.statusLabel}</strong><span>{normalCount}/{room.checks.length} monitored conditions currently clear</span></div>
        <div className="state-detail"><strong>{room.samples.length} readings</strong><span>rolling 24-hour trace</span></div>
      </div>
      <div className="critical-grid">
        {room.checks.map((check) => <article className={`critical-check check-${check.level}`} key={check.label}><span>{check.label} · {check.method.toLowerCase()}</span><strong>{check.status}</strong></article>)}
      </div>
      <div className="metric-grid">
        <Metric label="Health" value={fmt(latest?.health)} note="air-Q index + raw channels" grade={indexGrade(latest?.health ?? null)} />
        <Metric label="Performance" value={fmt(latest?.performance)} note="air-Q workday index" grade={indexGrade(latest?.performance ?? null)} />
        <Metric label="CO₂" value={`${fmt(latest?.co2)} ppm`} note={occupancyText(room)} grade={co2Grade(latest?.co2 ?? null)} />
        <Metric label="TVOC" value={`${fmt(latest?.tvoc)} ppb`} note="gas-pattern context" grade={tvocGrade(latest?.tvoc ?? null)} />
        <Metric label="Oxygen" value={`${fmt(latest?.oxygen, 2)}%`} note="displacement proxy" grade={oxygenGrade(latest?.oxygen ?? null)} />
        <Metric label="Temperature" value={`${fmt(latest?.temperature, 1)}°C`} note="LAB thermal band" grade={temperatureGrade(latest?.temperature ?? null, "LAB")} />
        <Metric label="Humidity" value={`${fmt(latest?.humidity)}%`} note="humidity band" grade={humidityGrade(latest?.humidity ?? null)} />
      </div>
      <div className="evidence-layout">
        <section className="evidence-panel" aria-labelledby="evidence-heading">
          <div className="panel-heading"><h2 id="evidence-heading">24-hour evidence tail</h2><div className="colour-key"><span className="key-great">GOOD</span><span className="key-watch">CHECK</span><span className="key-action">ACT</span></div></div>
          <TrendRow label="TVOC / HCHO" samples={room.samples} primary={(s) => s.tvoc} secondary={(s) => s.hcho} gradeFor={tvocGrade} analysisMinutes={analysisMinutes} />
          <TrendRow label="CO₂ / humidity" samples={room.samples} primary={(s) => s.co2} secondary={(s) => s.humidityAbs} gradeFor={co2Grade} analysisMinutes={analysisMinutes} />
          <TrendRow label="O₂ / CO" samples={room.samples} primary={(s) => s.oxygen} secondary={(s) => s.co} gradeFor={oxygenGrade} analysisMinutes={analysisMinutes} />
          <TrendRow label="PM / sound max" samples={room.samples} primary={particleValue} secondary={(s) => s.soundMax} gradeFor={pmGrade} analysisMinutes={analysisMinutes} />
        </section>
        <aside className={`meaning-panel meaning-panel-${room.status}`} aria-labelledby="meaning-heading">
          <h2 id="meaning-heading">Meaningful action</h2>
          <div className="meaning-copy"><strong>WHAT IT MEANS NOW</strong><p>{room.summary}</p><span>COMPUTED · PAST HOUR</span></div>
          <div className="meaning-evidence" aria-label="Signals supporting the current interpretation">
            {evidenceChecks.map((check) => <div key={check.label}><span>{check.label}</span><b className={`text-${check.level}`}>{check.status}</b></div>)}
          </div>
          <div className={`action-copy action-${room.status}`}><strong>{room.status === "normal" ? "KEEP MONITORING" : room.status === "watch" ? "CHECK THIS NOW" : room.status === "action" ? "ACT NOW" : "CHECK DATA"}</strong><p>{room.action}</p></div>
        </aside>
      </div>
    </section>
  );
}

function Metric({ label, value, note, grade }: { label: string; value: string; note: string; grade: Grade }) {
  return <article className={`metric metric-${grade.level}`} title={`${label}: ${value} — ${grade.label}. ${note}`}><div className="metric-label"><span>{label}</span></div><strong>{value}</strong><div className="metric-foot"><b className={`grade-word grade-${grade.level}`}><i />{grade.label}</b></div></article>;
}

function TrendRow({ label, samples, primary, secondary, gradeFor, analysisMinutes }: { label: string; samples: Sample[]; primary: (sample: Sample) => number | null; secondary?: (sample: Sample) => number | null; gradeFor: (value: number | null) => Grade; analysisMinutes: number }) {
  const grade = gradeFor(latestValue(samples, primary));
  return <div className={`trend-row trend-row-${grade.level}`}><strong>{label}</strong><HistoryTrend samples={samples} primary={primary} secondary={secondary} levelFor={gradeFor} label={`${label} across 24 hours; background colour follows the primary reading`} analysisMinutes={analysisMinutes} /><span className="trend-reading"><b className={`grade-pill grade-${grade.level}`}><i />{grade.label}</b></span></div>;
}

function OfficeRail({ room, analysisMinutes }: { room: RoomData; analysisMinutes: number }) {
  const latest = room.latest;
  const pmObservation = particleObservation(room.samples);
  const pmValue = pmObservation?.value ?? null;
  const pmAge = pmObservation ? ageLabel(pmObservation.timestamp, latest?.timestamp) : "PM VALUE NOT RETURNED";
  const pmDisplayGrade = pmObservation && latest && latest.timestamp - pmObservation.timestamp > 10 * 60_000
    ? { label: "LAST VALID", level: "unknown" as const }
    : pmGrade(pmValue);
  const actionLabel = room.status === "normal" ? "KEEP MONITORING" : room.status === "watch" ? "CHECK THIS NOW" : room.status === "action" ? "ACT NOW" : "CHECK DATA";
  const visibleChecks = room.checks.filter((check) => ["CO release", "O₂ displacement", "Volatile-gas pattern", "Sound peak >90 dB"].includes(check.label));
  return (
    <aside className="office-rail" aria-labelledby="office-heading">
      <div className="office-heading"><div className="room-titleline"><TrafficLight status={room.status} /><h2 id="office-heading">BIOENGINEERING OFFICE</h2></div></div>
      <div className={`office-state overall-${room.status}`}><LevelMark status={room.status} /><div><strong>{room.statusLabel}</strong><span>{room.checks.filter((check) => check.level === "normal").length}/{room.checks.length} checks clear</span></div></div>
      <div className="office-metrics">
        <Metric label="Health" value={fmt(latest?.health)} note="air-Q index" grade={indexGrade(latest?.health ?? null)} />
        <Metric label="Performance" value={fmt(latest?.performance)} note="air-Q index" grade={indexGrade(latest?.performance ?? null)} />
        <Metric label="CO₂" value={`${fmt(latest?.co2)} ppm`} note={occupancyText(room)} grade={co2Grade(latest?.co2 ?? null)} />
        <Metric label="TVOC" value={`${fmt(latest?.tvoc)} ppb`} note="vapour pattern" grade={tvocGrade(latest?.tvoc ?? null)} />
        <Metric label="PM" value={`${fmt(pmValue, 1)} µg/m³`} note={pmObservation ? `${pmObservation.channel} · ${pmAge}` : pmAge} grade={pmDisplayGrade} />
        <Metric label="Temperature" value={`${fmt(latest?.temperature, 1)}°C`} note="OFFICE thermal band" grade={temperatureGrade(latest?.temperature ?? null, "OFFICE")} />
      </div>
      <section className="office-trends" aria-label="OFFICE 24-hour compact trends">
        <div className="office-trend-title"><strong>24-hour colour history</strong></div>
        <OfficeTrend label="CO₂" value={`${fmt(latest?.co2)} ppm`} samples={room.samples} selector={(s) => s.co2} gradeFor={co2Grade} analysisMinutes={analysisMinutes} />
        <OfficeTrend label="VOC" value={`${fmt(latest?.tvoc)} ppb`} samples={room.samples} selector={(s) => s.tvoc} gradeFor={tvocGrade} analysisMinutes={analysisMinutes} />
        <OfficeTrend label="PM" value={`${fmt(pmValue, 1)} µg/m³`} samples={room.samples} selector={particleValue} gradeFor={pmGrade} displayGrade={pmDisplayGrade} noSeriesLabel={pmObservation ? `${pmObservation.channel} ${fmt(pmValue, 1)} µg/m³ · ${pmAge}` : pmAge} analysisMinutes={analysisMinutes} />
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

function OfficeTrend({ label, value, samples, selector, gradeFor, displayGrade, noSeriesLabel, analysisMinutes }: { label: string; value: string; samples: Sample[]; selector: (sample: Sample) => number | null; gradeFor: (value: number | null) => Grade; displayGrade?: Grade; noSeriesLabel?: string; analysisMinutes: number }) {
  const grade = displayGrade ?? gradeFor(latestValue(samples, selector));
  return <div className={`office-trend-row trend-row-${grade.level}`}><div><strong>{label}</strong><span><b className={`grade-pill grade-${grade.level}`}><i />{grade.label}</b> {value}</span></div><HistoryTrend samples={samples} primary={selector} levelFor={gradeFor} label={`${label} across 24 hours; background colour follows the reading`} noSeriesLabel={noSeriesLabel} analysisMinutes={analysisMinutes} /></div>;
}
