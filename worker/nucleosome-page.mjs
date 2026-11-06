export const DASHBOARD_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="robots" content="noindex,nofollow">
<title>SPARK BMC-LMU · Nucleosome progress</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='4' fill='%230f1115'/%3E%3Cpath d='M7 24V8h5l8 12V8h5v16h-5L12 12v12z' fill='%2378bf8a'/%3E%3C/svg%3E">
<style>
:root{color-scheme:dark;--bg:#0f1115;--panel:#15181e;--border:#2b3039;--text:#d9dce3;--muted:#9098a6;--green:#86c99a;--amber:#e5bd78;--cyan:#86bbcf;--purple:#b3a4df;--red:#e68c8c;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace;font-size:14px;font-synthesis:none}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);line-height:1.5}button{font:inherit}header{border-bottom:1px solid var(--border)}.header-inner{max-width:1240px;margin:auto;display:flex;justify-content:space-between;align-items:center;padding:19px 32px;gap:16px}.brand{font-size:15px;font-weight:650;letter-spacing:.045em}.header-time{font-variant-numeric:tabular-nums;color:var(--muted);font-size:15px}main{max-width:1240px;margin:0 auto;padding:30px 32px 28px}.title-row{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:22px}h1{font-size:19px;letter-spacing:-.04em;font-weight:550;margin:0}h1 span{color:var(--muted);font-weight:400}.feed{display:flex;gap:8px;align-items:center;color:var(--muted);font-size:11px}.dot{width:7px;height:7px;background:var(--muted);display:inline-block;border-radius:50%;flex-shrink:0}.dot.green{background:var(--green)}.dot.amber{background:var(--amber)}.overview{display:grid;grid-template-columns:1.65fr 1fr 1fr;border:1px solid var(--border);background:var(--panel);margin-bottom:20px}.metric{padding:22px 24px;min-width:0}.metric+.metric{border-left:1px solid var(--border)}.eyebrow{color:var(--muted);font-size:11px;letter-spacing:.075em;text-transform:uppercase}.value{font-size:40px;letter-spacing:-.07em;line-height:1.2;font-weight:550;margin:7px 0 8px;font-variant-numeric:tabular-nums}.value.green{color:var(--green)}.value .small{font-size:20px;letter-spacing:-.03em;color:var(--muted)}.metric-note{font-size:12px;color:var(--muted)}.total-bar{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;height:9px;margin-top:17px}.total-segment{background:#282e36;overflow:hidden}.total-segment i{height:100%;display:block;background:var(--green)}.total-segment.current i{background:var(--cyan)}.attention{border:1px solid #594b33;background:#201c16;color:var(--amber);padding:12px 17px;display:flex;gap:18px;align-items:center;justify-content:space-between;font-size:12px;margin-bottom:20px}.attention-main{display:flex;align-items:center;gap:10px}.attention-meta{color:#bdab8d;font-size:11px;text-align:right}.grid{display:grid;grid-template-columns:1.65fr 1fr;gap:20px}.panel{border:1px solid var(--border);background:var(--panel);min-width:0}.panel-head{padding:14px 18px;border-bottom:1px solid var(--border);display:flex;gap:16px;justify-content:space-between;align-items:center}.panel-title{font-size:12px;letter-spacing:.035em;font-weight:550;margin:0}.panel-hint{font-size:10px;color:var(--muted)}.runs{padding:4px 18px 7px}.run{display:grid;grid-template-columns:83px minmax(60px,1fr) 47px 86px;gap:13px;align-items:center;padding:16px 0;min-height:64px}.run+.run{border-top:1px solid #242932}.run-label{font-size:12px}.run-label span{color:var(--muted)}.run-track{background:#292f37;height:7px;overflow:hidden}.run-fill{height:100%;background:var(--green)}.run-fill.current{background:var(--cyan)}.run-fill.failed{background:var(--red)}.run-percent{text-align:right;font-size:12px;font-variant-numeric:tabular-nums}.run-state{text-align:right;font-size:11px;color:var(--muted)}.run-state.complete{color:var(--green)}.run-state.current{color:var(--cyan)}.run-state.failed{color:var(--red)}.side{display:flex;flex-direction:column;gap:20px}.active-body{padding:17px 18px 18px}.active-top{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:16px;gap:15px}.active-name{font-size:20px;color:var(--cyan)}.active-percent{font-size:23px;font-variant-numeric:tabular-nums;color:var(--cyan)}.detail{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:11px;margin:9px 0}.detail dt{color:var(--muted)}.detail dd{margin:0;text-align:right}.green{color:var(--green)}.amber{color:var(--amber)}.red{color:var(--red)}.muted{color:var(--muted)}dl{margin:0}.chart-body{padding:15px 18px 11px}svg.history{width:100%;height:122px;display:block;overflow:visible}.chart-labels{display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-top:7px}.stages{display:grid;grid-template-columns:repeat(6,1fr);gap:0;margin-top:20px;border:1px solid var(--border);background:var(--panel)}.stage{padding:17px 15px;position:relative;min-width:0}.stage+.stage{border-left:1px solid var(--border)}.stage-number{font-size:10px;color:var(--muted);margin-bottom:7px}.stage-name{font-size:11px;white-space:nowrap}.stage-state{font-size:10px;margin-top:6px;color:var(--muted)}.stage-state.complete{color:var(--green)}.stage-state.in_progress{color:var(--cyan)}.stage-line{height:3px;margin-top:14px;background:#2a3038}.stage-line i{display:block;height:100%;background:var(--green)}.stage-line.current i{background:var(--cyan)}.next{margin-top:20px;display:flex;align-items:baseline;gap:16px;font-size:12px;padding:15px 18px;border:1px solid var(--border)}.next-label{color:var(--cyan);font-size:10px;letter-spacing:.1em;flex-shrink:0}.next-text{line-height:1.7}.next-text span{color:var(--muted)}.bottom{display:flex;align-items:center;justify-content:space-between;gap:15px;color:var(--muted);font-size:10px;margin-top:20px}.bottom-left{display:flex;gap:18px;flex-wrap:wrap}.refresh{background:transparent;border:1px solid var(--border);color:var(--muted);padding:5px 9px;cursor:pointer}.refresh:hover{border-color:var(--muted);color:var(--text)}.refresh:focus-visible{outline:2px solid var(--cyan);outline-offset:3px}.refresh:disabled{opacity:.5;cursor:wait}.loading{padding:45px 0;color:var(--muted);font-size:12px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}[hidden]{display:none!important}
@media(min-width:1450px){main{padding-top:40px}.value{font-size:46px}.run{padding:19px 0}.header-inner{padding-top:22px;padding-bottom:22px}}
@media(max-width:860px){main{padding:24px 20px}.header-inner{padding:17px 20px}.overview{grid-template-columns:1.4fr 1fr 1fr}.metric{padding:18px 17px}.value{font-size:33px}.grid{grid-template-columns:1fr}.side{display:grid;grid-template-columns:1fr 1fr}.stages{grid-template-columns:repeat(3,1fr)}.stage:nth-child(4){border-left:0}.stage:nth-child(n+4){border-top:1px solid var(--border)}.attention{align-items:flex-start}.run{grid-template-columns:95px minmax(60px,1fr) 55px 95px;padding:15px 0}.title-row{align-items:flex-start}}
@media(max-width:540px){:root{font-size:13px}.header-inner{padding:15px 16px}.brand,.header-time{font-size:12px}main{padding:21px 16px}.title-row{display:block;margin-bottom:18px}h1{font-size:17px}.feed{margin-top:8px;font-size:10px}.overview{grid-template-columns:1fr 1fr}.metric:first-child{grid-column:1/-1;border-bottom:1px solid var(--border);padding:19px}.metric:nth-child(2){border-left:0}.metric{padding:17px 19px}.value{font-size:32px}.metric:first-child .value{font-size:48px}.metric-note{font-size:10px}.attention{display:block;padding:12px 14px}.attention-meta{margin:5px 0 0 17px;text-align:left;font-size:10px}.side{display:flex;gap:20px}.run{grid-template-columns:76px minmax(35px,1fr) 43px 72px;gap:9px}.run-state{font-size:10px}.runs{padding-left:14px;padding-right:14px}.run-label{font-size:11px}.stage{padding:13px 10px}.stage-name{font-size:10px}.stage-state{font-size:9px}.next{gap:12px;padding:12px 14px;font-size:11px}.bottom{align-items:flex-start}.bottom-left{display:block}.bottom-left span{display:block;margin-bottom:5px}}
@media(prefers-reduced-motion:no-preference){.run-fill,.total-segment i{transition:width .45s ease}}
</style>
</head>
<body>
<header><div class="header-inner"><div class="brand">SPARK BMC-LMU</div><time id="updated" class="header-time" aria-label="Information update time in Berlin">------------</time></div></header>
<main>
<div class="title-row"><h1>Nucleosome <span>/ progress</span></h1><div class="feed"><i class="dot" id="feed-dot" aria-hidden="true"></i><span id="feed-state" role="status">Connecting</span></div></div>
<div id="loading" class="loading" role="status">Loading progress…</div>
<div id="content" hidden>
<section class="overview" aria-label="Baseline overview">
<div class="metric"><div class="eyebrow">Baseline simulations</div><div class="value green" id="overall">—</div><div class="metric-note" id="saved-total">—</div><div class="total-bar" id="total-bar" role="progressbar" aria-label="Overall saved simulation steps" aria-valuemin="0" aria-valuemax="100"></div></div>
<div class="metric"><div class="eyebrow">Runs complete</div><div class="value" id="finished">—</div><div class="metric-note" id="finished-note">—</div></div>
<div class="metric"><div class="eyebrow">Steps remaining</div><div class="value" id="remaining">—</div><div class="metric-note" id="remaining-note">—</div></div>
</section>
<div class="attention" id="attention" role="status"><div class="attention-main"><i class="dot amber" aria-hidden="true"></i><span id="attention-title">—</span></div><div class="attention-meta" id="attention-meta">—</div></div>
<div class="grid">
<section class="panel" aria-labelledby="runs-heading"><div class="panel-head"><h2 class="panel-title" id="runs-heading">All runs</h2><span class="panel-hint">100,000 steps each</span></div><div class="runs" id="runs"></div></section>
<div class="side">
<section class="panel" aria-labelledby="active-heading"><div class="panel-head"><h2 class="panel-title" id="active-heading">Current checkpoint</h2><span class="panel-hint" id="active-status">—</span></div><div class="active-body"><div class="active-top"><span class="active-name" id="active-name">—</span><span class="active-percent" id="active-percent">—</span></div><dl><div class="detail"><dt>Saved steps</dt><dd id="active-steps">—</dd></div><div class="detail"><dt>Guards</dt><dd id="active-guards">—</dd></div><div class="detail"><dt>Checkpoint</dt><dd id="active-at">—</dd></div><div class="detail"><dt>Runtime</dt><dd class="amber" id="runtime">Unconfirmed</dd></div></dl></div></section>
<section class="panel" aria-labelledby="history-heading"><div class="panel-head"><h2 class="panel-title" id="history-heading">Saved progress</h2><span class="panel-hint" id="history-total">—</span></div><div class="chart-body"><svg id="history" class="history" viewBox="0 0 360 122" role="img" aria-label="Cumulative saved simulation progress"></svg><div class="chart-labels"><span id="history-start">—</span><span id="history-end">—</span></div></div></section>
</div>
</div>
<section class="stages" id="stages" aria-label="Study stages"></section>
<div class="next"><span class="next-label">NEXT</span><div class="next-text" id="next">—</div></div>
<footer class="bottom"><div class="bottom-left"><span id="watchdog">Watchdog: —</span><span id="checked">—</span><span>Refresh: 30s</span></div><button class="refresh" id="refresh" type="button">Refresh ↻</button></footer>
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
  var stageLabels={audit:'Audit & setup',baseline:'Baseline',components:'Components',pulling:'Pulling',heldout:'Validation',conclusions:'Results'};
  function parts(value){return new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Berlin',month:'2-digit',day:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).reduce(function(a,p){a[p.type]=p.value;return a},{})}
  function stamp(value){var p=parts(value);return p.month+p.day+p.year+p.hour+p.minute}
  function time(value){return new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit',timeZoneName:'short',hourCycle:'h23'}).format(new Date(value))}
  function day(value){return new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',day:'numeric',month:'short'}).format(new Date(value))}
  function age(value){var m=Math.max(0,Math.floor((Date.now()-Date.parse(value))/60000));return m<1?'just now':m<60?m+'m ago':m<1440?Math.floor(m/60)+'h '+m%60+'m ago':Math.floor(m/1440)+'d '+Math.floor(m%1440/60)+'h ago'}
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
    $('remaining').textContent=nf.format(jobs.filter(function(j){return j.status!=='guard_stop'}).reduce(function(s,j){return s+j.cap-j.step},0));
    $('remaining-note').textContent=(total/1000).toFixed(0)+' / 600 ps saved';
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
    $('runtime').textContent=done+stops===6?'Tranche finished':'Unconfirmed';
    $('runtime').className=done+stops===6?'green':'amber';
    $('attention').hidden=done+stops===6&&!stops;
    $('attention-title').textContent=stops?'Guard stop recorded':stale?'Runtime access needed':'Awaiting current runtime update';
    $('attention-meta').textContent=current&&current.checkpoint_at?'Last checkpoint '+age(current.checkpoint_at):'Next run queued';
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
    data.stages.forEach(function(stage,index){var card=node('div','stage');card.append(node('div','stage-number','0'+(index+1)));card.append(node('div','stage-name',stageLabels[stage.id]));var state=stage.id==='baseline'&&stage.state==='in_progress'?pct.toFixed(1)+'%':stage.state==='complete'?'✓ complete':stage.state==='in_progress'?'in progress':stage.state==='guard_stop'?'guard stop':'pending';card.append(node('div','stage-state '+stage.state,state));var line=node('div','stage-line'+(stage.state==='in_progress'?' current':'')),fill=node('i');fill.style.width=stage.state==='complete'?'100%':stage.id==='baseline'?pct+'%':'0%';line.append(fill);card.append(line);stages.append(card)});
    var todo=[];
    if(stops)todo.push('Review guard stop');
    if(done+stops<6)todo.push('Confirm runtime');
    jobs.filter(function(j){return !['completed','guard_stop'].includes(j.status)}).forEach(function(j){todo.push((j.step?'Finish ':'Run ')+labels[j.id])});
    if(!todo.length){var pending=data.stages.find(function(s){return s.state!=='complete'});todo.push(pending?stageLabels[pending.id]:'Review results')}
    $('next').replaceChildren();todo.slice(0,4).forEach(function(item,index){if(index)$('next').append(node('span',null,' → '));$('next').append(document.createTextNode(item))});
    $('watchdog').textContent='Watchdog: '+(data.watchdog_armed?'armed':'awaiting install');
    $('watchdog').className=data.watchdog_armed?'green':'amber';
    $('checked').textContent='Information updated '+age(data.information_updated_at);
    var feedStale=Date.now()-Date.parse(data.information_updated_at)>900000;
    $('feed-dot').className='dot '+(failed||feedStale||data.feed_mode!=='automatic'?'amber':'green');
    $('feed-state').textContent=failed?'Refresh failed · saved data':data.feed_mode!=='automatic'?'Saved snapshot':feedStale?'Feed update overdue':'Feed connected';
    $('loading').hidden=true;$('content').hidden=false;
  }
  async function refresh(){
    if(busy)return;busy=true;$('refresh').disabled=true;
    try{var response=await fetch('/api/nucleosome-progress',{cache:'no-store',signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error('HTTP '+response.status);var next=await response.json();if(!next.jobs||next.jobs.length!==6||!next.information_updated_at)throw new Error('Invalid progress');data=next;lastRead=Date.now();failed=false;render()}
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
