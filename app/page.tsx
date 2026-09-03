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
    statusLabel: lab ? "SAFE WITHIN MONITORED SCOPE" : "MONITORED STATE NORMAL",
    samples,
    latest: samples.at(-1) ?? null,
    occupancy: { label: lab ? "2–4 likely" : "1–3 likely", confidence: "medium confidence" },
    summary: lab
      ? "Routine occupancy is plausible. An earlier vapour response is returning toward the LAB reference without a particle plume."
      : "A gentle CO₂ rise with stable PM is consistent with light occupancy; no unusual outdoor-air pattern is visible.",
    action: lab
      ? "None now. Verify hood or process state only if TVOC reverses upward or remains elevated for another 30 minutes."
      : "None now. Reassess if CO₂ and VOC rise together or PM enters with a ventilation change.",
    checks: [
      { label: "CO release", method: "DIRECT", status: "NO ELEVATION", level: "normal" },
      { label: "O₂ displacement", method: "PROXY", status: "NOT INDICATED", level: "normal" },
      { label: "Volatile-gas pattern", method: "PATTERN", status: "NORMAL", level: "normal" },
      { label: "Formaldehyde elevation", method: "DIRECT", status: "NOT DETECTED", level: "normal" },
      { label: "Particle plume", method: "DIRECT", status: "NONE", level: "normal" },
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
  analysisMinutes = 60,
}: {
  samples: Sample[];
  primary: (sample: Sample) => number | null;
  secondary?: (sample: Sample) => number | null;
  label: string;
  analysisMinutes?: number;
}) {
  const geometry = useMemo(() => {
    const start = samples[0]?.timestamp ?? 0;
    const end = samples.at(-1)?.timestamp ?? start + 1;
    const recentStart = end - analysisMinutes * 60_000;
    function build(selector?: (sample: Sample) => number | null) {
      if (!selector) return { all: "", recent: "", current: null as { x: number; y: number } | null };
      const values = samples.map(selector).filter((value): value is number => value !== null && Number.isFinite(value));
      if (values.length < 2) return { all: "", recent: "", current: null };
      const min = Math.min(...values);
      const max = Math.max(...values);
      const allPoints = pointsFor(samples, selector, start, end, min, max);
      const recentPoints = pointsFor(samples.filter((sample) => sample.timestamp >= recentStart), selector, start, end, min, max);
      return {
        all: allPoints.map((point) => `${point.command}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" "),
        recent: recentPoints.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" "),
        current: allPoints.at(-1) ?? null,
      };
    }
    return { primary: build(primary), secondary: build(secondary), recentBoundary: Math.max(0, ((recentStart - start) / Math.max(end - start, 1)) * 100) };
  }, [samples, primary, secondary, analysisMinutes]);

  return (
    <svg className="trend-svg" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={label}>
      <line x1="0" y1="25" x2="100" y2="25" className="trend-grid" />
      <line x1="0" y1="16" x2="100" y2="16" className="trend-reference" />
      <rect x={geometry.recentBoundary} y="3" width={100 - geometry.recentBoundary} height="23" className="recent-window" />
      {geometry.secondary.all ? <path d={geometry.secondary.all} className="trend-secondary trend-history" /> : null}
      {geometry.primary.all ? <path d={geometry.primary.all} className="trend-primary trend-history" /> : null}
      {geometry.secondary.recent ? <path d={geometry.secondary.recent} className="trend-secondary trend-recent" /> : null}
      {geometry.primary.recent ? <path d={geometry.primary.recent} className="trend-primary trend-recent" /> : null}
      {geometry.primary.current ? <circle cx={geometry.primary.current.x} cy={geometry.primary.current.y} r="2.2" className="current-point" /> : null}
    </svg>
  );
}

function LevelMark({ status }: { status: RoomData["status"] }) {
  return <span className={`level-mark level-${status}`} aria-hidden="true">{status === "normal" ? "✓" : status === "action" ? "!" : "•"}</span>;
}

export default function Home() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [data, setData] = useState<DashboardData>(DEMO_DATA);
  const [clock, setClock] = useState(0);
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
      .then((payload: { authorized?: boolean }) => { if (active) setAuthorized(payload.authorized === true); })
      .catch(() => { if (active) setAuthorized(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!authorized) return;
    setClock(Date.now());
    loadData();
    const refreshTimer = window.setInterval(loadData, 120_000);
    const clockTimer = window.setInterval(() => setClock(Date.now()), 15_000);
    return () => { window.clearInterval(refreshTimer); window.clearInterval(clockTimer); };
  }, [authorized, loadData]);

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
  }

  if (authorized !== true) return <AccessGate checking={authorized === null} onGranted={() => setAuthorized(true)} />;

  return (
    <main className="wallboard">
      <header className="wallboard-header">
        <div className="identity"><strong>ENVIRONMENTAL STATUS</strong><span>Recent 60-minute analysis · 24-hour visual context</span></div>
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
        <span>LAB and OFFICE are evaluated independently. Older history is subdued; the latest hour and current point are emphasized.</span>
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
        <h1>Environmental monitor</h1>
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

function LabPanel({ room, refreshing, analysisMinutes }: { room: RoomData; refreshing: boolean; analysisMinutes: number }) {
  const latest = room.latest;
  const normalCount = room.checks.filter((check) => check.level === "normal").length;
  const recentCutoff = (latest?.timestamp ?? 0) - analysisMinutes * 60_000;
  const maxSound = Math.max(...room.samples.filter((sample) => sample.timestamp >= recentCutoff).map((sample) => sample.soundMax ?? -Infinity));
  return (
    <section className="lab-panel" aria-labelledby="lab-heading">
      <div className="room-heading"><div><h1 id="lab-heading">LAB</h1><span>Primary analytical environment · LAB-specific reference</span></div><span>{refreshing ? "Refreshing…" : "80% screen priority"}</span></div>
      <div className={`overall-state overall-${room.status}`}>
        <LevelMark status={room.status} />
        <div><strong>{room.statusLabel}</strong><span>{normalCount}/{room.checks.length} critical checks currently clear</span></div>
        <div className="state-detail"><strong>{room.occupancy.label}</strong><span>occupancy · {room.occupancy.confidence}</span></div>
      </div>
      <div className="critical-grid">
        {room.checks.map((check) => <article className={`critical-check check-${check.level}`} key={check.label}><span>{check.label} · {check.method.toLowerCase()}</span><strong>{check.status}</strong></article>)}
      </div>
      <div className="metric-grid">
        <Metric label="Health" value={fmt(latest?.health)} note="index + raw channels" />
        <Metric label="Performance" value={fmt(latest?.performance)} note="workday watch" />
        <Metric label="CO₂" value={`${fmt(latest?.co2)} ppm`} note={room.occupancy.label} />
        <Metric label="TVOC" value={`${fmt(latest?.tvoc)} ppb`} note="gas-pattern context" />
        <Metric label="Oxygen" value={`${fmt(latest?.oxygen, 2)}%`} note="displacement proxy" />
        <Metric label="Temperature" value={`${fmt(latest?.temperature, 1)}°C`} note="thermal context" />
        <Metric label="Humidity" value={`${fmt(latest?.humidity)}%`} note="sensor context" />
      </div>
      <div className="evidence-layout">
        <section className="evidence-panel" aria-labelledby="evidence-heading">
          <div className="panel-heading"><h2 id="evidence-heading">24-hour evidence tail</h2><span>latest 60 min shaded · current point enlarged</span></div>
          <TrendRow label="TVOC / HCHO" status="vapour pattern" samples={room.samples} primary={(s) => s.tvoc} secondary={(s) => s.hcho} analysisMinutes={analysisMinutes} />
          <TrendRow label="CO₂ / humidity" status={room.occupancy.label} samples={room.samples} primary={(s) => s.co2} secondary={(s) => s.humidityAbs} analysisMinutes={analysisMinutes} />
          <TrendRow label="O₂ / CO" status="displacement/CO" samples={room.samples} primary={(s) => s.oxygen} secondary={(s) => s.co} analysisMinutes={analysisMinutes} />
          <TrendRow label="PM / sound max" status={`recent max ${Number.isFinite(maxSound) ? fmt(maxSound) : "—"} dB`} samples={room.samples} primary={(s) => s.pm25} secondary={(s) => s.soundMax} analysisMinutes={analysisMinutes} />
        </section>
        <aside className="meaning-panel" aria-labelledby="meaning-heading">
          <h2 id="meaning-heading">Meaning and next action</h2>
          <div className="meaning-copy"><strong>Past-hour interpretation</strong><p>{room.summary}</p><span>INFERRED · MULTI-SENSOR</span></div>
          <div className={`action-copy action-${room.status}`}><strong>{room.status === "normal" ? "NO ACTION" : room.status === "watch" ? "WATCH" : "ACTION"}</strong><p>{room.action}</p></div>
        </aside>
      </div>
    </section>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <article className="metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function TrendRow({ label, status, samples, primary, secondary, analysisMinutes }: { label: string; status: string; samples: Sample[]; primary: (sample: Sample) => number | null; secondary?: (sample: Sample) => number | null; analysisMinutes: number }) {
  return <div className="trend-row"><strong>{label}</strong><HistoryTrend samples={samples} primary={primary} secondary={secondary} label={`${label} across 24 hours with the latest hour emphasized`} analysisMinutes={analysisMinutes} /><span>{status}</span></div>;
}

function OfficeRail({ room, analysisMinutes }: { room: RoomData; analysisMinutes: number }) {
  const latest = room.latest;
  const visibleChecks = room.checks.filter((check) => ["CO release", "O₂ displacement", "Volatile-gas pattern", "Sound peak >90 dB"].includes(check.label));
  return (
    <aside className="office-rail" aria-labelledby="office-heading">
      <div className="office-heading"><div><h2 id="office-heading">OFFICE</h2><span>Secondary context</span></div><span>20%</span></div>
      <div className={`office-state overall-${room.status}`}><LevelMark status={room.status} /><div><strong>{room.statusLabel}</strong><span>{room.checks.filter((check) => check.level === "normal").length}/{room.checks.length} checks clear</span></div></div>
      <div className="office-metrics">
        <Metric label="Health" value={fmt(latest?.health)} note="index" />
        <Metric label="Performance" value={fmt(latest?.performance)} note="index" />
        <Metric label="CO₂" value={`${fmt(latest?.co2)} ppm`} note={room.occupancy.label} />
        <Metric label="TVOC" value={`${fmt(latest?.tvoc)} ppb`} note="vapour pattern" />
        <Metric label="PM₂.₅" value={`${fmt(latest?.pm25, 1)} µg/m³`} note="particle context" />
        <Metric label="Temperature" value={`${fmt(latest?.temperature, 1)}°C`} note="comfort" />
      </div>
      <section className="office-trends" aria-label="OFFICE 24-hour compact trends">
        <div className="office-trend-title"><strong>24-hour context</strong><span>latest hour bright</span></div>
        <OfficeTrend label="CO₂" value={`${fmt(latest?.co2)} ppm`} samples={room.samples} selector={(s) => s.co2} analysisMinutes={analysisMinutes} />
        <OfficeTrend label="VOC" value={`${fmt(latest?.tvoc)} ppb`} samples={room.samples} selector={(s) => s.tvoc} analysisMinutes={analysisMinutes} />
        <OfficeTrend label="PM₂.₅" value={`${fmt(latest?.pm25, 1)} µg/m³`} samples={room.samples} selector={(s) => s.pm25} analysisMinutes={analysisMinutes} />
      </section>
      <div className="office-checks">{visibleChecks.map((check) => <div key={check.label}><span>{check.label}</span><strong className={`text-${check.level}`}>{check.status}</strong></div>)}</div>
      <div className="office-summary"><strong>Past-hour interpretation</strong><p>{room.summary}</p></div>
      <div className={`office-action action-${room.status}`}><strong>{room.status === "normal" ? "NO OFFICE ACTION" : "OFFICE WATCH"}</strong><p>{room.action}</p></div>
    </aside>
  );
}

function OfficeTrend({ label, value, samples, selector, analysisMinutes }: { label: string; value: string; samples: Sample[]; selector: (sample: Sample) => number | null; analysisMinutes: number }) {
  return <div className="office-trend-row"><div><strong>{label}</strong><span>{value}</span></div><HistoryTrend samples={samples} primary={selector} label={`${label} across 24 hours with the latest hour emphasized`} analysisMinutes={analysisMinutes} /></div>;
}
