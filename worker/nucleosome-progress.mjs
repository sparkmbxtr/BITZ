import { DASHBOARD_HTML } from "./nucleosome-page.mjs";
import { INITIAL_SNAPSHOT } from "./nucleosome-snapshot.mjs";
import { progressWriterAuthorized } from "./nucleosome-oidc.mjs";

const IDS = ["601-A", "control-A", "601-B", "control-B", "601-C", "control-C"];
const STATES = ["pending", "in_progress", "complete", "guard_stop"];
const STAGES = ["audit", "baseline", "components", "pulling", "heldout", "conclusions"];
const MAX_BYTES = 100_000;

function instant(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && value.length <= 40;
}

export function validateSnapshot(input) {
  if (!input || input.version !== 1 || !instant(input.information_updated_at)
    || Date.parse(input.information_updated_at) > Date.now() + 60_000
    || !/^[a-f0-9]{40}$/.test(input.source_revision ?? "")
    || !Array.isArray(input.jobs) || input.jobs.length !== IDS.length) throw new Error("Snapshot identity rejected");
  const jobs = IDS.map(id => {
    const matches = input.jobs.filter(job => job.id === id);
    if (matches.length !== 1) throw new Error("Job set rejected");
    const job = matches[0];
    if (!Number.isInteger(job.step) || job.step < 0 || job.step > 100_000
      || !["queued", "checkpoint", "completed", "guard_stop"].includes(job.status)
      || (job.step > 0 && (!instant(job.checkpoint_at) || Date.parse(job.checkpoint_at) > Date.parse(input.information_updated_at) + 60_000))
      || (job.step === 0 && job.status !== "queued")
      || (job.status === "completed" && job.step !== 100_000)
      || (job.status === "queued" && job.step !== 0)
      || ![true, false, null].includes(job.guards_pass)
      || (job.step > 0 && typeof job.guards_pass !== "boolean")
      || (job.status === "guard_stop" && job.guards_pass !== false)
      || (job.status !== "guard_stop" && job.guards_pass === false)) throw new Error("Job evidence rejected");
    return { id, step: job.step, cap: 100_000, status: job.status,
      checkpoint_at: job.step ? job.checkpoint_at : null, guards_pass: job.guards_pass };
  });
  const stages = STAGES.map(id => {
    const entry = input.stages?.find(stage => stage.id === id);
    if (!entry || !STATES.includes(entry.state)) throw new Error("Project stages rejected");
    return { id, state: entry.state };
  });
  const baselineComplete = jobs.every(job => ["completed", "guard_stop"].includes(job.status));
  stages.find(stage => stage.id === "baseline").state = baselineComplete ? "complete" : "in_progress";
  if (typeof input.watchdog_armed !== "boolean") throw new Error("Watchdog state rejected");
  const history = Array.isArray(input.history) ? input.history : [];
  if (history.length > 160 || history.some(point => !instant(point.at) || !Number.isInteger(point.step)
    || point.step < 0 || point.step > 600_000 || Date.parse(point.at) > Date.parse(input.information_updated_at) + 60_000)) throw new Error("History rejected");
  for (let i = 1; i < history.length; i++) {
    if (Date.parse(history[i].at) < Date.parse(history[i - 1].at) || history[i].step < history[i - 1].step) throw new Error("History is not monotonic");
  }
  const total = jobs.reduce((sum, job) => sum + job.step, 0);
  if (history.length && history.at(-1).step !== total) throw new Error("History total differs");
  return { version: 1, information_updated_at: input.information_updated_at, source_revision: input.source_revision,
    jobs, stages, watchdog_armed: input.watchdog_armed,
    history: history.map(point => ({ at: point.at, step: point.step })) };
}

export function publicSnapshot(snapshot, mode, now = Date.now()) {
  const completed = snapshot.jobs.filter(job => job.status === "completed").length;
  const terminal = snapshot.jobs.filter(job => ["completed", "guard_stop"].includes(job.status)).length;
  const total = snapshot.jobs.reduce((sum, job) => sum + job.step, 0);
  const current = snapshot.jobs.find(job => job.status === "checkpoint") ?? snapshot.jobs.find(job => job.status === "queued") ?? null;
  return { ...snapshot, source_revision: undefined, feed_mode: mode,
    total_steps: total, total_cap: 600_000, percent: total / 6_000,
    completed_runs: completed, terminal_runs: terminal,
    current_job: current?.id ?? null,
    checkpoint_stale: Boolean(current?.checkpoint_at && now - Date.parse(current.checkpoint_at) > 25 * 60_000),
    runtime_confirmed: false,
    feed_stale: now - Date.parse(snapshot.information_updated_at) > 15 * 60_000 };
}

function json(value, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" } });
}

export async function routeNucleosomeProgress(request, env, authorize = progressWriterAuthorized) {
  const url = new URL(request.url);
  if (url.hostname !== "spark.bioengineering.workers.dev") return null;
  const api = url.pathname === "/api/nucleosome-progress";
  if (!api && url.pathname !== "/" && url.pathname !== "/nucleosome") return null;
  if (!api) {
    if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    return new Response(request.method === "HEAD" ? null : DASHBOARD_HTML, { headers: {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store, max-age=0",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" } });
  }
  const stub = env.CONTEXT_LOG?.getByName("nucleosome-progress");
  if (request.method === "GET") {
    let stored;
    try { stored = stub ? await stub.readNucleosomeProgress() : null; } catch { stored = null; }
    let data;
    try { data = stored ? validateSnapshot(JSON.parse(stored)) : null; } catch { data = null; }
    return json(publicSnapshot(data ?? INITIAL_SNAPSHOT, data ? "automatic" : "initial_snapshot"));
  }
  if (request.method !== "PUT") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, PUT" } });
  if (!await authorize(request)) return json({ error: "Unauthorized publisher" }, 401);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") return json({ error: "JSON required" }, 415);
  if (Number(request.headers.get("content-length")) > MAX_BYTES) return json({ error: "Payload too large" }, 413);
  if (!stub) return json({ error: "Persistent progress storage unavailable" }, 503);
  let data;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Missing body");
    let length = 0;
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_BYTES) { await reader.cancel(); return json({ error: "Payload too large" }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    data = validateSnapshot(JSON.parse(new TextDecoder().decode(bytes)));
  } catch { return json({ error: "Progress validation failed" }, 400); }
  try {
    const raw = JSON.stringify(data);
    await stub.writeNucleosomeProgress(raw, Date.parse(data.information_updated_at));
    const saved = await stub.readNucleosomeProgress();
    if (saved !== raw) return json({ error: "Newer progress already stored" }, 409);
    return json({ published: true, information_updated_at: data.information_updated_at,
      source_revision: data.source_revision, total_steps: data.jobs.reduce((sum, job) => sum + job.step, 0) });
  } catch { return json({ error: "Progress publication unavailable" }, 503); }
}
