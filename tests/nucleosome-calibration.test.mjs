import test from "node:test";
import assert from "node:assert/strict";
import {validateCalibrationData,calibrationPresentation} from "../worker/nucleosome-calibration.mjs";
import {validateActivities} from "../worker/nucleosome-controls.mjs";
import {validateSnapshot,publicSnapshot} from "../worker/nucleosome-progress.mjs";
import {INITIAL_SNAPSHOT} from "../worker/nucleosome-snapshot.mjs";
import {createFittedLayout} from "../worker/nucleosome-fit-layout.mjs";

const at="2026-01-02T12:00:00.000Z";
const ids=["exact_601_0pN","exact_601_12pN","matched_control_0pN","matched_control_12pN"];
function fixture(){
  const queued=id=>({id,cap:100000,step:0,status:"queued",samples:0,guards_pass:null,recorded_at:null,stop_reason:null});
  const runs=ids.map(queued);
  Object.assign(runs[0],{step:10000,status:"stopped",samples:501,guards_pass:true,recorded_at:at,stop_reason:"controller"});
  Object.assign(runs[1],{step:2400,status:"running",samples:121,guards_pass:true,recorded_at:at});
  return {version:1,partition:"calibration",dt_fs:1,sample_interval_steps:20,runs};
}
test("a controller-censored predecessor stays incomplete alongside the next active unit",()=>{
  const value=validateCalibrationData(fixture(),at),view=calibrationPresentation(value);
  assert.equal(view.complete,0);assert.equal(view.rows[0].status,"stopped");
  assert.equal(view.rows[0].label,"Stopped · incomplete");assert.equal(view.rows[0].percent,10);
  assert.equal(view.rows[1].percent,2.4);assert.equal(view.rows[2].percent,0);
  assert.match(view.summary,/1 running/);assert.match(view.summary,/2 queued/);assert.match(view.summary,/1 incomplete/);
});
test("queued rows cannot invent saved samples or guards",()=>{
  for(const patch of [{step:20},{samples:1},{guards_pass:true},{recorded_at:at},{stop_reason:"controller"}]){
    const value=fixture();Object.assign(value.runs[2],patch);assert.throws(()=>validateCalibrationData(value,at));
  }
});
test("exact four IDs and the original 100000-step cap are required",()=>{
  for(const mutate of [v=>v.runs.pop(),v=>v.runs[0].id="other",v=>v.runs[2].id=v.runs[1].id,v=>v.runs[1].cap=200000]){
    const value=fixture();mutate(value);assert.throws(()=>validateCalibrationData(value,at));
  }
});
test("sample counts, guard boundaries and timestamps are checked",()=>{
  for(const patch of [{step:2401},{step:-20},{step:100020},{samples:120},{recorded_at:"invalid"},{recorded_at:"2026-01-03T00:00:00Z"},{guards_pass:false}]){
    const value=fixture();Object.assign(value.runs[1],patch);assert.throws(()=>validateCalibrationData(value,at));
  }
});
test("a guard stop and a passing-guard controller stop have distinct evidence",()=>{
  const value=fixture();value.runs[0].stop_reason="guard";assert.throws(()=>validateCalibrationData(value,at));
  value.runs[0].guards_pass=false;assert.equal(validateCalibrationData(value,at).runs[0].stop_reason,"guard");
});
test("one unit at a time, in the recorded order",()=>{
  const value=fixture();Object.assign(value.runs[2],{status:"running",samples:1,guards_pass:true,recorded_at:at});
  assert.throws(()=>validateCalibrationData(value,at));
  Object.assign(value.runs[1],{status:"queued",step:0,samples:0,guards_pass:null,recorded_at:null});
  assert.throws(()=>validateCalibrationData(value,at));
});
test("saved completion cannot turn a stopped run into a successful run",()=>{
  const value=fixture();Object.assign(value.runs[0],{step:100000,samples:5001});
  const view=calibrationPresentation(validateCalibrationData(value,at));
  assert.equal(view.rows[0].percent,100);assert.equal(view.rows[0].label,"Stopped · incomplete");assert.equal(view.complete,0);
  value.runs[1].step=100000;value.runs[1].samples=5001;assert.throws(()=>validateCalibrationData(value,at));
});
test("near-complete running progress remains below 100 percent",()=>{
  const value=fixture();value.runs[1].step=99980;value.runs[1].samples=5000;
  assert.equal(calibrationPresentation(validateCalibrationData(value,at)).rows[1].percent,99.98);
});
test("nested progress round-trips through the original publisher-compared activities",()=>{
  const base=structuredClone(INITIAL_SNAPSHOT),calibration=fixture();
  calibration.runs.filter(r=>r.recorded_at).forEach(r=>r.recorded_at=base.information_updated_at);
  const old=validateSnapshot(base);base.activities=[{label:"Calibration",detail:"Synthetic saved progress.",state:"active",calibration_data:calibration}];
  const snapshot=validateSnapshot(base),response=publicSnapshot(snapshot,"automatic",Date.parse(base.information_updated_at));
  assert.deepEqual(response.activities,base.activities);assert.deepEqual(snapshot.jobs,old.jobs);
  assert.deepEqual(snapshot.stages,old.stages);assert.deepEqual(snapshot.history,old.history);
  assert.deepEqual(snapshot.daily_progress_samples,old.daily_progress_samples);
});
test("legacy activities remain exact and duplicate calibration payloads are rejected",()=>{
  const old=[{label:"Other work",detail:"Synthetic legacy activity.",state:"blocked"}];
  assert.deepEqual(validateActivities(old,at),old);
  const activity={label:"Calibration",detail:"Synthetic progress.",state:"active",calibration_data:fixture()};
  assert.throws(()=>validateActivities([activity,activity],at));
  assert.throws(()=>validateActivities([{...activity,state:"complete"}],at));
});
test("the embedded presentation function has no external dependencies",()=>{
  const embedded=Function("return ("+calibrationPresentation.toString()+")")();
  assert.deepEqual(embedded(fixture()),calibrationPresentation(fixture()));
  assert.equal(embedded(null).rows.length,0);
});
test("phone and short-screen layouts use one compact viewport",()=>{
  for(const [width,height,compact] of [[320,568,true],[390,844,true],[844,390,true],[1024,768,true],[1440,900,false],[3840,2160,false]]){
    const root={dataset:{},style:{setProperty(){}},hidden:false};
    const doc={querySelectorAll(){return[]},getElementById(){return root}};
    const win={innerWidth:width,innerHeight:height,addEventListener(){},requestAnimationFrame(){}};
    const layout=createFittedLayout(doc,win,()=>{});const config=layout.configuration();
    assert.equal(root.dataset.layout,"single");assert.equal(config.compact,compact);
  }
});
