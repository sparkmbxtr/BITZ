export type ObservationWindow = { from: number; to: number };
export type TimedSample = { timestamp: number };
export type Scale = { min: number; max: number };
export type Reading = { timestamp: number; value: number };
export type PlotPoint = Reading & { x: number; y: number };

export const HISTORY_MS = 24 * 60 * 60_000;
// The report analysis also treats indoor intervals over five minutes as gaps.
// A fixed limit prevents sparse data or a long outage from defining a new cadence.
export const INDOOR_GAP_MS = 5 * 60_000;
// Weather observations are hourly, independently of the indoor sensor cadence.
export const OUTDOOR_GAP_MS = 90 * 60_000;

export function chronologicalByTimestamp<T extends TimedSample>(samples: T[]): T[] {
  const unique = new Map<number, T>();
  for (const sample of samples) {
    if (Number.isFinite(sample.timestamp)) unique.set(sample.timestamp, sample);
  }
  return [...unique.values()].sort((left, right) => left.timestamp - right.timestamp);
}

export function observationWindow(payload: { coverage?: ObservationWindow; fetchedAt: number }, now: number): ObservationWindow {
  const coverage = payload.coverage;
  if (coverage && Number.isFinite(coverage.from) && Number.isFinite(coverage.to) && coverage.to - coverage.from === HISTORY_MS) {
    return { from: coverage.from, to: coverage.to };
  }
  // Older API responses may lack coverage. Never derive the axis from samples.
  const to = Number.isFinite(payload.fetchedAt) && payload.fetchedAt > 0 ? payload.fetchedAt : now;
  return { from: to - HISTORY_MS, to };
}

export function samplesInWindow<T extends TimedSample>(samples: T[], window: ObservationWindow): T[] {
  return chronologicalByTimestamp(samples).filter((sample) => sample.timestamp >= window.from && sample.timestamp <= window.to);
}

export function latestReading<T extends TimedSample>(samples: T[], selector: (sample: T) => number | null, end: number): Reading | null {
  const ordered = chronologicalByTimestamp(samples);
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const sample = ordered[index];
    const value = selector(sample);
    if (sample.timestamp <= end && typeof value === "number" && Number.isFinite(value)) {
      return { timestamp: sample.timestamp, value };
    }
  }
  return null;
}

export function isFreshReading(reading: TimedSample | null, now: number): boolean {
  return reading !== null && Number.isFinite(reading.timestamp) && reading.timestamp <= now && now - reading.timestamp <= INDOOR_GAP_MS;
}

export function scaleFor(values: Array<number | null>): Scale | null {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return min === Infinity ? null : { min, max };
}

export function timePosition(timestamp: number, window: ObservationWindow): number {
  return ((timestamp - window.from) / (window.to - window.from)) * 100;
}

export function historySeries<T extends TimedSample>(
  samples: T[],
  selector: (sample: T) => number | null,
  window: ObservationWindow,
  scale: Scale | null,
  maxGapMs = INDOOR_GAP_MS,
) {
  const segments: PlotPoint[][] = [];
  let segment: PlotPoint[] | null = null;
  if (scale) {
    for (const sample of samplesInWindow(samples, window)) {
      const value = selector(sample);
      if (typeof value !== "number" || !Number.isFinite(value)) {
        segment = null;
        continue;
      }
      if (!segment || sample.timestamp - segment[segment.length - 1].timestamp > maxGapMs) {
        segment = [];
        segments.push(segment);
      }
      segment.push({
        timestamp: sample.timestamp,
        value,
        x: timePosition(sample.timestamp, window),
        y: scale.max === scale.min ? 16.5 : 28 - ((value - scale.min) / (scale.max - scale.min)) * 23,
      });
    }
  }
  return {
    segments,
    path: segments.map((points) => points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ")).join(" "),
    // An SVG move command alone is invisible. Draw isolated observations as dots.
    isolated: segments.filter((points) => points.length === 1).map((points) => points[0]),
  };
}

export function referenceZones<Band extends string>(segments: PlotPoint[][], bandFor: (value: number) => Band) {
  const zones: Array<{ from: number; to: number; band: Band }> = [];
  for (const segment of segments) {
    for (let index = 0; index < segment.length; index += 1) {
      const point = segment[index];
      const from = index ? (segment[index - 1].x + point.x) / 2 : point.x;
      const to = index < segment.length - 1 ? (point.x + segment[index + 1].x) / 2 : point.x;
      if (to <= from) continue;
      const band = bandFor(point.value);
      const previous = zones.at(-1);
      if (previous?.band === band && previous.to === from) previous.to = to;
      else zones.push({ from, to, band });
    }
  }
  return zones;
}
