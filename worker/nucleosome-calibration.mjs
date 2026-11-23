const RUNS = ["exact_601_0pN", "exact_601_12pN", "matched_control_0pN", "matched_control_12pN"];

export function validateCalibrationData(value, observedAt) {
  const reject = () => { throw Error("Calibration progress rejected"); };
  if (!value || value.version !== 1 || value.partition !== "calibration"
    || value.dt_fs !== 1 || value.sample_interval_steps !== 20
    || !Number.isFinite(Date.parse(observedAt)) || !Array.isArray(value.runs)
    || value.runs.length !== RUNS.length) reject();
  const runs = RUNS.map(id => {
    const matches = value.runs.filter(row => row?.id === id), row = matches[0];
    if (matches.length !== 1 || row.cap !== 100000 || !Number.isInteger(row.step)
      || row.step < 0 || row.step > row.cap || row.step % 20
      || !["queued", "running", "completed", "stopped"].includes(row.status)
      || !Number.isInteger(row.samples) || row.samples < 0
      || ![true, false, null].includes(row.guards_pass)) reject();
    if (row.status === "queued") {
      if (row.step !== 0 || row.samples !== 0 || row.guards_pass !== null
        || row.recorded_at !== null || row.stop_reason !== null) reject();
    } else {
      if (row.samples !== row.step / 20 + 1 || typeof row.guards_pass !== "boolean"
        || typeof row.recorded_at !== "string" || row.recorded_at.length > 40
        || !Number.isFinite(Date.parse(row.recorded_at))
        || Date.parse(row.recorded_at) > Date.parse(observedAt)) reject();
      if (row.status === "stopped") {
        if (!["controller", "guard", "resource", "integrity"].includes(row.stop_reason)
          || (row.stop_reason === "guard") !== !row.guards_pass) reject();
      } else if (!row.guards_pass || row.stop_reason !== null
        || (row.status === "completed" && row.step !== row.cap)
        || (row.status === "running" && row.step === row.cap)) reject();
    }
    return {id, cap: 100000, step: row.step, status: row.status, samples: row.samples,
      guards_pass: row.guards_pass, recorded_at: row.recorded_at, stop_reason: row.stop_reason};
  });
  if (runs.filter(row => row.status === "running").length > 1) reject();
  for (let i = 1; i < runs.length; i++)
    if (runs[i].status !== "queued" && runs.slice(0, i).some(row => row.status === "queued" || row.status === "running")) reject();
  return {version: 1, partition: "calibration", dt_fs: 1, sample_interval_steps: 20, runs};
}

// Self-contained for embedding in the authenticated page; no scientific classification.
export function calibrationPresentation(value) {
  if (!value || !Array.isArray(value.runs)) return {rows: [], complete: 0, summary: "Awaiting calibration observations"};
  const names = {exact_601_0pN: "601 · 0 pN", exact_601_12pN: "601 · 12 pN",
    matched_control_0pN: "Matched · 0 pN", matched_control_12pN: "Matched · 12 pN"};
  const counts = {running: 0, queued: 0, completed: 0, stopped: 0};
  value.runs.forEach(row => counts[row.status]++);
  const labels = {running: "Running", queued: "Queued", completed: "Complete", stopped: "Stopped · incomplete"};
  const summary = [counts.running && counts.running + " running", counts.queued && counts.queued + " queued",
    counts.completed && counts.completed + " complete", counts.stopped && counts.stopped + " incomplete"].filter(Boolean).join(" · ");
  return {complete: counts.completed, summary, rows: value.runs.map(row => ({...row,
    name: names[row.id], label: labels[row.status], percent: row.step / row.cap * 100,
    time_ps: row.step * value.dt_fs / 1000, duration_ps: row.cap * value.dt_fs / 1000}))};
}

export const CALIBRATION_CSS = String.raw`
#content .calibration-panel{margin-top:10px;min-width:0;flex:none}
#content .calibration-panel .panel-head{flex-wrap:wrap;gap:3px 12px}
#content .calibration-body{padding:8px 12px 10px;min-width:0}
#content .calibration-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;min-width:0}
#content .calibration-run{display:grid;align-content:start;gap:4px;min-width:0;font-size:12px;line-height:1.3}
#content .calibration-run-title,#content .calibration-stats{display:flex;justify-content:space-between;gap:6px;flex-wrap:wrap;min-width:0}
#content .calibration-name{font-weight:600;font-size:13px}
#content .calibration-run-state{color:var(--muted)}
#content .calibration-run[data-state="running"] .calibration-run-state,#content .calibration-run[data-state="completed"] .calibration-run-state{color:var(--green)}
#content .calibration-run[data-state="stopped"] .calibration-run-state{color:var(--amber)}
#content .calibration-run .run-track{height:6px;width:100%;min-width:0;border-radius:4px}
#content .calibration-run .run-fill{height:100%;background:var(--green)}
#content .calibration-stats,#content .calibration-time{color:var(--muted);font-variant-numeric:tabular-nums}
#content .calibration-percent{color:var(--green)}
#content .calibration-note{font-size:11px;color:var(--muted);margin:7px 0 0;line-height:1.3}
#content .calibration-state-short,#content .calibration-note-short{display:none}
`;
