import assert from "node:assert/strict";
import test from "node:test";
import {stagePresentation} from "../worker/nucleosome-stage-details.mjs";
const baseline=()=>["601-A","control-A","601-B","control-B","601-C","control-C"].map(id=>({id,step:100000,status:"completed",guards_pass:true}));
const controls=()=>["free-601-A","free-601-B","free-601-C","free-control-A","free-control-B","free-control-C","apo-A","apo-B","apo-C"].map(id=>({id,step:0,status:"queued",native_step:null}));
test("stage details distinguish finished apo replicas, current work and a stopped observation tail",()=>{
 const jobs=controls();
 for(const j of jobs.slice(6,8))Object.assign(j,{status:"completed",step:100000,native_step:100000});
 Object.assign(jobs[8],{status:"checkpoint",step:16580,native_step:16000});
 Object.assign(jobs[0],{status:"stopped",step:8880,native_step:8000});
 const model=stagePresentation({id:"components",state:"in_progress"},{jobs:baseline(),controls:jobs});
 assert.equal(model.status,"In progress");assert.equal(model.summary,"2 / 9 complete · Apo C 16.6%");
 const text=model.rows.map(r=>r.text).join("\n");
 assert.match(text,/Apo A: finished 100,000 steps/);assert.match(text,/Apo B: finished 100,000 steps/);
 assert.match(text,/Apo C: 16,580 \/ 100,000 saved/);
 assert.match(text,/601 DNA A: stopped at 8,880, native 8,000/);assert.match(text,/5 DNA replicas not started/);
});
test("completed apo details make room for the next live DNA control without claiming all controls finished",()=>{
 const jobs=controls();for(const j of jobs.slice(6))Object.assign(j,{status:"completed",step:100000,native_step:100000});
 Object.assign(jobs[1],{status:"checkpoint",step:40,native_step:0});
 const model=stagePresentation({id:"components",state:"in_progress"},{jobs:baseline(),controls:jobs});
 assert.match(model.summary,/3 \/ 9 complete.*601 DNA B/);
 assert.equal(model.rows.filter(r=>r.text.startsWith("Apo")).length,1);
 assert.ok(model.rows.some(r=>r.text==="601 DNA B: 40 / 100,000 saved."));
});
test("baseline completion is separate from pending conditional stages",()=>{
 const data={jobs:baseline()};
 const baselineModel=stagePresentation({id:"baseline",state:"complete"},data);
 assert.equal(baselineModel.summary,"6 / 6 runs finished");assert.equal(baselineModel.percent,100);
 for(const id of ["pulling","heldout","conclusions"]){
  const model=stagePresentation({id,state:"pending"},data);
  assert.equal(model.status,"Pending");assert.equal(model.percent,0);
 }
 assert.ok(stagePresentation({id:"pulling",state:"pending"},data).rows.some(r=>r.text.includes("only if triggered")));
 assert.ok(stagePresentation({id:"heldout",state:"pending"},data).rows.some(r=>r.text.includes("conditional capacity")));
});
test("single-view concise details preserve actual completion and the earlier native DNA recovery point",()=>{
 const jobs=controls();for(const j of jobs.slice(6,8))Object.assign(j,{status:"completed",step:100000,native_step:100000});
 Object.assign(jobs[8],{status:"checkpoint",step:23980,native_step:23000});Object.assign(jobs[0],{status:"stopped",step:8880,native_step:8000});
 for(const density of [1,2]){
  const model=stagePresentation({id:"components",state:"in_progress"},{jobs:baseline(),controls:jobs},density),text=model.rows.map(r=>r.text).join(" ");
  assert.match(text,/A\/B/);assert.match(text,/native 8,000/);assert.doesNotMatch(text,/native 8,880/);
  assert.match(model.summary,/Apo C 24.0%/);
 }
 const smallest=stagePresentation({id:"components",state:"in_progress"},{jobs:baseline(),controls:jobs},3);
 assert.equal(smallest.status,"2 / 9 done");assert.match(smallest.rows[0].text,/A\/B done; DNA stop/);
});
test("condensing details never marks queued controls or pending stages complete",()=>{
 for(const density of [1,2,3]){
  const model=stagePresentation({id:"components",state:"in_progress"},{jobs:baseline(),controls:controls()},density);
  assert.doesNotMatch(model.rows.map(r=>r.text).join(" "),/A\/B.*done|A\/B.*complete/);
  assert.equal(stagePresentation({id:"heldout",state:"pending"},{jobs:baseline()},density).status,"Pending");
  assert.match(stagePresentation({id:"heldout",state:"pending"},{jobs:baseline()},density).rows.map(r=>r.text).join(" "),/conditional/);
 }
});
test("completed controls never appear pending or queued at any layout density",()=>{
 const rows=controls().map(j=>({...j,status:"completed",step:100000,native_step:100000}));
 for(const density of [0,1,2,3]){
  const model=stagePresentation({id:"components",state:"complete"},{jobs:baseline(),controls:rows},density);
  assert.equal(model.percent,100);
  assert.match(model.summary,/9 \/ 9 complete/);
  assert.doesNotMatch(model.rows.map(r=>r.text).join(" "),/pending|queued|not started/i);
  if(density>=2)assert.match(model.rows.map(r=>r.text).join(" "),/DNA:? 6\s*\/\s*6/);
 }
});
test("compact control details distinguish partial DNA completion from queued work",()=>{
 const rows=controls();
 for(const j of [...rows.slice(0,2),...rows.slice(6)])Object.assign(j,{status:"completed",step:100000,native_step:100000});
 Object.assign(rows[2],{status:"checkpoint",step:1600,native_step:1000});
 for(const density of [2,3]){
  const model=stagePresentation({id:"components",state:"in_progress"},{jobs:baseline(),controls:rows},density);
  assert.equal(model.status,"5 / 9 done");
  assert.match(model.rows.map(r=>r.text).join(" "),/DNA:? 2\s*\/\s*6/);
  assert.ok(model.percent<100);
 }
});
