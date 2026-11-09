import { workspaceNavigation } from "./dashboard-tabs.mjs";

export const DASHBOARD_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="robots" content="noindex,nofollow">
<title>SPARK BMC-LMU · Nucleosome-C</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='4' fill='%230f1115'/%3E%3Cpath d='M7 24V8h5l8 12V8h5v16h-5L12 12v12z' fill='%2378bf8a'/%3E%3C/svg%3E">
<style>
:root{color-scheme:dark;--bg:#0f1115;--panel:#15181e;--border:#2b3039;--text:#d9dce3;--muted:#9098a6;--green:#86c99a;--amber:#e5bd78;--cyan:#86bbcf;--purple:#b3a4df;--red:#e68c8c;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace;font-size:14px;font-synthesis:none}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);line-height:1.5}button{font:inherit}header{border-bottom:1px solid var(--border)}.header-inner{max-width:1240px;margin:auto;display:flex;justify-content:space-between;align-items:center;padding:19px 32px;gap:16px}.brand{font-size:15px;font-weight:650;letter-spacing:.045em}.header-time{font-variant-numeric:tabular-nums;color:var(--muted);font-size:15px}main{max-width:1240px;margin:0 auto;padding:30px 32px 28px}.title-row{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:22px}h1{font-size:19px;letter-spacing:-.04em;font-weight:550;margin:0}h1 span{color:var(--muted);font-weight:400}.feed{display:flex;gap:8px;align-items:center;color:var(--muted);font-size:11px}.dot{width:7px;height:7px;background:var(--muted);display:inline-block;border-radius:50%;flex-shrink:0}.dot.green{background:var(--green)}.dot.amber{background:var(--amber)}.overview{display:grid;grid-template-columns:1.65fr 1fr 1fr;border:1px solid var(--border);background:var(--panel);margin-bottom:20px}.metric{padding:22px 24px;min-width:0}.metric+.metric{border-left:1px solid var(--border)}.eyebrow{color:var(--muted);font-size:11px;letter-spacing:.075em;text-transform:uppercase}.value{font-size:40px;letter-spacing:-.07em;line-height:1.2;font-weight:550;margin:7px 0 8px;font-variant-numeric:tabular-nums}.value.green{color:var(--green)}.value .small{font-size:20px;letter-spacing:-.03em;color:var(--muted)}.metric-note{font-size:12px;color:var(--muted)}.total-bar{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;height:9px;margin-top:17px}.total-segment{background:#282e36;overflow:hidden}.total-segment i{height:100%;display:block;background:var(--green)}.total-segment.current i{background:var(--cyan)}.attention{border:1px solid #594b33;background:#201c16;color:var(--amber);padding:12px 17px;display:flex;gap:18px;align-items:center;justify-content:space-between;font-size:12px;margin-bottom:20px}.attention-main{display:flex;align-items:center;gap:10px}.attention-meta{color:#bdab8d;font-size:11px;text-align:right}.grid{display:grid;grid-template-columns:1.65fr 1fr;gap:20px}.panel{border:1px solid var(--border);background:var(--panel);min-width:0}.panel-head{padding:14px 18px;border-bottom:1px solid var(--border);display:flex;gap:16px;justify-content:space-between;align-items:center}.panel-title{font-size:12px;letter-spacing:.035em;font-weight:550;margin:0}.panel-hint{font-size:10px;color:var(--muted)}.runs{padding:4px 18px 7px}.run{display:grid;grid-template-columns:83px minmax(60px,1fr) 47px 86px;gap:13px;align-items:center;padding:16px 0;min-height:64px}.run+.run{border-top:1px solid #242932}.run-label{font-size:12px}.run-label span{color:var(--muted)}.run-track{background:#292f37;height:7px;overflow:hidden}.run-fill{height:100%;background:var(--green)}.run-fill.current{background:var(--cyan)}.run-fill.failed{background:var(--red)}.run-percent{text-align:right;font-size:12px;font-variant-numeric:tabular-nums}.run-state{text-align:right;font-size:11px;color:var(--muted)}.run-state.complete{color:var(--green)}.run-state.current{color:var(--cyan)}.run-state.failed{color:var(--red)}.side{display:flex;flex-direction:column;gap:20px}.active-body{padding:17px 18px 18px}.active-top{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:16px;gap:15px}.active-name{font-size:20px;color:var(--cyan)}.active-percent{font-size:23px;font-variant-numeric:tabular-nums;color:var(--cyan)}.detail{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:11px;margin:9px 0}.detail dt{color:var(--muted)}.detail dd{margin:0;text-align:right}.green{color:var(--green)}.amber{color:var(--amber)}.red{color:var(--red)}.muted{color:var(--muted)}dl{margin:0}.chart-body{padding:15px 18px 11px}svg.history{width:100%;height:122px;display:block;overflow:visible}.chart-labels{display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-top:7px}.stages{display:grid;grid-template-columns:repeat(6,1fr);gap:0;margin-top:20px;border:1px solid var(--border);background:var(--panel)}.stage{padding:17px 15px;position:relative;min-width:0}.stage+.stage{border-left:1px solid var(--border)}.stage-number{font-size:10px;color:var(--muted);margin-bottom:7px}.stage-name{font-size:11px;white-space:nowrap}.stage-state{font-size:10px;margin-top:6px;color:var(--muted)}.stage-state.complete{color:var(--green)}.stage-state.in_progress{color:var(--cyan)}.stage-line{height:3px;margin-top:14px;background:#2a3038}.stage-line i{display:block;height:100%;background:var(--green)}.stage-line.current i{background:var(--cyan)}.next{margin-top:20px;display:flex;align-items:baseline;gap:16px;font-size:12px;padding:15px 18px;border:1px solid var(--border)}.next-label{color:var(--cyan);font-size:10px;letter-spacing:.1em;flex-shrink:0}.next-text{line-height:1.7}.next-text span{color:var(--muted)}.bottom{display:flex;align-items:center;justify-content:space-between;gap:15px;color:var(--muted);font-size:10px;margin-top:20px}.bottom-left{display:flex;gap:18px;flex-wrap:wrap}.refresh{background:transparent;border:1px solid var(--border);color:var(--muted);padding:5px 9px;cursor:pointer}.refresh:hover{border-color:var(--muted);color:var(--text)}.refresh:focus-visible{outline:2px solid var(--cyan);outline-offset:3px}.refresh:disabled{opacity:.5;cursor:wait}.loading{padding:45px 0;color:var(--muted);font-size:12px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}[hidden]{display:none!important}
@media(min-width:1450px){main{padding-top:40px}.value{font-size:46px}.run{padding:19px 0}.header-inner{padding-top:22px;padding-bottom:22px}}
@media(max-width:860px){main{padding:24px 20px}.header-inner{padding:17px 20px}.overview{grid-template-columns:1.4fr 1fr 1fr}.metric{padding:18px 17px}.value{font-size:33px}.grid{grid-template-columns:1fr}.side{display:grid;grid-template-columns:1fr 1fr}.stages{grid-template-columns:repeat(3,1fr)}.stage:nth-child(4){border-left:0}.stage:nth-child(n+4){border-top:1px solid var(--border)}.attention{align-items:flex-start}.run{grid-template-columns:95px minmax(60px,1fr) 55px 95px;padding:15px 0}.title-row{align-items:flex-start}}
@media(max-width:540px){:root{font-size:13px}.header-inner{padding:15px 16px}.brand,.header-time{font-size:12px}main{padding:21px 16px}.title-row{display:block;margin-bottom:18px}h1{font-size:17px}.feed{margin-top:8px;font-size:10px}.overview{grid-template-columns:1fr 1fr}.metric:first-child{grid-column:1/-1;border-bottom:1px solid var(--border);padding:19px}.metric:nth-child(2){border-left:0}.metric{padding:17px 19px}.value{font-size:32px}.metric:first-child .value{font-size:48px}.metric-note{font-size:10px}.attention{display:block;padding:12px 14px}.attention-meta{margin:5px 0 0 17px;text-align:left;font-size:10px}.side{display:flex;gap:20px}.run{grid-template-columns:76px minmax(35px,1fr) 43px 72px;gap:9px}.run-state{font-size:10px}.runs{padding-left:14px;padding-right:14px}.run-label{font-size:11px}.stage{padding:13px 10px}.stage-name{font-size:10px}.stage-state{font-size:9px}.next{gap:12px;padding:12px 14px;font-size:11px}.bottom{align-items:flex-start}.bottom-left{display:block}.bottom-left span{display:block;margin-bottom:5px}}
@media(prefers-reduced-motion:no-preference){.run-fill,.total-segment i{transition:width .45s ease}}
/* One viewport overview. Extra evidence appears as screen area increases. */
html,body{height:100%;overflow:hidden}body{height:100dvh;display:grid;grid-template-rows:auto minmax(0,1fr)}
.header-inner{max-width:2000px;padding:clamp(9px,1.5vh,24px) clamp(14px,2.8vw,56px)}
main{width:100%;max-width:2000px;min-height:0;padding:clamp(10px,1.8vh,30px) clamp(14px,2.8vw,56px);display:grid;grid-template-rows:auto minmax(0,1fr);gap:clamp(8px,1.3vh,20px)}
.title-row{margin:0;display:flex;align-items:center}h1{font-size:clamp(16px,1.6vw,26px)}.feed{margin:0}
#content{min-height:0;display:grid;grid-template-rows:minmax(90px,1fr) auto minmax(140px,2fr) minmax(90px,.95fr) auto auto;gap:clamp(8px,1.4vh,20px)}
.overview{margin:0;grid-template-columns:1.45fr 1fr 1fr;border-radius:10px;overflow:hidden}.metric{padding:clamp(10px,1.8vh,28px) clamp(12px,1.8vw,32px);display:flex;flex-direction:column;justify-content:center}.value,.metric:first-child .value{font-size:clamp(25px,4.5vh,64px);margin:3px 0}.total-bar{margin-top:clamp(6px,1vh,16px);height:7px}.eyebrow{font-size:clamp(9px,.85vw,12px)}.metric-note{font-size:clamp(9px,.8vw,12px)}
.attention{margin:0;padding:8px 14px;border-radius:6px;background:#182822;border-color:#355044;color:var(--green)}.attention-meta{color:var(--muted)}
.grid{min-height:0;grid-template-columns:1.4fr 1fr;gap:clamp(8px,1.4vw,20px)}.panel{border-radius:9px;overflow:hidden;display:flex;flex-direction:column;min-height:0}.panel-head{padding:clamp(8px,1.1vh,16px) clamp(10px,1.4vw,22px)}.panel-title{font-size:clamp(10px,.9vw,14px)}.panel-hint{font-size:clamp(9px,.7vw,11px)}
.runs{flex:1;min-height:0;display:grid;grid-template-rows:repeat(6,1fr);padding:0 16px}.run{min-height:0;padding:4px 0;grid-template-columns:80px minmax(28px,1fr) 42px 64px;gap:10px}.run-label,.run-percent{font-size:clamp(10px,.9vw,14px)}.run-state{font-size:clamp(9px,.8vw,12px)}.run-track{border-radius:4px;height:6px}.side{min-height:0;display:grid;grid-template-columns:1fr 1fr;gap:12px}.active-body{flex:1;padding:10px 14px;display:flex;flex-direction:column;justify-content:space-evenly}.active-top{margin-bottom:6px}.active-name,.active-percent{font-size:clamp(16px,1.7vw,27px)}.detail{font-size:clamp(9px,.75vw,12px);margin:7px 0}.chart-body{min-height:0;flex:1;display:flex;flex-direction:column;justify-content:center;padding:12px}.history{min-height:30px;max-height:150px;flex:1}.chart-labels{font-size:9px}
.stages{margin:0;border-radius:9px;overflow:hidden;grid-template-columns:repeat(6,1fr);min-height:0}.stage{padding:clamp(9px,1.3vh,20px) clamp(8px,1.1vw,20px);display:flex;flex-direction:column;justify-content:center}.stage:nth-child(n){border-top:0}.stage+.stage{border-left:1px solid var(--border)}.stage-number{margin-bottom:3px}.stage-name{font-size:clamp(10px,1vw,15px)}.stage-state{font-size:clamp(9px,.8vw,12px);margin-top:3px}.stage-line{margin-top:8px;height:4px;border-radius:3px}.stage-note{color:var(--muted);font-size:clamp(9px,.7vw,11px);margin-top:7px;line-height:1.4}.stage[data-state="in_progress"]{background:linear-gradient(130deg,#182a33,#15181e)}.stage[data-state="complete"] .stage-number{color:var(--green)}
.next{margin:0;padding:7px 12px;font-size:clamp(10px,.9vw,13px);border-radius:6px}.next-text{line-height:1.4}.bottom{margin:0;align-items:center;font-size:clamp(9px,.75vw,12px)}.bottom-left{display:flex;gap:14px}.bottom-left span{margin:0}.refresh{border-radius:5px;font-size:10px}.capacity{color:var(--muted);font-size:10px;margin-left:auto}
@media(max-width:1200px){.side{grid-template-columns:1fr}.side .panel:last-child{display:none}.stage-note{font-size:9px}.capacity{display:none}}
@media(max-width:700px){:root{font-size:12px}.header-inner{padding:9px 14px}.brand,.header-time{font-size:11px}main{padding:10px 12px;gap:8px}.feed{font-size:9px}h1{font-size:15px}#content{gap:8px;grid-template-rows:minmax(83px,.9fr) auto minmax(150px,1.8fr) minmax(125px,1.35fr) auto auto}.overview{grid-template-columns:1.2fr 1fr 1fr}.metric:first-child{grid-column:auto;border-bottom:0;padding:10px}.metric:nth-child(2){border-left:1px solid var(--border)}.metric{padding:10px}.eyebrow{font-size:8px;letter-spacing:.02em}.value,.metric:first-child .value{font-size:clamp(24px,6vw,36px)}.metric-note{font-size:8px;line-height:1.4}.grid{grid-template-columns:1.2fr 1fr;gap:8px}.panel-head{padding:8px 10px;gap:4px}.panel-title{font-size:9px}.panel-hint{font-size:8px}.runs{padding:0 9px}.run{grid-template-columns:53px minmax(15px,1fr) 30px;gap:5px}.run-label{font-size:9px}.run-percent{font-size:9px}.run-state{display:none}.side{display:grid;gap:0}.active-body{padding:8px 10px}.active-name,.active-percent{font-size:14px}.active-top{gap:5px}.detail{font-size:8px;gap:4px;margin:8px 0}.detail dt{white-space:nowrap}.attention{display:flex;padding:7px 9px;font-size:9px;gap:8px}.attention-main{gap:6px}.attention-meta{font-size:8px;margin:0}.stages{grid-template-columns:repeat(3,1fr)}.stage{padding:8px 10px}.stage:nth-child(n+4){border-top:1px solid var(--border)}.stage:nth-child(4){border-left:0}.stage-number{display:none}.stage-name{font-size:10px}.stage-state{font-size:9px}.stage-note{font-size:8px;margin-top:4px}.stage-line{margin-top:5px;height:3px}.next{padding:6px 9px;font-size:9px;gap:9px}.next-label{font-size:9px}.bottom{font-size:8px;gap:5px}.bottom-left{gap:7px}.bottom-left span:last-child{display:none}.refresh{font-size:9px;padding:5px 7px}}
@media(max-height:650px) and (min-width:701px){.header-inner{padding-top:7px;padding-bottom:7px}main{padding-top:8px;padding-bottom:8px;gap:7px}#content{gap:7px;grid-template-rows:70px auto minmax(105px,1fr) 75px auto auto}.metric{padding:8px 16px}.value,.metric:first-child .value{font-size:26px}.total-bar{margin-top:5px;height:5px}.panel-head{padding:6px 10px}.run{padding:2px}.stage{padding:8px}.stage-note{font-size:8px;margin-top:3px}.detail{margin:4px 0}.next{padding:5px 10px}.attention{padding:5px 10px}.active-top{margin:0}.active-body{padding:5px 10px}}
@media(max-height:600px) and (max-width:700px){main{padding:7px 10px;gap:6px}#content{gap:6px;grid-template-rows:72px 27px minmax(128px,1fr) 112px auto 24px}.metric{padding:7px}.metric:first-child{padding:7px}.attention-meta{display:none}.detail{margin:5px 0}.stage{padding:6px 8px}.next{padding:5px 8px}.stage-note{font-size:8px}.panel-head{padding:6px 8px}.active-body{padding:5px 8px}}
@media(max-height:450px){.header-inner{padding-top:5px;padding-bottom:5px}main{padding:6px 12px;gap:5px}#content{grid-template-columns:1.2fr 1fr;grid-template-rows:67px minmax(95px,1fr) 26px 23px;gap:6px}.overview{grid-column:1}.attention{grid-column:1;grid-row:3}.grid{grid-column:1;grid-row:2;grid-template-columns:1fr 1fr}.stages{grid-column:2;grid-row:1/3;grid-template-columns:repeat(3,1fr)}.stage:nth-child(n+4){border-top:1px solid var(--border)}.stage:nth-child(4){border-left:0}.stage-number{display:none}.next{grid-column:2;grid-row:3;font-size:8px;overflow:hidden}.bottom{grid-column:1/-1;grid-row:4}.metric{padding:6px}.value,.metric:first-child .value{font-size:22px}.metric-note,.eyebrow{font-size:8px}.total-bar{height:4px;margin-top:4px}.panel-head{padding:4px 6px}.panel-title{font-size:8px}.panel-hint{display:none}.run{grid-template-columns:50px minmax(10px,1fr) 28px;gap:4px}.run-state{display:none}.runs{padding:0 6px}.run-label,.run-percent,.detail{font-size:8px}.active-top{margin:0}.active-name,.active-percent{font-size:12px}.active-body{padding:4px 6px}.detail{margin:3px 0}.stage{padding:6px}.stage-name{font-size:10px}.stage-state{font-size:8px}.stage-note{font-size:8px}.attention{padding:4px 6px;font-size:8px}.attention-meta{display:none}.side .panel:last-child{display:none}.bottom-left{font-size:8px}}
.next{display:block}.next-line{display:flex;gap:12px;align-items:baseline}.timing{display:flex;gap:16px;flex-wrap:wrap;margin-top:6px;padding-top:6px;border-top:1px solid var(--border);font-size:clamp(9px,.8vw,12px);color:var(--muted)}.timing strong{color:var(--cyan);font-weight:500}.rate-basis{font-size:clamp(8px,.7vw,11px);color:var(--muted);margin-top:4px;line-height:1.4}.hardware{color:var(--muted)}
@media(max-width:700px){.timing{gap:3px 10px;margin-top:4px;padding-top:4px;font-size:8px}.rate-basis{font-size:8px;margin-top:3px}.next-line{gap:8px}.hardware{display:none}}
@media(max-height:450px){.next{grid-row:3;max-height:26px;padding:4px 6px}.next-line{display:none}.timing{margin:0;padding:0;border:0;font-size:8px;gap:4px}.rate-basis{display:none}.hardware{display:none}}
@media(max-width:700px){h1{white-space:nowrap;font-size:14px}.stage-note{line-height:1.2}.detail:nth-child(3),.detail:nth-child(4){display:none}.active-body{justify-content:center;gap:6px}.detail{margin:3px 0}}
@media(max-height:600px) and (max-width:700px){#content{grid-template-rows:84px 24px minmax(116px,1fr) 118px auto 22px}.metric,.metric:first-child{padding:5px 7px}.value,.metric:first-child .value{font-size:24px}.eyebrow{white-space:nowrap}.stage-note{font-size:7.5px}.stage{padding:5px 7px}.stage-line{margin-top:4px}.stage-name{font-size:9px}.stage-state{font-size:8px}.detail{margin:3px 0}.bottom-left{gap:5px}.bottom-left span:nth-child(2){font-size:7px}}
@media(max-height:600px) and (max-width:700px){.eyebrow{line-height:1.2}.value,.metric:first-child .value{margin:2px 0}.total-bar{height:4px;margin-top:4px}.run{padding:0;line-height:1.1}.active-body{justify-content:flex-start;gap:4px;padding:5px 6px}.active-top{margin:0}.detail{margin:1px 0}.stage{padding:4px 6px;line-height:1.15}.stage-state{margin-top:2px}.stage-line{margin-top:3px}.stage-note{margin-top:3px}}
/* The workspace shell stays dark; the selected study has its own wine/plum theme. */
body[data-workspace="nucleosome-c"]{--bg:#160c18;--panel:#211226;--border:#4a2a44;--text:#f1e3ec;--muted:#b19aaa;--green:#9dceae;--amber:#e3b989;--cyan:#d0a4d9;--purple:#c89ccf;--red:#e2a1b3}
header{background:#100b13}.workspace-tabs{max-width:2000px;margin:auto;display:flex;gap:6px;padding:0 clamp(14px,2.8vw,56px);min-width:0}
.workspace-tab{display:inline-flex;align-items:center;min-height:34px;padding:5px 17px;border:1px solid transparent;border-bottom:0;border-radius:9px 9px 0 0;color:var(--muted);text-decoration:none;font-size:12px;letter-spacing:.025em;white-space:nowrap}
.workspace-tab[aria-current="page"]{color:#efd9e9;background:#432039;border-color:#6a3855;box-shadow:inset 0 2px #ad668e}
.workspace-tab:hover{color:var(--text);background:#2c182c}.workspace-tab:focus-visible{outline:2px solid var(--cyan);outline-offset:-3px}
.run-track,.total-segment,.stage-line{background:#3a263d}.run+.run{border-top-color:#3a263d}.stage[data-state="in_progress"]{background:linear-gradient(130deg,#3a203d,#211226)}
.attention{background:#202122;border-color:#41423f}.overview,.panel,.stages{box-shadow:0 4px 20px #08040a18}
@media(max-width:700px){.workspace-tabs{padding:0 12px}.workspace-tab{min-height:29px;font-size:10px;padding:4px 12px}.header-inner{padding-top:7px;padding-bottom:7px}}
@media(max-height:600px) and (max-width:700px){.header-inner{padding-top:5px;padding-bottom:5px}.workspace-tab{min-height:26px;font-size:9px;padding:3px 10px}main{gap:4px}.stage-note{line-height:1.1}}
@media(max-height:450px){.workspace-tab{min-height:25px;font-size:10px;padding:3px 12px}.header-inner{padding-top:4px;padding-bottom:4px}main{padding-top:4px;padding-bottom:4px}}
@media(max-height:850px) and (min-width:701px){.stage-number{display:none}.stage{padding-top:7px;padding-bottom:7px}.stage-note{margin-top:4px;line-height:1.2}.metric{padding-top:9px;padding-bottom:9px}.metric .value{line-height:1.1}.metric .total-bar{margin-top:6px}}
@media(max-height:600px) and (max-width:700px){.title-row{display:none}main{grid-template-rows:minmax(0,1fr)}}
@media(max-height:450px){.metric,.metric:first-child{padding:4px 6px}.metric .value,.metric:first-child .value{font-size:20px;line-height:1;margin:1px 0}.metric .eyebrow,.metric-note{font-size:7.5px;line-height:1.1}.metric .total-bar{margin-top:3px;height:3px}}
</style>
</head>
<body data-workspace="nucleosome-c">
<header><div class="header-inner"><div class="brand">SPARK BMC-LMU</div><time id="updated" class="header-time" aria-label="Information update time in Berlin">------------</time></div>${workspaceNavigation("nucleosome-c")}</header>
<main id="nucleosome-c" aria-labelledby="tab-nucleosome-c">
<div class="title-row"><h1>Nucleosome <span>/ experiment</span></h1><div class="feed"><i class="dot" id="feed-dot" aria-hidden="true"></i><span id="feed-state" role="status">Connecting</span></div></div>
<div id="loading" class="loading" role="status">Loading progress…</div>
<div id="content" hidden>
<section class="overview" aria-label="Baseline overview">
<div class="metric"><div class="eyebrow">Baseline saved</div><div class="value green" id="overall">—</div><div class="metric-note" id="saved-total">—</div><div class="total-bar" id="total-bar" role="progressbar" aria-label="Overall saved simulation steps" aria-valuemin="0" aria-valuemax="100"></div></div>
<div class="metric"><div class="eyebrow">Runs complete</div><div class="value" id="finished">—</div><div class="metric-note" id="finished-note">—</div></div>
<div class="metric"><div class="eyebrow">Study stages</div><div class="value" id="remaining">—</div><div class="metric-note" id="remaining-note">—</div></div>
</section>
<div class="attention" id="attention" role="status"><div class="attention-main"><i class="dot amber" aria-hidden="true"></i><span id="attention-title">—</span></div><div class="attention-meta" id="attention-meta">—</div></div>
<div class="grid">
<section class="panel" aria-labelledby="runs-heading"><div class="panel-head"><h2 class="panel-title" id="runs-heading">Baseline · six replicas</h2><span class="panel-hint">100 ps each</span></div><div class="runs" id="runs"></div></section>
<div class="side">
<section class="panel" aria-labelledby="active-heading"><div class="panel-head"><h2 class="panel-title" id="active-heading">Current checkpoint</h2><span class="panel-hint" id="active-status">—</span></div><div class="active-body"><div class="active-top"><span class="active-name" id="active-name">—</span><span class="active-percent" id="active-percent">—</span></div><dl><div class="detail"><dt>Saved steps</dt><dd id="active-steps">—</dd></div><div class="detail"><dt>Guards</dt><dd id="active-guards">—</dd></div><div class="detail"><dt>Checkpoint</dt><dd id="active-at">—</dd></div><div class="detail"><dt>Runtime</dt><dd class="amber" id="runtime">Unconfirmed</dd></div></dl></div></section>
<section class="panel" aria-labelledby="history-heading"><div class="panel-head"><h2 class="panel-title" id="history-heading">Saved progress</h2><span class="panel-hint" id="history-total">—</span></div><div class="chart-body"><svg id="history" class="history" viewBox="0 0 360 122" role="img" aria-label="Cumulative saved simulation progress"></svg><div class="chart-labels"><span id="history-start">—</span><span id="history-end">—</span></div></div></section>
</div>
</div>
<section class="stages" id="stages" aria-label="Study stages"></section>
<div class="next"><div class="next-line"><span class="next-label">NEXT</span><div class="next-text" id="next">—</div></div><div class="timing"><span>Baseline <strong id="eta-baseline">measuring…</strong></span><span>Defined program <strong id="eta-program">measuring…</strong></span><span>Conditional ceiling <strong id="eta-ceiling">measuring…</strong></span></div><div class="rate-basis" id="rate-basis">Time estimates await measured cloud progression.</div><div class="rate-basis hardware" id="hardware">CPU / VM properties awaiting verification</div></div>
<footer class="bottom"><div class="bottom-left"><span id="watchdog">Watchdog: —</span><span id="checked">—</span><span>Refresh: 30s</span></div><span class="capacity">21 defined runs · up to 48 conditional · 69 maximum</span><button class="refresh" id="refresh" type="button">Refresh ↻</button></footer>
</div>
<noscript><p>JavaScript is required to display progress.</p></noscript>
</main>
<script>
(function(){
  'use strict';
  var data=null,busy=false,lastRead=0,failed=false;
  var $=function(id){return document.getElementById(id)};
  var nf=new Intl.NumberFormat('en-US');
  var labels={'601-A':'601 A','control-A':'Control A','601-B':'601 B','control-B':'Control B','601-C':'601 C','control-C':'Control C'};
  var stageLabels={audit:'Setup',baseline:'Baseline',components:'Controls',pulling:'Force tests',heldout:'Confirmation',conclusions:'Results'};
  var stageNotes={audit:'Inputs · guards',baseline:'6 bound replicas',components:'3 systems · 9 runs',pulling:'Qualify · 6 scouts · ≤12 extra',heldout:'≤36 independent runs',conclusions:'Model comparison'};
  function parts(value){return new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Berlin',month:'2-digit',day:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).reduce(function(a,p){a[p.type]=p.value;return a},{})}
  function stamp(value){var p=parts(value);return p.month+p.day+p.year+p.hour+p.minute}
  function time(value){return new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit',timeZoneName:'short',hourCycle:'h23'}).format(new Date(value))}
  function day(value){return new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',day:'numeric',month:'short'}).format(new Date(value))}
  function age(value){var m=Math.max(0,Math.floor((Date.now()-Date.parse(value))/60000));return m<1?'just now':m<60?m+'m ago':m<1440?Math.floor(m/60)+'h '+m%60+'m ago':Math.floor(m/1440)+'d '+Math.floor(m%1440/60)+'h ago'}
  function duration(seconds){var hours=Math.ceil(seconds/3600);return hours<48?'~'+hours+'h':'~'+Math.round(hours/24*10)/10+'d'}
  function node(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n}
  function svgNode(tag,attributes){var n=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.keys(attributes).forEach(function(k){n.setAttribute(k,attributes[k])});return n}
  function render(){
    if(!data)return;
    var jobs=data.jobs,total=jobs.reduce(function(s,j){return s+j.step},0),pct=total/6000;
    var done=jobs.filter(function(j){return j.status==='completed'}).length;
    var stops=jobs.filter(function(j){return j.status==='guard_stop'}).length;
    var active=jobs.find(function(j){return j.status==='checkpoint'})||jobs.find(function(j){return j.status==='queued'})||null;
    var current=active||(jobs.length?jobs[jobs.length-1]:null);
    $('updated').textContent=stamp(data.information_updated_at);
    $('updated').dateTime=data.information_updated_at;
    $('updated').title='Information updated '+day(data.information_updated_at)+' '+time(data.information_updated_at)+' · Europe/Berlin';
    $('overall').textContent=pct.toFixed(pct%1?1:0)+'%';
    $('saved-total').textContent=nf.format(total)+' / 600,000 steps saved';
    $('finished').textContent=done+' / 6';
    $('finished-note').textContent=stops?stops+' guard stop'+(stops===1?'':'s'):done===6?'Baseline complete':(6-done)+' runs remaining';
    $('remaining').textContent=data.stages.filter(function(s){return s.state==='complete'}).length+' / '+data.stages.length;
    $('remaining-note').textContent='Later stages gated';
    var totalBar=$('total-bar');totalBar.replaceChildren();totalBar.setAttribute('aria-valuenow',pct.toFixed(1));
    jobs.forEach(function(job){var segment=node('div','total-segment'+(job.status==='checkpoint'?' current':''));var fill=node('i');fill.style.width=(job.step/1000)+'%';segment.append(fill);segment.title=labels[job.id]+': '+(job.step/1000)+'%';totalBar.append(segment)});
    var runRows=$('runs');runRows.replaceChildren();
    jobs.forEach(function(job){
      var isCurrent=job.status==='checkpoint',isStop=job.status==='guard_stop';
      var row=node('div','run');row.append(node('div','run-label',labels[job.id]));
      var track=node('div','run-track'),fill=node('div','run-fill'+(isCurrent?' current':isStop?' failed':''));
      fill.style.width=(job.step/1000)+'%';track.append(fill);track.setAttribute('role','progressbar');track.setAttribute('aria-label',labels[job.id]);track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');track.setAttribute('aria-valuenow',String(job.step/1000));row.append(track);
      row.append(node('span','run-percent',(job.step/1000).toFixed(job.step%1000?1:0)+'%'));
      row.append(node('span','run-state'+(job.status==='completed'?' complete':isCurrent?' current':isStop?' failed':''),job.status==='completed'?'✓ done':isCurrent?'saved':isStop?'guard stop':'queued'));
      runRows.append(row);
    });
    if(current){
      $('active-name').textContent=labels[current.id];$('active-percent').textContent=(current.step/1000)+'%';
      $('active-steps').textContent=nf.format(current.step)+' / 100,000';
      $('active-guards').textContent=current.guards_pass===true?'6 / 6 pass':current.guards_pass===false?'Guard stop':'Pending';
      $('active-guards').className=current.guards_pass===true?'green':current.guards_pass===false?'red':'muted';
      $('active-at').textContent=current.checkpoint_at?day(current.checkpoint_at)+' · '+time(current.checkpoint_at):'Pending';
      $('active-status').textContent=current.checkpoint_at?age(current.checkpoint_at):'Queued';
    }
    var stale=current&&current.checkpoint_at&&Date.now()-Date.parse(current.checkpoint_at)>1500000;
    var runtime=data.runtime_observation,confirmed=data.runtime_confirmed&&runtime&&Date.now()-Date.parse(runtime.at)<=360000;
    $('runtime').textContent=done+stops===6?'Tranche finished':confirmed?'Advancing · '+age(runtime.at):'Unconfirmed';
    $('runtime').className=done+stops===6||confirmed?'green':'amber';
    if(confirmed&&current&&runtime.job===current.id){$('active-status').textContent=nf.format(runtime.observed_step)+' observed';$('active-guards').textContent=runtime.guards_pass?'6 / 6 pass':'Guard stop';$('active-guards').className=runtime.guards_pass?'green':'red'}
    $('attention').hidden=done+stops===6&&!stops;
    $('attention-title').textContent=stops?'Guard stop recorded':confirmed?'Simulation advancing':stale?'Runtime observation overdue':'Awaiting current runtime update';
    $('attention-meta').textContent=confirmed?(runtime.observed_step/1000).toFixed(2)+' ps observed':current&&current.checkpoint_at?'Last checkpoint '+age(current.checkpoint_at):'Next run queued';
    var chart=$('history');chart.replaceChildren();
    var history=data.history||[],width=360,height=112;
    [0,0.5,1].forEach(function(f){chart.append(svgNode('line',{x1:0,y1:height-f*height,x2:width,y2:height-f*height,stroke:'#2b3039','stroke-width':1,'stroke-dasharray':'3 5'}))});
    if(history.length>1){
      var begin=Date.parse(history[0].at),end=Date.parse(history[history.length-1].at),span=Math.max(end-begin,1);
      var coordinates=history.map(function(p){return [((Date.parse(p.at)-begin)/span*width).toFixed(2),(height-p.step/600000*height).toFixed(2)]});
      var path='M '+coordinates.map(function(p){return p.join(' ')}).join(' L ');
      chart.append(svgNode('path',{d:path+' L '+width+' '+height+' L 0 '+height+' Z',fill:'#86c99a',opacity:0.055}));
      chart.append(svgNode('path',{d:path,fill:'none',stroke:'#86c99a','stroke-width':2,'stroke-linejoin':'round','vector-effect':'non-scaling-stroke'}));
      var last=coordinates[coordinates.length-1];chart.append(svgNode('circle',{cx:last[0],cy:last[1],r:3,fill:'#86c99a'}));
      $('history-start').textContent=day(history[0].at);$('history-end').textContent=day(history[history.length-1].at)+' · '+time(history[history.length-1].at);
    }else{$('history-start').textContent='Checkpoint history';$('history-end').textContent='Pending'}
    $('history-total').textContent=(total/1000)+' / 600 ps';
    chart.setAttribute('aria-label','Saved progress: '+(total/1000)+' of 600 picoseconds');
    var stages=$('stages');stages.replaceChildren();
    data.stages.forEach(function(stage,index){var card=node('div','stage');card.setAttribute('data-state',stage.state);card.append(node('div','stage-number','0'+(index+1)));card.append(node('div','stage-name',stageLabels[stage.id]));var state=stage.id==='baseline'&&stage.state==='in_progress'?pct.toFixed(1)+'% saved':stage.state==='complete'?'✓ complete':stage.state==='in_progress'?'in progress':stage.state==='guard_stop'?'guard stop':'pending';card.append(node('div','stage-state '+stage.state,state));var line=node('div','stage-line'+(stage.state==='in_progress'?' current':'')),fill=node('i');fill.style.width=stage.state==='complete'?'100%':stage.id==='baseline'?pct+'%':'0%';line.append(fill);card.append(line);card.append(node('div','stage-note',stageNotes[stage.id]));stages.append(card)});
    var todo=[];
    if(stops)todo.push('Review guard stop');
    if(done+stops<6&&!confirmed)todo.push('Confirm runtime');
    jobs.filter(function(j){return !['completed','guard_stop'].includes(j.status)}).forEach(function(j){todo.push((j.step?'Finish ':'Run ')+labels[j.id])});
    if(!todo.length){var pending=data.stages.find(function(s){return s.state!=='complete'});todo.push(pending?stageLabels[pending.id]:'Review results')}
    $('next').replaceChildren();todo.slice(0,4).forEach(function(item,index){if(index)$('next').append(node('span',null,' → '));$('next').append(document.createTextNode(item))});
    $('watchdog').textContent='Watchdog: '+(data.watchdog_armed?'armed':'awaiting install');
    $('watchdog').className=data.watchdog_armed?'green':'amber';
    if(data.compute_rate){
      var rate=data.compute_rate,remaining=jobs.filter(function(j){return j.status!=='guard_stop'}).reduce(function(s,j){return s+j.cap-j.step},0);
      var pending=function(id){return data.stages.some(function(s){return s.id===id&&s.state!=='complete'})};
      var defined=remaining+(pending('components')?900000:0)+(pending('pulling')?600000:0);
      var ceiling=defined+(pending('pulling')?1200000:0)+(pending('heldout')?3600000:0);
      $('eta-baseline').textContent=duration(remaining/rate.steps_per_second);
      $('eta-program').textContent=duration(defined/rate.steps_per_second)+'*';
      $('eta-ceiling').textContent=duration(ceiling/rate.steps_per_second)+'*';
      $('rate-basis').textContent=rate.steps_per_second.toFixed(3)+' steps/s · 4 CPU · '+Math.round((Date.parse(rate.to)-Date.parse(rate.from))/60000)+' min sample. *Same-rate budgets; later speeds unmeasured. Pauses/qualification extra.';
      $('hardware').textContent=rate.cpu_model+' · '+rate.threads+' threads · '+rate.logical_cpus+' visible CPUs / '+rate.cpu_quota+' CPU quota · '+rate.memory_gib+' GiB RAM · provider VM type unavailable';
    }
    $('checked').textContent='Information updated '+age(data.information_updated_at);
    var feedStale=Date.now()-Date.parse(data.information_updated_at)>900000;
    $('feed-dot').className='dot '+(failed||feedStale||data.feed_mode!=='automatic'?'amber':'green');
    $('feed-state').textContent=failed?'Refresh failed · saved data':data.feed_mode!=='automatic'?'Saved snapshot':feedStale?'Feed update overdue':'Feed connected';
    $('loading').hidden=true;$('content').hidden=false;
  }
  async function refresh(){
    if(busy)return;busy=true;$('refresh').disabled=true;
    try{var response=await fetch('/api/nucleosome-progress',{cache:'no-store',signal:AbortSignal.timeout(12000)});if(response.status===401){window.location.assign('/');return}if(!response.ok)throw new Error('HTTP '+response.status);var next=await response.json();if(!next.jobs||next.jobs.length!==6||!next.information_updated_at)throw new Error('Invalid progress');data=next;lastRead=Date.now();failed=false;render()}
    catch(error){failed=true;if(data)render();else{$('loading').textContent='Progress unavailable. Retrying in 30s.';$('feed-state').textContent='Connection unavailable';$('feed-dot').className='dot amber'}}
    finally{busy=false;$('refresh').disabled=false}
  }
  $('refresh').addEventListener('click',refresh);
  document.addEventListener('visibilitychange',function(){if(!document.hidden)refresh()});
  window.addEventListener('online',refresh);
  setInterval(function(){if(!document.hidden)refresh()},30000);
  setInterval(function(){if(data&&!document.hidden)render()},15000);
  refresh();
})();
</script>
</body>
</html>`;
