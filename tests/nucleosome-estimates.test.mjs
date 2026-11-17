import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDailyProgressSamples,mergeDailyProgressSamples,estimateTimeRange} from '../worker/nucleosome-estimates.mjs';
import {INITIAL_SNAPSHOT} from '../worker/nucleosome-snapshot.mjs';
import {routeNucleosomeProgress} from '../worker/nucleosome-progress.mjs';
const start=Date.parse('2026-11-16T14:00:00Z'),at=h=>new Date(start+h*3600000).toISOString();
function fixture(){return {information_updated_at:at(24),jobs:[{step:600000,cap:600000}],
  controls:[{step:400000,cap:900000}],stages:[{id:'components',state:'in_progress'},{id:'pulling',state:'pending'},{id:'heldout',state:'pending'}],
  daily_progress_samples:[{at:at(0),steps:840000},{at:at(22),steps:940000},{at:at(23),steps:970000},{at:at(24),steps:1000000}]};}
test('daily envelope includes pauses and fastest >=1h observed sample',()=>{
 const r=estimateTimeRange(fixture());assert.equal(r.available,true);assert.equal(r.observed_steps,160000);
 assert.equal(r.average_steps_per_day,160000);assert.equal(r.fast_steps_per_day,720000);
 assert.equal(r.controls.minimum_days,500000/720000);assert.equal(r.controls.maximum_days,500000/160000);
 assert.equal(r.defined.remaining_steps,1100000);assert.equal(r.ceiling.remaining_steps,5900000);
 assert.equal(r.baseline.maximum_days,0);
});
test('zero progression has no fabricated finite completion date',()=>{
 const f=fixture();f.daily_progress_samples.forEach(p=>p.steps=1000000);assert.equal(estimateTimeRange(f).reason,'no_recent_progress');
});
test('one point and samples shorter than one hour do not claim daily evidence',()=>{
 const f=fixture();f.daily_progress_samples=[{at:at(24),steps:1000000}];assert.equal(estimateTimeRange(f).available,false);
 f.daily_progress_samples=[{at:at(23.9),steps:999000},{at:at(24),steps:1000000}];assert.equal(estimateTimeRange(f).available,false);
});
test('out-of-order, decreasing, future and impossible counts rejected',()=>{
 const bad=[[{at:at(24),steps:1},{at:at(23),steps:2}],[{at:at(23),steps:2},{at:at(24),steps:1}],
  [{at:at(25),steps:2}],[{at:at(24),steps:1000001}],[{at:at(24),steps:-1}]];
 for(const samples of bad)assert.throws(()=>validateDailyProgressSamples(samples,at(24),1000000));
});
test('existing status publications extend the same bounded rolling history',()=>{
 const f=fixture();const first=mergeDailyProgressSamples(null,f.daily_progress_samples,f);
 f.information_updated_at=at(25);f.controls[0].step=420000;
 const next=mergeDailyProgressSamples(first,null,f);assert.equal(next.at(-1).steps,1020000);assert.equal(next.at(-1).at,at(25));
 assert.equal(estimateTimeRange({...f,daily_progress_samples:next}).available,true);
});
test('repeated publication does not duplicate progress',()=>{
 const f=fixture(),old=mergeDailyProgressSamples(null,f.daily_progress_samples,f);
 assert.deepEqual(mergeDailyProgressSamples(old,null,f),old);
});
test('conflicting source counts are rejected',()=>{
 const f=fixture();assert.throws(()=>mergeDailyProgressSamples(f.daily_progress_samples,[{at:at(23),steps:980000}],f));
});
test('short available daily window is reported with its real duration',()=>{
 const f=fixture();f.daily_progress_samples=f.daily_progress_samples.slice(1);assert.equal(estimateTimeRange(f).window_hours,2);
});
test('completed later stages remove their actual compute budgets',()=>{
 const f=fixture();f.stages.forEach(s=>s.state='complete');const r=estimateTimeRange(f);
 assert.equal(r.controls.remaining_steps,0);assert.equal(r.defined.remaining_steps,0);assert.equal(r.ceiling.remaining_steps,0);
});
test('the protected existing feed persists daily evidence and derives day ranges without a publisher change',async()=>{
 const source=structuredClone(INITIAL_SNAPSHOT),now=Date.now();source.information_updated_at=new Date(now).toISOString();
 source.history=[];source.watchdog_armed=false;
 for(const job of source.jobs)Object.assign(job,{step:100000,status:'completed',checkpoint_at:source.information_updated_at,guards_pass:true});
 source.controls=['free-601-A','free-601-B','free-601-C','free-control-A','free-control-B','free-control-C','apo-A','apo-B','apo-C'].map(id=>{
   const done=id==='free-601-A'||id.startsWith('apo-');return {id,step:done?100000:0,status:done?'completed':'queued',guard_rows:done?5001:0,guards_pass:done?true:null,native_step:done?100000:null,checkpoint_at:done?source.information_updated_at:null};
 });
 source.stages.find(s=>s.id==='baseline').state='complete';
 source.daily_progress_samples=[{at:new Date(now-86400000).toISOString(),steps:840000},{at:new Date(now-7200000).toISOString(),steps:940000},{at:new Date(now-3600000).toISOString(),steps:970000},{at:source.information_updated_at,steps:1000000}];
 source.time_estimate={available:true,average_steps_per_day:999999999};
 let saved=null;const env={CONTEXT_LOG:{getByName(){return {async writeNucleosomeProgress(raw){saved=raw},async readNucleosomeProgress(){return saved}}}}};
 const origin='https://spark.bioengineering.workers.dev/api/nucleosome-progress';
 const request=()=>new Request(origin,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(source)});
 assert.equal((await routeNucleosomeProgress(request(),env,async()=>false)).status,401);assert.equal(saved,null);
 assert.equal((await routeNucleosomeProgress(request(),env,async()=>true)).status,200);
 let body=await (await routeNucleosomeProgress(new Request(origin),env,async()=>true)).json();
 assert.equal(body.time_estimate.average_steps_per_day,160000);assert.equal(body.time_estimate.fast_steps_per_day,720000);
 assert.equal(body.time_estimate.controls.remaining_steps,500000);assert.deepEqual(body.controls,source.controls.map(j=>({...j,cap:100000})));
 delete source.daily_progress_samples;delete source.time_estimate;source.information_updated_at=new Date(now+30000).toISOString();
 assert.equal((await routeNucleosomeProgress(request(),env,async()=>true)).status,200);
 body=await (await routeNucleosomeProgress(new Request(origin),env,async()=>true)).json();
 assert.ok(body.daily_progress_samples.length>=4);assert.equal(body.time_estimate.available,true);
 assert.equal(body.information_updated_at,source.information_updated_at);
});
