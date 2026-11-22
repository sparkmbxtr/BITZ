import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import {validateValidationData, validationDataPresentation} from "../worker/nucleosome-validation-data.mjs";
import {validateSnapshot, publicSnapshot, routeNucleosomeProgress} from "../worker/nucleosome-progress.mjs";
import {INITIAL_SNAPSHOT} from "../worker/nucleosome-snapshot.mjs";
import {DASHBOARD_HTML} from "../worker/nucleosome-page.mjs";

const at="2025-01-01T00:00:00Z";
const initial=()=>({version:1,budget_approved:false,dt_fs:1,sample_interval_steps:20,force_pN:0,
  models:["exact_601","matched_control"].map(id=>({id,step:0,cap:5000,status:"prepared",guards_pass:null,recorded_at:null}))});
const recorded=(step,status="running")=>({step,status,guards_pass:status!=="stopped",recorded_at:at});
function addPlan(snapshot){
 snapshot.activities=[{label:"Validation data",state:"blocked",detail:"Prepared; awaiting budget approval.",
  validation_data:validateValidationData(initial(),snapshot.information_updated_at)}];
 return snapshot;
}

test("prepared plans stay zero with an explicit pending-approval state",()=>{
 const value=validateValidationData(initial(),at),view=validationDataPresentation(value);
 assert.equal(value.status,"prepared");assert.equal(view.status,"Awaiting budget approval");
 assert.equal(view.total,0);assert.equal(view.cap,10000);assert.equal(view.percent,0);
 assert.ok(view.rows.every(r=>r.step===0&&r.percent===0&&r.time_ps===0&&r.duration_ps===5));
});

test("missing plans show unknown rather than invented progress",()=>{
 assert.equal(validationDataPresentation(null).percent,null);
 assert.deepEqual(validationDataPresentation(null).rows,[]);
});

test("a budget-unapproved plan cannot claim recording or completion",()=>{
 for(const status of ["running","completed","stopped"]){
  const x=initial();Object.assign(x.models[0],recorded(status==="completed"?5000:20,status));
  assert.throws(()=>validateValidationData(x,at),/Validation data/);
 }
});

test("actual saved counts set green-bar percentages independently of plans",()=>{
 const x=initial();x.budget_approved=true;Object.assign(x.models[0],recorded(1000));
 const view=validationDataPresentation(validateValidationData(x,at));
 assert.equal(view.status,"Recording");assert.equal(view.rows[0].percent,20);
 assert.equal(view.rows[0].time_ps,1);assert.equal(view.percent,10);
});

test("model identity, strict integers, caps, cadence and source timestamps are checked",()=>{
 const mutations=[x=>x.models[1].id=x.models[0].id,x=>x.models[0].step=true,
  x=>x.models[0].cap=0,x=>x.models[0].cap=100020,x=>x.models[0].step=21,
  x=>x.dt_fs=2,x=>x.sample_interval_steps=1000,x=>x.force_pN=5,
  x=>Object.assign(x.models[0],recorded(20),{recorded_at:"2025-01-02T00:00:00Z"})];
 for(const mutate of mutations){const x=initial();x.budget_approved=true;mutate(x);assert.throws(()=>validateValidationData(x,at));}
 assert.throws(()=>validateValidationData(initial(),"invalid"));
});

test("one model at a time and successful predecessor completion are required",()=>{
 const x=initial();x.budget_approved=true;Object.assign(x.models[1],recorded(20));
 assert.throws(()=>validateValidationData(x,at));
 Object.assign(x.models[0],recorded(40));assert.throws(()=>validateValidationData(x,at));
 Object.assign(x.models[0],recorded(5000,"completed"));
 assert.equal(validateValidationData(x,at).status,"running");
});

test("guard failures remain stopped and cannot be relabeled complete",()=>{
 const x=initial();x.budget_approved=true;Object.assign(x.models[0],recorded(20,"stopped"));
 assert.match(validationDataPresentation(validateValidationData(x,at)).status,/Stopped/);
 x.models[0].status="completed";assert.throws(()=>validateValidationData(x,at));
});

test("completion requires exact caps on both models",()=>{
 const x=initial();x.budget_approved=true;x.models.forEach(r=>Object.assign(r,recorded(5000,"completed")));
 assert.equal(validationDataPresentation(validateValidationData(x,at)).percent,100);
 x.models[1].step=4980;assert.throws(()=>validateValidationData(x,at));
});

test("private source paths and budget evidence never enter the public view",()=>{
 const x=initial();x.private_path="/private/source";x.models[0].seed="private-seed";
 const value=JSON.stringify(validateValidationData(x,at));assert.doesNotMatch(value,/private|seed/);
});

test("new data do not inflate original baseline totals or measured daily progress",()=>{
 const snapshot=addPlan(structuredClone(INITIAL_SNAPSHOT));
 const before=publicSnapshot(validateSnapshot(INITIAL_SNAPSHOT),"test");
 const after=publicSnapshot(validateSnapshot(snapshot),"test");
 assert.equal(after.total_steps,before.total_steps);assert.equal(after.total_cap,before.total_cap);
 assert.deepEqual(after.history,before.history);assert.equal(after.validation_data.models[0].step,0);
});

test("the new section survives authenticated PUT and GET through existing storage",async()=>{
 let saved;const stub={async writeNucleosomeProgress(raw){saved=raw},async readNucleosomeProgress(){return saved??null}};
 const env={CONTEXT_LOG:{getByName(){return stub}}};
 const payload=structuredClone(INITIAL_SNAPSHOT);payload.information_updated_at=new Date().toISOString();addPlan(payload);
 const put=await routeNucleosomeProgress(new Request("https://spark.bioengineering.workers.dev/api/nucleosome-progress",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(payload)}),env,async()=>true);
 assert.equal(put.status,200);assert.equal(JSON.parse(saved).validation_data.models[0].step,0);
 const get=await routeNucleosomeProgress(new Request("https://spark.bioengineering.workers.dev/api/nucleosome-progress"),env,async()=>true);
 const actual=await get.json();assert.equal(actual.feed_mode,"automatic");assert.equal(actual.validation_data.status,"prepared");
 // The unchanged deployed publisher compares this complete activity object.
 assert.deepEqual(actual.activities,payload.activities);
});

test("conflicting activity states and duplicate recording sections are rejected",()=>{
 const snapshot=addPlan(structuredClone(INITIAL_SNAPSHOT));snapshot.activities[0].state="active";
 assert.throws(()=>validateSnapshot(snapshot));
 snapshot.activities[0].state="blocked";snapshot.activities.push(structuredClone(snapshot.activities[0]));
 assert.throws(()=>validateSnapshot(snapshot));
});

test("browser presentation has no missing closure dependencies",()=>{
 const fn=vm.runInNewContext("("+validationDataPresentation.toString()+")");
 assert.equal(fn(validateValidationData(initial(),at)).status,"Awaiting budget approval");
});

test("completed rows precede a distinct rightmost validation panel without extra buttons",()=>{
 assert.ok(DASHBOARD_HTML.indexOf('id="completed-runs"')<DASHBOARD_HTML.indexOf('id="validation-panel"'));
 assert.equal((DASHBOARD_HTML.match(/id="validation-panel"/g)||[]).length,1);
 assert.match(DASHBOARD_HTML,/Validation data/);
 assert.doesNotMatch(DASHBOARD_HTML,/id="validation-panel"[^]*?<button/);
});
