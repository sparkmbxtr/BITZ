import { allowedProgressClaims, verifyGithubWriter } from "./nucleosome-oidc.mjs";

export const EXTRA_ACCESS_ENROLLMENT = "owner-extra-login-20261110";
const endpoint = "/api/nucleosome-extra-access";
const workflow = "sparkmbxtr/nucleosome/.github/workflows/enroll-extra-monitor-login-20261110.yml@refs/heads/codex/nucleosome-c-sync";
const headers = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
const reply = (value, status = 200) => Response.json(value, { status, headers });
const hex = bytes => Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("");
const bytes = value => Uint8Array.from(value.match(/../g), value => parseInt(value, 16));

export function allowedExtraAccessClaims(claims, now) {
  return allowedProgressClaims({ ...claims, aud: "nucleosome-progress",
    workflow_ref: "sparkmbxtr/nucleosome/.github/workflows/publish-nucleosome-progress.yml@refs/heads/codex/nucleosome-c-sync" }, now)
    && claims.aud === "nucleosome-extra-access-20261110"
    && claims.workflow_ref === workflow && claims.event_name === "push";
}

export function validateExtraAccess(value) {
  if (!value || Object.keys(value).sort().join(",") !== "algorithm,enrollment,hash,iterations,salt,version"
    || value.version !== 1 || value.enrollment !== EXTRA_ACCESS_ENROLLMENT || value.algorithm !== "PBKDF2-SHA256"
    || value.iterations !== 100000 || typeof value.salt !== "string" || typeof value.hash !== "string"
    || !/^[a-f0-9]{32}$/.test(value.salt) || !/^[a-f0-9]{64}$/.test(value.hash)) {
    throw new Error("Invalid supplemental access enrollment");
  }
  return { version: 1, enrollment: value.enrollment, algorithm: value.algorithm,
    iterations: value.iterations, salt: value.salt, hash: value.hash };
}

export async function verifyExtraMonitorPassword(supplied, env) {
  if (typeof supplied !== "string") return false;
  const password = supplied.normalize("NFKC").replace(/[\p{Cf}\p{Z}\s]/gu, "");
  if (!password || password.length > 256) return false;
  try {
    const store = env.CONTEXT_LOG?.getByName("nucleosome-progress");
    if (!store?.readExtraMonitorAccess) return false;
    const raw = await store.readExtraMonitorAccess(EXTRA_ACCESS_ENROLLMENT);
    if (!raw) return false;
    const record = validateExtraAccess(JSON.parse(raw));
    for (const variant of new Set([password, password.toUpperCase(), password.toLowerCase()])) {
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(variant), "PBKDF2", false, ["deriveBits"]);
      const hash = hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256",
        salt: bytes(record.salt), iterations: record.iterations }, key, 256));
      let mismatch = 0;
      for (let i = 0; i < hash.length; i++) mismatch |= hash.charCodeAt(i) ^ record.hash.charCodeAt(i);
      if (mismatch === 0) return true;
    }
  } catch { /* Unavailable/malformed supplemental storage never grants access. */ }
  return false;
}

export async function routeExtraMonitorAccess(request, env, authorize = r => verifyGithubWriter(r, allowedExtraAccessClaims)) {
  const url = new URL(request.url);
  if (url.hostname !== "spark.bioengineering.workers.dev" || url.pathname !== endpoint) return null;
  if (request.method !== "PUT") return reply({ error: "Method not allowed" }, 405);
  if (!await authorize(request)) return reply({ error: "Private enrollment authorization required" }, 401);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") return reply({ error: "JSON required" }, 415);
  if (Number(request.headers.get("content-length")) > 1024) return reply({ error: "Request too large" }, 413);
  const reader = request.body?.getReader();
  if (!reader) return reply({ error: "Invalid enrollment" }, 400);
  let value;
  try {
    let size = 0; const pieces = [];
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 1024) { await reader.cancel(); return reply({ error: "Request too large" }, 413); }
      pieces.push(value);
    }
    const raw = new Uint8Array(size); let offset = 0;
    for (const piece of pieces) { raw.set(piece, offset); offset += piece.length; }
    value = JSON.stringify(validateExtraAccess(JSON.parse(new TextDecoder().decode(raw))));
  } catch { return reply({ error: "Invalid enrollment" }, 400); }
  try {
    const store = env.CONTEXT_LOG?.getByName("nucleosome-progress");
    if (!store) return reply({ error: "Private access storage unavailable" }, 503);
    if (!await store.putExtraMonitorAccess(EXTRA_ACCESS_ENROLLMENT, value)) return reply({ error: "Existing enrollment preserved" }, 409);
    if (await store.readExtraMonitorAccess(EXTRA_ACCESS_ENROLLMENT) !== value) return reply({ error: "Enrollment readback unavailable" }, 503);
    return reply({ enrolled: true, readback_verified: true, existing_access_preserved: true });
  } catch { return reply({ error: "Private access storage unavailable" }, 503); }
}
