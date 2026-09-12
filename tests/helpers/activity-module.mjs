import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";

// Exercise the production pure detector without loading the React UI or build
// dependencies. Explicit boundaries fail closed if the source is reorganised.
export function loadActivityModule(source = readFileSync(new URL("../../app/page.tsx", import.meta.url), "utf8")) {
  const start = source.indexOf("function berlinClock(");
  const end = source.indexOf("function latestCycle(", start);
  if (start < 0 || end < start) throw new Error("Activity module boundaries changed");
  const exports = {};
  const code = stripTypeScriptTypes(source.slice(start, end));
  vm.runInNewContext(code + "\nexports.activityCycles = activityCycles; exports.activityCycleIsOpen = activityCycleIsOpen; exports.routineClosedForRoom = routineClosedForRoom; exports.labDepartureCloseEventTime = typeof labDepartureCloseEventTime === 'function' ? labDepartureCloseEventTime : null;", { exports });
  return exports;
}
