from __future__ import annotations

import json
import math
from pathlib import Path

import matplotlib as mpl
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.patches import Rectangle

import report_common as base


OUT = base.OUTDIR / f"airq_monitoring_weekly_{base.REPORT_RANGE}.pdf"

# Pair order mirrors the live monitor wherever it already combines channels.
# Temperature and absolute humidity are deliberately repeated once so that
# pressure and dew point are paired with physically meaningful context instead
# of being forced into a misleading one-to-one match.
PAIR_DEFS = [
    ("health", "performance", "airQ index trajectories"),
    ("tvoc", "hcho", "volatile-gas co-movement"),
    ("co2", "humidityAbs", "occupancy and moisture response"),
    ("temperature", "humidity", "thermal and relative-humidity response"),
    ("oxygen", "co", "gas-channel cross-check"),
    ("sound", "soundMax", "acoustic average and raw-peak response"),
    ("humidityAbs", "dewpt", "moisture state and condensation potential"),
    ("temperature", "pressure", "thermal and air-mass context"),
    ("dco2dt", "dhdt", "coincident change-rate timing"),
]

PM_FIELDS = ["pm1", "pm25", "pm4", "pm10"]
PM_COLOURS = [base.CYAN, base.GREEN, base.AMBER, base.PURPLE]
PAGES_PER_ROOM = len(PAIR_DEFS) + 1
TOTAL_PAGES = PAGES_PER_ROOM * 2
base.TOTAL_PAGES = TOTAL_PAGES


def finite_series(values):
    return pd.to_numeric(values, errors="coerce")


def weekly_rho(df15, first, second):
    values = df15[[first, second]].apply(pd.to_numeric, errors="coerce").dropna()
    if len(values) < 3:
        return float("nan"), len(values)
    return float(values[first].corr(values[second], method="spearman")), len(values)


def stat_text(room, field, side):
    meta = base.DATA["fieldMeta"][field]
    stats = base.DATA["rooms"][room]["weeklyStats"][field]
    unit = meta["unit"] or "index"
    return (
        f"{side} - {meta['label']} [{unit}] | min {base.fmt(stats['min'])} | "
        f"median {base.fmt(stats['median'])} | max {base.fmt(stats['max'])} | "
        f"end {base.fmt(stats['end'])} | {base.band_summary(field, room)}"
    )


def pair_key(fig):
    handles = [
        mpl.lines.Line2D([], [], color=base.CYAN, lw=2.3, label="LEFT scale / first channel"),
        mpl.lines.Line2D([], [], color=base.AMBER, lw=2.3, label="RIGHT scale / second channel"),
        mpl.lines.Line2D([], [], color=base.WHITE, alpha=0.35, lw=0.7, label="raw cloud samples ~2 min"),
        mpl.lines.Line2D([], [], color=base.WHITE, alpha=0.70, lw=1.1, label="5-minute median"),
        mpl.lines.Line2D([], [], color=base.WHITE, lw=2.2, label="15-minute trajectory"),
        Rectangle((0, 0), 1, 1, fc=base.GREEN, alpha=0.22, label="GOOD RANGE"),
        Rectangle((0, 0), 1, 1, fc=base.RED, alpha=0.32, label="ABOVE / BELOW LIMIT"),
        mpl.lines.Line2D([], [], color=base.CYAN, lw=1.0, ls="--", label="BEGIN"),
        mpl.lines.Line2D([], [], color=base.AMBER, lw=1.0, ls="--", label="CLOSE"),
        Rectangle((0, 0), 1, 1, fc=base.WORK_WINDOW, alpha=0.30, label="BEGIN -30 min to CLOSE +30 min"),
        Rectangle((0, 0), 1, 1, fc="#859595", alpha=0.18, label="Saturday"),
        Rectangle((0, 0), 1, 1, fc=base.AMBER, alpha=0.13, label="volatile event"),
        mpl.lines.Line2D([], [], color=base.RED, marker="o", lw=0, markersize=5, label=">90 dB raw"),
    ]
    fig.legend(
        handles=handles,
        loc="upper left",
        bbox_to_anchor=(0.025, 0.872, 0.95, 0.050),
        mode="expand",
        ncol=7,
        frameon=False,
        fontsize=10.6,
        handlelength=1.45,
        handletextpad=0.42,
        columnspacing=0.85,
        borderaxespad=0,
    )


def axis_band(ax, field, room, *, alpha_scale=1.0):
    """Shade the decision regions against this axis without changing its scale."""
    spec = base.value_band_spec(field, room)
    ylo, yhi = ax.get_ylim()
    good_low, good_high = spec["good"]
    visible_low = max(ylo, good_low)
    visible_high = min(yhi, good_high)
    if visible_low < visible_high:
        ax.axhspan(visible_low, visible_high, color=base.GREEN,
                   alpha=0.050 * alpha_scale, zorder=0.045)
    for boundary in (good_low, good_high):
        if ylo < boundary < yhi:
            ax.axhline(boundary, color=base.GREEN, lw=0.65, ls=":",
                       alpha=0.62, zorder=0.09)

    upper = spec.get("upper")
    if upper is not None and yhi > upper:
        ax.axhspan(max(ylo, upper), yhi, color=base.RED,
                   alpha=0.115 * alpha_scale, zorder=0.055)
        if ylo < upper < yhi:
            ax.axhline(upper, color=base.RED, lw=0.95, ls="--",
                       alpha=0.86, zorder=0.10)

    lower = spec.get("lower")
    if lower is not None and ylo < lower:
        ax.axhspan(ylo, min(yhi, lower), color=base.RED,
                   alpha=0.115 * alpha_scale, zorder=0.055)
        if ylo < lower < yhi:
            ax.axhline(lower, color=base.RED, lw=0.95, ls="--",
                       alpha=0.86, zorder=0.10)
    ax.set_ylim(ylo, yhi)


def style_time_axis(ax):
    ax.set_xlim(
        pd.Timestamp(base.local_dt(base.DATA["coverage"]["from"])),
        pd.Timestamp(base.local_dt(base.DATA["coverage"]["to"])),
    )
    ax.xaxis.set_major_locator(mdates.HourLocator(byhour=[0, 6, 12, 18], tz=base.TZ))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%d.%m %H:%M", tz=base.TZ))
    ax.tick_params(axis="x", labelsize=11.0, pad=7, colors=base.MUTED)
    for tick in ax.get_xticklabels():
        tick.set_rotation(40)
        tick.set_horizontalalignment("right")
        tick.set_rotation_mode("anchor")


def add_outdoor_fill(ax, field):
    if field not in {"temperature", "humidity"}:
        return
    outdoor = pd.DataFrame(base.DATA["outdoorRows"])
    outdoor["time"] = pd.to_datetime(
        outdoor["timestamp"], unit="ms", utc=True
    ).dt.tz_convert("Europe/Berlin")
    ylo, yhi = ax.get_ylim()
    colour = base.BLUE if field == "temperature" else base.PURPLE
    ax.fill_between(
        outdoor["time"],
        np.full(len(outdoor), ylo),
        outdoor[field],
        color=colour,
        alpha=0.09,
        zorder=0.08,
    )
    ax.set_ylim(ylo, yhi)


def add_extrema(ax, room, field, colour):
    stats = base.DATA["rooms"][room]["weeklyStats"][field]
    for value_key, time_key in (("min", "minTime"), ("max", "maxTime")):
        value = stats[value_key]
        time_value = stats[time_key]
        if value is None or time_value is None:
            continue
        ax.scatter(
            [base.local_dt(time_value)], [value], s=26, color=colour,
            edgecolor=base.WHITE, linewidth=0.5, zorder=7,
        )


def pair_chart_page(pdf, room, page_no, first, second, reason):
    df = base.room_df(room)
    df5 = df.resample("5min").median(numeric_only=True)
    df15 = df.resample("15min").median(numeric_only=True)
    meta1 = base.DATA["fieldMeta"][first]
    meta2 = base.DATA["fieldMeta"][second]
    stats1 = base.DATA["rooms"][room]["weeklyStats"][first]
    stats2 = base.DATA["rooms"][room]["weeklyStats"][second]

    fig = base.figure()
    base.page_header(
        fig,
        f"{room} | {meta1['label'].upper()} / {meta2['label'].upper()} - PAIRED WEEKLY TRAJECTORY",
        "",
        page_no,
    )
    pair_key(fig)
    fig.text(0.055, 0.846, stat_text(room, first, "LEFT"),
             color=base.CYAN, fontsize=9.8, fontweight="bold", ha="left", va="top")
    fig.text(0.945, 0.846, stat_text(room, second, "RIGHT"),
             color=base.AMBER, fontsize=9.8, fontweight="bold", ha="right", va="top")
    rho, n = weekly_rho(df15, first, second)
    rho_text = "n/a" if not math.isfinite(rho) else f"{rho:+.3f}"
    fig.text(
        0.5, 0.812,
        f"{reason.upper()} | 15-minute Spearman rho {rho_text} | paired bins n={n} | descriptive association, not causation",
        color=base.MUTED, fontsize=10.2, fontweight="bold", ha="center", va="top",
    )

    ax = fig.add_axes([0.064, 0.148, 0.872, 0.610])
    ax.set_facecolor(base.PANEL)
    ax.grid(True, axis="both", linewidth=0.45)
    ax2 = ax.twinx()
    ax2.patch.set_visible(False)
    ax2.tick_params(axis="x", bottom=False, top=False, labelbottom=False, labeltop=False)

    base.add_daily_spans(ax, room, label_events=True)
    for event in base.DATA["rooms"][room]["volatileEvents"]:
        if (first in {"tvoc", "hcho"} or second in {"tvoc", "hcho"}) and event["durationMinutes"] >= 30:
            t0 = base.local_dt(event["onset"])
            t1 = base.local_dt(event["recovery"]) if event["recovery"] else t0 + pd.Timedelta(minutes=event["durationMinutes"])
            ax.axvspan(t0, t1, color=base.AMBER,
                       alpha=0.08 if event["durationMinutes"] < 60 else 0.13, zorder=0.18)

    # First channel: cyan left scale. Second channel: amber right scale.
    raw1 = finite_series(df[first])
    raw2 = finite_series(df[second])
    ax.plot(df.index, raw1, color=base.CYAN, lw=0.42, alpha=0.22, zorder=1)
    ax.plot(df5.index, finite_series(df5[first]), color=base.CYAN, lw=0.95, alpha=0.58, zorder=2)
    ax.plot(df15.index, finite_series(df15[first]), color=base.CYAN, lw=2.15, alpha=0.98, zorder=4)
    ax2.plot(df.index, raw2, color=base.AMBER, lw=0.42, alpha=0.20, zorder=1)
    ax2.plot(df5.index, finite_series(df5[second]), color=base.AMBER, lw=0.95, alpha=0.55, zorder=2)
    ax2.plot(df15.index, finite_series(df15[second]), color=base.AMBER, lw=2.15, alpha=0.96, zorder=4)

    baseline1 = base.baseline_series(room, first, df5.index)
    baseline2 = base.baseline_series(room, second, df5.index)
    if np.isfinite(baseline1).any():
        ax.plot(df5.index, baseline1, color=base.CYAN, lw=0.70, ls=":", alpha=0.74, zorder=3)
    if np.isfinite(baseline2).any():
        ax2.plot(df5.index, baseline2, color=base.AMBER, lw=0.70, ls=":", alpha=0.74, zorder=3)
    if stats1["median"] is not None:
        ax.axhline(stats1["median"], color=base.CYAN, lw=0.8, ls="-.", alpha=0.56, zorder=2)
    if stats2["median"] is not None:
        ax2.axhline(stats2["median"], color=base.AMBER, lw=0.8, ls="-.", alpha=0.56, zorder=2)

    axis_band(ax, first, room, alpha_scale=1.0)
    axis_band(ax2, second, room, alpha_scale=0.78)
    add_outdoor_fill(ax, first)
    add_outdoor_fill(ax2, second)
    add_extrema(ax, room, first, base.CYAN)
    add_extrema(ax2, room, second, base.AMBER)

    if first == "soundMax" or second == "soundMax":
        event_axis = ax if first == "soundMax" else ax2
        for event in base.DATA["rooms"][room]["acousticEvents"]:
            t = base.local_dt(event["peakTime"])
            event_axis.axvline(t, color=base.RED, lw=0.9, alpha=0.76, zorder=5)
            event_axis.scatter([t], [event["peak"]], s=28, color=base.RED,
                               edgecolor=base.WHITE, linewidth=0.5, zorder=8)

    unit1 = meta1["unit"] or "index"
    unit2 = meta2["unit"] or "index"
    ax.set_ylabel(f"{meta1['label']}\n{unit1}", color=base.CYAN,
                  fontsize=11.5, fontweight="bold")
    ax2.set_ylabel(f"{meta2['label']}\n{unit2}", color=base.AMBER,
                   fontsize=11.5, fontweight="bold", rotation=270, labelpad=29)
    ax.tick_params(axis="y", colors=base.CYAN, labelsize=11.5)
    ax2.tick_params(axis="y", colors=base.AMBER, labelsize=11.5)
    ax.spines["left"].set_color(base.CYAN)
    ax.spines["bottom"].set_color(base.GRID)
    ax.spines["right"].set_visible(False)
    ax.spines["top"].set_visible(False)
    ax2.spines["right"].set_color(base.AMBER)
    ax2.spines["left"].set_visible(False)
    ax2.spines["top"].set_visible(False)
    ax2.spines["bottom"].set_visible(False)
    style_time_axis(ax)

    min1 = base.local_s(stats1["minTime"])
    max1 = base.local_s(stats1["maxTime"])
    min2 = base.local_s(stats2["minTime"])
    max2 = base.local_s(stats2["maxTime"])
    fig.text(
        0.5, 0.066,
        f"LEFT min {base.fmt(stats1['min'])} at {min1} / max {base.fmt(stats1['max'])} at {max1}"
        f"   |   RIGHT min {base.fmt(stats2['min'])} at {min2} / max {base.fmt(stats2['max'])} at {max2}",
        color=base.MUTED, fontsize=10.0, ha="center", va="bottom",
    )
    pdf.savefig(fig, facecolor=base.BG)
    plt.close(fig)


def pm_key(fig):
    handles = [
        *[
            mpl.lines.Line2D([], [], color=colour, lw=2.3,
                             label=f"{base.DATA['fieldMeta'][field]['label']} [{base.DATA['fieldMeta'][field]['unit']}]")
            for field, colour in zip(PM_FIELDS, PM_COLOURS)
        ],
        mpl.lines.Line2D([], [], color=base.WHITE, alpha=0.35, lw=0.7, label="raw cloud samples ~2 min"),
        mpl.lines.Line2D([], [], color=base.WHITE, alpha=0.70, lw=1.1, label="5-minute median"),
        mpl.lines.Line2D([], [], color=base.WHITE, lw=2.2, label="15-minute trajectory"),
        Rectangle((0, 0), 1, 1, fc=base.GREEN, alpha=0.22, label="GOOD RANGE"),
        Rectangle((0, 0), 1, 1, fc=base.RED, alpha=0.32, label="ABOVE LIMIT"),
        mpl.lines.Line2D([], [], color=base.CYAN, lw=1.0, ls="--", label="BEGIN"),
        mpl.lines.Line2D([], [], color=base.AMBER, lw=1.0, ls="--", label="CLOSE"),
        Rectangle((0, 0), 1, 1, fc=base.WORK_WINDOW, alpha=0.30, label="BEGIN -30 min to CLOSE +30 min"),
        Rectangle((0, 0), 1, 1, fc="#859595", alpha=0.18, label="Saturday"),
    ]
    fig.legend(
        handles=handles, loc="upper left",
        bbox_to_anchor=(0.025, 0.872, 0.95, 0.050), mode="expand",
        ncol=7, frameon=False, fontsize=10.6,
        handlelength=1.45, handletextpad=0.42, columnspacing=0.85,
        borderaxespad=0,
    )


def pm_chart_page(pdf, room, page_no):
    df = base.room_df(room)
    df5 = df.resample("5min").median(numeric_only=True)
    df15 = df.resample("15min").median(numeric_only=True)
    fig = base.figure()
    base.page_header(
        fig,
        f"{room} | PM1 / PM2.5 / PM4 / PM10 - COMBINED PARTICLE TRAJECTORY",
        "",
        page_no,
    )
    pm_key(fig)

    summaries = []
    for field in PM_FIELDS:
        meta = base.DATA["fieldMeta"][field]
        stats = base.DATA["rooms"][room]["weeklyStats"][field]
        summaries.append(
            f"{meta['label']} min {base.fmt(stats['min'])} / median {base.fmt(stats['median'])} / max {base.fmt(stats['max'])} / end {base.fmt(stats['end'])}"
        )
    fig.text(0.5, 0.843, "   |   ".join(summaries[:2]), color=base.CYAN,
             fontsize=10.0, fontweight="bold", ha="center", va="top")
    fig.text(0.5, 0.817, "   |   ".join(summaries[2:]), color=base.AMBER,
             fontsize=10.0, fontweight="bold", ha="center", va="top")

    ax = fig.add_axes([0.064, 0.148, 0.872, 0.610])
    ax.set_facecolor(base.PANEL)
    ax.grid(True, axis="both", linewidth=0.45)
    base.add_daily_spans(ax, room, label_events=True)
    for field, colour in zip(PM_FIELDS, PM_COLOURS):
        ax.plot(df.index, finite_series(df[field]), color=colour, lw=0.38, alpha=0.18, zorder=1)
        ax.plot(df5.index, finite_series(df5[field]), color=colour, lw=0.90, alpha=0.55, zorder=2)
        ax.plot(df15.index, finite_series(df15[field]), color=colour, lw=2.05, alpha=0.96, zorder=4)
        baseline = base.baseline_series(room, field, df5.index)
        if np.isfinite(baseline).any():
            ax.plot(df5.index, baseline, color=colour, lw=0.62, ls=":", alpha=0.56, zorder=3)
        add_extrema(ax, room, field, colour)

    # All four fractions have the same unit, so one shared scale is the only
    # non-misleading comparison. The right scale mirrors the left exactly.
    axis_band(ax, "pm25", room, alpha_scale=1.0)
    ax_right = ax.secondary_yaxis("right", functions=(lambda y: y, lambda y: y))
    ax.set_ylabel("Particle concentration\nµg/m³", color=base.CYAN,
                  fontsize=11.5, fontweight="bold")
    ax_right.set_ylabel("Shared PM scale\nµg/m³", color=base.GREEN,
                        fontsize=11.5, fontweight="bold", rotation=270, labelpad=29)
    ax.tick_params(axis="y", colors=base.CYAN, labelsize=11.5)
    ax_right.tick_params(axis="y", colors=base.GREEN, labelsize=11.5)
    ax.spines["left"].set_color(base.CYAN)
    ax.spines["right"].set_visible(False)
    ax.spines["top"].set_visible(False)
    ax_right.spines["right"].set_color(base.GREEN)
    style_time_axis(ax)

    extrema = []
    for field in PM_FIELDS:
        meta = base.DATA["fieldMeta"][field]
        stats = base.DATA["rooms"][room]["weeklyStats"][field]
        extrema.append(
            f"{meta['label']} max {base.fmt(stats['max'])} at {base.local_s(stats['maxTime'])}"
        )
    fig.text(0.5, 0.066, "   |   ".join(extrema), color=base.MUTED,
             fontsize=9.8, ha="center", va="bottom")
    pdf.savefig(fig, facecolor=base.BG)
    plt.close(fig)


def build():
    with PdfPages(OUT, metadata={
        "Title": f"airQ Weekly Paired Monitoring Charts {base.REPORT_RANGE}",
        "Author": "SPARK RICHARD BIOENGINEERING",
        "Subject": "Room-specific paired trajectories and combined particle fractions",
        "Keywords": "airQ, LAB, OFFICE, paired charts, PM, A2 landscape",
    }) as pdf:
        page_no = 1
        for room in ("LAB", "OFFICE"):
            for first, second, reason in PAIR_DEFS:
                pair_chart_page(pdf, room, page_no, first, second, reason)
                page_no += 1
            pm_chart_page(pdf, room, page_no)
            page_no += 1

    print(json.dumps({
        "output": str(OUT),
        "pages": TOTAL_PAGES,
        "size": "A2 landscape",
        "layout": "paired dual-y charts; one shared bottom time axis",
    }))


if __name__ == "__main__":
    build()
