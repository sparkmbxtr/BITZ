const ISSUER = "https://token.actions.githubusercontent.com";
const REPOSITORY = "sparkmbxtr/nucleosome";
const REF = "refs/heads/codex/nucleosome-c-sync";
let cachedKeys;

function decode(segment) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error("Invalid JWT segment");
  const padded = segment.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(segment.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

export function allowedProgressClaims(claims, now = Math.floor(Date.now() / 1000)) {
  return claims.iss === ISSUER
    && claims.aud === "nucleosome-progress"
    && claims.repository === REPOSITORY
    && claims.repository_id === "1439578026"
    && claims.repository_owner_id === "324419950"
    && claims.repository_visibility === "private"
    && claims.ref === REF
    && claims.workflow_ref === `${REPOSITORY}/.github/workflows/publish-nucleosome-progress.yml@${REF}`
    && claims.runner_environment === "github-hosted"
    && ["push", "workflow_dispatch"].includes(claims.event_name)
    && Number.isFinite(claims.iat) && Number.isFinite(claims.exp)
    && claims.iat <= now + 60 && claims.iat >= now - 900
    && claims.exp > now && claims.exp > claims.iat && claims.exp - claims.iat <= 900
    && (claims.nbf === undefined || (Number.isFinite(claims.nbf) && claims.nbf <= now + 60));
}

export async function progressWriterAuthorized(request, fetcher = fetch) {
  const token = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_.-]+)$/i)?.[1];
  if (!token || token.length > 16_384) return false;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const header = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));
    if (header.alg !== "RS256" || typeof header.kid !== "string" || !allowedProgressClaims(claims)) return false;
    if (!cachedKeys || cachedKeys.expiresAt < Date.now() || !cachedKeys.keys.some(k => k.kid === header.kid)) {
      const response = await fetcher(`${ISSUER}/.well-known/jwks`, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return false;
      const payload = await response.json();
      if (!Array.isArray(payload.keys)) return false;
      cachedKeys = { keys: payload.keys, expiresAt: Date.now() + 600_000 };
    }
    const jwk = cachedKeys.keys.find(k => k.kid === header.kid && k.kty === "RSA" && k.use === "sig");
    if (!jwk) return false;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  } catch {
    return false;
  }
}
