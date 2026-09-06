const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_JWKS = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;
const EXPORT_AUDIENCE = "bitz-monitor-export";
const EXPORT_REPOSITORY = "sparkmbxtr/BITZ";
const EXPORT_REPOSITORY_ID = "1355786577";
const EXPORT_REPOSITORY_OWNER_ID = "324419950";
const EXPORT_REF = "refs/heads/main";
const EXPORT_WORKFLOW_REFS = new Set([
  `${EXPORT_REPOSITORY}/.github/workflows/archive-monitoring.yml@${EXPORT_REF}`,
  `${EXPORT_REPOSITORY}/.github/workflows/export-first-week.yml@${EXPORT_REF}`,
]);
const CLOCK_SKEW_SECONDS = 60;
const MAX_TOKEN_AGE_SECONDS = 15 * 60;
const JWKS_CACHE_MS = 10 * 60_000;

type JwtHeader = {
  alg?: unknown;
  kid?: unknown;
};

type JwtClaims = {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
  iat?: unknown;
  repository?: unknown;
  repository_id?: unknown;
  repository_owner_id?: unknown;
  repository_visibility?: unknown;
  runner_environment?: unknown;
  ref?: unknown;
  workflow_ref?: unknown;
  event_name?: unknown;
};

type JwksResponse = {
  keys?: JsonWebKey[];
};

let jwksCache: { expiresAt: number; keys: JsonWebKey[] } | null = null;

function bearerToken(request: Request) {
  return request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
}

function base64UrlDecode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url value");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function jsonSegment<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(value))) as T;
}

function audienceMatches(value: unknown) {
  return value === EXPORT_AUDIENCE || (Array.isArray(value) && value.includes(EXPORT_AUDIENCE));
}

function claimsAreAllowed(claims: JwtClaims) {
  const now = Math.floor(Date.now() / 1000);
  const exp = typeof claims.exp === "number" ? claims.exp : Number.NaN;
  const nbf = typeof claims.nbf === "number" ? claims.nbf : Number.NaN;
  const iat = typeof claims.iat === "number" ? claims.iat : Number.NaN;
  const allowedEvent = claims.event_name === "schedule" || claims.event_name === "workflow_dispatch" || claims.event_name === "push";

  return claims.iss === GITHUB_OIDC_ISSUER
    && audienceMatches(claims.aud)
    && claims.repository === EXPORT_REPOSITORY
    && claims.repository_id === EXPORT_REPOSITORY_ID
    && claims.repository_owner_id === EXPORT_REPOSITORY_OWNER_ID
    && claims.repository_visibility === "private"
    && claims.runner_environment === "github-hosted"
    && claims.ref === EXPORT_REF
    && typeof claims.workflow_ref === "string"
    && EXPORT_WORKFLOW_REFS.has(claims.workflow_ref)
    && allowedEvent
    && Number.isFinite(exp)
    && Number.isFinite(iat)
    && exp > now - CLOCK_SKEW_SECONDS
    && iat <= now + CLOCK_SKEW_SECONDS
    && iat >= now - MAX_TOKEN_AGE_SECONDS
    && exp - iat <= MAX_TOKEN_AGE_SECONDS
    && (!Number.isFinite(nbf) || nbf <= now + CLOCK_SKEW_SECONDS);
}

async function githubKeys(forceRefresh = false) {
  if (!forceRefresh && jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const response = await fetch(GITHUB_OIDC_JWKS, {
    headers: { Accept: "application/json" },
    cf: { cacheEverything: true, cacheTtl: 600 },
  } as RequestInit);
  if (!response.ok) throw new Error("GitHub OIDC keys unavailable");
  const payload = await response.json() as JwksResponse;
  const keys = Array.isArray(payload.keys) ? payload.keys : [];
  if (!keys.length) throw new Error("GitHub OIDC keys missing");
  jwksCache = { expiresAt: Date.now() + JWKS_CACHE_MS, keys };
  return keys;
}

async function signingKey(kid: string) {
  let keys = await githubKeys();
  let key = keys.find((candidate) => candidate.kid === kid && candidate.kty === "RSA" && candidate.use === "sig");
  if (!key) {
    keys = await githubKeys(true);
    key = keys.find((candidate) => candidate.kid === kid && candidate.kty === "RSA" && candidate.use === "sig");
  }
  return key ?? null;
}

export async function isGitHubActionsExportAuthorized(request: Request) {
  const token = bearerToken(request);
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) return false;

  try {
    const header = jsonSegment<JwtHeader>(parts[0]);
    const claims = jsonSegment<JwtClaims>(parts[1]);
    if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid || !claimsAreAllowed(claims)) return false;
    const jwk = await signingKey(header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      base64UrlDecode(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    return false;
  }
}
