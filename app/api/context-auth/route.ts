import { env } from "cloudflare:workers";
import {
  contextEntryCookie,
  expiredContextEntryCookie,
  isAuthorized,
  passwordVerifierReady,
  verifyPassword,
} from "@/lib/dashboard-auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders);
  headers.set("Cache-Control", "no-store, max-age=0");
  return Response.json(body, { status, headers });
}

function secrets() {
  const runtimeEnv = env as unknown as Record<string, unknown>;
  const passwordHash = runtimeEnv.CONTEXT_ENTRY_PASSWORD_HASH;
  const sessionSecret = runtimeEnv.DASHBOARD_SESSION_SECRET;
  if (typeof passwordHash !== "string" || typeof sessionSecret !== "string") return null;
  return { passwordHash, sessionSecret };
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

export async function POST(request: Request) {
  const configured = secrets();
  if (!configured || !passwordVerifierReady(configured.passwordHash)) {
    return json({ error: "Context protection is unavailable" }, 503);
  }
  if (!await isAuthorized(request, configured.sessionSecret)) {
    return json({ error: "Dashboard session required" }, 401);
  }
  if (!sameOrigin(request)) return json({ error: "Origin rejected" }, 403);

  let password = "";
  try {
    const body = await request.json() as { password?: unknown };
    if (typeof body.password === "string") {
      password = body.password.normalize("NFKC").replace(/[\p{Cf}\p{Z}\s]/gu, "").toUpperCase();
    }
  } catch {
    return json({ error: "Invalid request" }, 400);
  }

  if (!password || password.length > 256 || !await verifyPassword(password, configured.passwordHash)) {
    return json({ error: "Password not accepted" }, 401);
  }

  return json(
    { authorized: true, expiresInSeconds: 300 },
    200,
    { "Set-Cookie": await contextEntryCookie(configured.sessionSecret) },
  );
}

export async function DELETE() {
  return json(
    { authorized: false },
    200,
    { "Set-Cookie": expiredContextEntryCookie() },
  );
}
