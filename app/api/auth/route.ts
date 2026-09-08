import { env } from "cloudflare:workers";
import { expiredSessionCookie, isAuthorized, passwordVerifierReady, sessionGrant, verifyPassword } from "@/lib/dashboard-auth";

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
  return Response.json(
    { authorized, passwordVerifierReady: configured ? passwordVerifierReady(configured.passwordHash) : false },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

export async function POST(request: Request) {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  const nativeForm = contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data");
  const redirectToGate = (reason: "incorrect" | "unavailable") => {
    const target = new URL("/", request.url);
    target.searchParams.set("login", reason);
    return new Response(null, {
      status: 303,
      headers: { "Cache-Control": "no-store", Location: target.toString() },
    });
  };

  const configured = secrets();
  if (!configured) {
    return nativeForm
      ? redirectToGate("unavailable")
      : Response.json({ error: "Access protection is unavailable" }, { status: 503 });
  }
  if (!passwordVerifierReady(configured.passwordHash)) {
    return nativeForm
      ? redirectToGate("unavailable")
      : Response.json({ error: "Display password configuration needs correction" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  let password = "";
  try {
    let supplied: unknown;
    if (nativeForm) {
      const body = await request.formData();
      supplied = body.get("password") ?? body.get("display-password");
    } else {
      const body = await request.json() as { password?: unknown };
      supplied = body.password;
    }
    if (typeof supplied === "string") {
      // Shared wall displays use varied keyboards. Normalize harmless keyboard
      // differences while retaining the same stored password verifier.
      password = supplied.normalize("NFKC").replace(/[\p{Cf}\p{Z}\s]/gu, "").toUpperCase();
    }
  } catch {
    return nativeForm
      ? redirectToGate("unavailable")
      : Response.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!password || password.length > 256 || !await verifyPassword(password, configured.passwordHash)) {
    return nativeForm
      ? redirectToGate("incorrect")
      : Response.json({ error: "Incorrect password" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const grant = await sessionGrant(configured.sessionSecret);
  if (nativeForm) {
    return new Response(null, {
      status: 303,
      headers: {
        "Cache-Control": "no-store",
        Location: new URL("/", request.url).toString(),
        "Set-Cookie": grant.cookie,
      },
    });
  }
  const portableSessionRequested = request.headers.get("x-bitz-session-mode") === "portable";
  return Response.json(
    { authorized: true, ...(portableSessionRequested ? { sessionToken: grant.token, expiresAt: grant.expiresAt } : {}) },
    { headers: { "Cache-Control": "no-store", "Set-Cookie": grant.cookie } },
  );
}

export async function DELETE() {
  return Response.json(
    { authorized: false },
    { headers: { "Cache-Control": "no-store", "Set-Cookie": expiredSessionCookie() } },
  );
}
