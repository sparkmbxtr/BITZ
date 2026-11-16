import assert from "node:assert/strict";
import test from "node:test";
import {validateControls,validateActivities,validateNextActions,validateGuardSummary,controlsAreMonotonic} from "../worker/nucleosome-controls.mjs";
const at="2026-11-16T10:48:00.000Z";
const ids=["free-601-A","free-601-B","free-601-C","free-control-A","free-control-B","free-control-C","apo-A","apo-B","apo-C"];
const fixture=()=>ids.map(id=>({id,step:0,status:"queued",guard_rows:0,guards_pass:null,native_step:null,checkpoint_at:null}));
test("controls include independent apo progress after all six bound jobs have finished",()=>{
 const jobs=fixture();
 for(const id of ["apo-A","apo-B"])Object.assign(jobs.find(j=>j.id===id),{step:100000,status:"completed",guard_rows:5001,guards_pass:true,native_step:100000,checkpoint_at:at});
 Object.assign(jobs.find(j=>j.id==="apo-C"),{step:120,status:"checkpoint",guard_rows:7,guards_pass:true,native_step:0,checkpoint_at:at,runtime:{at,identity_verified:true,advancing:true}});
 assert.equal(validateControls(jobs,at).find(j=>j.id==="apo-C").step,120);
});
test("stopped DNA keeps passing saved guards and its exact earlier native step",()=>{
 const jobs=fixture();Object.assign(jobs[0],{step:8880,status:"stopped",guard_rows:445,guards_pass:true,native_step:8000,checkpoint_at:at});
 assert.equal(validateControls(jobs,at)[0].native_step,8000);
});
test("incomplete guards, repeated IDs, overlapping live replicas and invented completion are rejected",()=>{
 for(const edit of [j=>j[1].id=j[0].id,j=>Object.assign(j[0],{step:100000,status:"completed"}),j=>Object.assign(j[0],{step:120,status:"checkpoint",guard_rows:6,guards_pass:true,native_step:0,checkpoint_at:at}),j=>{for(let n=0;n<2;n++)Object.assign(j[n],{step:0,status:"checkpoint",guard_rows:1,guards_pass:true,native_step:0,checkpoint_at:at})}]){const jobs=fixture();edit(jobs);assert.throws(()=>validateControls(jobs,at));}
});
test("completed controls cannot be reopened or lost in an older snapshot",()=>{
 const previous=fixture();Object.assign(previous[6],{step:100000,status:"completed",guard_rows:5001,guards_pass:true,native_step:100000,checkpoint_at:at});
 assert.equal(controlsAreMonotonic(previous,structuredClone(previous)),true);
 assert.equal(controlsAreMonotonic(previous,fixture()),false);
 assert.equal(controlsAreMonotonic(previous,undefined),false);
});
test("activities and next actions are bounded allowlisted text",()=>{
 assert.deepEqual(validateActivities([{label:"Library",detail:"Verifying recovery",state:"active",private_path:"discard"}]),[{label:"Library",detail:"Verifying recovery",state:"active"}]);
 assert.throws(()=>validateActivities([{label:"Library",detail:"x".repeat(201),state:"active"}]));
 assert.deepEqual(validateNextActions(["Finish apo C"]),["Finish apo C"]);
 assert.throws(()=>validateNextActions(Array(5).fill("Repeated")));
});
const guard=()=>({armed:true,controller_confirmed_at:at,controller_deadline_at:"2026-11-16T13:18:00.000Z",timeout_seconds:9000,guard_interval_steps:20,checkpoint_interval_steps:1000});
test("guard details retain only actual public timing and fixed check intervals",()=>{
 const value=guard();assert.deepEqual(validateGuardSummary({...value,nonce:"private",pid:123,host:"private"},at,true),value);
 assert.equal(validateGuardSummary(undefined,at,true),undefined);
});
test("invented controller windows, mismatched armed state and expired live records are rejected",()=>{
 for(const edit of [g=>g.armed=false,g=>g.timeout_seconds=600,g=>g.guard_interval_steps=100,g=>g.checkpoint_interval_steps=2000,g=>g.controller_deadline_at="2026-11-16T14:18:00.000Z",g=>g.controller_confirmed_at="invalid"]){
  const value=guard();edit(value);assert.throws(()=>validateGuardSummary(value,at,true),/Guard summary/);
 }
 assert.throws(()=>validateGuardSummary(guard(),"2026-11-16T13:19:00.000Z",true),/Guard summary/);
 assert.throws(()=>validateGuardSummary(guard(),"2026-11-16T10:40:00.000Z",true),/Guard summary/);
});

