import { env } from "cloudflare:workers";
import QRCode from "qrcode";

import { isAuthorized, passwordVerifierReady, sessionGrant, verifyPassword } from "@/lib/dashboard-auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const PAIRING_LIFETIME_MS = 10 * 60_000;
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

type PairingPoll = {
  status: "pending" | "approved" | "expired";
  sessionToken?: string;
};

type PairingStore = {
  createDisplayPairing(pairing: {
    id: string;
    code: string;
    pollSecretHash: string;
    createdAt: number;
    expiresAt: number;
  }): Promise<void>;
  approveDisplayPairing(code: string, sessionToken: string): Promise<boolean>;
  consumeDisplayPairing(id: string, pollSecretHash: string): Promise<PairingPoll>;
};

type PairingNamespace = {
  getByName(name: string): PairingStore;
};

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function pairingStore() {
  const namespace = (env as unknown as Record<string, unknown>).CONTEXT_LOG as PairingNamespace | undefined;
  return namespace?.getByName ? namespace.getByName("airq-context-log") : null;
}

function randomCode(length = 7) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function dashboardSecrets() {
  const runtimeEnv = env as unknown as Record<string, unknown>;
  const passwordHash = runtimeEnv.DASHBOARD_PASSWORD_HASH;
  const sessionSecret = runtimeEnv.DASHBOARD_SESSION_SECRET;
  if (typeof passwordHash !== "string" || typeof sessionSecret !== "string") return null;
  return { passwordHash, sessionSecret };
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Origin rejected" }, 403);
  const store = pairingStore();
  if (!store) return json({ error: "Display pairing is unavailable" }, 503);

  const body = await request.json().catch(() => null) as {
    action?: unknown;
    pairingId?: unknown;
    pollSecret?: unknown;
  } | null;

  if (body?.action === "poll") {
    if (typeof body.pairingId !== "string" || typeof body.pollSecret !== "string"
      || body.pairingId.length > 80 || body.pollSecret.length > 100) {
      return json({ error: "Invalid pairing request" }, 400);
    }
    const result = await store.consumeDisplayPairing(body.pairingId, await sha256(body.pollSecret));
    return json(result, result.status === "pending" ? 202 : result.status === "approved" ? 200 : 410);
  }

  if (body?.action !== "start") return json({ error: "Invalid pairing request" }, 400);

  const now = Date.now();
  const pairingId = crypto.randomUUID();
  const pollSecret = randomSecret();
  const expiresAt = now + PAIRING_LIFETIME_MS;
  let code = "";
  let stored = false;
  for (let attempt = 0; attempt < 5 && !stored; attempt += 1) {
    code = randomCode();
    try {
      await store.createDisplayPairing({
        id: pairingId,
        code,
        pollSecretHash: await sha256(pollSecret),
        createdAt: now,
        expiresAt,
      });
      stored = true;
    } catch (error) {
      if (error instanceof Error && error.message.includes("PAIRING_RATE_LIMIT")) {
        return json({ error: "Too many pairing requests; wait one minute" }, 429);
      }
    }
  }
  if (!stored) return json({ error: "Display pairing could not be started" }, 503);

  const origin = new URL(request.url).origin;
  const approvalUrl = `${origin}/pair?code=${encodeURIComponent(code)}`;
  const qrSvg = await QRCode.toString(approvalUrl, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 280,
    color: { dark: "#032c2b", light: "#f4fffaf0" },
  });

  return json({ pairingId, pollSecret, code, expiresAt, approvalUrl, qrSvg }, 201);
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Origin rejected" }, 403);
  const configured = dashboardSecrets();
  const store = pairingStore();
  if (!configured || !passwordVerifierReady(configured.passwordHash) || !store) {
    return json({ error: "Display pairing is unavailable" }, 503);
  }

  const body = await request.json().catch(() => null) as { code?: unknown; password?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.normalize("NFKC").replace(/[^A-Z0-9]/gi, "").toUpperCase() : "";
  let password = "";
  if (typeof body?.password === "string") {
    password = body.password.normalize("NFKC").replace(/[\p{Cf}\p{Z}\s]/gu, "").toUpperCase();
  }

  const phoneAlreadyAuthorized = await isAuthorized(request, configured.sessionSecret);
  const passwordAccepted = Boolean(password && password.length <= 256 && await verifyPassword(password, configured.passwordHash));
  if (!code || (!phoneAlreadyAuthorized && !passwordAccepted)) {
    return json({ error: "Code or password not accepted" }, 401);
  }

  const grant = await sessionGrant(configured.sessionSecret);
  if (!await store.approveDisplayPairing(code, grant.token)) {
    return json({ error: "Pairing code expired or not found" }, 404);
  }
  return json({ approved: true });
}
