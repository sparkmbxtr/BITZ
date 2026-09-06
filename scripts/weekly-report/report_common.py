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
WORK_WINDOW = "#B9A7FF"
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

def activity_rows(room):
    r=DATA["rooms"][room]
    rows=[]
    for a in r["activities"]:
        rows.append([
            day_label(a["date"]),
            "CONTROL" if a["controlDay"] else "OPERATING",
            f"BEGIN {hm(a['begin'])}" if a["begin"] else "NOT DETECTED",
            a["peopleRange"] or "-",
            f"CLOSE {hm(a['close'])}" if a["close"] else "NOT DETECTED",
        ])
    return rows

def room_summary_page(pdf, room, page_no):
    r=DATA["rooms"][room]
    fig=figure()
    page_header(fig, f"{room} - WEEKLY SUMMARY",
                f"Coverage: {DATA['coverage']['label']} | Location: near Oberschneiding-Schierlhof, Straubing-Bogen | Rooms evaluated independently",
                page_no)
    ax=panel(fig,[0.025,0.075,0.68,0.825],"EXACT ANALYTICAL TABLE | COMPLETE WEEK")
    columns=["Parameter","Unit","Start","End","Minimum / time","Median","Maximum / time","Weekly night ref","End delta vs ref","End delta vs original"]
    widths=[0.145,0.06,0.065,0.065,0.135,0.065,0.135,0.085,0.095,0.095]
    draw_table(ax,stats_rows(room),columns,widths,bbox=(0.01,0.015,0.98,0.885),font=6.7,header_font=6.7,row_height_scale=1.05)

    axa=panel(fig,[0.72,0.635,0.255,0.265],"BEGIN / CLOSE | EUROPE/BERLIN",GREEN)
    draw_table(axa,activity_rows(room),["Date","Role","BEGIN","People","CLOSE"],[0.18,0.16,0.23,0.15,0.23],bbox=(0.02,0.04,0.96,0.82),font=7.0,header_font=7.0)

    axi=panel(fig,[0.72,0.435,0.255,0.185],"INDEX-VALUE DECISION",CYAN)
    ia=r["indexAssessment"]
    axi.text(0.04,0.74,f"Health airQ(TM): r = {ia['healthCorrelation']:.2f} | " + ("meaningful secondary trajectory" if ia["healthMeaningful"] else "limited additional information"),fontsize=10.4,fontweight="bold",color=GREEN)
    axi.text(0.04,0.52,f"Performance airQ(TM): r = {ia['performanceCorrelation']:.2f} | " + ("meaningful secondary trajectory" if ia["performanceMeaningful"] else "limited additional information"),fontsize=10.4,fontweight="bold",color=GREEN if ia["performanceMeaningful"] else MUTED)
    axi.text(0.04,0.29,wrap(ia["summary"],59),fontsize=MIN_TEXT,color=WHITE,va="top",linespacing=1.28)

    axe=panel(fig,[0.72,0.265,0.255,0.155],"MAJOR EVENT EXTREMA",AMBER)
    max_sound=max(r["acousticEvents"],key=lambda x:x["peak"]) if r["acousticEvents"] else None
    tv=r["weeklyStats"]["tvoc"]
    hcho=r["weeklyStats"]["hcho"]
    lines=[
        f"Raw sound_max >90 dB episodes: {len(r['acousticEvents'])}" + (f" | highest {max_sound['peak']:.1f} dB at {local_s(max_sound['peakTime'])}" if max_sound else ""),
        f"Volatile-gas episodes: {len(r['volatileEvents'])} | TVOC maximum {tv['max']:.1f} ppb at {local_s(tv['maxTime'])}",
        f"Formaldehyde-signal maximum {hcho['max']:.2f} µg/m³ at {local_s(hcho['maxTime'])}",
    ]
    for i,t in enumerate(lines): axe.text(0.04,0.75-i*0.25,wrap(t,59),fontsize=9.8,color=WHITE,va="top",linespacing=1.22)

    axc=panel(fig,[0.72,0.075,0.255,0.175],"ROOM-SPECIFIC CONCLUSION",GREEN)
    if room=="LAB":
        txt=(f"Five operating days produced five BEGIN and five CLOSE events. Saturday CO2 was {abs(r['controlComparison']['co2']['difference']):.1f} ppm lower and TVOC {abs(r['controlComparison']['tvoc']['difference']):.1f} ppb lower than weekday medians, while PM2.5 was unchanged. "
             "The PM1/PM2.5/PM4/PM10 balance remained within the LAB's own low particle history, supporting effective HEPA particle control for this week. Propane and nitrogen remain NOT INFERRED until dedicated sensors are installed.")
    else:
        txt=("Five operating-day BEGIN events were detected. CLOSE was corroborated on four days and deliberately left not detected on 1 September. Saturday CO2 and sound were lower, but TVOC and the formaldehyde signal were higher than weekday medians; occupancy and volatile-source or air-exchange behaviour therefore remain separate analytical dimensions.")
    axc.text(0.04,0.79,wrap(txt,61),fontsize=9.7,color=WHITE,va="top",linespacing=1.27)
    axc.text(0.04,0.10,"People ranges are exploratory sensor inferences, not attendance records.",fontsize=MIN_TEXT,color=MUTED)
    pdf.savefig(fig,facecolor=BG); plt.close(fig)

def baseline_event_page(pdf, room, page_no):
    r=DATA["rooms"][room]
    fig=figure()
    page_header(fig,f"{room} - DAILY REFERENCES AND EVENT REGISTER",
                "Same-date 00:00-06:00 operational night medians | Raw acoustic peaks retained before aggregation | Saturday control separated",
                page_no)

    ax1=panel(fig,[0.025,0.665,0.95,0.235],"DAILY NIGHT REFERENCE AND ACTIVITY MAP",CYAN)
    cols=["Date","Role","Night records","Coverage","Quality","Conditional channels","BEGIN evidence","People","CLOSE evidence","Day records"]
    rows=[]
    for a in r["activities"]:
        b=r["baselines"][a["date"]]; d=r["daily"][a["date"]]
        rows.append([day_label(a["date"]),"CONTROL" if a["controlDay"] else "OPERATING",b["recordCount"],b["coverage"],b["quality"],", ".join(b["conditionalChannels"]),"DETECTED" if a["begin"] else "-",a["peopleRange"] or "-","DETECTED" if a["close"] else "-",d["recordCount"]])
    draw_table(ax1,rows,cols,[0.085,0.085,0.08,0.095,0.14,0.19,0.09,0.065,0.09,0.075],bbox=(0.01,0.04,0.98,0.82),font=7.3,header_font=7.1)

    ax2=panel(fig,[0.025,0.435,0.95,0.215],"SELECTED NIGHT-REFERENCE VALUES | ALL OTHER PARAMETERS REMAIN IN THE WORKBOOK",GREEN)
    bf=["co2","tvoc","hcho","pm1","pm25","pm4","pm10","oxygen","co","sound","soundMax","temperature","humidity","humidityAbs"]
    compact_headers={
        "co2":"CO2", "tvoc":"TVOC", "hcho":"HCHO", "oxygen":"O2", "co":"CO",
        "sound":"Sound avg", "soundMax":"Sound max", "temperature":"Temp.",
        "humidity":"Rel. humidity", "humidityAbs":"Abs. humidity",
    }
    cols=["Date",*[(compact_headers.get(f,DATA["fieldMeta"][f]["label"])+"\n"+DATA["fieldMeta"][f]["unit"]) for f in bf]]
    rows=[]
    for date in DATA["dates"]:
        b=r["baselines"][date]["values"]
        rows.append([day_label(date),*[fmt(b[f],3 if abs(b[f])<100 else 1) for f in bf]])
    draw_table(ax2,rows,cols,[0.08,*([0.064]*len(bf))],bbox=(0.01,0.05,0.98,0.79),font=6.8,header_font=6.6)

    ax3=panel(fig,[0.025,0.075,0.47,0.345],f"ALL RAW SOUND_MAX >90 dB EPISODES | n={len(r['acousticEvents'])}",RED)
    ac_cols=["ID","Date/onset","Peak","Last >90","Recovery","Sound avg","CO2","TVOC","HCHO","PM2.5","O2"]
    ac_rows=[]
    for x in r["acousticEvents"]:
        ac_rows.append([x["episodeId"].split("-")[-1],f"{x['date']}\n{hm(x['onset'])}",f"{x['peak']:.1f} dB\n{hm(x['peakTime'])}",hm(x["lastAbove"]),hm(x["recovery"]),fmt(x["soundAverage"],1),fmt(x["co2"],0),fmt(x["tvoc"],1),fmt(x["hcho"],2),fmt(x["pm25"],1),fmt(x["oxygen"],3)])
    draw_table(ax3,ac_rows or [["-","No episodes","-","-","-","-","-","-","-","-","-"]],ac_cols,[0.06,0.12,0.10,0.08,0.08,0.09,0.07,0.08,0.09,0.08,0.08],bbox=(0.01,0.04,0.98,0.82),font=6.4,header_font=6.3)
    ax3.text(0.015,0.012,"Raw device-review events only; not statutory exposure conclusions.",fontsize=MIN_TEXT,color=MUTED)

    ax4=panel(fig,[0.505,0.075,0.47,0.345],f"ALL VOLATILE-GAS / MIXTURE-SIGNAL EPISODES | n={len(r['volatileEvents'])}",AMBER)
    vg_cols=["ID","Date/onset","Peak","Recovery","Duration","TVOC peak/ref","HCHO peak/ref","Support","Persistence"]
    vg_rows=[]
    for x in r["volatileEvents"]:
        vg_rows.append([x["eventId"].split("-")[-1],f"{x['date']}\n{hm(x['onset'])}",hm(x["peakTime"]),hm(x["recovery"]),f"{x['durationMinutes']:.0f} min",f"{x['tvocPeak']:.1f}/{x['tvocBaseline']:.1f}",f"{x['hchoPeak']:.1f}/{x['hchoBaseline']:.1f}",wrap(x["support"],20),x["persistence"]])
    draw_table(ax4,vg_rows or [["-","No episodes","-","-","-","-","-","-","-"]],vg_cols,[0.055,0.12,0.07,0.07,0.085,0.11,0.11,0.22,0.10],bbox=(0.01,0.04,0.98,0.82),font=6.3,header_font=6.2)
    ax4.text(0.015,0.012,"Mixture or cross-sensitivity signal; no compound identity assigned.",fontsize=MIN_TEXT,color=MUTED)

    pdf.savefig(fig,facecolor=BG); plt.close(fig)

def room_df(room):
    df=pd.DataFrame(DATA["rooms"][room]["samples"])
    df["time"]=pd.to_datetime(df["timestamp"],unit="ms",utc=True).dt.tz_convert("Europe/Berlin")
    return df.set_index("time").sort_index()

def activity_windows(room):
    activities=DATA["rooms"][room]["activities"]
    operating=[a for a in activities if not a["controlDay"]]

    def average_clock_minutes(key):
        values=[]
        for activity in operating:
            if activity[key] is not None:
                event_time=local_dt(activity[key])
                values.append(event_time.hour*60+event_time.minute+event_time.second/60)
        return int(round(float(np.mean(values)))) if values else None

    averages={key:average_clock_minutes(key) for key in ("begin","close")}
    windows=[]
    for activity in operating:
        day=pd.Timestamp(activity["date"],tz="Europe/Berlin")
        item={"date":activity["date"]}
        for key in ("begin","close"):
            if activity[key] is not None:
                item[key]=pd.Timestamp(local_dt(activity[key]))
                item[f"{key}Average"]=False
            elif averages[key] is not None:
                item[key]=day+pd.Timedelta(minutes=averages[key])
                item[f"{key}Average"]=True
            else:
                item[key]=None
                item[f"{key}Average"]=False
        windows.append(item)
    return windows

def add_daily_spans(ax, room, label_events=False):
    r=DATA["rooms"][room]
    for date in DATA["dates"]:
        d=pd.Timestamp(date,tz="Europe/Berlin")
        ax.axvspan(d,d+pd.Timedelta(hours=6),color="#142B30",alpha=0.38,zorder=0)
        if date==DATA["saturday"]:
            ax.axvspan(d,d+pd.Timedelta(days=1),color="#859595",alpha=0.08,zorder=0)
    for window in activity_windows(room):
        if window["begin"] is not None and window["close"] is not None:
            band_start=window["begin"]-pd.Timedelta(minutes=30)
            band_end=window["close"]+pd.Timedelta(minutes=30)
            event_day=window["begin"].normalize()
            if not (
                window["begin"].normalize()==window["close"].normalize()==event_day
                and band_start.normalize()==band_end.normalize()==event_day
            ):
                raise ValueError(
                    f"Unsafe activity band for {room} {window['date']}: "
                    f"{band_start.isoformat()} to {band_end.isoformat()}"
                )
            ax.axvspan(
                band_start,
                band_end,
                color=WORK_WINDOW,alpha=0.105,zorder=0.12,
            )
            ax.axvline(band_start,color=WORK_WINDOW,ls=":",lw=0.7,alpha=0.80,zorder=0.2)
            ax.axvline(band_end,color=WORK_WINDOW,ls=":",lw=0.7,alpha=0.80,zorder=0.2)
        if window["begin"] is not None:
            ax.axvline(window["begin"],color=CYAN,ls=":" if window["beginAverage"] else "--",lw=1.0,alpha=0.88,zorder=4)
        if window["close"] is not None:
            ax.axvline(window["close"],color=AMBER,ls=":" if window["closeAverage"] else "--",lw=1.0,alpha=0.88,zorder=4)
        if label_events:
            blend=mpl.transforms.blended_transform_factory(ax.transData,ax.transAxes)
            if window["begin"] is not None:
                suffix=" (avg)" if window["beginAverage"] else ""
                ax.text(
                    window["begin"],0.985,
                    f"BEGIN {window['begin'].strftime('%H:%M')}{suffix}",
                    transform=blend,ha="center",va="top",fontsize=10.5,
                    fontweight="bold",color=CYAN,clip_on=True,zorder=6,
                    bbox=dict(boxstyle="round,pad=0.16",fc=BG,ec=CYAN,lw=0.65,alpha=0.92),
                )
            if window["close"] is not None:
                suffix=" (avg)" if window["closeAverage"] else ""
                ax.text(
                    window["close"],0.900,
                    f"CLOSE {window['close'].strftime('%H:%M')}{suffix}",
                    transform=blend,ha="center",va="top",fontsize=10.5,
                    fontweight="bold",color=AMBER,clip_on=True,zorder=6,
                    bbox=dict(boxstyle="round,pad=0.16",fc=BG,ec=AMBER,lw=0.65,alpha=0.92),
                )

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
                 label_events=False, sound_events=False, volatile_spans=False, outdoor=False):
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
    add_daily_spans(ax,room,label_events=label_events)
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
        mpl.lines.Line2D([], [], color=CYAN, lw=1.0, ls="--", label="BEGIN"),
        mpl.lines.Line2D([], [], color=AMBER, lw=1.0, ls="--", label="CLOSE"),
        Rectangle((0, 0), 1, 1, fc=WORK_WINDOW, alpha=0.30, label="BEGIN -30 min to CLOSE +30 min"),
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

def single_chart(fig, rect, room, df, df5, df15, field, *, label_events=False):
    ax=fig.add_axes(rect)
    ax.set_facecolor(PANEL)
    ax.grid(True,axis="both",linewidth=0.45)
    for sp in ax.spines.values(): sp.set_color(GRID)

    meta=DATA["fieldMeta"][field]
    stats=DATA["rooms"][room]["weeklyStats"][field]
    x=df5.index
    y=df5[field].astype(float)
    baseline=baseline_series(room,field,x)

    add_daily_spans(ax,room,label_events=label_events)
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
    single_chart(fig,[0.055,0.145,0.900,0.655],room,df,df5,df15,field,label_events=True)
    pdf.savefig(fig,facecolor=BG)
    plt.close(fig)

def methods_page(pdf,page_no):
    fig=figure()
    page_header(fig,"METHODS, ACTIVE RULES AND REVIEW BOUNDARIES",
                "Rules are reproduced in full in the accompanying workbook | Official references are linked below",
                page_no)
    boxes=[
        (0.025,0.66,0.305,0.24,"REFERENCE MODEL",CYAN,[
            "Each room/date uses its own 00:00-06:00 Europe/Berlin median.",
            "Night count and actual coverage are reported; conditional gas baselines remain labelled.",
            "First post-cutoff sample is provenance, not delta zero.",
            "LAB and OFFICE are never subtracted, ranked or assigned common tolerances.",
        ]),
        (0.347,0.66,0.305,0.24,"EVENT MODEL",GREEN,[
            "Five-minute medians retain onset; 15-minute trajectories corroborate direction.",
            "Cross-channel timing is tested within +/-5 minutes; persistence at 30/60 minutes is retained.",
            "BEGIN/CLOSE require sensor evidence. Saturday is a no-activity control.",
            "People range is exploratory and never an attendance record.",
        ]),
        (0.67,0.66,0.305,0.24,"RAW ACOUSTIC HANDLING",RED,[
            "Raw sound_max is scanned before aggregation.",
            "A consecutive >90 dB run is one episode; a new episode follows any <=90 dB record.",
            "Onset, peak, final-above and recovery are retained with nearby channels.",
            "Events are device-review markers, not statutory exposure conclusions.",
        ]),
        (0.025,0.38,0.305,0.24,"ROOM-SPECIFIC INFERENCE",AMBER,[
            "OFFICE CLOSE may use sustained TVOC-rise onset only with falling sound or halted/reversed CO2 and absolute-humidity accumulation.",
            "LAB CLOSE is independent and does not inherit the OFFICE window rule.",
            "Single TVOC/HCHO/CO channels remain mixture or cross-sensitivity signals.",
            "Competing explanations are retained when timing support is insufficient.",
        ]),
        (0.347,0.38,0.305,0.24,"LAB TECHNICAL BOUNDARY",GREEN,[
            "HEPA status uses the combined balance of PM1, PM2.5, PM4 and PM10 plus clearance duration.",
            "Gas channels are evaluated separately from particle filtration.",
            "Propane and nitrogen remain NOT INFERRED until dedicated sensors are installed.",
            "Dedicated operational safety systems remain authoritative; this report is not an alarm system.",
        ]),
        (0.67,0.38,0.305,0.24,"CONTEXT AND LEARNING",PURPLE,[
            "Manual context entries are timestamped observations, never ground truth.",
            "Raw notes remain in the workbook and are excluded from this shareable PDF.",
            "Fewer than three dates or less than two weeks of evidence remains OBSERVATION ONLY.",
            "No first-week context correlation was activated in operational logic.",
        ]),
    ]
    for x,y,w,h,title,accent,items in boxes:
        ax=panel(fig,[x,y,w,h],title,accent)
        draw_balanced_bullets(ax, items)

    ax=panel(fig,[0.025,0.075,0.95,0.265],"OFFICIAL REFERENCE MAP | APPLIED ONLY WHEN METRIC, UNIT, AVERAGING TIME AND ROOM CONTEXT MATCH",CYAN)
    refs=[
        ["ASR A3.6","CO2 and temperature-linked humidity decisions","CO2 orientation bands: <1000, 1000-2000, >2000 ppm","https://www.baua.de/DE/Angebote/Regelwerk/ASR/ASR-A3-6"],
        ["ASR A3.5","Use-period room temperature","Work/posture conditional; no invented universal chart threshold","https://www.baua.de/DE/Angebote/Regelwerk/ASR/ASR-A3-5"],
        ["TRGS 900","Applicable LAB formaldehyde and CO workplace references","Formal comparison requires compatible sampling and metric","https://www.baua.de/DE/Angebote/Regelwerk/TRGS/TRGS-900"],
        ["UBA/AIR","OFFICE indoor formaldehyde guidance only","100 µg/m³ indoor guidance; also not to be exceeded for 30 minutes","https://www.umweltbundesamt.de/themen/gesundheit/umwelteinfluesse-auf-den-menschen/chemische-stoffe/formaldehyd"],
        ["Noise boundary","airQ sound and sound_max","No direct workplace limit applied because LEX,8h and dB(C) peak equivalence are unavailable","Raw >90 dB events remain non-regulatory device-review markers"],
    ]
    draw_table(ax,refs,["Authority","Report application","Decision boundary","Official source"],[0.12,0.25,0.30,0.33],bbox=(0.01,0.04,0.98,0.80),font=7.3,header_font=7.3)
    pdf.savefig(fig,facecolor=BG); plt.close(fig)

def overview_page(pdf,page_no):
    fig=figure()
    page_header(fig,"LAB and OFFICE - Overview",
                f"First-week executive map | {DATA['coverage']['label']} | near Oberschneiding-Schierlhof, Straubing-Bogen",
                page_no)
    # Scope and integrity banner.
    axi=panel(fig,[0.025,0.79,0.95,0.11],"SCOPE, DATA INTEGRITY AND INTERPRETIVE BOUNDARY",CYAN)
    total=DATA["rooms"]["LAB"]["quality"]["records"]+DATA["rooms"]["OFFICE"]["quality"]["records"]
    axi.text(0.025,0.62,f"{total:,} exact room records | LAB {DATA['rooms']['LAB']['quality']['records']:,} | OFFICE {DATA['rooms']['OFFICE']['quality']['records']:,} | median cadence 2.02 min | 6 complete local dates | 3 timestamped context observations",fontsize=10.8,fontweight="bold",color=GREEN)
    axi.text(0.025,0.27,"LAB and OFFICE are separate environments. Every delta uses the same-date, same-room 00:00-06:00 operational night median. Saturday is a no-activity control. No cross-room subtraction, ranking, merged tolerance or causal claim from a single gas channel.",fontsize=MIN_TEXT,color=WHITE)

    for idx,room in enumerate(["LAB","OFFICE"]):
        x=0.025+idx*0.485; r=DATA["rooms"][room]
        operating=[a for a in r["activities"] if not a["controlDay"]]
        begins=[hm(a["begin"]) for a in operating if a["begin"]]
        closes=[hm(a["close"]) for a in operating if a["close"]]
        people=[]
        for a in operating:
            if a["peopleRange"]:
                people.extend(int(v) for v in a["peopleRange"].split("-") if v.isdigit())
        ax=panel(fig,[x,0.555,0.465,0.215],f"{room} | WEEKLY OPERATING SUMMARY",GREEN if room=="LAB" else CYAN)
        summary_rows=[
            ["BEGIN","5/5 operating days",f"range {min(begins)}-{max(begins)}"],
            ["CLOSE",f"{len(closes)}/5 operating days",f"range {min(closes)}-{max(closes)}" if closes else "not resolved"],
            ["People range","Exploratory",f"~{min(people)}-{max(people)} across first-hour estimates" if people else "insufficient evidence"],
            ["Acoustic",f"{len(r['acousticEvents'])} raw >90 dB episodes",f"peak {max([e['peak'] for e in r['acousticEvents']],default=float('nan')):.1f} dB" if r['acousticEvents'] else "none"],
            ["Volatile gas",f"{len(r['volatileEvents'])} mixture-signal episodes",f"TVOC max {r['weeklyStats']['tvoc']['max']:.1f} ppb"],
            ["Night references","6/6 dates",f"~{r['baselines'][DATA['dates'][0]]['recordCount']} records per 00:00-06:00 window"],
        ]
        draw_table(ax,summary_rows,["Element","Finding","Range / detail"],[0.22,0.37,0.37],bbox=(0.02,0.05,0.96,0.78),font=7.7,header_font=7.5)

        ax2=panel(fig,[x,0.31,0.465,0.225],f"{room} | SATURDAY CONTROL VS WEEKDAY MEDIAN",AMBER)
        cr=r["controlComparison"]
        rows=[]
        for f in ["co2","tvoc","hcho","pm25","sound","soundMax","temperature","humidity"]:
            meta=DATA["fieldMeta"][f]; q=cr[f]
            rows.append([meta["label"],meta["unit"],fmt(q["weekdayMedian"]),fmt(q["saturdayMedian"]),fmt(q["difference"])])
        draw_table(ax2,rows,["Parameter","Unit","Weekday","Saturday","Difference"],[0.28,0.13,0.18,0.18,0.18],bbox=(0.02,0.04,0.96,0.80),font=7.1,header_font=7.0)

        ax3=panel(fig,[x,0.105,0.465,0.18],f"{room} | WEEKLY DECISION",GREEN)
        if room=="LAB":
            text=(f"{r['quality']['records']:,} raw records; {len(r['acousticEvents'])} raw >90 dB episodes; {len(r['volatileEvents'])} volatile-gas episodes. Saturday's lower CO2 and TVOC with unchanged PM2.5 helps separate occupancy/process activity from the already low particle background. HEPA particle performance was consistent with the LAB's own history. Propane and nitrogen remain NOT INFERRED pending dedicated sensors.")
        else:
            text=(f"{r['quality']['records']:,} raw records; {len(r['acousticEvents'])} raw >90 dB episode; {len(r['volatileEvents'])} volatile-gas episodes. Saturday's lower CO2 and sound but higher volatile signals shows why OFFICE occupancy, open-air exchange and source episodes must be evaluated independently. CLOSE was not detected on 1 September and remains deliberately blank.")
        ax3.text(0.035,0.78,wrap(text,83),fontsize=10.2,color=WHITE,va="top",linespacing=1.28)

    # Compact navigation line summarizes every following section without repeating daily exact timestamps.
    fig.text(0.5,0.073,"WHAT FOLLOWS | LAB exact table -> LAB daily references/events -> LAB trajectories (2 pages) -> OFFICE exact table -> OFFICE daily references/events -> OFFICE trajectories (2 pages) -> methods/rules",ha="center",fontsize=MIN_TEXT,fontweight="bold",color=MUTED)
    pdf.savefig(fig,facecolor=BG); plt.close(fig)

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

