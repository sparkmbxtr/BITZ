import { monitorAuthorized } from "./nucleosome-auth.mjs";
import { allowedProgressClaims, verifyGithubWriter } from "./nucleosome-oidc.mjs";
import { PILOT_MANIFEST_SHA256 } from "./pilot-revision.mjs";

const ROOT = "/api/pilot-library";
const CHUNK_BYTES = 240 * 1024;
const HEX = /^[a-f0-9]{64}$/;
const NAME = /^[a-z0-9][a-z0-9.-]{0,100}$/;
const headers = { "Cache-Control": "no-store, max-age=0, must-revalidate", "CDN-Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow" };
const json = (data, status = 200) => Response.json(data, { status, headers });
const sha = async raw => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", raw)), n => n.toString(16).padStart(2, "0")).join("");

export function allowedPilotClaims(claims, now) {
  // Reuse every original private-repository/branch/runner/time identity check,
  // then require this distinct audience and this single own-file push workflow.
  return allowedProgressClaims({ ...claims, aud: "nucleosome-progress",
    workflow_ref: "sparkmbxtr/nucleosome/.github/workflows/publish-nucleosome-progress.yml@refs/heads/codex/nucleosome-c-sync" }, now)
    && claims.aud === "nucleosome-pilot-assets"
    && claims.workflow_ref === "sparkmbxtr/nucleosome/.github/workflows/publish-historical-pilots-20261110.yml@refs/heads/codex/nucleosome-c-sync"
    && claims.event_name === "push";
}

export function validatePilotManifest(raw) {
  const value = JSON.parse(raw);
  if (value.version !== 1 || !Array.isArray(value.files) || !value.files.length || value.files.length > 1100) throw new Error("Pilot manifest rejected");
  const names = new Set(); let total = 0;
  for (const item of value.files) {
    if (!NAME.test(item.name) || names.has(item.name) || !HEX.test(item.sha256) || !Number.isInteger(item.bytes)
      || item.bytes < 1 || item.bytes > 32 * 1024**2 || !["application/json", "application/javascript", "application/octet-stream", "text/plain"].includes(item.type)
      || !Array.isArray(item.chunks) || item.chunks.length !== Math.ceil(item.bytes / CHUNK_BYTES)) throw new Error("Pilot asset rejected");
    names.add(item.name);total += item.bytes;
    item.chunks.forEach((part, i) => {
      if (!HEX.test(part.sha256) || part.bytes !== Math.min(CHUNK_BYTES, item.bytes - i * CHUNK_BYTES)) throw new Error("Pilot chunk rejected");
    });
  }
  if (total > 512 * 1024**2) throw new Error("Pilot capacity rejected");
  return value;
}

async function bounded(request, limit) {
  if (Number(request.headers.get("content-length")) > limit) throw new Error("Body too large");
  const reader = request.body?.getReader();if (!reader) return new Uint8Array();
  const pieces = [];let size = 0;
  while (true) { const {done, value} = await reader.read();if (done) break;size += value.length;
    if (size > limit) { await reader.cancel();throw new Error("Body too large"); } pieces.push(value); }
  const raw = new Uint8Array(size);let offset = 0;for (const piece of pieces) {raw.set(piece, offset);offset += piece.length;}return raw;
}

export async function routePilotLibrary(request, env, options = {}) {
  const url = new URL(request.url);
  if (url.hostname !== "spark.bioengineering.workers.dev" || !(url.pathname === ROOT || url.pathname.startsWith(ROOT + "/"))) return null;
  const revision = options.revision ?? PILOT_MANIFEST_SHA256;
  const writer = options.authorize ?? (r => verifyGithubWriter(r, allowedPilotClaims));
  const writing = request.method === "PUT";
  if (writing ? !await writer(request) : !await monitorAuthorized(request, env)) return json({error:"Monitor access required"}, 401);
  if (!["GET", "HEAD", "PUT"].includes(request.method)) return json({error:"Method not allowed"}, 405);
  const store = env.CONTEXT_LOG?.getByName("nucleosome-progress");
  if (!store || !HEX.test(revision)) return json({error:"Historical library unavailable"}, 503);
  try {
    if (url.pathname === ROOT + "/manifest") {
      if (writing) {
        const bytes = await bounded(request, 1024 * 1024);
        if (await sha(bytes) !== revision) return json({error:"Unreviewed manifest rejected"}, 409);
        const raw = new TextDecoder("utf-8", {fatal:true}).decode(bytes);validatePilotManifest(raw);
        if (!await store.putPilotManifest(revision, raw)) throw new Error("Manifest readback failed");
        return json({stored:true, revision});
      }
      const raw = await store.readPilotManifest(revision);
      return raw ? new Response(request.method === "HEAD" ? null : raw, {headers:{...headers,"Content-Type":"application/json"}}) : json({error:"Historical data is being prepared"}, 503);
    }
    const match = url.pathname.match(/^\/api\/pilot-library\/assets\/([a-z0-9][a-z0-9.-]{0,100})(?:\/chunks\/(0|[1-9][0-9]{0,3}))?$/);
    if (!match) return json({error:"Unknown asset"}, 404);
    const raw = await store.readPilotManifest(revision);if (!raw) return json({error:"Historical data is being prepared"}, 503);
    const manifest = validatePilotManifest(raw), asset = manifest.files.find(item => item.name === match[1]);
    if (!asset) return json({error:"Unknown asset"}, 404);
    if (writing) {
      const part = Number(match[2]);if (match[2] === undefined || !asset.chunks[part]) return json({error:"Unknown chunk"}, 404);
      const bytes = await bounded(request, CHUNK_BYTES), expected = asset.chunks[part];
      if (bytes.length !== expected.bytes || await sha(bytes) !== expected.sha256) return json({error:"Chunk integrity rejected"}, 409);
      if (!await store.putPilotChunk(revision, asset.name, part, bytes.buffer)) throw new Error("Chunk readback failed");
      return json({stored:true, asset:asset.name, part});
    }
    if (match[2] !== undefined) return json({error:"Unknown asset"}, 404);
    const status = await store.pilotAssetStatus(revision, asset.name);
    if (status.parts !== asset.chunks.length || status.bytes !== asset.bytes) return json({error:"Saved frames are still being prepared"}, 503);
    let index = 0;
    const stream = request.method === "HEAD" ? null : new ReadableStream({
      async pull(controller) {
        try {
          if (index === asset.chunks.length) {controller.close();return;}
          const bytes = new Uint8Array(await store.readPilotChunk(revision, asset.name, index));
          if (bytes.length !== asset.chunks[index].bytes || await sha(bytes) !== asset.chunks[index].sha256) throw new Error("Stored chunk integrity failure");
          index++;controller.enqueue(bytes);
        } catch {controller.error(new Error("Saved asset integrity unavailable"));}
      },
    });
    return new Response(stream, {headers:{...headers,"Content-Type":asset.type,"Content-Length":String(asset.bytes),"X-Content-SHA256":asset.sha256}});
  } catch { return json({error:"Historical library operation failed; data retained"}, 503); }
}
