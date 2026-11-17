import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { validateSnapshot, publicSnapshot } from "../worker/nucleosome-progress.mjs";
import { DASHBOARD_HTML } from "../worker/nucleosome-page.mjs";
function snapshot(){
 const at=new Date().toISOString();
 const controls=["free-601-A","free-601-B","free-601-C","free-control-A","free-control-B","free-control-C","apo-A","apo-B","apo-C"].map(id=>({id,step:0,status:"queued",guard_rows:0,guards_pass:null,native_step:null,checkpoint_at:null}));
 for(const id of ["apo-A","apo-B"])Object.assign(controls.find(j=>j.id===id),{step:100000,status:"completed",guard_rows:5001,guards_pass:true,native_step:100000,checkpoint_at:at});
 Object.assign(controls[8],{step:120,status:"checkpoint",guard_rows:7,guards_pass:true,native_step:0,checkpoint_at:at,runtime:{at,identity_verified:true,advancing:true}});
 return {version:1,information_updated_at:at,source_revision:"1".repeat(40),watchdog_armed:true,
  jobs:["601-A","control-A","601-B","control-B","601-C","control-C"].map(id=>({id,step:100000,status:"completed",checkpoint_at:at,guards_pass:true})),
  stages:["audit","baseline","components","pulling","heldout","conclusions"].map(id=>({id,state:["audit","baseline"].includes(id)?"complete":id==="components"?"in_progress":"pending"})),
  controls,activities:[{label:"Apo C",detail:"120 saved steps; guards pass",state:"active"},{label:"Library",detail:"Verifying file recovery",state:"active"}],next_actions:["Finish apo C"],history:[]};
}
test("the real public snapshot retains controls and bottom activity fields",()=>{
 const input=snapshot(); const data=publicSnapshot(validateSnapshot({...input,private_vm_source:"discard"}),"automatic");
 assert.equal(data.total_steps,600000);assert.equal(data.controls[8].step,120);
 assert.deepEqual(data.activities,input.activities);assert.deepEqual(data.next_actions,["Finish apo C"]);
 assert.equal(data.private_vm_source,undefined);
});
async function renderSnapshot(input,Clock=Date){
 const data=publicSnapshot(validateSnapshot(input),"automatic"), elements=new Map();
 class Element {
  constructor(){this.children=[];this.style={};this.textContent="";}
  append(...v){this.children.push(...v)}
  replaceChildren(...v){this.children=v;this.textContent=""}
  setAttribute(){}
  addEventListener(){}
 }
 const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)};
 const document={hidden:false,getElementById:get,createElement:()=>new Element(),createElementNS:()=>new Element(),createTextNode:t=>({textContent:t}),addEventListener(){}};
 const context={document,window:{addEventListener(){},location:{assign(){},href:"https://spark.bioengineering.workers.dev/"}},Intl,Date:Clock,URL,AbortSignal,console,
  fetch:async()=>({ok:true,status:200,json:async()=>data}),setInterval(){}};
 vm.runInNewContext(DASHBOARD_HTML.split("<script>")[1].split("</script>")[0],context);
 await new Promise(resolve=>setImmediate(resolve));
 const text=e=>e.textContent+(e.children||[]).map(text).join("");
 return {get,text,elements};
}
test("the real dashboard renders current apo progress and activities after baseline completion",async()=>{
 const {get,text}=await renderSnapshot(snapshot());
 assert.equal(get("active-name").textContent,"Apo C");assert.match(get("active-steps").textContent,/120/);
 assert.match(text(get("stages")),/2 \/ 9 complete.*Apo C 0.1%/);
 assert.match(text(get("next")),/Library: Verifying file recovery/);assert.match(text(get("next")),/Finish apo C/);
 assert.match(get("runtime").textContent,/Updated/);
 assert.equal(get("activity-label").textContent,"NOW / NEXT");
});
test("guard footer shows saved checks, checkpoint and last update without runtime notices",async()=>{
 const input=snapshot(),confirmed=input.information_updated_at;
 input.guard_summary={armed:true,controller_confirmed_at:confirmed,controller_deadline_at:new Date(Date.parse(confirmed)+9000000).toISOString(),timeout_seconds:9000,guard_interval_steps:20,checkpoint_interval_steps:1000};
 input.compute_rate={from:new Date(Date.parse(confirmed)-100000).toISOString(),to:confirmed,steps:50,steps_per_second:0.5,cpu_model:"TEST",threads:4,logical_cpus:4,cpu_quota:4,memory_gib:16};
 const {get,elements}=await renderSnapshot(input);
 assert.match(get("watchdog").textContent,/Saved computation guards pass/);
 assert.match(get("guard-checks").textContent,/7 \/ 7 passed/);assert.match(get("native-recovery").textContent,/0 steps/);
 assert.match(get("controller-confirmed").textContent,/Last update/);assert.match(get("controller-deadline").textContent,/Checkpoint interval/);
 assert.match(get("guard-note").textContent,/20 steps.*1,000 steps/);
 assert.doesNotMatch(DASHBOARD_HTML,/unconfirmed|Runtime observation overdue|Confirm runtime/);
 assert.equal(elements.has("hardware"),false);assert.doesNotMatch(DASHBOARD_HTML,/id="hardware"|properties awaiting verification/);
});
test("an older observation shows its update age and recorded guards without runtime notices",async()=>{
 const input=snapshot(),confirmed=input.information_updated_at;
 input.guard_summary={armed:true,controller_confirmed_at:confirmed,controller_deadline_at:new Date(Date.parse(confirmed)+9000000).toISOString(),timeout_seconds:9000,guard_interval_steps:20,checkpoint_interval_steps:1000};
 class Later extends Date {static now(){return Date.parse(confirmed)+9001000}}
 const {get}=await renderSnapshot(input,Later);
 assert.equal(get("watchdog").textContent,"Saved computation guards pass");
 assert.match(get("runtime").textContent,/Updated/);
 assert.equal(get("runtime").className,"amber");
 assert.match(get("controller-confirmed").textContent,/Last update/);
 assert.doesNotMatch(get("watchdog").textContent,/stopped|dead|expired/i);
});
test("both control columns mirror the baseline bars while retaining stopped and queued evidence",async()=>{
 const input=snapshot();Object.assign(input.controls[0],{step:8880,status:"stopped",guard_rows:445,guards_pass:true,native_step:8000,checkpoint_at:input.information_updated_at});
 const {get}=await renderSnapshot(input),apo=get("apo-runs").children,dna=get("dna-runs").children;
 assert.equal(apo.length,3);assert.equal(dna.length,6);assert.equal(get("controls-complete").textContent,"2 / 9 complete");
 for(const row of apo.slice(0,2)){assert.equal(row.children[1].children[0].style.width,"100%");assert.equal(row.children[2].textContent,"100%");assert.equal(row.children[3].textContent,"✓ done")}
 assert.equal(apo[2].children[1].children[0].style.width,"0.12%");assert.equal(apo[2].children[3].textContent,"Active");
 assert.match(apo[2].children[3].title,/Active at the source observation/);
 assert.equal(dna[0].children[1].children[0].style.width,"8.88%");assert.equal(dna[0].children[3].textContent,"stopped");
 assert.equal(dna[1].children[1].children[0].style.width,"0%");assert.equal(dna[1].children[3].textContent,"queued");
});

test("an older active observation retains its recorded status and visible update age",async()=>{
 const input=snapshot(),at=input.information_updated_at;
 class Later extends Date {static now(){return Date.parse(at)+600000}}
 const {get}=await renderSnapshot(input,Later);
 assert.equal(get("apo-runs").children[2].children[3].textContent,"Active");
 assert.match(get("apo-runs").children[2].children[3].title,/source observation/);
 assert.equal(get("runtime").className,"amber");
 assert.match(get("runtime").textContent,/Updated 10m ago/);
});

