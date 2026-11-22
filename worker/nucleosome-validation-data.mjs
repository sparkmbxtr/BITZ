// Minimal dashboard evidence only. This schema grants no simulation authority.
export function validateValidationData(input, observedAt) {
  const reject = () => { throw new Error("Validation data evidence rejected"); };
  const ids = ["exact_601", "matched_control"];
  if (!Number.isFinite(Date.parse(observedAt)) || !input || input.version !== 1 || typeof input.budget_approved !== "boolean"
    || input.dt_fs !== 1 || input.sample_interval_steps !== 20 || input.force_pN !== 0
    || !Array.isArray(input.models) || input.models.length !== 2) reject();
  const models = ids.map(id => {
    const matches = input.models.filter(row => row?.id === id);
    if (matches.length !== 1) reject();
    const row = matches[0];
    if (!Number.isInteger(row.cap) || row.cap < 20 || row.cap > 100000 || row.cap % 20
      || !Number.isInteger(row.step) || row.step < 0 || row.step > row.cap || row.step % 20
      || !["prepared", "running", "stopped", "completed"].includes(row.status)
      || ![null, true, false].includes(row.guards_pass)) reject();
    if (row.status === "prepared") {
      if (row.step !== 0 || row.guards_pass !== null || row.recorded_at != null) reject();
    } else {
      if (!input.budget_approved || typeof row.recorded_at !== "string" || row.recorded_at.length > 40
        || !Number.isFinite(Date.parse(row.recorded_at)) || Date.parse(row.recorded_at) > Date.parse(observedAt)
        || typeof row.guards_pass !== "boolean") reject();
      if ((row.status === "stopped") !== (row.guards_pass === false)
        || (row.status === "completed" && row.step !== row.cap)
        || (row.status === "running" && row.step === row.cap)) reject();
    }
    if (!input.budget_approved && row.status !== "prepared") reject();
    return {id, cap: row.cap, step: row.step, status: row.status,
      guards_pass: row.guards_pass, recorded_at: row.recorded_at ?? null};
  });
  if (models.filter(row => row.status === "running").length > 1
    || (models[1].status !== "prepared" && models[0].status !== "completed")) reject();
  const status = models.every(row => row.status === "completed") ? "completed"
    : models.some(row => row.status === "stopped") ? "stopped"
    : models.some(row => row.status === "running") ? "running" : "prepared";
  if (input.status != null && input.status !== status) reject();
  return {version: 1, budget_approved: input.budget_approved, dt_fs: 1,
    sample_interval_steps: 20, force_pN: 0, status, models};
}

// Kept self-contained because the authenticated HTML embeds this function.
export function validationDataPresentation(value) {
  if (!value || !Array.isArray(value.models) || value.models.length !== 2)
    return {status: "Awaiting verified plan", total: 0, cap: 0, percent: null, rows: []};
  const names = {exact_601: "601 model", matched_control: "Matched control"};
  const total = value.models.reduce((sum, row) => sum + row.step, 0);
  const cap = value.models.reduce((sum, row) => sum + row.cap, 0);
  const status = !value.budget_approved ? "Awaiting budget approval"
    : value.status === "running" ? "Recording"
    : value.status === "stopped" ? "Stopped · review required"
    : value.status === "completed" ? "Recordings complete" : "Prepared";
  return {status, total, cap, percent: cap ? total / cap * 100 : null,
    rows: value.models.map(row => ({id: row.id, name: names[row.id],
      step: row.step, cap: row.cap, status: row.status,
      percent: row.step / row.cap * 100,
      time_ps: row.step * value.dt_fs / 1000, duration_ps: row.cap * value.dt_fs / 1000}))};
}

export const VALIDATION_DATA_CSS = String.raw`
#content .grid{grid-template-columns:minmax(0,2fr) minmax(0,1fr)}
#content .completed-runs{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:14px;min-width:0;min-height:0;height:100%}
#content .completed-runs>.panel,#content .completed-runs>.side{min-width:0;min-height:0;height:100%}
#content .validation-panel{display:flex;flex-direction:column;min-width:0;min-height:0}
#content .validation-panel .panel-head{align-items:flex-start;flex-wrap:wrap;gap:2px 10px}
#content .validation-body{padding:8px 12px;display:grid;align-content:start;gap:12px;min-width:0;min-height:0}
#content .validation-state{font-size:13px;line-height:1.3;color:var(--muted)}
#content .validation-run{display:grid;gap:5px;min-width:0}
#content #validation-runs{display:grid;gap:12px}
#content .validation-run-title{display:flex;justify-content:space-between;gap:5px;font-size:14px;line-height:1.25;min-width:0}
#content .validation-run-title span:last-child{color:var(--green);font-variant-numeric:tabular-nums}
#content .validation-run .run-track{height:6px;width:100%;min-width:0}
#content .validation-run .run-fill{background:var(--green)}
#content .validation-stats{display:flex;justify-content:space-between;flex-wrap:wrap;gap:1px 8px;color:var(--muted);font-size:12px;line-height:1.25;font-variant-numeric:tabular-nums}
#content[data-density="1"] .completed-runs{gap:10px}
#content[data-density="1"] .validation-body{gap:9px;padding:6px 9px}
#content[data-density="2"] .grid{height:190px}
#content[data-density="3"] .grid{height:180px}
#content[data-density="2"] .completed-runs,#content[data-density="3"] .completed-runs{gap:6px}
#content[data-density="2"] .control-run,#content[data-density="3"] .control-run{grid-template-columns:minmax(0,1fr) auto;gap:1px 3px;min-height:0;padding:2px 0}
#content[data-density="2"] .control-run .run-label,#content[data-density="3"] .control-run .run-label{grid-column:1;grid-row:1}
#content[data-density="2"] .control-run .run-percent,#content[data-density="3"] .control-run .run-percent{grid-column:2;grid-row:1}
#content[data-density="2"] .control-run .run-track,#content[data-density="3"] .control-run .run-track{grid-column:1/-1;grid-row:2;height:3px}
#content[data-density="2"] .control-run .run-state,#content[data-density="3"] .control-run .run-state{display:none}
#content[data-density="2"] .control-run .run-label,#content[data-density="2"] .control-run .run-percent{font-size:11px}
#content[data-density="3"] .control-run .run-label,#content[data-density="3"] .control-run .run-percent{font-size:10px}
#content[data-density="2"] .validation-body,#content[data-density="3"] .validation-body{padding:5px 6px;gap:9px}
#content[data-density="2"] .validation-state,#content[data-density="3"] .validation-state{font-size:11px}
#content[data-density="2"] .validation-run-title,#content[data-density="3"] .validation-run-title{font-size:11px}
#content[data-density="2"] .validation-stats,#content[data-density="3"] .validation-stats{font-size:10px}
#content[data-density="2"] .validation-run,#content[data-density="3"] .validation-run{gap:3px}
#content[data-density="2"] #validation-runs,#content[data-density="3"] #validation-runs{gap:8px}
#content[data-density="2"] .validation-run .run-track,#content[data-density="3"] .validation-run .run-track{height:4px}
@media(max-width:700px){
 #content[data-density="3"] .completed-runs{gap:4px}
 #content[data-density="3"] .run{grid-template-columns:minmax(0,1fr) auto;gap:1px 2px;padding:2px 0}
 #content[data-density="3"] .run-label{grid-column:1;grid-row:1}
 #content[data-density="3"] .run-percent{grid-column:2;grid-row:1}
 #content[data-density="3"] .run-track{grid-column:1/-1;grid-row:2;height:3px}
 #content[data-density="3"] .control-run{padding:2px 0}
 #content[data-density="3"] .validation-body{padding:5px;gap:8px}
 #content[data-density="3"] .validation-run-title{font-size:10px;gap:3px}
 #content[data-density="3"] .validation-stats{font-size:9px;gap:1px 3px}
}
@media(max-height:450px){
 #content[data-density="3"] .grid{height:120px}
 #content[data-density="3"] .run,#content[data-density="3"] .control-run{padding:0;line-height:1.05}
 #content[data-density="3"] .control-run{grid-template-columns:minmax(32px,1fr) minmax(12px,1fr) 28px;gap:3px;min-height:12px}
 #content[data-density="3"] .control-run .run-label{grid-column:1;grid-row:1}
 #content[data-density="3"] .control-run .run-track{grid-column:2;grid-row:1;height:3px}
 #content[data-density="3"] .control-run .run-percent{grid-column:3;grid-row:1}
 #content[data-density="3"] .validation-body{gap:3px;padding:3px 5px}
 #content[data-density="3"] #validation-runs{gap:4px}
 #content[data-density="3"] .validation-run-title{font-size:10px}
 #content[data-density="3"] .validation-stats{font-size:9px}
 #content[data-density="3"] .validation-stats .validation-time{display:none}
 #content[data-density="3"] .validation-state{font-size:10px}
}
`;
