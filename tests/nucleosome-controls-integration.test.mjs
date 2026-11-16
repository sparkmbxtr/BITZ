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
test("the real dashboard renders current apo progress and activities after baseline completion",async()=>{
 const data=publicSnapshot(validateSnapshot(snapshot()),"automatic"), elements=new Map();
 class Element {
  constructor(){this.children=[];this.style={};this.textContent="";}
  append(...v){this.children.push(...v)}
  replaceChildren(...v){this.children=v;this.textContent=""}
  setAttribute(){}
  addEventListener(){}
 }
 const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)};
 const document={hidden:false,getElementById:get,createElement:()=>new Element(),createElementNS:()=>new Element(),createTextNode:t=>({textContent:t}),addEventListener(){}};
 const context={document,window:{addEventListener(){},location:{assign(){},href:"https://spark.bioengineering.workers.dev/"}},Intl,Date,URL,AbortSignal,console,
  fetch:async()=>({ok:true,status:200,json:async()=>data}),setInterval(){}};
 vm.runInNewContext(DASHBOARD_HTML.split("<script>")[1].split("</script>")[0],context);
 await new Promise(resolve=>setImmediate(resolve));
 const text=e=>e.textContent+(e.children||[]).map(text).join("");
 assert.equal(get("active-name").textContent,"Apo C");assert.match(get("active-steps").textContent,/120/);
 assert.match(text(get("stages")),/2 \/ 9 complete.*Apo C 0.1%/);
 assert.match(text(get("next")),/Library: Verifying file recovery/);assert.match(text(get("next")),/Finish apo C/);
 assert.match(get("runtime").textContent,/Advancing/);
 assert.equal(get("activity-label").textContent,"NOW / NEXT");
});

