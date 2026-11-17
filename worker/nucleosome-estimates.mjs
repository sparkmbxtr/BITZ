// Only dated aggregate saved-step counts; no scientific payloads or new storage.
const HOUR = 3_600_000, DAY = 24 * HOUR, MAX_SAMPLES = 256;
const point = snapshot => ({at:snapshot.information_updated_at,
  steps:snapshot.jobs.reduce((n,j)=>n+j.step,0)+(snapshot.controls??[]).reduce((n,j)=>n+j.step,0)});

export function validateDailyProgressSamples(samples, observedAt, total) {
  if (!Array.isArray(samples) || !samples.length || samples.length > MAX_SAMPLES) throw Error('Daily progress samples rejected');
  let priorTime=-Infinity, priorSteps=-1;
  return samples.map(sample=>{
    const at=typeof sample?.at==='string'?Date.parse(sample.at):NaN;
    if (!Number.isFinite(at) || at<=priorTime || at>Date.parse(observedAt)
      || !Number.isInteger(sample.steps) || sample.steps<priorSteps || sample.steps<0 || sample.steps>total)
      throw Error('Daily progress sample evidence rejected');
    priorTime=at;priorSteps=sample.steps;
    return {at:sample.at,steps:sample.steps};
  });
}

export function mergeDailyProgressSamples(previous, incoming, snapshot) {
  const current=point(snapshot), byTime=new Map();
  for(const samples of [previous,incoming]) {
    if(samples==null)continue;
    for(const sample of validateDailyProgressSamples(samples,current.at,current.steps)) {
      const time=Date.parse(sample.at), prior=byTime.get(time);
      if(prior && prior.steps!==sample.steps)throw Error('Conflicting daily progress evidence');
      byTime.set(time,sample);
    }
  }
  const at=Date.parse(current.at), same=byTime.get(at);
  if(same && same.steps!==current.steps)throw Error('Daily progress endpoint differs');
  byTime.set(at,current);
  const ordered=[...byTime.values()].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  validateDailyProgressSamples(ordered.slice(-MAX_SAMPLES),current.at,current.steps);
  const cutoff=at-DAY, first=ordered.findIndex(p=>Date.parse(p.at)>=cutoff);
  return ordered.slice(Math.max(0,first-1)).slice(-MAX_SAMPLES);
}

export function estimateTimeRange(snapshot) {
  const current=point(snapshot), cutoff=Date.parse(current.at)-DAY;
  let samples;
  try {samples=validateDailyProgressSamples(snapshot.daily_progress_samples,current.at,current.steps)
    .filter(p=>Date.parse(p.at)>=cutoff);} catch {return {available:false,reason:'insufficient_history'};}
  const first=samples[0],last=samples.at(-1),elapsed=first&&last?Date.parse(last.at)-Date.parse(first.at):0;
  if(samples.length<2 || elapsed<HOUR || last.at!==current.at || last.steps!==current.steps)
    return {available:false,reason:'insufficient_history'};
  const observed=last.steps-first.steps, average=observed/elapsed*DAY;
  if(average<=0)return {available:false,reason:'no_recent_progress',window_hours:elapsed/HOUR};
  let fastest=average,fastHours=elapsed/HOUR;
  for(let end=1;end<samples.length;end++)for(let start=0;start<end;start++) {
    const dt=Date.parse(samples[end].at)-Date.parse(samples[start].at);
    if(dt<HOUR)continue;
    const rate=(samples[end].steps-samples[start].steps)/dt*DAY;
    if(rate>fastest){fastest=rate;fastHours=dt/HOUR;}
  }
  const remaining=rows=>rows.reduce((n,j)=>n+Math.max(0,j.cap-j.step),0);
  const pending=id=>snapshot.stages.some(s=>s.id===id&&s.state!=='complete');
  const baseline=remaining(snapshot.jobs),controls=pending('components')?(snapshot.controls?remaining(snapshot.controls):900000):0;
  const defined=baseline+controls+(pending('pulling')?600000:0);
  const ceiling=defined+(pending('pulling')?1200000:0)+(pending('heldout')?3600000:0);
  const budget=steps=>({remaining_steps:steps,minimum_days:steps/fastest,maximum_days:steps/average});
  return {available:true,from:first.at,to:last.at,window_hours:elapsed/HOUR,observed_steps:observed,
    average_steps_per_day:average,fast_steps_per_day:fastest,fast_sample_hours:fastHours,
    baseline:budget(baseline),controls:budget(controls),defined:budget(defined),ceiling:budget(ceiling),
    basis:'Minimum: fastest measured sample of at least one hour. Maximum: observed daily average including pauses. Compute-only projection; later speeds, qualification and reviews are unmeasured.'};
}
