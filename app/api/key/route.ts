import { env } from "cloudflare:workers";
import { apiKeyFromRequest, expiredApiKeyCookie, isAuthorized } from "@/lib/dashboard-auth";
import { readStoredApiKey, storeApiKey } from "@/lib/airq-key-store";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const API_ROOT = "https://air-q-cloud.de/open_api/v3";

function configuration() {
  const runtimeEnv = env as unknown as Record<string, unknown>;
  const sessionSecret = runtimeEnv.DASHBOARD_SESSION_SECRET;
  const labId = runtimeEnv.AIRQ_LAB_DEVICE_ID;
  const officeId = runtimeEnv.AIRQ_OFFICE_DEVICE_ID;
  const environmentKey = runtimeEnv.AIRQ_API_KEY;
  if (typeof sessionSecret !== "string" || typeof labId !== "string" || typeof officeId !== "string") return null;
  return { sessionSecret, labId, officeId, environmentKey: typeof environmentKey === "string" ? environmentKey : null };
}

async function validKeyForRoom(apiKey: string, deviceId: string) {
  const to = Date.now();
  const from = to - 24 * 60 * 60_000;
  const url = new URL(`${API_ROOT}/devices/${encodeURIComponent(deviceId)}/sensordata/timerange`);
  url.searchParams.set("f", String(from));
  url.searchParams.set("t", String(to));
  const response = await fetch(url, { headers: { "Api-Key": apiKey, Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) return false;
  const payload = await response.json().catch(() => null);
  return Array.isArray(payload);
}

async function configuredApiKey(request: Request, configured: NonNullable<ReturnType<typeof configuration>>) {
  if (configured.environmentKey) return configured.environmentKey;
  const sharedKey = await readStoredApiKey(configured.sessionSecret).catch(() => null);
  if (sharedKey) return sharedKey;

  // Promote the previous device-local setup automatically when it exists.
  const legacyKey = await apiKeyFromRequest(request, configured.sessionSecret);
  if (legacyKey) {
    await storeApiKey(legacyKey, configured.sessionSecret);
    return legacyKey;
  }
  return null;
}

export async function GET(request: Request) {
  const configured = configuration();
  if (!configured || !await isAuthorized(request, configured.sessionSecret)) {
    return Response.json({ error: "Authorization required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const storedKey = await configuredApiKey(request, configured);
  return Response.json({ configured: Boolean(storedKey) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const configured = configuration();
  if (!configured || !await isAuthorized(request, configured.sessionSecret)) {
    return Response.json({ error: "Authorization required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (await configuredApiKey(request, configured)) {
    return Response.json({ configured: true }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  let apiKey = "";
  try {
    const body = await request.json() as { apiKey?: unknown };
    if (typeof body.apiKey === "string") apiKey = body.apiKey.trim();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  if (apiKey.length < 8 || apiKey.length > 256) return Response.json({ error: "Invalid key" }, { status: 400 });

  const [labValid, officeValid] = await Promise.all([
    validKeyForRoom(apiKey, configured.labId),
    validKeyForRoom(apiKey, configured.officeId),
  ]);
  if (!labValid || !officeValid) {
    return Response.json({ error: "The key could not read both rooms" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  await storeApiKey(apiKey, configured.sessionSecret);
  return Response.json(
    { configured: true },
    { headers: { "Cache-Control": "no-store", "Set-Cookie": expiredApiKeyCookie() } },
  );
}

export async function DELETE(request: Request) {
  const configured = configuration();
  if (!configured || !await isAuthorized(request, configured.sessionSecret)) {
    return Response.json({ error: "Authorization required" }, { status: 401 });
  }
  return Response.json(
    { configured: Boolean(await configuredApiKey(request, configured)) },
    { headers: { "Cache-Control": "no-store", "Set-Cookie": expiredApiKeyCookie() } },
  );
}
