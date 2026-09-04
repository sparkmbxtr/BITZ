import { env } from "cloudflare:workers";
import { isAuthorized, isBearerAuthorized } from "@/lib/dashboard-auth";
import { isGitHubActionsExportAuthorized } from "@/lib/github-actions-oidc";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type ContextArea = "LAB" | "OFFICE" | "OUTDOOR";

type ContextEntry = {
  id: string;
  createdAt: number;
  area: ContextArea;
  note: string;
};

type ContextLogStub = {
  add(entry: ContextEntry): Promise<ContextEntry>;
  list(from: number, to: number, limit?: number): Promise<ContextEntry[]>;
};

type ContextLogNamespace = {
  getByName(name: string): ContextLogStub;
};

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function runtimeBinding<T>(name: string) {
  return (env as unknown as Record<string, unknown>)[name] as T | undefined;
}

async function authorized(request: Request) {
  const secret = runtimeBinding<string>("DASHBOARD_SESSION_SECRET");
  return Boolean(secret && await isAuthorized(request, secret));
}

async function exportTokenAuthorized(request: Request) {
  const expected = runtimeBinding<string>("MONITOR_EXPORT_TOKEN");
  return Boolean(expected && await isBearerAuthorized(request, expected))
    || await isGitHubActionsExportAuthorized(request);
}

async function canReadContext(request: Request) {
  return await authorized(request) || await exportTokenAuthorized(request);
}

function contextLog() {
  const namespace = runtimeBinding<ContextLogNamespace>("CONTEXT_LOG");
  if (!namespace?.getByName) return null;
  return namespace.getByName("airq-context-log");
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

function cleanNote(value: unknown) {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function validArea(value: unknown): value is ContextArea {
  return value === "LAB" || value === "OFFICE" || value === "OUTDOOR";
}

export async function POST(request: Request) {
  if (!await authorized(request)) return json({ error: "Unauthorized" }, 401);
  if (!sameOrigin(request)) return json({ error: "Origin rejected" }, 403);

  const payload = await request.json().catch(() => null) as { area?: unknown; note?: unknown; observedAt?: unknown } | null;
  const area = payload?.area;
  const note = cleanNote(payload?.note);
  if (!validArea(area)) return json({ error: "Select LAB, OFFICE or OUTDOOR" }, 400);
  if (!note) return json({ error: "Context is empty" }, 400);
  if (note.length > 500) return json({ error: "Context is limited to 500 characters" }, 400);

  const stub = contextLog();
  if (!stub) return json({ error: "Context log is unavailable" }, 503);

  const now = Date.now();
  const requestedTimestamp = Number(payload?.observedAt);
  const createdAt = Number.isFinite(requestedTimestamp) && requestedTimestamp >= now - 12 * 60 * 60_000 && requestedTimestamp <= now + 60_000
    ? Math.floor(requestedTimestamp)
    : now;
  const entry: ContextEntry = {
    id: crypto.randomUUID(),
    createdAt,
    area,
    note,
  };

  try {
    await stub.add(entry);
    return json({ saved: true, entry: { id: entry.id, createdAt: entry.createdAt, area: entry.area } }, 201);
  } catch (error) {
    if (error instanceof Error && error.message.includes("CONTEXT_RATE_LIMIT")) {
      return json({ error: "Too many entries; wait one minute" }, 429);
    }
    return json({ error: "Context could not be saved" }, 503);
  }
}

export async function GET(request: Request) {
  if (!await canReadContext(request)) return json({ error: "Unauthorized" }, 401);
  const stub = contextLog();
  if (!stub) return json({ error: "Context log is unavailable" }, 503);

  const url = new URL(request.url);
  const now = Date.now();
  const fromValue = url.searchParams.get("from");
  const toValue = url.searchParams.get("to");
  const requestedFrom = fromValue === null ? Number.NaN : Number(fromValue);
  const requestedTo = toValue === null ? Number.NaN : Number(toValue);
  const to = Number.isFinite(requestedTo) ? Math.min(requestedTo, now + 60_000) : now;
  const defaultFrom = to - 48 * 60 * 60_000;
  const from = Number.isFinite(requestedFrom)
    ? Math.max(requestedFrom, to - 31 * 24 * 60 * 60_000)
    : defaultFrom;
  if (from > to) return json({ error: "Invalid time range" }, 400);

  try {
    const entries = await stub.list(from, to, 5000);
    return json({
      schemaVersion: 1,
      timezone: "Europe/Berlin",
      exportedAt: now,
      range: { from, to },
      entries,
    });
  } catch {
    return json({ error: "Context log could not be read" }, 503);
  }
}
