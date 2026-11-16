export function stagePresentation(stage, data) {
  const jobs=data.jobs||[], controls=data.controls||[];
  const labels={"apo-A":"Apo A","apo-B":"Apo B","apo-C":"Apo C","free-601-A":"601 DNA A","free-601-B":"601 DNA B","free-601-C":"601 DNA C","free-control-A":"Control DNA A","free-control-B":"Control DNA B","free-control-C":"Control DNA C"};
  const n=value=>Number(value).toLocaleString("en-US");
  const complete=jobs.filter(j=>j.status==="completed").length;
  const done=controls.filter(j=>j.status==="completed").length;
  const current=controls.find(j=>j.status==="checkpoint");
  const state=stage.state==="complete"?"Complete":stage.state==="in_progress"?"In progress":stage.state==="guard_stop"?"Review stop":"Pending";
  const result={status:state,summary:"",heading:"Details",rows:[],percent:stage.state==="complete"?100:0};
  const row=(text,tone="muted")=>({text,tone});
  if(stage.id==="audit"){
    result.summary="Inputs and checks";
    result.heading=stage.state==="complete"?"Recorded and ready":"Preparation";
    result.rows=[row("Original model inputs and reference structures fixed."),row("Independent replicas and saved-step limits defined."),row("Guard checks and native recovery configured.")];
  } else if(stage.id==="baseline"){
    result.summary=complete+" / 6 runs finished";
    result.heading="Completed comparison";
    const group=prefix=>jobs.filter(j=>j.id.startsWith(prefix)).filter(j=>j.status==="completed").map(j=>j.id.split("-").at(-1)).join(", ");
    result.rows=[row("601 replicas: "+(group("601-")||"none complete"),"complete"),row("Control replicas: "+(group("control-")||"none complete"),"complete"),row(n(jobs.reduce((s,j)=>s+j.step,0))+" / 600,000 steps saved."),row(jobs.every(j=>j.guards_pass===true)?"Saved guards pass for all six runs.":"See individual guard records.")];
    result.percent=jobs.reduce((s,j)=>s+j.step,0)/6000;
  } else if(stage.id==="components"){
    result.summary=controls.length?done+" / 9 complete"+(current?" · "+labels[current.id]+" "+(current.step/1000).toFixed(1)+"%":""):"3 systems · 9 runs";
    result.heading="Finished and ongoing";
    if(!controls.length) result.rows=[row("Awaiting verified control details.")];
    else{
      const apo=controls.filter(j=>j.id.startsWith("apo-"));
      if(apo.length===3&&apo.every(j=>j.status==="completed"))result.rows.push(row("Apo A, B and C finished 100,000 steps each.","complete"));
      for(const j of apo.every(a=>a.status==="completed")?[]:apo){
        result.rows.push(row(labels[j.id]+": "+(j.status==="completed"?"finished 100,000 steps":j.status==="checkpoint"?n(j.step)+" / 100,000 saved":j.status==="stopped"?"stopped at "+n(j.step):"not started"),j.status==="completed"?"complete":j.status==="checkpoint"?"current":j.status==="stopped"?"stopped":"muted"));
      }
      if(current&&!current.id.startsWith("apo-"))result.rows.push(row(labels[current.id]+": "+n(current.step)+" / 100,000 saved.","current"));
      for(const [prefix,name] of [["free-601-","601 DNA"],["free-control-","Control DNA"]]){
        const finished=controls.filter(j=>j.id.startsWith(prefix)&&j.status==="completed").map(j=>j.id.split("-").at(-1));
        if(finished.length)result.rows.push(row(name+" replicas finished: "+finished.join(", ")+".","complete"));
      }
      const stopped=controls.find(j=>!j.id.startsWith("apo-")&&j.status==="stopped");
      if(stopped)result.rows.push(row(labels[stopped.id]+": stopped at "+n(stopped.step)+", native "+n(stopped.native_step)+".","stopped"));
      const queued=controls.filter(j=>!j.id.startsWith("apo-")&&j.status==="queued").length;
      if(queued)result.rows.push(row(queued+" DNA replicas not started."));
      result.percent=controls.reduce((s,j)=>s+j.step,0)/9000;
    }
  } else if(stage.id==="pulling"){
    result.summary="Prerequisite gated";
    result.heading=stage.state==="pending"?"Before release":"Stage scope";
    result.rows=[row(stage.state==="pending"?"Not started; original controls and apparatus checks come first.":"Read the current activity summary."),row("Reviewed scouts: 2, 5 and 12 pN."),row("6 initial scouts; up to 12 refinements only if triggered.")];
  } else if(stage.id==="heldout"){
    result.summary="Independent confirmation";
    result.heading=stage.state==="pending"?"Planned after discovery":"Stage scope";
    result.rows=[row(stage.state==="pending"?"No confirmation runs started.":"Read the current activity summary."),row("Held-out decisions frozen prospectively."),row("Up to 36 independent runs; conditional capacity.")];
  } else {
    result.summary="Model comparison";
    result.heading=stage.state==="complete"?"Finished synthesis":"Awaiting the evidence";
    result.rows=[row("Compare bound and intrinsic behaviour."),row("Include qualified force results when available."),row(stage.state==="complete"?"Reviewed conclusions recorded.":"Final conclusions are not yet released.")];
  }
  return result;
}

