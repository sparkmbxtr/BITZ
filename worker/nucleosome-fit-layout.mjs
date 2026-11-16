export const FITTED_LAYOUT_CSS = String.raw`
body[data-workspace="nucleosome-c"]{font-size:15px}
body[data-workspace="nucleosome-c"] .title-row{flex-wrap:wrap}
body[data-workspace="nucleosome-c"] .feed{font-size:13px}
body[data-workspace="nucleosome-c"] #content{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr) auto auto;gap:var(--display-gap,10px);min-height:0;height:100%;overflow:hidden}
#content>*,#content .progress-pane>*{grid-column:auto;grid-row:auto}
#content .overview,#content .attention{display:none}
#content .progress-pane{min-width:0;min-height:0}
#content .grid{height:190px;min-height:0;grid-template-columns:1.35fr 1fr;gap:14px}
#content .panel-head{padding:6px 12px}
#content .panel-title{font-size:15px}
#content .panel-hint{font-size:13px}
#content .runs{padding:0 12px}
#content .run{min-height:25px;grid-template-columns:100px minmax(28px,1fr) 52px 70px;gap:10px;padding:3px 0}
#content .run-label,#content .run-percent,#content .run-state{font-size:15px}
#content .side{grid-template-columns:1fr}
#content .side .panel:last-child{display:none}
#content .active-body{padding:7px 14px;justify-content:flex-start;gap:4px}
#content .active-top{margin:0 0 4px}
#content .active-name,#content .active-percent{font-size:24px}
#content .detail{display:flex;font-size:14px;line-height:1.4;margin:4px 0;gap:14px}
#content .detail dd{overflow-wrap:break-word}
#content .current-band{display:none;border:1px solid var(--border);background:var(--panel);border-radius:7px;padding:7px 10px;line-height:1.35}
#content .band-title{display:flex;justify-content:space-between;gap:10px;font-size:16px;color:var(--cyan)}
#content .band-evidence{font-size:12px;color:var(--muted);margin-top:3px}
#content #stages{display:grid;grid-template-columns:repeat(var(--stage-columns,6),minmax(0,1fr));grid-template-rows:repeat(var(--stage-rows,1),minmax(0,1fr));min-height:0;height:100%;margin:0;overflow:hidden}
#content #stages .stage{display:grid;grid-template-rows:var(--stage-header-height,106px) minmax(0,1fr);align-content:stretch;justify-content:stretch;min-width:0;min-height:0;padding:var(--card-padding,14px);line-height:1.4}
#content .stage-header{display:flex;flex-direction:column;min-width:0;gap:5px}
#content .stage-topline{display:flex;align-items:baseline;justify-content:space-between;gap:5px}
#content .stage-number{display:block;font-size:13px;margin:0}
#content .stage-state{font-size:14px;margin:0}
#content .stage-name{font-size:18px;white-space:normal;font-weight:600;line-height:1.25}
#content .stage-summary{font-size:14px;line-height:1.4;color:var(--text)}
#content .stage-line{margin:0 0 8px;height:4px;flex:none;margin-top:auto}
#content .stage-details{min-height:0;border-top:1px solid var(--border);padding-top:12px;min-width:0}
#content .stage-details-heading{font-size:14px;font-weight:600;color:var(--text);line-height:1.35;margin:0 0 12px}
#content .stage-details-list{display:grid;align-content:start;gap:var(--detail-gap,12px);list-style:none;margin:0;padding:0}
#content .stage-detail{font-size:var(--detail-size,16px);line-height:1.45;overflow-wrap:break-word;margin:0}
#content .stage-detail.complete{color:var(--green)}
#content .stage-detail.current{color:var(--cyan)}
#content .stage-detail.stopped{color:var(--amber)}
#content .activity-pane{min-width:0;min-height:0}
#content .next{padding:9px 12px;font-size:14px;max-height:none;overflow:visible;margin:0}
#content .next-line{display:flex;gap:14px;align-items:baseline;min-height:0}
#content .next-label{font-size:13px;white-space:nowrap}
#content .next-text{line-height:1.45;min-height:0}
#content .activity-item{display:inline}
#content .activity-item:not(:last-child)::after{content:" → ";color:var(--muted)}
#content .timing{font-size:13px;gap:7px 22px;margin-top:6px;padding-top:6px}
#content[data-has-rate="false"] .timing{display:none}
#content .rate-basis{display:block;font-size:13px;line-height:1.4;margin-top:5px}
#content .bottom{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 24px;align-items:start;font-size:13px;padding:0 2px;min-height:0;overflow:visible}
#content .guard-title{font-size:15px;font-weight:600;margin-bottom:6px}
#content .guard-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px 18px;font-size:14px;line-height:1.4}
#content .guard-note{font-size:13px;line-height:1.4;margin-top:6px}
#content .footer-actions{display:flex;flex-direction:column;align-items:flex-end;gap:5px;font-size:12px}
#content .capacity{grid-column:1/-1;margin:0;font-size:12px}
#content .guard-compact{display:none}
#content .guard-compact>span{display:block}
#content[data-density="1"] .grid{height:158px}
#content[data-density="1"] .run{min-height:21px;padding:0}
#content[data-density="1"] .run-label,#content[data-density="1"] .run-percent,#content[data-density="1"] .run-state{font-size:14px}
#content[data-density="1"] .side .panel-head{display:none}
#content[data-density="1"] .active-body{padding:8px 14px;gap:4px}
#content[data-density="1"] .active-body dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3px 18px}
#content[data-density="1"] .detail{display:block;margin:0}
#content[data-density="1"] .detail dt{font-size:12px}
#content[data-density="1"] .detail dd{text-align:left}
#content[data-density="1"] .stage-name{font-size:16px}
#content[data-density="1"] .stage-summary,#content[data-density="1"] .stage-state{font-size:13px}
#content[data-density="1"] .stage-details-heading{font-size:13px;margin-bottom:8px}
#content[data-density="1"] .stage-details{padding-top:9px}
#content[data-density="1"] .guard-metrics{grid-template-columns:repeat(2,minmax(0,1fr));font-size:13px}
#content[data-density="1"] .guard-title{font-size:14px;margin-bottom:4px}
#content[data-density="1"] .guard-note{font-size:12px}
#content[data-density="1"] .next{font-size:13px;padding:7px 10px}
#content[data-density="1"] .capacity{display:none}
#content[data-density="2"] .grid,#content[data-density="3"] .grid{display:none}
#content[data-density="2"] .current-band,#content[data-density="3"] .current-band{display:block}
#content[data-density="2"] .stage-summary,#content[data-density="3"] .stage-summary,#content[data-density="2"] .stage-details-heading,#content[data-density="3"] .stage-details-heading{display:none}
#content[data-density="2"] .stage-name{font-size:15px}
#content[data-density="2"] .stage-state{font-size:12px}
#content[data-density="2"] .stage-number{font-size:11px}
#content[data-density="2"] .stage-header{gap:3px}
#content[data-density="2"] .stage-details{padding-top:7px}
#content[data-density="2"] .next,#content[data-density="3"] .next{font-size:12px;padding:6px 9px}
#content[data-density="2"] .next-line,#content[data-density="3"] .next-line{display:block}
#content[data-density="2"] .next-label,#content[data-density="3"] .next-label{display:none}
#content[data-density="2"] .rate-basis,#content[data-density="3"] .rate-basis{font-size:12px;margin-top:3px;line-height:1.3}
#content[data-density="2"] .bottom,#content[data-density="3"] .bottom{display:block;font-size:12px;line-height:1.35}
#content[data-density="2"] .guard-status,#content[data-density="3"] .guard-status,#content[data-density="2"] .capacity,#content[data-density="3"] .capacity{display:none}
#content[data-density="2"] .guard-compact,#content[data-density="3"] .guard-compact{display:block}
#content[data-density="2"] .footer-actions,#content[data-density="3"] .footer-actions{flex-direction:row;justify-content:space-between;flex-wrap:wrap;font-size:11px;margin-top:2px}
#content[data-density="3"] .current-band{padding:4px 8px}
#content[data-density="3"] .band-title{font-size:14px}
#content[data-density="3"] .band-evidence{font-size:11px;margin-top:1px}
#content[data-density="3"] .stage-header{gap:2px}
#content[data-density="3"] .stage-number{font-size:10px}
#content[data-density="3"] .stage-state{font-size:11px}
#content[data-density="3"] .stage-name{font-size:13px}
#content[data-density="3"] .stage-line{height:3px;margin-bottom:4px}
#content[data-density="3"] .stage-details{padding-top:5px}
#content[data-density="3"] .stage-detail{line-height:1.3}
#content[data-density="3"] .rate-basis{font-size:11px}
#content[data-density="3"] .next{padding:4px 7px;line-height:1.3}
#content[data-density="3"] .guard-compact{font-size:11px;line-height:1.3}
@media(max-width:999px){#content .stage:nth-child(n+4){border-top:1px solid var(--border)}#content .stage:nth-child(4){border-left:0}}
@media(max-width:649px){#content .stage:nth-child(n+3){border-top:1px solid var(--border)}#content .stage:nth-child(odd){border-left:0}#content .stage:nth-child(4){border-left:1px solid var(--border)}}
@media(max-height:650px){
 body[data-workspace="nucleosome-c"] .title-row{display:none}
 body[data-workspace="nucleosome-c"]>main{grid-template-rows:minmax(0,1fr)}
}
@media(max-height:500px){
 body[data-workspace="nucleosome-c"] .title-row{display:none}
 body[data-workspace="nucleosome-c"]>main{grid-template-rows:minmax(0,1fr)}
 #content .stage:nth-child(n){border-top:0;border-left:1px solid var(--border)}#content .stage:first-child{border-left:0}
 #content .band-title{font-size:13px}
 #content .band-evidence{font-size:11px}
 #content .current-band{display:flex!important;align-items:baseline;justify-content:space-between;gap:10px}
 #content .guard-compact{display:flex!important;gap:7px;justify-content:space-between;flex-wrap:wrap}
 #content .footer-actions>span:nth-child(2){display:none}
}
`;

// The same six stages stay visible. Only redundant wording is condensed as
// available area decreases; there are no alternate views or paged details.
export function createFittedLayout(doc,win,onChange) {
  if(typeof doc.querySelectorAll!=="function")return {configuration(){return {density:0}},update(){}};
  const root=doc.getElementById("content");let density=0,size="",scheduled=false;
  function configuration(){
    const next=win.innerWidth+"x"+win.innerHeight;
    if(size!==next){size=next;density=win.innerWidth>=1200&&win.innerHeight>=1000?0:win.innerWidth>=950&&win.innerHeight>=700?1:win.innerHeight>=700?2:3}
    const columns=win.innerHeight<500?6:win.innerWidth>=1000?6:win.innerWidth>=650?3:2;
    const detail=density===0?Math.min(18,Math.max(16,win.innerHeight/80+2)):density===1?14:density===2?13:12;
    root.dataset.density=String(density);root.dataset.layout="single";
    for(const [name,value] of Object.entries({"--stage-columns":columns,"--stage-rows":6/columns,"--detail-size":detail+"px","--stage-header-height":(density===0?106:density===1?88:density===2?50:44)+"px","--detail-gap":(density===0?12:density===1?8:density===2?6:0)+"px","--card-padding":(density===0?14:density===1?11:density===2?9:6)+"px","--display-gap":(density<2?10:6)+"px"}))root.style.setProperty(name,value);
    return {density};
  }
  function fit(){
    scheduled=false;if(root.hidden)return;
    const bounds=root.getBoundingClientRect();
    let overflow=root.scrollHeight>root.clientHeight+1;
    for(const e of root.querySelectorAll(".stage-detail,.detail,.activity-item,.guard-metrics>span,.guard-note,.guard-compact,.band-title,.band-evidence")){
      if(!e.getClientRects().length)continue;
      const b=e.getBoundingClientRect();if(b.bottom>bounds.bottom+1||b.right>bounds.right+1)overflow=true;
      const card=e.closest(".stage");if(card&&b.bottom>card.getBoundingClientRect().bottom-3)overflow=true;
    }
    if(overflow&&density<3){density++;configuration();onChange()}
  }
  function update(){if(!scheduled){scheduled=true;win.requestAnimationFrame(fit)}}
  win.addEventListener("resize",()=>{configuration();onChange()});
  return {configuration,update};
}
