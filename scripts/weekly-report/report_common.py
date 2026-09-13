from __future__ import annotations

import json
import math
import os
import textwrap
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import matplotlib as mpl
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.patches import Rectangle

ANALYSIS_PATH = Path(os.environ["WEEKLY_ANALYSIS_JSON"]).resolve()
DATA = json.loads(ANALYSIS_PATH.read_text())
OUTDIR = Path(os.environ["WEEKLY_OUTPUT_DIR"]).resolve()
OUTDIR.mkdir(parents=True, exist_ok=True)
REPORT_RANGE = os.environ["WEEKLY_REPORT_RANGE"]
OUT = OUTDIR / f"airq_monitoring_weekly_{REPORT_RANGE}.pdf"
TZ = ZoneInfo("Europe/Berlin")

# ISO A2 landscape: 594 x 420 mm. Matplotlib PDF output remains vector-first.
A2_LANDSCAPE = (23.3858, 16.5354)
BG = "#061719"
PANEL = "#0A292C"
PANEL2 = "#10383A"
GRID = "#2A5557"
WHITE = "#F2FAFA"
MUTED = "#9CB7B7"
CYAN = "#53E0E4"
GREEN = "#59E7A1"
AMBER = "#FFC45C"
RED = "#FF6666"
BLUE = "#80CFFF"
PURPLE = "#C7A5FF"
RAW_TRACE = "#9FD7FF"
FOOTER = "BIOENGINEERING LAB, BITZ"
LIVE_MONITOR = "LIVE monitoring system: https://spark.bioengineering.workers.dev"
MIN_TEXT = 9.5

mpl.rcParams.update({
    "font.family": "DejaVu Sans",
    "font.size": MIN_TEXT,
    "axes.facecolor": PANEL,
    "figure.facecolor": BG,
    "axes.edgecolor": GRID,
    "axes.labelcolor": WHITE,
    "xtick.color": MUTED,
    "ytick.color": MUTED,
    "text.color": WHITE,
    "grid.color": GRID,
    "grid.alpha": 0.45,
    "pdf.fonttype": 42,
    "ps.fonttype": 42,
})

FIELDS = list(DATA["fieldMeta"].keys())
TABLE_FIELDS = [
    "health", "performance", "co2", "tvoc", "hcho", "pm1", "pm25", "pm4", "pm10",
    "oxygen", "co", "sound", "soundMax", "temperature", "humidity", "humidityAbs",
    "dewpt", "pressure", "dco2dt", "dhdt",
]
TOTAL_PAGES = len(TABLE_FIELDS) * 2

# Display bands are operational chart aids, not cross-room rankings.  The
# upper/lower red zones use the established dashboard decision boundaries;
# they are drawn only where that part of the y-scale is actually visible.
VALUE_BANDS = {
    "health":      {"good": (50.0, 100.0)},
    "performance": {"good": (50.0, 100.0)},
    "co2":         {"good": (400.0, 1000.0), "upper": 2000.0},
    "tvoc":        {"good": (0.0, 1000.0), "upper": 1000.0},
    "hcho":        {"good": (0.0, 100.0), "upper": 100.0},
    "pm1":         {"good": (0.0, 10.0), "upper": 35.0},
    "pm25":        {"good": (0.0, 10.0), "upper": 35.0},
    "pm4":         {"good": (0.0, 10.0), "upper": 35.0},
    "pm10":        {"good": (0.0, 10.0), "upper": 35.0},
    "oxygen":      {"good": (20.0, 21.0), "lower": 19.5, "upper": 23.5},
    "co":          {"good": (0.0, 5.0), "upper": 23.0},
    "sound":       {"good": (0.0, 80.0), "upper": 90.0},
    "soundMax":    {"good": (0.0, 80.0), "upper": 90.0},
    "temperature": {"good": (18.0, 26.0), "upper": 30.0},
    "humidity":    {"good": (30.0, 60.0), "upper": 80.0},
    "humidityAbs": {"good": (5.0, 12.0), "upper": 15.0},
    "dewpt":       {"good": (-30.0, 15.0), "upper": 18.0},
    "pressure":    {"good": (950.0, 1050.0)},
    "dco2dt":      {"good": (-150.0, 150.0), "upper": 450.0},
    "dhdt":        {"good": (-1.5, 1.5), "upper": 3.0},
}

def local_dt(ms):
    if ms is None:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=ZoneInfo("UTC")).astimezone(TZ)

def local_s(ms, seconds=False):
    if ms is None:
        return "-"
    return local_dt(ms).strftime("%d.%m.%Y %H:%M:%S" if seconds else "%d.%m.%Y %H:%M")

def hm(ms):
    return "-" if ms is None else local_dt(ms).strftime("%H:%M")

def day_label(date_s):
    d = datetime.fromisoformat(date_s)
    return d.strftime("%a %d.%m")

def fmt(v, p=None):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "-"
    if p is None:
        av = abs(float(v))
        if av >= 100: p = 1
        elif av >= 10: p = 2
        elif av >= 1: p = 3
        else: p = 4
    return f"{v:,.{p}f}"

def wrap(s, width):
    return "\n".join(textwrap.wrap(str(s), width=width, break_long_words=False, break_on_hyphens=False))

def figure():
    fig = plt.figure(figsize=A2_LANDSCAPE)
    fig.patch.set_facecolor(BG)
    return fig

def page_header(fig, title, subtitle, page_no):
    fig.text(0.025, 0.966, title, fontsize=23, fontweight="bold", color=WHITE, va="top")
    if subtitle:
        fig.text(0.025, 0.934, subtitle, fontsize=13.0, fontweight="bold", color=MUTED, va="top")
    fig.text(0.975, 0.966, f"SPARK RICHARD BIOENGINEERING | {REPORT_RANGE}", fontsize=9.5,
             fontweight="bold", color=CYAN, ha="right", va="top")
    divider_y = 0.918 if subtitle else 0.934
    fig.add_artist(mpl.lines.Line2D([0.025, 0.975], [divider_y, divider_y], color=CYAN, linewidth=1.2, alpha=0.8))
    fig.add_artist(mpl.lines.Line2D([0.025, 0.975], [0.052, 0.052], color=GRID, linewidth=0.9))
    fig.text(0.025, 0.030, FOOTER, fontsize=MIN_TEXT, color=MUTED, va="bottom")
    fig.text(0.55, 0.030, LIVE_MONITOR, fontsize=MIN_TEXT, color=MUTED, ha="center", va="bottom")
    fig.text(0.975, 0.030, f"Slide {page_no}/{TOTAL_PAGES}", fontsize=MIN_TEXT, color=MUTED, ha="right", va="bottom")

def panel(fig, xywh, title=None, accent=CYAN, fill=PANEL):
    ax = fig.add_axes(xywh)
    ax.set_facecolor(fill)
    for sp in ax.spines.values():
        sp.set_color(GRID)
        sp.set_linewidth(0.9)
    ax.set_xticks([]); ax.set_yticks([])
    if title:
        ax.text(0.018, 0.974, title, transform=ax.transAxes, va="top", ha="left",
                fontsize=12.0, fontweight="bold", color=accent)
        ax.add_line(mpl.lines.Line2D([0.018, 0.982], [0.916, 0.916], transform=ax.transAxes,
                                    color=accent, linewidth=1.0, alpha=0.6))
    return ax

def draw_balanced_bullets(ax, items, *, wrap_width=54, fontsize=12.8):
    """Use the full card height without adding low-value filler text."""
    positions = np.linspace(0.80, 0.17, len(items))
    for yy, item in zip(positions, items):
        ax.text(
            0.055,
            yy,
            "• " + wrap(item, wrap_width),
            fontsize=fontsize,
            color=WHITE,
            va="top",
            linespacing=1.22,
        )

def draw_table(ax, data, columns, col_widths=None, bbox=(0.01,0.01,0.98,0.90), font=7.1,
               header_font=7.3, row_height_scale=1.0, align="center"):
    font = max(font, MIN_TEXT)
    header_font = max(header_font, MIN_TEXT)
    tbl = ax.table(cellText=data, colLabels=columns, cellLoc=align, colLoc="center",
                   colWidths=col_widths, bbox=bbox)
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(font)
    for (r,c), cell in tbl.get_celld().items():
        cell.set_edgecolor(GRID)
        cell.set_linewidth(0.45)
        if r == 0:
            cell.set_facecolor(PANEL2)
            cell.get_text().set_color(CYAN)
            cell.get_text().set_fontweight("bold")
            cell.get_text().set_fontsize(header_font)
        else:
            cell.set_facecolor(PANEL if r % 2 else "#0D3033")
            cell.get_text().set_color(WHITE)
        cell.get_text().set_wrap(True)
        cell.PAD = 0.015
    if row_height_scale != 1:
        tbl.scale(1, row_height_scale)
    return tbl

def stats_rows(room):
    r = DATA["rooms"][room]
    out=[]
    for f in TABLE_FIELDS:
        m=DATA["fieldMeta"][f]; s=r["weeklyStats"][f]
        original_delta = s["end"] - s["start"] if s["end"] is not None and s["start"] is not None else None
        out.append([
            m["label"], m["unit"], fmt(s["start"]), fmt(s["end"]),
            f"{fmt(s['min'])}\n{local_s(s['minTime'])}", fmt(s["median"]),
            f"{fmt(s['max'])}\n{local_s(s['maxTime'])}", fmt(s["baseline"]),
            fmt(s["endDelta"]), fmt(original_delta),
        ])
    return out

def room_df(room):
    df=pd.DataFrame(DATA["rooms"][room]["samples"])
    df["time"]=pd.to_datetime(df["timestamp"],unit="ms",utc=True).dt.tz_convert("Europe/Berlin")
    return df.set_index("time").sort_index()

def add_daily_spans(ax):
    for date in DATA["dates"]:
        day=pd.Timestamp(date,tz="Europe/Berlin")
        ax.axvspan(day,day+pd.Timedelta(hours=6),color="#142B30",alpha=0.38,zorder=0)
        if date==DATA["saturday"]:
            ax.axvspan(day,day+pd.Timedelta(days=1),color="#859595",alpha=0.08,zorder=0)

def baseline_series(room, field, index):
    vals=[]
    for t in index:
        ds=t.strftime("%Y-%m-%d")
        b=DATA["rooms"][room]["baselines"].get(ds)
        vals.append(b["values"].get(field) if b else np.nan)
    return np.array(vals,dtype=float)

def band_value(value):
    return f"{value:,.2f}".rstrip("0").rstrip(".")

def value_band_spec(field,room):
    spec=dict(VALUE_BANDS[field])
    # OFFICE uses the UBA/AIR 100 µg/m³ indoor guidance.  LAB retains the
    # separate TRGS 900 workplace reference (0.37 mg/m³ = 370 µg/m³).
    if field=="hcho" and room=="LAB":
        spec["upper"]=370.0
    return spec

def band_summary(field,room):
    spec=value_band_spec(field,room)
    unit=DATA["fieldMeta"][field]["unit"] or "index"
    low,high=spec["good"]
    parts=[f"GOOD RANGE {band_value(low)}-{band_value(high)} {unit}"]
    if "upper" in spec:
        parts.append(f"ABOVE LIMIT >{band_value(spec['upper'])} {unit}")
    if "lower" in spec:
        parts.append(f"BELOW LIMIT <{band_value(spec['lower'])} {unit}")
    return " | ".join(parts)

def add_value_bands(ax, field, room):
    """Shade only the visible part of each horizontal decision region."""
    spec=value_band_spec(field,room)
    ylo,yhi=ax.get_ylim()
    good_low,good_high=spec["good"]
    visible_low=max(ylo,good_low)
    visible_high=min(yhi,good_high)
    if visible_low < visible_high:
        ax.axhspan(visible_low,visible_high,color=GREEN,alpha=0.080,zorder=0.045)
    for boundary in (good_low,good_high):
        if ylo < boundary < yhi:
            ax.axhline(boundary,color=GREEN,lw=0.65,ls=":",alpha=0.72,zorder=0.09)

    upper=spec.get("upper")
    if upper is not None and yhi > upper:
        ax.axhspan(max(ylo,upper),yhi,color=RED,alpha=0.145,zorder=0.055)
        if ylo < upper < yhi:
            ax.axhline(upper,color=RED,lw=0.95,ls="--",alpha=0.90,zorder=0.10)

    lower=spec.get("lower")
    if lower is not None and ylo < lower:
        ax.axhspan(ylo,min(yhi,lower),color=RED,alpha=0.145,zorder=0.055)
        if ylo < lower < yhi:
            ax.axhline(lower,color=RED,lw=0.95,ls="--",alpha=0.90,zorder=0.10)
    # Prevent axhspan/axhline from changing the data-focused visible scale.
    ax.set_ylim(ylo,yhi)

def paired_chart(fig, rect, room, df5, df15, f1, f2=None, title=None, thresholds=None,
                 sound_events=False, volatile_spans=False, outdoor=False):
    ax=fig.add_axes(rect)
    ax.set_facecolor(PANEL)
    ax.grid(True,axis="both",linewidth=0.45)
    for sp in ax.spines.values(): sp.set_color(GRID)
    m1=DATA["fieldMeta"].get(f1,{"label":f1,"unit":""})
    x=df5.index
    y1=df5[f1].astype(float)
    b1=baseline_series(room,f1,x) if f1 in DATA["fieldMeta"] else np.full(len(x),np.nan)
    # Direction fill relative to that date and room's own night reference.
    if np.isfinite(b1).any():
        ax.fill_between(x,y1,b1,where=(y1>=b1),color=AMBER,alpha=0.10,interpolate=True)
        ax.fill_between(x,y1,b1,where=(y1<b1),color=CYAN,alpha=0.09,interpolate=True)
        ax.plot(x,b1,color=MUTED,lw=0.45,ls=":",alpha=0.65)
    ax.plot(x,y1,color=CYAN,lw=0.65,alpha=0.55,label=f"{m1['label']} 5-min")
    ax.plot(df15.index,df15[f1],color=CYAN,lw=1.55,alpha=0.98,label=f"{m1['label']} 15-min")
    ax.tick_params(axis="y",colors=CYAN,labelsize=MIN_TEXT)
    ax.set_ylabel(f"{m1['label']}\n{m1['unit']}",color=CYAN,fontsize=MIN_TEXT,fontweight="bold")
    ax.set_title(title or m1["label"],loc="left",fontsize=9.5,fontweight="bold",color=WHITE,pad=5)
    ax2=None
    if f2:
        ax2=ax.twinx(); m2=DATA["fieldMeta"].get(f2,{"label":f2,"unit":""})
        ax2.plot(df5.index,df5[f2],color=AMBER,lw=0.6,alpha=0.42,label=f"{m2['label']} 5-min")
        ax2.plot(df15.index,df15[f2],color=AMBER,lw=1.45,alpha=0.92,label=f"{m2['label']} 15-min")
        b2=baseline_series(room,f2,df5.index)
        if np.isfinite(b2).any(): ax2.plot(df5.index,b2,color=AMBER,lw=0.4,ls=":",alpha=0.4)
        ax2.tick_params(axis="y",colors=AMBER,labelsize=MIN_TEXT)
        ax2.set_ylabel(f"{m2['label']}\n{m2['unit']}",color=AMBER,fontsize=MIN_TEXT,fontweight="bold")
        for sp in ax2.spines.values(): sp.set_color(GRID)
        if room=="OFFICE" and f1=="tvoc" and f2=="hcho":
            ax2.axhline(100,color=AMBER,ls="--",lw=0.75,alpha=0.8)
            ax2.text(0.995,100,"UBA/AIR guidance: 100 µg/m³",transform=mpl.transforms.blended_transform_factory(ax2.transAxes,ax2.transData),ha="right",va="bottom",fontsize=MIN_TEXT,color=AMBER)
        if f1=="temperature" and f2=="humidity":
            od=pd.DataFrame(DATA["outdoorRows"])
            od["time"]=pd.to_datetime(od["timestamp"],unit="ms",utc=True).dt.tz_convert("Europe/Berlin")
            ylo,yhi=ax.get_ylim()
            ax.fill_between(od["time"],np.full(len(od),ylo),od["temperature"],color=BLUE,alpha=0.08,zorder=0.2)
            ax.set_ylim(ylo,yhi)
            ylo2,yhi2=ax2.get_ylim()
            ax2.fill_between(od["time"],np.full(len(od),ylo2),od["humidity"],color=PURPLE,alpha=0.07,zorder=0.2)
            ax2.set_ylim(ylo2,yhi2)
            ax.text(0.99,0.04,"PALE FILL = OUTDOOR",transform=ax.transAxes,ha="right",va="bottom",fontsize=MIN_TEXT,color=MUTED)
    if thresholds:
        for value,label,color in thresholds:
            ax.axhline(value,color=color,ls="--",lw=0.75,alpha=0.8)
            ax.text(0.995,value,label,transform=mpl.transforms.blended_transform_factory(ax.transAxes,ax.transData),ha="right",va="bottom",fontsize=MIN_TEXT,color=color)
    if volatile_spans:
        for ev in DATA["rooms"][room]["volatileEvents"]:
            if ev["durationMinutes"]>=30:
                t0=local_dt(ev["onset"]); t1=local_dt(ev["recovery"]) if ev["recovery"] else t0+pd.Timedelta(minutes=ev["durationMinutes"])
                ax.axvspan(t0,t1,color=AMBER,alpha=0.08 if ev["durationMinutes"]<60 else 0.13,zorder=0)
    if sound_events:
        for ev in DATA["rooms"][room]["acousticEvents"]:
            ax.axvline(local_dt(ev["peakTime"]),color=RED,lw=0.85,alpha=0.9)

    # Every panel carries an explicit trace-to-scale key. Numeric tick labels and
    # axis titles use the same colours, so the value scale remains unambiguous.
    if f2:
        left_unit = m1["unit"] or "index"
        right_unit = m2["unit"] or "index"
        handles = [
            mpl.lines.Line2D([], [], color=CYAN, lw=2.2,
                             label=f"{m1['label']} [{left_unit}] - LEFT scale"),
            mpl.lines.Line2D([], [], color=AMBER, lw=2.2,
                             label=f"{m2['label']} [{right_unit}] - RIGHT scale"),
        ]
        legend = ax.legend(
            handles=handles,
            loc="lower right",
            bbox_to_anchor=(1.0, 1.01),
            ncol=2,
            frameon=False,
            borderaxespad=0,
            handlelength=1.7,
            handletextpad=0.45,
            columnspacing=1.15,
            fontsize=MIN_TEXT,
        )
        for legend_text, colour in zip(legend.get_texts(), (CYAN, AMBER)):
            legend_text.set_color(colour)
    add_daily_spans(ax)
    ax.set_xlim(pd.Timestamp(local_dt(DATA["coverage"]["from"])),pd.Timestamp(local_dt(DATA["coverage"]["to"])))
    ax.xaxis.set_major_locator(mdates.HourLocator(byhour=[0,12],tz=TZ))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%d.%m %H:%M",tz=TZ))
    ax.tick_params(axis="x",labelsize=MIN_TEXT,pad=5)
    for label in ax.get_xticklabels():
        label.set_rotation(40)
        label.set_horizontalalignment("right")
        label.set_rotation_mode("anchor")
    return ax,ax2

def chart_page_key(fig):
    handles = [
        mpl.lines.Line2D([], [], color=RAW_TRACE, lw=0.9, label="raw cloud samples ~2 min"),
        mpl.lines.Line2D([], [], color=CYAN, lw=1.4, label="5-minute median"),
        mpl.lines.Line2D([], [], color=WHITE, lw=2.2, label="15-minute trajectory"),
        mpl.lines.Line2D([], [], color=GREEN, lw=1.1, ls="-.", label="weekly median"),
        Rectangle((0, 0), 1, 1, fc=GREEN, alpha=0.24, label="GOOD RANGE"),
        Rectangle((0, 0), 1, 1, fc=RED, alpha=0.35, label="ABOVE / BELOW LIMIT"),
        Rectangle((0, 0), 1, 1, fc=CYAN, alpha=0.18, label="below ref"),
        Rectangle((0, 0), 1, 1, fc=AMBER, alpha=0.18, label="above ref"),
        mpl.lines.Line2D([], [], color=CYAN, marker="o", markeredgecolor=WHITE, lw=0, markersize=5, label="MIN"),
        mpl.lines.Line2D([], [], color=AMBER, marker="o", markeredgecolor=WHITE, lw=0, markersize=5, label="MAX"),
        mpl.lines.Line2D([], [], color=RED, marker="o", lw=0, markersize=5, label=">90 dB raw"),
        Rectangle((0, 0), 1, 1, fc="#859595", alpha=0.18, label="Saturday"),
        Rectangle((0, 0), 1, 1, fc=AMBER, alpha=0.13, label="volatile event"),
        Rectangle((0, 0), 1, 1, fc=PURPLE, alpha=0.15, label="outdoor"),
    ]
    fig.legend(
        handles=handles,
        loc="upper left",
        bbox_to_anchor=(0.025, 0.842, 0.95, 0.057),
        mode="expand",
        ncol=9,
        frameon=False,
        fontsize=11.5,
        handlelength=1.45,
        handletextpad=0.42,
        columnspacing=0.90,
        borderaxespad=0,
    )

def single_chart(fig, rect, room, df, df5, df15, field):
    ax=fig.add_axes(rect)
    ax.set_facecolor(PANEL)
    ax.grid(True,axis="both",linewidth=0.45)
    for sp in ax.spines.values(): sp.set_color(GRID)

    meta=DATA["fieldMeta"][field]
    stats=DATA["rooms"][room]["weeklyStats"][field]
    x=df5.index
    y=df5[field].astype(float)
    baseline=baseline_series(room,field,x)

    add_daily_spans(ax)
    if np.isfinite(baseline).any():
        ax.fill_between(x,y,baseline,where=(y>=baseline),color=AMBER,alpha=0.075,interpolate=True,zorder=0.4)
        ax.fill_between(x,y,baseline,where=(y<baseline),color=CYAN,alpha=0.070,interpolate=True,zorder=0.4)

    raw=pd.to_numeric(df[field],errors="coerce")
    ax.plot(df.index,raw,color=RAW_TRACE,lw=0.42,alpha=0.36,zorder=1)
    ax.plot(x,y,color=CYAN,lw=0.95,alpha=0.66,zorder=2)
    ax.plot(df15.index,df15[field],color=WHITE,lw=2.05,alpha=0.82,zorder=3)
    if stats["median"] is not None:
        ax.axhline(stats["median"],color=GREEN,lw=1.0,ls="-.",alpha=0.72,zorder=1.5)

    if field in {"tvoc","hcho"}:
        for event in DATA["rooms"][room]["volatileEvents"]:
            if event["durationMinutes"]>=30:
                t0=local_dt(event["onset"])
                t1=local_dt(event["recovery"]) if event["recovery"] else t0+pd.Timedelta(minutes=event["durationMinutes"])
                ax.axvspan(t0,t1,color=AMBER,alpha=0.13,zorder=0.25)

    if field=="soundMax":
        peaks=[]
        for event in DATA["rooms"][room]["acousticEvents"]:
            t=local_dt(event["peakTime"])
            peaks.append((t,event["peak"]))
            ax.axvline(t,color=RED,lw=0.9,alpha=0.75,zorder=2.5)
        if peaks:
            ax.scatter([p[0] for p in peaks],[p[1] for p in peaks],s=24,color=RED,edgecolor=WHITE,linewidth=0.5,zorder=5)

    if field in {"temperature","humidity"}:
        outdoor=pd.DataFrame(DATA["outdoorRows"])
        outdoor["time"]=pd.to_datetime(outdoor["timestamp"],unit="ms",utc=True).dt.tz_convert("Europe/Berlin")
        source_field="temperature" if field=="temperature" else "humidity"
        low,high=ax.get_ylim()
        fill_colour=BLUE if field=="temperature" else PURPLE
        ax.fill_between(outdoor["time"],np.full(len(outdoor),low),outdoor[source_field],color=fill_colour,alpha=0.13,zorder=0.2)
        ax.set_ylim(low,high)
        ax.text(0.99,0.04,"PALE FILL · OUTDOOR",transform=ax.transAxes,ha="right",va="bottom",fontsize=MIN_TEXT,color=MUTED)

    add_value_bands(ax,field,room)

    # Exact extrema remain visible without a separate summary table. Mark the
    # actual points in the plot, while keeping their text below the time axis so
    # labels never cover the measured trajectory.
    for kind,value,time_value,colour,offset_y,va in [
        ("MIN",stats["min"],stats["minTime"],CYAN,7,"bottom"),
        ("MAX",stats["max"],stats["maxTime"],AMBER,-7,"top"),
    ]:
        if value is None or time_value is None:
            continue
        t=local_dt(time_value)
        ax.scatter([t],[value],s=22,color=colour,edgecolor=WHITE,linewidth=0.45,zorder=5)

    unit=meta["unit"] or "index"
    extra=""
    if field=="soundMax":
        extra=f" · >90 dB episodes {len(DATA['rooms'][room]['acousticEvents'])}"
    elif field in {"tvoc","hcho"}:
        extra=f" · volatile episodes {len(DATA['rooms'][room]['volatileEvents'])}"
    stat_label=(
        f"{meta['label']} [{unit}] · VALUE SCALE | min {fmt(stats['min'])} · "
        f"median {fmt(stats['median'])} · max {fmt(stats['max'])} · end {fmt(stats['end'])}{extra}"
    )
    ax.text(0.0,1.016,stat_label,transform=ax.transAxes,ha="left",va="bottom",
            fontsize=10.5,fontweight="bold",color=CYAN,clip_on=False)
    ax.text(1.0,1.016,band_summary(field,room),transform=ax.transAxes,ha="right",va="bottom",
            fontsize=10.5,fontweight="bold",color=GREEN,clip_on=False)

    ax.set_ylabel(f"{meta['label']}\n{unit}",color=CYAN,fontsize=MIN_TEXT,fontweight="bold")
    ax.tick_params(axis="y",colors=CYAN,labelsize=12.0)
    ax.set_xlim(pd.Timestamp(local_dt(DATA["coverage"]["from"])),pd.Timestamp(local_dt(DATA["coverage"]["to"])))
    ax.xaxis.set_major_locator(mdates.HourLocator(byhour=[0,6,12,18],tz=TZ))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%d.%m %H:%M",tz=TZ))
    ax.tick_params(axis="x",labelsize=11.5,pad=7)
    for tick in ax.get_xticklabels():
        tick.set_rotation(40)
        tick.set_horizontalalignment("right")
        tick.set_rotation_mode("anchor")

    min_time=local_dt(stats["minTime"]) if stats["minTime"] is not None else None
    max_time=local_dt(stats["maxTime"]) if stats["maxTime"] is not None else None
    extrema_parts=[]
    if min_time is not None:
        extrema_parts.append(f"MIN {fmt(stats['min'])} · {min_time.strftime('%d.%m %H:%M')}")
    if max_time is not None:
        extrema_parts.append(f"MAX {fmt(stats['max'])} · {max_time.strftime('%d.%m %H:%M')}")
    ax.text(
        0.5,-0.105,"   |   ".join(extrema_parts),transform=ax.transAxes,
        ha="center",va="top",fontsize=11.5,color=MUTED,clip_on=False,
    )
    return ax

def chart_page(pdf,room,page_no,field):
    meta=DATA["fieldMeta"][field]
    df=room_df(room)
    df5=df.resample("5min").median(numeric_only=True)
    df15=df.resample("15min").median(numeric_only=True)
    fig=figure()
    page_header(
        fig,
        f"{room} | {meta['label'].upper()} - HIGH-RESOLUTION WEEKLY TRAJECTORY",
        "",
        page_no,
    )
    chart_page_key(fig)
    single_chart(fig,[0.055,0.145,0.900,0.655],room,df,df5,df15,field)
    pdf.savefig(fig,facecolor=BG)
    plt.close(fig)

def build_weekly_pdf():
    with PdfPages(OUT, metadata={
        "Title":f"airQ Weekly Monitoring Report {REPORT_RANGE}",
        "Author":"SPARK RICHARD BIOENGINEERING",
        "Subject":"LAB and OFFICE room-specific technical review",
        "Keywords":"airQ, LAB, OFFICE, weekly monitoring, A2 landscape",
    }) as pdf:
        page_no=1
        for room in ("LAB","OFFICE"):
            for field in TABLE_FIELDS:
                chart_page(pdf,room,page_no,field)
                page_no+=1

    print(json.dumps({"output":str(OUT),"pages":TOTAL_PAGES,"size":"A2 landscape","scale":"A1/A3 without reflow"}))


if __name__ == "__main__":
    build_weekly_pdf()
