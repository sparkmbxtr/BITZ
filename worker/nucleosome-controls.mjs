const IDS = ["free-601-A","free-601-B","free-601-C","free-control-A","free-control-B","free-control-C","apo-A","apo-B","apo-C"];
export const CONTROL_LABELS = Object.fromEntries(IDS.map(id => [id, id.replace("free-601","601 DNA").replace("free-control","Control DNA").replace("apo","Apo").replace(/-([ABC])$/, " $1")]));
const instant = value => typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
export function validateControls(value, observedAt) {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.length !== 9 || value.filter(j => j.status === "checkpoint").length > 1) throw Error("Control set rejected");
  return IDS.map(id => {
    const matches = value.filter(j => j.id === id), j = matches[0];
    if (matches.length !== 1 || !Number.isInteger(j.step) || j.step < 0 || j.step > 100000
      || !["queued","checkpoint","completed","stopped"].includes(j.status)
      || !Number.isInteger(j.guard_rows) || j.guard_rows < 0
      || ![true,false,null].includes(j.guards_pass)) throw Error("Control evidence rejected");
    if (j.status === "queued") {
      if (j.step !== 0 || j.guard_rows !== 0 || j.guards_pass !== null || j.native_step !== null || j.checkpoint_at !== null) throw Error("Queued control evidence rejected");
    } else if (j.guard_rows !== j.step / 20 + 1 || typeof j.guards_pass !== "boolean"
      || !Number.isInteger(j.native_step) || j.native_step < 0 || j.native_step > j.step || j.native_step % 1000
      || !instant(j.checkpoint_at) || Date.parse(j.checkpoint_at) > Date.parse(observedAt) + 60000
      || (j.status === "completed" && (j.step !== 100000 || j.native_step !== 100000 || !j.guards_pass))
      || (j.status === "checkpoint" && !j.guards_pass)) throw Error("Saved control evidence rejected");
    let runtime;
    if (j.runtime != null) {
      const r=j.runtime;
      if (j.status !== "checkpoint" || !instant(r.at) || Date.parse(r.at) > Date.parse(observedAt)
        || ["identity_verified","advancing"].some(k => typeof r[k] !== "boolean")) throw Error("Control runtime rejected");
      runtime={at:r.at,identity_verified:r.identity_verified,advancing:r.advancing};
    }
    return {id,step:j.step,cap:100000,status:j.status,guard_rows:j.guard_rows,guards_pass:j.guards_pass,
      native_step:j.native_step,checkpoint_at:j.checkpoint_at,...(runtime?{runtime}:{})};
  });
}
export function validateActivities(value, observedAt) {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.length > 6) throw Error("Activities rejected");
  if (value.filter(a => a?.validation_data != null).length > 1) throw Error("Duplicate validation data activity");
  return value.map(a => {
    if (!a || typeof a.label !== "string" || !a.label.trim() || a.label.length > 80
      || typeof a.detail !== "string" || a.detail.length > 200
      || !["active","queued","complete","blocked"].includes(a.state)) throw Error("Activity rejected");
    const progress = a.validation_data != null ? validateValidationData(a.validation_data, observedAt) : null;
    if (progress && ((progress.status === "running" && a.state !== "active")
      || (progress.status === "completed" && a.state !== "complete")
      || (progress.status === "stopped" && a.state !== "blocked")
      || (!progress.budget_approved && a.state !== "blocked"))) throw Error("Validation activity state rejected");
    return {label:a.label,detail:a.detail,state:a.state,
      ...(progress ? {validation_data:progress} : {})};
  });
}
export function validateNextActions(value) {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.length > 4 || value.some(s => typeof s !== "string" || !s.trim() || s.length > 180)) throw Error("Next actions rejected");
  return [...value];
}
export function validateGuardSummary(value, observedAt, armed) {
  if (value == null) return undefined;
  if (typeof value.armed !== "boolean" || value.armed !== armed
    || value.timeout_seconds !== 9000 || value.guard_interval_steps !== 20 || value.checkpoint_interval_steps !== 1000
    || !instant(value.controller_confirmed_at) || !instant(value.controller_deadline_at)
    || Date.parse(value.controller_confirmed_at) > Date.parse(observedAt) + 60000
    || Math.abs(Date.parse(value.controller_deadline_at)-Date.parse(value.controller_confirmed_at)-9000000) > 2000
    || (armed && Date.parse(value.controller_deadline_at) <= Date.parse(observedAt))) throw Error("Guard summary rejected");
  return {armed:value.armed,controller_confirmed_at:value.controller_confirmed_at,controller_deadline_at:value.controller_deadline_at,
    timeout_seconds:9000,guard_interval_steps:20,checkpoint_interval_steps:1000};
}
export function controlsAreMonotonic(previous, incoming) {
  if (!previous) return true;
  return previous.every(old => {
    const next=incoming?.find(j => j.id === old.id);
    return next && next.step >= old.step && (old.status !== "completed" || next.status === "completed");
  });
}

import { validateValidationData } from "./nucleosome-validation-data.mjs";

