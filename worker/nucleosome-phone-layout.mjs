// A single phone viewport: spend space on the bars and readable status text.
export const PHONE_LAYOUT_CSS = String.raw`
@media(max-width:1100px),(max-height:780px){
 body[data-workspace="nucleosome-c"]{--phone-font:clamp(12px,2dvh,17px);--workspace-gutter:8px;--workspace-pad:6px;--workspace-gap:5px;font-size:var(--phone-font);line-height:1.2}
 body[data-workspace="nucleosome-c"]>main{grid-template-rows:minmax(0,1fr);overflow:hidden;gap:0}
 body[data-workspace="nucleosome-c"] .title-row{display:none!important}
 body[data-workspace="nucleosome-c"] .header-inner{height:34px;padding:0 8px;gap:6px}
 body[data-workspace="nucleosome-c"] .brand{font-size:15px}
 body[data-workspace="nucleosome-c"] .header-time{font-size:12px}
 body[data-workspace="nucleosome-c"] .workspace-tabs{padding:0 8px;gap:3px;grid-template-columns:repeat(4,minmax(0,1fr))}
 body[data-workspace="nucleosome-c"] .workspace-tab{font-size:12px;min-height:34px;padding:3px 2px;line-height:1.15;white-space:normal;justify-content:center;text-align:center;letter-spacing:0}
 body[data-workspace="nucleosome-c"] #content{height:100%;min-height:0;overflow:hidden;grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(96px,1fr) auto auto;gap:5px}
 #content .progress-pane{display:grid;grid-template-rows:max-content max-content;min-height:0;gap:5px}
 #content .grid,#content[data-density] .grid{height:auto;grid-template-columns:minmax(0,1fr);grid-template-rows:max-content max-content;gap:5px}
 #content .completed-runs,#content[data-density] .completed-runs{height:clamp(110px,25.5dvh,238px);grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:5px}
 #content .completed-runs>.panel,#content .completed-runs>.side{height:100%}
 #content .side{display:block;min-height:0}
 #content .panel{min-height:0;border-radius:6px}
 #content .panel-head,#content[data-density] .panel-head{padding:4px 6px;min-height:24px;gap:4px;flex-wrap:wrap;line-height:1.15}
 #content .panel-title,#content[data-density] .panel-title{font-size:var(--phone-font);letter-spacing:0;line-height:1.15}
 #content .panel-hint,#content[data-density] .panel-hint{font-size:12px}
 #content .baseline-panel .panel-title,#content[data-density] .baseline-panel .panel-title{font-size:0}
 #content .baseline-panel .panel-title::after{content:"Baseline";font-size:var(--phone-font)}
 #content .baseline-panel .panel-hint{display:none}
 #content .runs,#content[data-density] .runs{padding:2px 5px;display:grid;grid-template-rows:repeat(6,minmax(0,1fr))}
 #content .run,#content .control-run,#content[data-density] .run{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto 4px;min-height:0;padding:2px 0;gap:1px 2px;line-height:1.1}
 #content .run-label,#content .run-percent,#content[data-density] .run-label,#content[data-density] .run-percent{font-size:var(--phone-font);line-height:1.1}
 #content[data-density] .control-run .run-label,#content[data-density] .control-run .run-percent{font-size:var(--phone-font);line-height:1.1}
 #content .run-label{grid-column:1;grid-row:1;white-space:nowrap}
 #content .run-percent{grid-column:2;grid-row:1}
 #content .run-track,#content[data-density] .run-track{grid-column:1/-1;grid-row:2;height:4px;min-width:0;width:100%}
 #content .run-state{display:none!important}
 #content .control-columns,#content[data-density] .control-columns{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:6px;padding:2px 5px}
 #content .control-group-title,#content[data-density] .control-group-title{font-size:12px;line-height:1.1;margin:0 0 2px}
 #content .control-label-full{display:none!important}
 #content .control-label-short{display:inline!important}
 #content .current-control-meta{display:none}
 #content .validation-body,#content[data-density] .validation-body{padding:4px 6px;display:block}
 #content .validation-state{display:none}
 #content #validation-runs,#content[data-density] #validation-runs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
 #content .validation-run,#content[data-density] .validation-run{gap:3px}
 #content .validation-run-title,#content[data-density] .validation-run-title{font-size:var(--phone-font);line-height:1.1}
 #content .validation-stats{display:none}
 #content .calibration-panel{margin:0}
 #content .calibration-panel .panel-head{flex-wrap:nowrap}
 #content .calibration-panel .panel-title{font-size:var(--phone-font)}
 #content .calibration-panel .panel-hint{display:none}
 #content .calibration-body{padding:4px 6px;flex:none}
 #content .calibration-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px 10px}
 #content .calibration-run{font-size:var(--phone-font);gap:3px;line-height:1.1}
 #content .calibration-run-title{display:grid;gap:1px}
 #content .calibration-name{font-size:var(--phone-font);line-height:1.1}
 #content .calibration-run-state{font-size:12px;line-height:1.1}
 #content .calibration-state-full{display:none}
 #content .calibration-state-short{display:inline}
 #content .calibration-run .run-track{grid-column:auto;grid-row:auto;height:5px}
 #content .calibration-stats{font-size:var(--phone-font);line-height:1.1;justify-content:flex-end}
 #content .calibration-stats>span:first-child,#content .calibration-time{display:none}
 #content .calibration-note{font-size:12px;line-height:1.15;margin:5px 0 0}
 #content .calibration-note-full{display:none}
 #content .calibration-note-short{display:inline}
 #content #stages{grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:repeat(2,minmax(0,1fr));height:100%;min-height:0;overflow:hidden}
 #content #stages .stage{display:flex;justify-content:center;padding:5px 6px;min-height:0;border:0;border-left:1px solid var(--border)}
 #content #stages .stage:nth-child(3n+1){border-left:0}
 #content #stages .stage:nth-child(n+4){border-top:1px solid var(--border)}
 #content .stage-header{gap:3px;flex:none}
 #content .stage-topline{order:2}
 #content .stage-number,#content .stage-summary,#content .stage-details{display:none!important}
 #content .stage-name,#content[data-density] .stage-name{font-size:calc(var(--phone-font) + 1px);line-height:1.15}
 #content .stage-state,#content[data-density] .stage-state{font-size:var(--phone-font);line-height:1.1}
 #content .stage-line{order:3;height:4px;margin:3px 0 0}
 #content .next,#content[data-density] .next{padding:5px 6px;font-size:var(--phone-font);line-height:1.2;max-height:none;overflow:visible}
 #content .next-line{display:block}
 #content .next-label{display:none}
 #content .next-text{line-height:1.2}
 #content .activity-item{display:inline;overflow-wrap:break-word}
 #content .activity-item:not(:last-child)::after{content:" · "}
 #content .timing{font-size:12px;gap:3px 10px;padding-top:4px;margin-top:4px;line-height:1.2}
 #content .rate-basis{display:none}
 #content .bottom,#content[data-density] .bottom{display:block;font-size:12px;line-height:1.2;padding:0 2px}
 #content .guard-status,#content .guard-compact,#content[data-density] .guard-compact,#content .capacity{display:none!important}
 #content .footer-actions,#content[data-density] .footer-actions{display:flex;flex-direction:row;justify-content:space-between;align-items:center;gap:5px;font-size:12px;margin:0}
 #content .footer-actions>span:nth-child(2){display:none}
}
@media(max-width:1100px),(max-height:780px){
 #content .control-columns,#content[data-density] .control-columns{grid-template-columns:minmax(0,1fr);gap:4px}
 #content .control-runs{grid-template-columns:repeat(3,minmax(0,1fr));gap:3px 5px}
 #content .control-run .run-percent{display:none}
 #content .control-run .run-label{grid-column:1/-1}
 #content .control-group-title{display:none}
 #content .control-run .run-label{white-space:nowrap}
 #content .controls-panel{height:100%}
 #content .control-columns{grid-template-rows:minmax(0,1fr) minmax(0,2fr)}
 #content .control-group{display:grid}
 #content .control-runs{height:100%;grid-auto-rows:minmax(0,1fr)}
 #content .control-run{align-content:center}
 #content #stages{min-height:84px}
 #content .calibration-run{grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto 5px}
 #content .calibration-run-title{grid-column:1;grid-row:1}
 #content .calibration-stats{grid-column:2;grid-row:1;align-self:center}
 #content .calibration-run .run-track{grid-column:1/-1;grid-row:2}
}
@media(max-width:700px) and (max-height:700px){
 #content .completed-runs,#content[data-density] .completed-runs{height:122px}
 body[data-workspace="nucleosome-c"] #content{grid-template-rows:auto minmax(84px,1fr) auto auto;gap:4px}
 #content .run,#content[data-density] .run{padding:1px 0;line-height:1.1}
 #content .baseline-panel .run{grid-template-columns:45px minmax(0,1fr);grid-template-rows:auto;gap:3px}
 #content .baseline-panel .run-percent{display:none}
 #content .baseline-panel .run-track{grid-column:2;grid-row:1;align-self:center}
 #content .calibration-grid{gap:5px 8px}
 #content .calibration-note{margin-top:4px}
}
@media(max-width:700px) and (min-height:740px){
 #content .run,#content .control-run,#content[data-density] .run{padding:3px 0;gap:2px}
 #content .panel-head,#content[data-density] .panel-head{padding:5px 6px}
 #content .calibration-body{padding:6px}
 #content .calibration-grid{gap:9px 10px}
 #content .calibration-run{gap:4px}
 #content .stage-details{display:block!important;flex:none;border:0;margin-top:3px;padding-top:0}
 #content .stage-details-heading{display:none!important}
 #content .stage-detail,#content[data-density] .stage-detail{font-size:12px;line-height:1.15}
}
@media(max-height:500px) and (min-width:701px){
 body[data-workspace="nucleosome-c"] .header-inner{height:26px}
 body[data-workspace="nucleosome-c"] .workspace-tab{min-height:28px}
 body[data-workspace="nucleosome-c"] #content{grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);grid-template-rows:minmax(0,1fr) auto auto;gap:5px}
 #content .progress-pane{grid-column:1;grid-row:1/-1;align-content:start}
 #content .completed-runs,#content[data-density] .completed-runs{height:118px}
 #content #stages{grid-column:2;grid-row:1}
 #content .activity-pane{grid-column:2;grid-row:2}
 #content .bottom{grid-column:2;grid-row:3}
 #content .calibration-grid{gap:5px 10px}
 #content .calibration-run-title{display:flex;gap:2px;flex-wrap:wrap}
 #content .calibration-note{margin-top:3px}
 #content .calibration-run{gap:2px}
 #content .calibration-body{padding:3px 6px}
 #content .calibration-run-state{font-size:12px}
 #content .baseline-panel .run{grid-template-columns:43px minmax(0,1fr) 30px;grid-template-rows:auto;gap:3px;padding:1px 0}
 #content .baseline-panel .run-track{grid-column:2;grid-row:1;align-self:center}
 #content .baseline-panel .run-percent{grid-column:3;grid-row:1}
}
`;
