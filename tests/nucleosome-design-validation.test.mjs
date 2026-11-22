import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {designValidationSummary, EXPERIMENT_DESIGN_HTML} from "../worker/nucleosome-design.mjs";
import {validateValidationData} from "../worker/nucleosome-validation-data.mjs";
import {validateSnapshot, publicSnapshot, routeNucleosomeProgress} from "../worker/nucleosome-progress.mjs";
import {INITIAL_SNAPSHOT} from "../worker/nucleosome-snapshot.mjs";

const at="2025-01-01T00:00:00Z";
const plan=()=>({version:1,budget_approved:true,dt_fs:1,sample_interval_steps:20,force_pN:0,
  models:[{id:"exact_601",step:400,cap:1000,status:"running",guards_pass:true,recorded_at:at},
    {id:"matched_control",step:0,cap:1000,status:"prepared",guards_pass:null,recorded_at:null}],
  accounting:{prior_charged_steps_per_model:200,cumulative_cap_steps_per_model:1200,component_budgets_unchanged:true}});

test("design uses saved counts, initial-plus-cadence samples and cumulative charges",()=>{
 const value=validateValidationData(plan(),at),view=designValidationSummary(value);
 assert.equal(view.rows[0].percent,40);assert.equal(view.rows[1].percent,0);
 assert.equal(view.rows[0].timePs,.4);assert.equal(view.rows[0].durationPs,1);
 assert.equal(view.rows[0].samples,51);assert.equal(view.intervalFs,20);
 assert.equal(view.total,400);assert.equal(view.totalCap,2000);
 assert.deepEqual(view.budget,{prior:200,cap:1200});assert.match(view.phase,/recording/);
 assert.equal(view.rows[1].label,"1KX5-sequence control");
});

test("optional accounting preserves the exact legacy activity object when absent",()=>{
 const input=plan();delete input.accounting;
 const result=validateValidationData(input,at);
 assert.equal(Object.hasOwn(result,"accounting"),false);
 assert.equal(designValidationSummary(result).budget,null);
 const snapshot=structuredClone(INITIAL_SNAPSHOT);
 snapshot.activities=[{label:"Validation data",state:"active",detail:"Synthetic recording.",validation_data:result}];
 const expected=structuredClone(snapshot.activities);
 assert.deepEqual(publicSnapshot(validateSnapshot(snapshot),"test").activities,expected);
});

test("accounting cannot refund previous charges or alter component budgets",()=>{
 for(const change of [a=>a.cumulative_cap_steps_per_model=1000,a=>a.prior_charged_steps_per_model=-1,
   a=>a.prior_charged_steps_per_model=true,a=>a.component_budgets_unchanged=false,a=>a.private_path="secret"]){
  const p=plan();change(p.accounting);assert.throws(()=>validateValidationData(p,at),/Validation data/);
 }
 const p=plan();p.budget_approved=false;
 p.models.forEach(row=>Object.assign(row,{step:0,status:"prepared",guards_pass:null,recorded_at:null}));
 assert.throws(()=>validateValidationData(p,at));
});

test("approved accounting survives the unchanged publisher's whole-activity PUT/GET comparison",async()=>{
 let saved;const env={CONTEXT_LOG:{getByName:()=>({writeNucleosomeProgress:async raw=>{saved=raw},readNucleosomeProgress:async()=>saved})}};
 const snapshot=structuredClone(INITIAL_SNAPSHOT);
 snapshot.activities=[{label:"Validation data",state:"active",detail:"Synthetic recording.",validation_data:validateValidationData(plan(),at)}];
 const originalJobs=structuredClone(snapshot.jobs),originalHistory=structuredClone(snapshot.history);
 const url="https://spark.bioengineering.workers.dev/api/nucleosome-progress";
 const put=await routeNucleosomeProgress(new Request(url,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(snapshot)}),env,async()=>true);
 assert.equal(put.status,200);
 const get=await routeNucleosomeProgress(new Request(url),env,async()=>true),actual=await get.json();
 assert.deepEqual(actual.activities,snapshot.activities);
 assert.deepEqual(actual.validation_data.accounting,plan().accounting);
 assert.deepEqual(actual.jobs,originalJobs);assert.deepEqual(actual.history,originalHistory);
 assert.equal(actual.total_steps,originalJobs.reduce((sum,row)=>sum+row.step,0));
});

test("the embedded design renderer rejects fabricated preparation, completion and parallel progress",()=>{
 const changes=[p=>{p.budget_approved=false},p=>p.models[1].step=20,
   p=>p.models[0].status="completed",p=>p.models[0].guards_pass=false,
   p=>Object.assign(p.models[1],{step:20,status:"running",guards_pass:true,recorded_at:at}),
   p=>p.accounting.cumulative_cap_steps_per_model=999];
 for(const change of changes){const p=plan();change(p);assert.equal(designValidationSummary(p),null);}
 assert.equal(designValidationSummary(null),null);
});

test("a stopped guard remains a censored recording rather than a completed validation",()=>{
 const p=plan();p.models[0].status="stopped";p.models[0].guards_pass=false;
 const view=designValidationSummary(validateValidationData(p,at));
 assert.match(view.phase,/stopped for review/);assert.equal(view.rows[0].percent,40);
 assert.equal(view.rows[1].status,"prepared");
 assert.match(EXPERIMENT_DESIGN_HTML,/transient and may be guard-censored/);
 assert.match(EXPERIMENT_DESIGN_HTML,/physically qualified intact and opened benchmarks/);
 assert.match(EXPERIMENT_DESIGN_HTML,/Native-contact loss alone is nonspecific/);
 assert.match(EXPERIMENT_DESIGN_HTML,/correlated noise/);
 assert.match(EXPERIMENT_DESIGN_HTML,/Freeze contact and extension criteria prospectively/);
 assert.doesNotMatch(EXPERIMENT_DESIGN_HTML,/Runtime unconfirmed|WSL connected|202611221|\/workspace\/|07ddbfd1/);
});

test("the browser helper has no missing closure dependencies or invented budget when unavailable",()=>{
 const fn=vm.runInNewContext("("+designValidationSummary.toString()+")");
 assert.equal(fn(plan()).rows[0].step,400);
 const p=plan();delete p.accounting;assert.equal(fn(p).budget,null);
 const prepared=plan();prepared.budget_approved=false;delete prepared.accounting;
 prepared.models.forEach(row=>Object.assign(row,{step:0,status:"prepared",guards_pass:null,recorded_at:null}));
 assert.match(fn(prepared).phase,/budget review pending/);assert.equal(fn(prepared).total,0);
});
