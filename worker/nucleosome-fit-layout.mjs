export const FITTED_LAYOUT_CSS = String.raw`
body[data-workspace="nucleosome-c"]{font-size:15px}
body[data-workspace="nucleosome-c"] .title-row{flex-wrap:wrap}
body[data-workspace="nucleosome-c"] .feed{font-size:13px}
body[data-workspace="nucleosome-c"] #content{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr) auto auto;gap:10px;min-height:0;height:100%;overflow:hidden}
#content>* ,#content .progress-pane>*{grid-column:auto;grid-row:auto}
#content .dashboard-views,#content .progress-views{display:none}
#content button{font:inherit}
#content .view-button,#content .page-button{border:1px solid var(--border);border-radius:5px;background:transparent;color:var(--muted);padding:5px 10px;cursor:pointer}
#content button:disabled{opacity:.4;cursor:default}
#content .view-button[aria-pressed="true"]{background:#432039;color:var(--text);border-color:#8b5878}
#content .progress-pane{display:grid;grid-template-rows:auto auto;gap:10px;min-width:0;min-height:0}
#content .overview{min-height:0;grid-template-columns:1.45fr 1fr 1fr}
#content .metric{display:grid;grid-template-columns:auto 1fr;align-items:baseline;gap:2px 12px;padding:9px 14px}
#content .eyebrow{font-size:12px;line-height:1.4;grid-column:1/-1}
#content .value{font-size:30px;line-height:1.1;margin:0}
#content .metric-note{font-size:13px;line-height:1.4}
#content .total-bar{grid-column:1/-1;height:4px;margin-top:4px}
#content .attention{font-size:13px;min-height:0;padding:5px 10px}
#content .grid{min-height:0;grid-template-columns:1.35fr 1fr;gap:14px}
#content .panel-head{padding:7px 12px}
#content .panel-title{font-size:14px}
#content .panel-hint{font-size:12px}
#content .runs{padding:0 12px}
#content .run{min-height:25px;grid-template-columns:100px minmax(28px,1fr) 52px 70px;gap:10px;padding:3px 0}
#content .run-label,#content .run-percent,#content .run-state{font-size:14px}
#content .side{grid-template-columns:1fr}
#content .side .panel:last-child{display:none}
#content .active-body{padding:9px 14px;justify-content:flex-start;gap:5px}
#content .active-name,#content .active-percent{font-size:22px}
#content .detail{display:flex;font-size:14px;line-height:1.4;margin:5px 0;gap:14px}
#content .detail dd{overflow-wrap:break-word}
#content .stage-area{display:grid;grid-template-rows:auto minmax(0,1fr);gap:6px;min-width:0;min-height:0}
#content .stage-navigation{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:13px;min-height:24px}
#content .stage-navigation strong{font-weight:500;color:var(--muted)}
#content .stage-navigation-controls{display:flex;align-items:center;gap:10px}
#content #stages{display:grid;grid-template-columns:repeat(var(--stage-columns,6),minmax(0,1fr));min-height:0;height:100%;margin:0;overflow:hidden}
#content #stages .stage{display:grid;grid-template-rows:104px minmax(0,1fr);align-content:stretch;justify-content:stretch;min-width:0;min-height:0;padding:12px 14px;line-height:1.45}
#content #stages .stage[hidden]{display:none}
#content .stage-header{display:flex;flex-direction:column;min-width:0;gap:5px}
#content .stage-topline{display:flex;align-items:baseline;justify-content:space-between;gap:6px}
#content .stage-number{display:block;font-size:12px;margin:0}
#content .stage-state{font-size:13px;margin:0}
#content .stage-name{font-size:17px;white-space:normal;font-weight:600;line-height:1.3}
#content .stage-summary{font-size:13px;line-height:1.4;color:var(--text);min-height:36px}
#content .stage-line{margin:0 0 8px;height:4px;flex:none}
#content .stage-details{display:grid;grid-template-rows:auto minmax(0,1fr) auto;min-height:0;border-top:1px solid var(--border);padding-top:10px;min-width:0}
#content .stage-details-heading{font-size:13px;font-weight:600;color:var(--text);line-height:1.4;margin:0 0 8px}
#content .stage-details-list{display:block;min-height:0;list-style:none;margin:0;padding:0;overflow:hidden}
#content .stage-detail{font-size:14px;line-height:1.5;overflow-wrap:break-word;margin:0 0 9px}
#content .stage-detail[hidden],#content .activity-item[hidden]{display:none}
#content .stage-detail.complete{color:var(--green)}
#content .stage-detail.current{color:var(--cyan)}
#content .stage-detail.stopped{color:var(--amber)}
#content .detail-pages{display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:28px;font-size:12px;margin-top:5px}
#content .detail-pages[hidden]{display:none}
#content .detail-pages .page-button{padding:2px 9px;font-size:14px}
#content .activity-pane{min-width:0;min-height:0}
#content .next{padding:10px 14px;font-size:14px;max-height:none;overflow:hidden}
#content .next-line{display:flex;gap:14px;align-items:baseline;min-height:0}
#content .next-label{font-size:13px;white-space:nowrap}
#content .next-text{line-height:1.5;min-height:0}
#content .activity-item{display:inline}
#content .activity-item:not(:last-child)::after{content:" → ";color:var(--muted)}
#content .timing{font-size:13px;gap:7px 22px;margin-top:6px;padding-top:6px}
#content .rate-basis{display:block;font-size:13px;line-height:1.4;margin-top:5px}
#content .bottom{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px 24px;align-items:start;font-size:13px;padding:0 2px 3px;min-height:0;overflow:hidden}
#content .guard-title{font-size:15px;font-weight:600;margin-bottom:6px}
#content .guard-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 20px;font-size:13px;line-height:1.4}
#content .guard-note{font-size:12px;line-height:1.4;margin-top:7px}
#content .footer-actions{display:flex;flex-direction:column;align-items:flex-end;gap:6px;font-size:12px}
#content .refresh{font-size:13px;padding:6px 12px;min-height:32px}
#content .capacity{display:block;grid-column:1/-1;margin:0;font-size:12px}
#content[data-layout="full"] .metric{padding:6px 14px}
#content[data-layout="full"] .grid{height:186px}
#content[data-layout="full"] .active-body{padding:7px 14px;gap:4px}
#content[data-layout="full"] .detail{margin:3px 0}
#content[data-layout="full"][data-has-rate="false"] .timing{display:none}
#content[data-layout="paged"]{grid-template-rows:auto minmax(0,1fr);gap:10px}
#content[data-layout="paged"] .dashboard-views{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;font-size:13px}
#content[data-layout="paged"]>.progress-pane,#content[data-layout="paged"]>.stage-area,#content[data-layout="paged"]>.activity-pane,#content[data-layout="paged"]>.bottom{display:none}
#content[data-layout="paged"][data-view="current"]>.progress-pane{display:grid;grid-template-rows:auto auto minmax(0,1fr);gap:10px}
#content[data-layout="paged"][data-view="stages"]>.stage-area{display:grid}
#content[data-layout="paged"][data-view="activity"]>.activity-pane{display:block}
#content[data-layout="paged"][data-view="checks"]>.bottom{display:grid;align-content:start}
#content[data-layout="paged"] .progress-views{display:flex;gap:6px;font-size:13px}
#content[data-layout="paged"] .grid{grid-template-columns:1fr}
#content[data-layout="paged"] .grid>.baseline-panel,#content[data-layout="paged"] .grid>.side{display:none}
#content[data-layout="paged"][data-progress="baseline"] .grid>.baseline-panel{display:flex}
#content[data-layout="paged"][data-progress="current"] .grid>.side{display:grid}
#content[data-layout="paged"] .active-body{gap:16px;padding:18px 20px}
#content[data-layout="paged"] .active-name,#content[data-layout="paged"] .active-percent{font-size:28px}
#content[data-layout="paged"] .detail{font-size:15px;margin:12px 0}
#content[data-layout="paged"] .run{min-height:34px;padding:6px 0}
#content[data-layout="paged"] .stage{border-top:0;border-left:1px solid var(--border)}
#content[data-layout="paged"] .stage:first-of-type{border-left:0}
#content[data-layout="paged"] .next{height:100%;display:grid;grid-template-rows:minmax(0,1fr) auto auto auto;padding:16px;font-size:15px}
#content[data-layout="paged"] .next-line{display:grid;grid-template-rows:auto minmax(0,1fr);gap:12px}
#content[data-layout="paged"] .next-text{overflow:hidden}
#content[data-layout="paged"] .activity-item{display:block;font-size:15px;line-height:1.6;margin-bottom:14px}
#content[data-layout="paged"] .activity-item::after{content:none}
#content[data-layout="paged"] .timing{font-size:14px;line-height:1.5}
#content[data-layout="paged"] .rate-basis{font-size:14px;line-height:1.5}
#content[data-layout="paged"] .guard-title{font-size:17px;margin-bottom:14px}
#content[data-layout="paged"] .guard-metrics{font-size:15px;gap:12px 24px;line-height:1.5}
#content[data-layout="paged"] .guard-note{font-size:14px;line-height:1.5;margin-top:16px}
#content[data-layout="paged"] .footer-actions{font-size:13px}
#content[data-layout="paged"] .refresh{font-size:14px;padding:9px 12px;min-height:40px}
@media(max-width:700px){
 #content .metric{display:block;padding:9px}
 #content .eyebrow{font-size:11px}
 #content .value{font-size:25px;margin:4px 0}
 #content .metric-note{font-size:12px}
 #content .stage-summary,#content .stage-state{font-size:14px}
 #content .stage-name{font-size:18px}
 #content .stage-number{font-size:13px}
 #content .stage-detail{font-size:15px}
 #content .stage-details-heading{font-size:14px}
 #content .bottom{grid-template-columns:1fr;gap:14px}
 #content .guard-metrics{grid-template-columns:1fr}
 #content .footer-actions{flex-direction:row;flex-wrap:wrap;align-items:center;justify-content:space-between}
 #content .footer-actions>span:nth-child(2){display:none}
 #content .capacity{font-size:12px}
 #content .run{grid-template-columns:90px minmax(28px,1fr) 50px}
 #content .run-state{display:none}
 #content .detail{font-size:14px}
}
@media(max-height:700px){
 #content[data-layout="paged"] .overview{display:none}
 #content[data-layout="paged"][data-view="current"]>.progress-pane{grid-template-rows:auto minmax(0,1fr)}
 #content[data-layout="paged"] .active-body{padding:10px 14px;gap:7px}
 #content[data-layout="paged"] .detail{font-size:14px;margin:7px 0}
 #content[data-layout="paged"] .active-name,#content[data-layout="paged"] .active-percent{font-size:24px}
 #content[data-layout="paged"] .run{min-height:24px;padding:3px 0}
 #content[data-layout="paged"] .guard-title{font-size:15px;margin-bottom:8px}
 #content[data-layout="paged"] .guard-metrics{font-size:14px;gap:7px 18px;line-height:1.4}
 #content[data-layout="paged"] .guard-note{font-size:13px;line-height:1.4;margin-top:10px}
 #content[data-layout="paged"] .bottom{gap:8px 18px}
 #content[data-layout="paged"] .capacity{display:none}
}
@media(max-height:450px){
 body[data-workspace="nucleosome-c"] .title-row{display:none}
 body[data-workspace="nucleosome-c"]>main{grid-template-rows:minmax(0,1fr)}
 #content #stages .stage{grid-template-rows:76px minmax(0,1fr);padding:8px 12px}
 #content .stage-header{gap:2px}
 #content .stage-summary{min-height:20px;line-height:1.3}
 #content .stage-name{font-size:16px}
 #content .stage-line{margin-bottom:4px}
}
@media(max-height:450px) and (min-width:600px){
 #content[data-layout="paged"] .active-body{padding:7px 12px;gap:4px}
 #content[data-layout="paged"] .active-top{margin-bottom:2px}
 #content[data-layout="paged"] .active-body dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 20px}
 #content[data-layout="paged"] .detail{display:block;margin:0}
 #content[data-layout="paged"] .detail dt{font-size:13px}
 #content[data-layout="paged"] .detail dd{text-align:left}
 #content[data-layout="paged"] .guard-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}
}
`;

// Fit each visible panel to the viewport. Additional details remain reachable
// through buttons; a smaller screen never requires a smaller reading font.
export function createFittedLayout(doc, win) {
  if(typeof doc.querySelectorAll!=="function")return {update(){}};
  const root=doc.getElementById("content"),stages=doc.getElementById("stages");
  const state={view:"current",progress:"current",anchor:2,details:{},activity:0};
  let scheduled=false;
  function buttonState(selector,value,key){doc.querySelectorAll(selector).forEach(b=>b.setAttribute("aria-pressed",String(b.dataset[key]===value)))}
  function paginate(list,rows,pager,key,position){
    rows.forEach(r=>r.hidden=false);pager.hidden=true;
    if(!list.clientHeight)return true;
    const height=()=>rows.map(r=>r.getBoundingClientRect().height+parseFloat(win.getComputedStyle(r).marginBottom||0));
    let sizes=height(),room=list.clientHeight;
    if(sizes.reduce((a,b)=>a+b,0)<=room+1){position(0);return true}
    pager.hidden=false;room=list.clientHeight;sizes=height();
    const pages=[];let page=[],used=0;
    rows.forEach((r,i)=>{if(page.length&&used+sizes[i]>room){pages.push(page);page=[];used=0}page.push(i);used+=sizes[i]});
    if(page.length)pages.push(page);
    const index=Math.min(Math.max(0,key()),Math.max(0,pages.length-1));position(index);
    rows.forEach((r,i)=>r.hidden=!pages[index]?.includes(i));
    const prev=pager.querySelector('[data-detail-direction="-1"]'),next=pager.querySelector('[data-detail-direction="1"]');
    prev.disabled=index===0;next.disabled=index===pages.length-1;
    pager.querySelector(".page-count").textContent=(index+1)+" / "+pages.length;
    prev.onclick=()=>{position(index-1);update()};next.onclick=()=>{position(index+1);update()};
    return sizes.every(size=>size<=room+1);
  }
  function update(forcePaged=false){
    if(root.hidden)return;
    const full=!forcePaged&&win.innerWidth>=1250&&win.innerHeight>=1000;
    root.dataset.layout=full?"full":"paged";root.dataset.view=state.view;root.dataset.progress=state.progress;
    buttonState("[data-dashboard-view]",state.view,"dashboardView");buttonState("[data-progress-view]",state.progress,"progressView");
    const cards=[...stages.children],columns=full?6:win.innerHeight<600?1:win.innerWidth>=1000?3:win.innerWidth>=650?2:1;
    stages.style.setProperty("--stage-columns",columns);
    const first=Math.floor(Math.max(0,Math.min(state.anchor,cards.length-1))/columns)*columns;
    cards.forEach((card,i)=>card.hidden=i<first||i>=first+columns);
    const navigation=doc.getElementById("stage-navigation-controls");navigation.hidden=columns>=cards.length;
    doc.getElementById("stage-page-count").textContent=(first+1)+(columns>1?"–"+Math.min(first+columns,cards.length):"")+" / "+cards.length;
    doc.getElementById("stage-prev").disabled=first===0;doc.getElementById("stage-next").disabled=first+columns>=cards.length;
    doc.getElementById("stage-prev").onclick=()=>{state.anchor=Math.max(0,first-columns);update()};
    doc.getElementById("stage-next").onclick=()=>{state.anchor=Math.min(cards.length-1,first+columns);update()};
    let detailsFit=true;
    cards.filter(c=>!c.hidden).forEach(card=>{
      const id=card.dataset.stageId,list=card.querySelector(".stage-details-list"),pager=card.querySelector(".detail-pages");
      if(!paginate(list,[...list.children],pager,()=>state.details[id]||0,n=>state.details[id]=n))detailsFit=false;
    });
    if(full&&(!detailsFit||root.scrollHeight>root.clientHeight+1)){update(true);return}
    const activity=doc.getElementById("next"),pager=doc.getElementById("activity-pages");
    if(!full&&state.view==="activity")paginate(activity,[...activity.children],pager,()=>state.activity,n=>state.activity=n);
    else{[...activity.children].forEach(r=>r.hidden=false);pager.hidden=true}
  }
  doc.querySelectorAll("[data-dashboard-view]").forEach(b=>b.addEventListener("click",()=>{state.view=b.dataset.dashboardView;update()}));
  doc.querySelectorAll("[data-progress-view]").forEach(b=>b.addEventListener("click",()=>{state.progress=b.dataset.progressView;update()}));
  function queue(){if(scheduled)return;scheduled=true;win.requestAnimationFrame(()=>{scheduled=false;update()})}
  win.addEventListener("resize",queue);
  if(typeof win.ResizeObserver==="function")new win.ResizeObserver(queue).observe(root);
  return {update:queue};
}
