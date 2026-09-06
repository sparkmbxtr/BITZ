#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import statistics
from collections import OrderedDict, defaultdict
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterable
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd


BERLIN = ZoneInfo("Europe/Berlin")
UTC = timezone.utc
SOURCE = Path(".")
OUT = Path(".")
WINDOW_START_MS = 0
WINDOW_END_MS = 0
DATES: list[Any] = []
SATURDAY = datetime.now(BERLIN).date()


def configure() -> None:
    global SOURCE, OUT, WINDOW_START_MS, WINDOW_END_MS, DATES, SATURDAY
    parser = argparse.ArgumentParser(description="Build a Monday-Saturday airQ weekly analysis.")
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--start-ms", required=True, type=int)
    parser.add_argument("--end-ms", required=True, type=int)
    args = parser.parse_args()
    SOURCE = args.source.resolve()
    OUT = args.output.resolve()
    WINDOW_START_MS = args.start_ms
    WINDOW_END_MS = args.end_ms
    if WINDOW_END_MS <= WINDOW_START_MS:
        raise ValueError("Weekly coverage end must follow its start")
    start_local = dt_local(WINDOW_START_MS)
    end_local = dt_local(WINDOW_END_MS)
    if any((start_local.hour, start_local.minute, start_local.second, end_local.hour, end_local.minute, end_local.second)):
        raise ValueError("Weekly coverage must use Europe/Berlin midnight boundaries")
    cursor = start_local.date()
    DATES = []
    while cursor < end_local.date():
        DATES.append(cursor)
        cursor += timedelta(days=1)
    if len(DATES) != 6 or DATES[0].weekday() != 0 or DATES[-1].weekday() != 5:
        raise ValueError("Weekly report coverage must be Monday through Saturday")
    SATURDAY = DATES[-1]
    OUT.mkdir(parents=True, exist_ok=True)

FIELD_META: OrderedDict[str, tuple[str, str, int]] = OrderedDict([
    ("health", ("Health Index", "%", 1)),
    ("performance", ("Performance Index", "%", 1)),
    ("hcho", ("Formaldehyde signal", "µg/m³", 2)),
    ("pm1", ("PM1", "µg/m³", 1)),
    ("pm25", ("PM2.5", "µg/m³", 1)),
    ("pm4", ("PM4", "µg/m³", 1)),
    ("pm10", ("PM10", "µg/m³", 1)),
    ("oxygen", ("Oxygen", "%", 3)),
    ("co2", ("Carbon dioxide", "ppm", 1)),
    ("tvoc", ("TVOC signal", "ppb", 1)),
    ("co", ("Carbon monoxide signal", "mg/m³", 6)),
    ("sound", ("Sound average", "dB", 2)),
    ("soundMax", ("Sound maximum", "dB", 1)),
    ("humidity", ("Relative humidity", "%", 3)),
    ("humidityAbs", ("Absolute humidity", "g/m³", 3)),
    ("pressure", ("Atmospheric pressure", "hPa", 2)),
    ("dewpt", ("Dew point", "°C", 3)),
    ("temperature", ("Temperature", "°C", 3)),
    ("dco2dt", ("CO2 rate", "ppm/h", 2)),
    ("dhdt", ("Humidity rate", "%/h", 2)),
])

ACTIVITY_SIGNALS = OrderedDict([
    ("co2", {"floor": 20.0, "settle": 45.0}),
    ("tvoc", {"floor": 25.0, "settle": 80.0}),
    ("humidityAbs", {"floor": 0.12, "settle": 0.3}),
    ("temperature", {"floor": 0.15, "settle": 0.4}),
    ("sound", {"floor": 2.5, "settle": 4.0}),
])

SOURCE_URLS = OrderedDict([
    ("ASR A3.6 - Ventilation", "https://www.baua.de/DE/Angebote/Regelwerk/ASR/ASR-A3-6"),
    ("ASR A3.5 - Room temperature", "https://www.baua.de/DE/Angebote/Regelwerk/ASR/ASR-A3-5"),
    ("TRGS 900 - Occupational exposure limits", "https://www.baua.de/DE/Angebote/Regelwerk/TRGS/TRGS-900"),
    ("UBA/AIR - Formaldehyde indoor guidance", "https://www.umweltbundesamt.de/themen/gesundheit/umwelteinfluesse-auf-den-menschen/chemische-stoffe/formaldehyd"),
])


def finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def med(values: Iterable[Any]) -> float | None:
    clean = [float(v) for v in values if finite(v)]
    return float(statistics.median(clean)) if clean else None


def mad(values: Iterable[Any], centre: float | None = None) -> float:
    clean = [float(v) for v in values if finite(v)]
    if not clean:
        return 0.0
    c = statistics.median(clean) if centre is None else centre
    return float(statistics.median(abs(v - c) for v in clean))


def dt_local(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=UTC).astimezone(BERLIN)


def dt_utc(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=UTC)


def hhmm(ms: int | None) -> str:
    return dt_local(ms).strftime("%H:%M") if ms else ""


def iso_local(ms: int) -> str:
    return dt_local(ms).strftime("%Y-%m-%d %H:%M:%S")


def iso_utc(ms: int) -> str:
    return dt_utc(ms).strftime("%Y-%m-%d %H:%M:%S")


def minute_of_day(sample: dict[str, Any]) -> int:
    d = dt_local(int(sample["timestamp"]))
    return d.hour * 60 + d.minute


def sample_date(sample: dict[str, Any]):
    return dt_local(int(sample["timestamp"])).date()


def load_inputs() -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    rooms: dict[str, list[dict[str, Any]]] = {"LAB": [], "OFFICE": []}
    outdoor: list[dict[str, Any]] = []
    sensor_files = sorted(SOURCE.glob("sensor-*.json"))
    if not sensor_files:
        raise FileNotFoundError("No sensor export chunks found")
    for sensor_file in sensor_files:
        payload = json.loads(sensor_file.read_text())
        assert payload["live"] is True
        for room, key in [("LAB", "lab"), ("OFFICE", "office")]:
            rooms[room].extend(payload["rooms"][key]["samples"])
        if payload.get("outdoor"):
            outdoor.extend(payload["outdoor"].get("samples", []))

    duplicate_counts = {}
    for room in rooms:
        before = len(rooms[room])
        by_ts = {int(r["timestamp"]): r for r in rooms[room] if finite(r.get("timestamp"))}
        rooms[room] = [by_ts[k] for k in sorted(by_ts) if WINDOW_START_MS <= k < WINDOW_END_MS]
        duplicate_counts[room] = before - len(rooms[room])
    outdoor_map = {int(r["timestamp"]): r for r in outdoor if finite(r.get("timestamp"))}
    outdoor = [outdoor_map[k] for k in sorted(outdoor_map)]
    context_payload = json.loads((SOURCE / "context.json").read_text())
    manifest = json.loads((SOURCE / "manifest.json").read_text())
    manifest["duplicatesRemoved"] = duplicate_counts
    return rooms, outdoor, context_payload.get("entries", []), manifest


def values_between(samples: list[dict[str, Any]], key: str, start: int, end: int) -> list[float]:
    return [float(s[key]) for s in samples if start <= int(s["timestamp"]) <= end and finite(s.get(key))]


def signed_window_delta(samples: list[dict[str, Any]], key: str, timestamp: int) -> float | None:
    before = med(values_between(samples, key, timestamp - 14 * 60_000, timestamp - 2 * 60_000))
    after = med(values_between(samples, key, timestamp + 2 * 60_000, timestamp + 14 * 60_000))
    return None if before is None or after is None else after - before


def transition_score(samples: list[dict[str, Any]], timestamp: int, scales: dict[str, float]) -> dict[str, float]:
    changed = 0
    score = 0.0
    for key, config in ACTIVITY_SIGNALS.items():
        before = med(values_between(samples, key, timestamp - 14 * 60_000, timestamp - 2 * 60_000))
        after = med(values_between(samples, key, timestamp + 2 * 60_000, timestamp + 14 * 60_000))
        if before is None or after is None:
            continue
        ratio = abs(after - before) / scales.get(key, config["floor"])
        if ratio >= 1:
            changed += 1
        score += min(ratio, 2.5)
    return {"changed": changed, "score": score}


def departure_score(samples: list[dict[str, Any]], timestamp: int, centres: dict[str, float], scales: dict[str, float]) -> dict[str, float]:
    changed = 0
    score = 0.0
    for key, config in ACTIVITY_SIGNALS.items():
        centre = centres.get(key)
        after = med(values_between(samples, key, timestamp, timestamp + 15 * 60_000))
        if centre is None or after is None:
            continue
        ratio = abs(after - centre) / scales.get(key, config["floor"])
        if ratio >= 1:
            changed += 1
        score += min(ratio, 2.5)
    return {"changed": changed, "score": score}


def office_close_signature(samples: list[dict[str, Any]], timestamp: int, scales: dict[str, float]) -> dict[str, Any]:
    minute = minute_of_day({"timestamp": timestamp})
    if minute < 16 * 60 + 20 or minute > 18 * 60:
        return {"matched": False, "score": 0.0}
    tvoc_change = signed_window_delta(samples, "tvoc", timestamp)
    sound_change = signed_window_delta(samples, "sound", timestamp)
    co2_change = signed_window_delta(samples, "co2", timestamp)
    humidity_change = signed_window_delta(samples, "humidityAbs", timestamp)
    threshold = max(25.0, scales.get("tvoc", 25.0) * 0.75)
    if tvoc_change is None or tvoc_change < threshold:
        return {"matched": False, "score": 0.0}
    sound_drop = sound_change is not None and sound_change <= -max(2.0, scales.get("sound", 2.5) * 0.5)
    co2_not_accumulating = co2_change is not None and co2_change <= max(15.0, scales.get("co2", 20.0) * 0.5)
    humidity_not_accumulating = humidity_change is not None and humidity_change <= max(0.08, scales.get("humidityAbs", 0.12) * 0.5)
    departure = co2_not_accumulating and humidity_not_accumulating
    support = int(sound_drop) + int(co2_not_accumulating) + int(humidity_not_accumulating)
    return {
        "matched": bool(sound_drop or departure),
        "score": min(tvoc_change / threshold, 3.0) + support * 0.55,
        "tvocChange": tvoc_change,
        "soundDrop": sound_drop,
        "co2NotAccumulating": co2_not_accumulating,
        "humidityNotAccumulating": humidity_not_accumulating,
    }


def office_close_event_time(samples: list[dict[str, Any]], candidate: int, scales: dict[str, float]) -> tuple[int, str]:
    tvoc_scale = max(25.0, scales.get("tvoc", 25.0))
    sound_scale = max(2.5, scales.get("sound", 2.5))
    candidates = [s for s in samples if abs(int(s["timestamp"]) - candidate) <= 24 * 60_000 and 16 * 60 + 20 <= minute_of_day(s) <= 18 * 60]
    best_ts, best_score = candidate, -math.inf
    for s in candidates:
        ts = int(s["timestamp"])
        before = med(values_between(samples, "tvoc", ts - 8 * 60_000, ts - 2 * 60_000))
        after = med(values_between(samples, "tvoc", ts, ts + 6 * 60_000))
        if before is None or after is None or after <= before:
            continue
        sb = med(values_between(samples, "sound", ts - 8 * 60_000, ts - 2 * 60_000))
        sa = med(values_between(samples, "sound", ts, ts + 6 * 60_000))
        sound_drop = 0.0 if sb is None or sa is None else max(0.0, sb - sa)
        score = (after - before) / tvoc_scale + (sound_drop / sound_scale) * 0.7
        if score > best_score:
            best_ts, best_score = ts, score
    anchor = best_ts
    reference = med(values_between(samples, "tvoc", anchor - 22 * 60_000, anchor - 10 * 60_000))
    if reference is None:
        return anchor, "corroborated transition"
    onset_delta = max(10.0, tvoc_scale * 0.25)
    onset_level = reference + onset_delta
    onset_candidates = sorted([s for s in candidates if anchor - 20 * 60_000 <= int(s["timestamp"]) <= anchor + 2 * 60_000], key=lambda s: s["timestamp"])
    for s in onset_candidates:
        ts = int(s["timestamp"])
        current = s.get("tvoc")
        if not finite(current) or float(current) < onset_level:
            continue
        previous = med(values_between(samples, "tvoc", ts - 6 * 60_000, ts - 2 * 60_000))
        following = values_between(samples, "tvoc", ts, ts + 6 * 60_000)
        sustained = [v for v in following if v >= onset_level]
        if previous is not None and float(current) - previous >= onset_delta * 0.6 and len(sustained) >= 2:
            return ts, "sustained TVOC-rise onset with departure support"
    return anchor, "corroborated TVOC/departure transition"


def approximate_people(samples: list[dict[str, Any]], begin: int, centres: dict[str, float]) -> str | None:
    end = begin + 60 * 60_000
    hour = [s for s in samples if begin <= int(s["timestamp"]) <= end]
    if not hour or int(hour[-1]["timestamp"]) < begin + 50 * 60_000:
        return None
    co2_start = med(values_between(hour, "co2", begin, begin + 12 * 60_000))
    co2_end = med(values_between(hour, "co2", end - 12 * 60_000, end))
    if co2_start is None or co2_end is None:
        return None
    h_start = med(values_between(hour, "humidityAbs", begin, begin + 12 * 60_000))
    h_end = med(values_between(hour, "humidityAbs", end - 12 * 60_000, end))
    sound_hour = med(values_between(hour, "sound", begin, end))
    co2_rise = max(0.0, co2_end - co2_start)
    centre = max(0.0, (co2_rise - 10.0) / 45.0)
    if h_start is not None and h_end is not None and h_end - h_start > 0.12:
        centre += 0.55
    if sound_hour is not None and centres.get("sound") is not None and sound_hour - centres["sound"] > 2.5:
        centre += 0.75
    if centre < 0.75:
        # A published BEGIN already implies at least one person-equivalent
        # transition; keep the deliberately broad lower-confidence range.
        return "1-2"
    low = max(1, min(12, math.floor(centre * 0.65)))
    high = max(low + 1, min(12, math.ceil(centre * 1.55)))
    return f"{low}-{high}"


def detect_activity(samples: list[dict[str, Any]], room: str, day) -> dict[str, Any]:
    rows = [s for s in samples if sample_date(s) == day]
    baseline = [s for s in rows if minute_of_day(s) < 6 * 60]
    base = {
        "date": str(day), "room": room, "begin": None, "close": None, "dayEnd": None,
        "peopleRange": None, "beginMethod": "not detected", "closeMethod": "not detected",
        "controlDay": day == SATURDAY,
    }
    if len(baseline) < 10:
        base["reason"] = "insufficient night-reference records"
        return base

    centres: dict[str, float] = {}
    scales: dict[str, float] = {}
    for key, config in ACTIVITY_SIGNALS.items():
        vals = [s.get(key) for s in baseline if finite(s.get(key))]
        centre = med(vals)
        if centre is None:
            continue
        centres[key] = centre
        scales[key] = max(config["floor"], mad(vals, centre) * 5)

    transition_candidates = []
    morning_candidates = []
    for s in rows:
        ts = int(s["timestamp"])
        minute = minute_of_day(s)
        transition_candidates.append({"timestamp": ts, "minute": minute, **transition_score(rows, ts, scales)})
        morning_candidates.append({"timestamp": ts, "minute": minute, **departure_score(rows, ts, centres, scales)})

    morning_window = [c for c in morning_candidates if 6 * 60 + 45 <= c["minute"] <= 10 * 60 + 30]
    morning = [c for c in morning_window if (c["changed"] >= 3 and c["score"] >= 3.4) or (c["changed"] >= 2 and c["score"] >= 2.25)]
    begin = None
    if morning:
        first_episode = [c for c in morning if c["timestamp"] <= morning[0]["timestamp"] + 20 * 60_000]
        best = max(first_episode, key=lambda c: c["score"])
        begin = best["timestamp"]
        base["beginMethod"] = f"coordinated transition ({best['changed']} channels; score {best['score']:.2f})"

    evening_window = [c for c in transition_candidates if 15 * 60 + 30 <= c["minute"] <= 19 * 60 + 30 and (not begin or c["timestamp"] >= begin + 4 * 60 * 60_000)]
    close = None
    if room == "OFFICE":
        office_candidates = []
        for candidate in evening_window:
            sig = office_close_signature(rows, candidate["timestamp"], scales)
            if sig["matched"]:
                office_candidates.append({**candidate, "signature": sig})
        if office_candidates:
            def weight(c):
                return c["score"] + c["signature"]["score"] - abs(c["minute"] - (16 * 60 + 50)) / 300
            selected = max(office_candidates, key=weight)
            close, method = office_close_event_time(rows, selected["timestamp"], scales)
            base["closeMethod"] = method

    if close is None:
        strict = [c for c in evening_window if c["changed"] >= 3 and c["score"] >= 3.4]
        evening = strict if strict else [c for c in evening_window if c["changed"] >= 2 and c["score"] >= 2.25]
        if evening:
            target = 16 * 60 + 50 if room == "OFFICE" else 17 * 60
            close_c = max(evening, key=lambda c: c["score"] - abs(c["minute"] - target) / 360)
            close = close_c["timestamp"]
            base["closeMethod"] = f"coordinated late-day transition ({close_c['changed']} channels; score {close_c['score']:.2f})"

    # Saturday was explicitly designated as the no-activity control day. Keep
    # candidate times in the audit notes, but never publish a clock-derived
    # BEGIN/CLOSE for the control day.
    if day == SATURDAY:
        base["candidateBegin"] = begin
        base["candidateClose"] = close
        base["beginMethod"] = "control day - no activity event assigned"
        base["closeMethod"] = "control day - no activity event assigned"
        base["reason"] = "Saturday no-activity control"
        return base

    def settled(start: int, end: int) -> bool:
        checks = []
        for key in ["co2", "humidityAbs", "temperature", "sound"]:
            centre = centres.get(key)
            current = med(values_between(rows, key, start, end))
            if centre is None or current is None:
                continue
            config = ACTIVITY_SIGNALS[key]
            checks.append((key, abs(current - centre) <= max(config["settle"], scales.get(key, config["floor"]) * 1.6)))
        if len(checks) < 3:
            return False
        core = [v for k, v in checks if k in ("co2", "sound")]
        return all(core) and sum(1 for _, v in checks if v) >= 3

    day_end = None
    if close:
        for s in rows:
            ts = int(s["timestamp"])
            if ts < close + 20 * 60_000 or minute_of_day(s) > 23 * 60 + 30:
                continue
            if settled(ts, ts + 15 * 60_000) and settled(ts + 15 * 60_000, ts + 35 * 60_000):
                day_end = ts
                break

    base.update({
        "begin": begin,
        "close": close,
        "dayEnd": day_end,
        "peopleRange": approximate_people(rows, begin, centres) if begin else None,
    })
    return base


def baseline_quality(rows: list[dict[str, Any]], baseline_rows: list[dict[str, Any]]) -> tuple[str, list[str]]:
    day_rows = [s for s in rows if 6 * 60 <= minute_of_day(s) < 18 * 60]
    raised = []
    floors = {"tvoc": 25.0, "hcho": 3.0, "co": 0.03}
    labels = {"tvoc": "TVOC", "hcho": "HCHO signal", "co": "CO signal"}
    for key in ["tvoc", "hcho", "co"]:
        bvals = [s.get(key) for s in baseline_rows if finite(s.get(key))]
        dvals = [float(s[key]) for s in day_rows if finite(s.get(key))]
        centre = med(bvals)
        if centre is None or not dvals:
            continue
        low = float(np.quantile(dvals, 0.10))
        if centre > low + max(floors[key], mad(bvals, centre) * 2):
            raised.append(labels[key])
    return ("OPERATIONAL / CONDITIONAL" if raised else "OPERATIONAL", raised)


def stat_block(rows: list[dict[str, Any]], baseline: dict[str, float | None]) -> dict[str, dict[str, Any]]:
    result = {}
    for key in FIELD_META:
        valid = [(int(s["timestamp"]), float(s[key])) for s in rows if finite(s.get(key))]
        if not valid:
            result[key] = {"start": None, "end": None, "min": None, "minTime": None, "median": None, "max": None, "maxTime": None, "baseline": baseline.get(key), "endDelta": None}
            continue
        mn = min(valid, key=lambda x: x[1])
        mx = max(valid, key=lambda x: x[1])
        b = baseline.get(key)
        result[key] = {
            "start": valid[0][1], "end": valid[-1][1],
            "min": mn[1], "minTime": mn[0], "median": med(v for _, v in valid),
            "max": mx[1], "maxTime": mx[0], "baseline": b,
            "endDelta": None if b is None else valid[-1][1] - b,
        }
    return result


def sound_episodes(samples: list[dict[str, Any]], room: str) -> list[dict[str, Any]]:
    episodes = []
    i = 0
    episode_no = 0
    while i < len(samples):
        if not finite(samples[i].get("soundMax")) or float(samples[i]["soundMax"]) <= 90:
            i += 1
            continue
        start = i
        while i + 1 < len(samples) and finite(samples[i + 1].get("soundMax")) and float(samples[i + 1]["soundMax"]) > 90:
            i += 1
        end = i
        episode_no += 1
        peak_idx = max(range(start, end + 1), key=lambda j: float(samples[j]["soundMax"]))
        recovery = samples[end + 1] if end + 1 < len(samples) and finite(samples[end + 1].get("soundMax")) and float(samples[end + 1]["soundMax"]) <= 90 else None
        peak = samples[peak_idx]
        episodes.append({
            "episodeId": f"{room}-AC-{episode_no:03d}",
            "room": room,
            "date": str(sample_date(samples[start])),
            "onset": int(samples[start]["timestamp"]),
            "peakTime": int(peak["timestamp"]),
            "peak": float(peak["soundMax"]),
            "lastAbove": int(samples[end]["timestamp"]),
            "recovery": int(recovery["timestamp"]) if recovery else None,
            "soundAverage": peak.get("sound"),
            "co2": peak.get("co2"), "tvoc": peak.get("tvoc"), "hcho": peak.get("hcho"),
            "co": peak.get("co"), "pm25": peak.get("pm25"), "oxygen": peak.get("oxygen"),
            "interpretation": "Analysis retained this as a raw device-review acoustic event, not a statutory exposure conclusion.",
        })
        i += 1
    return episodes


def to_frame(samples: list[dict[str, Any]]) -> pd.DataFrame:
    frame = pd.DataFrame(samples)
    frame["dt"] = pd.to_datetime(frame["timestamp"], unit="ms", utc=True).dt.tz_convert("Europe/Berlin")
    frame = frame.set_index("dt").sort_index()
    return frame


def volatile_episodes(samples: list[dict[str, Any]], room: str, baselines: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    frame = to_frame(samples)
    events = []
    event_no = 0
    for day in DATES:
        raw = frame[frame.index.date == day]
        if raw.empty:
            continue
        five = raw.resample("5min").median(numeric_only=True).dropna(how="all")
        baseline_rows = raw[raw.index.hour < 6]
        tvoc_base = baselines[str(day)]["values"].get("tvoc")
        hcho_base = baselines[str(day)]["values"].get("hcho")
        if tvoc_base is None or hcho_base is None:
            continue
        tvoc_thr_delta = max(35.0 if room == "OFFICE" else 50.0, mad(baseline_rows.get("tvoc", []), tvoc_base) * 6)
        hcho_thr_delta = max(5.0 if room == "OFFICE" else 8.0, mad(baseline_rows.get("hcho", []), hcho_base) * 6)
        tvoc_thr = tvoc_base + tvoc_thr_delta
        hcho_thr = hcho_base + hcho_thr_delta
        active = ((five.get("tvoc") >= tvoc_thr) | (five.get("hcho") >= hcho_thr)).fillna(False)
        groups = []
        current = []
        for ts, flag in active.items():
            if bool(flag):
                current.append(ts)
            elif current:
                groups.append(current)
                current = []
        if current:
            groups.append(current)

        for group in groups:
            start_ts = group[0]
            end_ts = group[-1] + pd.Timedelta(minutes=5)
            episode = raw[(raw.index >= start_ts) & (raw.index < end_ts)]
            if episode.empty:
                continue
            tvoc_peak_delta = float(episode["tvoc"].max() - tvoc_base) if "tvoc" in episode else 0.0
            hcho_peak_delta = float(episode["hcho"].max() - hcho_base) if "hcho" in episode else 0.0
            if len(group) < 2 and tvoc_peak_delta < 2 * tvoc_thr_delta and hcho_peak_delta < 2 * hcho_thr_delta:
                continue
            event_no += 1
            tvoc_peak_idx = episode["tvoc"].idxmax() if "tvoc" in episode and episode["tvoc"].notna().any() else episode.index[0]
            hcho_peak_idx = episode["hcho"].idxmax() if "hcho" in episode and episode["hcho"].notna().any() else episode.index[0]
            peak_idx = tvoc_peak_idx if tvoc_peak_delta / tvoc_thr_delta >= hcho_peak_delta / hcho_thr_delta else hcho_peak_idx
            peak = episode.loc[peak_idx]
            recovery = raw[raw.index >= end_ts]
            recovery = recovery[(recovery["tvoc"] <= tvoc_thr) & (recovery["hcho"] <= hcho_thr)]
            recovery_ts = recovery.index[0] if not recovery.empty else None

            base_values = baselines[str(day)]["values"]
            pm_support = finite(peak.get("pm25")) and finite(base_values.get("pm25")) and float(peak["pm25"]) - float(base_values["pm25"]) > max(0.5, mad(baseline_rows.get("pm25", []), base_values["pm25"]) * 5)
            co_support = finite(peak.get("co")) and finite(base_values.get("co")) and float(peak["co"]) - float(base_values["co"]) > max(0.03, mad(baseline_rows.get("co", []), base_values["co"]) * 5)
            hcho_support = hcho_peak_delta >= hcho_thr_delta
            tvoc_support = tvoc_peak_delta >= tvoc_thr_delta
            if tvoc_support and hcho_support and co_support:
                pattern = "Broad gas-channel mixture pattern"
            elif tvoc_support and hcho_support:
                pattern = "TVOC + HCHO-channel mixture pattern"
            elif tvoc_support:
                pattern = "TVOC-dominant mixture signal"
            else:
                pattern = "HCHO-channel dominant signal"
            if pm_support:
                pattern += " with particle support"
            duration_min = ((recovery_ts or end_ts) - start_ts).total_seconds() / 60
            events.append({
                "eventId": f"{room}-VG-{event_no:03d}", "room": room, "date": str(day),
                "onset": int(start_ts.tz_convert("UTC").timestamp() * 1000),
                "peakTime": int(peak_idx.tz_convert("UTC").timestamp() * 1000),
                "recovery": int(recovery_ts.tz_convert("UTC").timestamp() * 1000) if recovery_ts is not None else None,
                "durationMinutes": round(duration_min, 1),
                "tvocPeak": float(episode["tvoc"].max()), "tvocBaseline": tvoc_base,
                "hchoPeak": float(episode["hcho"].max()), "hchoBaseline": hcho_base,
                "coAtPeak": float(peak["co"]) if finite(peak.get("co")) else None,
                "co2AtPeak": float(peak["co2"]) if finite(peak.get("co2")) else None,
                "pm25AtPeak": float(peak["pm25"]) if finite(peak.get("pm25")) else None,
                "oxygenAtPeak": float(peak["oxygen"]) if finite(peak.get("oxygen")) else None,
                "support": ", ".join([x for x, ok in [("HCHO", hcho_support), ("CO", co_support), ("PM2.5", pm_support)] if ok]) or "no independent listed channel",
                "pattern": pattern,
                "persistence": "60+ min" if duration_min >= 60 else "30+ min" if duration_min >= 30 else "<30 min",
                "interpretation": "Analysis retained this as a mixture/cross-sensitivity signal and assigned no compound identity.",
            })
    return events


def asr_humidity_limit(temp_c: float) -> float:
    points = [(20.0, 80.0), (22.0, 70.0), (24.0, 62.0), (26.0, 55.0)]
    if temp_c <= 20:
        return 80.0
    if temp_c >= 26:
        return 55.0
    for (x1, y1), (x2, y2) in zip(points, points[1:]):
        if x1 <= temp_c <= x2:
            return y1 + (temp_c - x1) * (y2 - y1) / (x2 - x1)
    return 55.0


def corr(a: pd.Series, b: pd.Series) -> float | None:
    pair = pd.concat([a, b], axis=1).dropna()
    if len(pair) < 10 or pair.iloc[:, 0].std() == 0 or pair.iloc[:, 1].std() == 0:
        return None
    return float(pair.iloc[:, 0].corr(pair.iloc[:, 1]))


def robust_positive(series: pd.Series) -> pd.Series:
    centre = series.median()
    scale = (series - centre).abs().median()
    scale = max(float(scale) if finite(scale) else 0.0, 1e-9)
    return ((series - centre) / scale).clip(lower=0, upper=10)


def index_assessment(samples: list[dict[str, Any]], room: str) -> dict[str, Any]:
    frame = to_frame(samples).resample("15min").median(numeric_only=True)
    gas_parts = [robust_positive(frame[k]) for k in ["tvoc", "hcho", "co", "pm25"] if k in frame]
    performance_parts = [robust_positive(frame[k]) for k in ["co2", "humidityAbs", "temperature"] if k in frame]
    gas_burden = pd.concat(gas_parts, axis=1).mean(axis=1) if gas_parts else pd.Series(dtype=float)
    performance_burden = pd.concat(performance_parts, axis=1).mean(axis=1) if performance_parts else pd.Series(dtype=float)
    health_corr = corr(frame["health"], -gas_burden) if "health" in frame else None
    performance_corr = corr(frame["performance"], -performance_burden) if "performance" in frame else None
    meaningful_health = health_corr is not None and health_corr >= 0.35
    meaningful_performance = performance_corr is not None and performance_corr >= 0.35
    return {
        "healthCorrelation": health_corr,
        "performanceCorrelation": performance_corr,
        "healthMeaningful": meaningful_health,
        "performanceMeaningful": meaningful_performance,
        "summary": (
            f"Evaluation shows that Health {'tracked' if meaningful_health else 'only partly tracked'} the combined gas/particle burden "
            f"(15-minute correlation {health_corr:.2f})" if health_corr is not None else "Evaluation could not robustly correlate Health"
        ) + "; " + (
            f"Evaluation shows that Performance {'tracked' if meaningful_performance else 'only partly tracked'} the combined CO₂/climate burden "
            f"(15-minute correlation {performance_corr:.2f})." if performance_corr is not None else "Evaluation could not robustly correlate Performance."
        ) + " Raw channel timing remains decisive; airQ™ indices remain secondary summaries, not source identifiers.",
    }


def build_analysis():
    rooms, outdoor, context, manifest = load_inputs()
    result: dict[str, Any] = {
        "generatedAt": datetime.now(BERLIN).isoformat(),
        "coverage": {
            "from": WINDOW_START_MS,
            "to": WINDOW_END_MS,
            "label": f"{dt_local(WINDOW_START_MS).strftime('%Y-%m-%d %H:%M')} to {dt_local(WINDOW_END_MS).strftime('%Y-%m-%d %H:%M')} Europe/Berlin",
        },
        "dates": [str(d) for d in DATES], "saturday": str(SATURDAY),
        "fieldMeta": {k: {"label": v[0], "unit": v[1], "precision": v[2]} for k, v in FIELD_META.items()},
        "sources": SOURCE_URLS, "manifest": manifest, "context": context, "outdoor": outdoor, "rooms": {},
    }

    for room, samples in rooms.items():
        daily = {}
        baselines = {}
        activities = []
        event_markers: dict[int, list[str]] = defaultdict(list)
        for day in DATES:
            rows = [s for s in samples if sample_date(s) == day]
            night = [s for s in rows if minute_of_day(s) < 6 * 60]
            baseline_values = {key: med(s.get(key) for s in night) for key in FIELD_META}
            quality, raised = baseline_quality(rows, night)
            coverage = f"{hhmm(int(night[0]['timestamp']))}-{hhmm(int(night[-1]['timestamp']))}" if night else ""
            baselines[str(day)] = {
                "recordCount": len(night), "coverage": coverage, "quality": quality,
                "conditionalChannels": raised, "values": baseline_values,
            }
            active = [s for s in rows if 6 * 60 <= minute_of_day(s) < 18 * 60]
            evening = [s for s in rows if minute_of_day(s) >= 18 * 60]
            stats = stat_block(rows, baseline_values)
            daily[str(day)] = {
                "recordCount": len(rows), "first": int(rows[0]["timestamp"]) if rows else None, "last": int(rows[-1]["timestamp"]) if rows else None,
                "stats": stats,
                "dayMedian": {key: med(s.get(key) for s in active) for key in FIELD_META},
                "eveningMedian": {key: med(s.get(key) for s in evening) for key in FIELD_META},
            }
            activity = detect_activity(samples, room, day)
            activities.append(activity)
            if activity.get("begin"):
                event_markers[int(activity["begin"])].append(f"BEGIN {hhmm(activity['begin'])}")
            if activity.get("close"):
                event_markers[int(activity["close"])].append(f"CLOSE {hhmm(activity['close'])}")

        acoustic = sound_episodes(samples, room)
        volatile = volatile_episodes(samples, room, baselines)
        weekly_baseline = {key: med(baselines[str(d)]["values"].get(key) for d in DATES) for key in FIELD_META}
        weekly_stats = stat_block(samples, weekly_baseline)
        index_eval = index_assessment(samples, room)

        gaps = []
        for a, b in zip(samples, samples[1:]):
            delta = (int(b["timestamp"]) - int(a["timestamp"])) / 60_000
            if delta > 5:
                gaps.append({"from": int(a["timestamp"]), "to": int(b["timestamp"]), "minutes": round(delta, 2)})
        cadence = [(int(b["timestamp"]) - int(a["timestamp"])) / 60_000 for a, b in zip(samples, samples[1:])]
        missing = {key: sum(1 for s in samples if not finite(s.get(key))) for key in FIELD_META}

        raw_rows = []
        first_week_ts = int(samples[0]["timestamp"])
        formal_candidates = [s for s in samples if int(s["timestamp"]) >= WINDOW_START_MS]
        first_formal_ts = int(formal_candidates[0]["timestamp"]) if formal_candidates else None
        for s in samples:
            ts = int(s["timestamp"])
            baseline_flags = []
            if ts == first_week_ts:
                baseline_flags.append("WEEKLY ORIGINAL BASELINE - first returned record")
            if first_formal_ts and ts == first_formal_ts:
                baseline_flags.append("FORMAL ORIGINAL BASELINE - first post-cutoff record")
            nearest_events = []
            for event_ts, labels in event_markers.items():
                if abs(ts - event_ts) <= 75_000:
                    nearest_events.extend(labels)
            raw_rows.append({
                "timestamp": ts, "local": iso_local(ts), "utc": iso_utc(ts), "date": str(sample_date(s)),
                "period": "NIGHT 00:00-06:00" if minute_of_day(s) < 360 else "DAY 06:00-18:00" if minute_of_day(s) < 1080 else "EVENING 18:00-24:00",
                "baselineFlag": " | ".join(baseline_flags), "eventMarker": " | ".join(sorted(set(nearest_events))),
                **{key: s.get(key) for key in FIELD_META},
                "pmBalance": med([s.get("pm1"), s.get("pm25"), s.get("pm4"), s.get("pm10")]),
            })

        # Saturday control comparison against the Monday-Friday active-window medians.
        saturday_medians = daily[str(SATURDAY)]["dayMedian"]
        weekday_dates = [d for d in DATES if d != SATURDAY]
        control = {}
        for key in ["co2", "tvoc", "hcho", "pm25", "sound", "soundMax", "temperature", "humidity"]:
            weekday_centre = med(daily[str(d)]["dayMedian"].get(key) for d in weekday_dates)
            sat = saturday_medians.get(key)
            control[key] = {
                "weekdayMedian": weekday_centre, "saturdayMedian": sat,
                "difference": None if weekday_centre is None or sat is None else sat - weekday_centre,
            }

        result["rooms"][room] = {
            "samples": samples, "rawRows": raw_rows, "daily": daily, "baselines": baselines,
            "activities": activities, "acousticEvents": acoustic, "volatileEvents": volatile,
            "weeklyStats": weekly_stats, "weeklyBaseline": weekly_baseline,
            "indexAssessment": index_eval, "controlComparison": control,
            "quality": {
                "records": len(samples), "duplicatesRemoved": manifest["duplicatesRemoved"].get(room, 0),
                "first": int(samples[0]["timestamp"]), "last": int(samples[-1]["timestamp"]),
                "medianCadenceMinutes": med(cadence), "p95CadenceMinutes": float(np.quantile(cadence, 0.95)) if cadence else None,
                "gapsOver5Minutes": gaps, "missingByField": missing,
            },
        }

    # Outdoor records are hourly and may include up to two boundary records around each request.
    result["outdoorRows"] = [
        {"timestamp": int(s["timestamp"]), "local": iso_local(int(s["timestamp"])), "utc": iso_utc(int(s["timestamp"])),
         "temperature": s.get("temperature"), "humidity": s.get("humidity"), "source": "DWD via Bright Sky"}
        for s in outdoor if WINDOW_START_MS - 2 * 60 * 60_000 <= int(s["timestamp"]) <= WINDOW_END_MS + 2 * 60 * 60_000
    ]

    (OUT / "analysis.json").write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    summary = {
        "records": {r: result["rooms"][r]["quality"]["records"] for r in ["LAB", "OFFICE"]},
        "acoustic": {r: len(result["rooms"][r]["acousticEvents"]) for r in ["LAB", "OFFICE"]},
        "volatile": {r: len(result["rooms"][r]["volatileEvents"]) for r in ["LAB", "OFFICE"]},
        "activities": {r: [{"date": a["date"], "begin": hhmm(a.get("begin")), "close": hhmm(a.get("close")), "people": a.get("peopleRange"), "control": a.get("controlDay")} for a in result["rooms"][r]["activities"]] for r in ["LAB", "OFFICE"]},
    }
    (OUT / "analysis-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    configure()
    build_analysis()

