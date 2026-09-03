import { env } from "cloudflare:workers";
import { expiredSessionCookie, isAuthorized, sessionCookie, verifyPassword } from "@/lib/dashboard-auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function secrets() {
  const runtimeEnv = env as unknown as Record<string, unknown>;
  const passwordHash = runtimeEnv.DASHBOARD_PASSWORD_HASH;
  const sessionSecret = runtimeEnv.DASHBOARD_SESSION_SECRET;
  if (typeof passwordHash !== "string" || typeof sessionSecret !== "string") return null;
  return { passwordHash, sessionSecret };
}

export async function GET(request: Request) {
  const configured = secrets();
  const authorized = configured ? await isAuthorized(request, configured.sessionSecret) : false;
  return Response.json({ authorized }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const configured = secrets();
  if (!configured) return Response.json({ error: "Access protection is unavailable" }, { status: 503 });
  let password = "";
  try {
    const body = await request.json() as { password?: unknown };
    if (typeof body.password === "string") {
      // Shared wall displays use varied Android keyboards. Normalize harmless
      // keyboard differences while retaining the same stored password verifier.
      password = body.password.normalize("NFKC").trim().toUpperCase();
    }
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!password || password.length > 256 || !await verifyPassword(password, configured.passwordHash)) {
    return Response.json({ error: "Incorrect password" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(
    { authorized: true },
    { headers: { "Cache-Control": "no-store", "Set-Cookie": await sessionCookie(configured.sessionSecret) } },
  );
}

export async function DELETE() {
  return Response.json(
    { authorized: false },
    { headers: { "Cache-Control": "no-store", "Set-Cookie": expiredSessionCookie() } },
  );
}
