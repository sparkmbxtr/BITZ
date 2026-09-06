import { env } from "cloudflare:workers";
import { isAuthorized, isBearerAuthorized } from "@/lib/dashboard-auth";
import { isGitHubActionsExportAuthorized } from "@/lib/github-actions-oidc";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const REPORT_INPUT_GUIDE = "RICHARD/JEFF/JESS/LILIANA//Dr.Itzel//Dr.Kaarthik//Dr.Fidelis";
const REPORT_PENDING_MESSAGE = "The latest weekly report has not been generated yet.";

type ReportDownload = {
  id: string;
  createdAt: number;
  firstName: string;
  reportName: string;
};

type ReportLogStub = {
  addReportDownload(entry: ReportDownload): Promise<ReportDownload>;
  listReportDownloads(from: number, to: number, limit?: number): Promise<ReportDownload[]>;
};

type ReportLogNamespace = {
  getByName(name: string): ReportLogStub;
};

type ReportObject = {
  body: ReadableStream;
  size?: number;
};

type ReportHead = {
  size?: number;
};

type ReportsBucket = {
  head(key: string): Promise<ReportHead | null>;
  get(key: string): Promise<ReportObject | null>;
};

type ExpectedReport = {
  key: string;
  fileName: string;
  periodLabel: string;
};

function runtimeBinding<T>(name: string) {
  return (env as unknown as Record<string, unknown>)[name] as T | undefined;
}

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function reportLog() {
  const namespace = runtimeBinding<ReportLogNamespace>("CONTEXT_LOG");
  if (!namespace?.getByName) return null;
  return namespace.getByName("airq-context-log");
}

function reportsBucket() {
  const bucket = runtimeBinding<ReportsBucket>("REPORTS_BUCKET");
  return bucket?.head && bucket?.get ? bucket : null;
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

function cleanFirstName(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validFirstName(value: string) {
  if (!value || value.length > 80 || value === REPORT_INPUT_GUIDE) return false;
  return /^[\p{L}\p{M}][\p{L}\p{M}.'’ -]{0,79}$/u.test(value);
}

async function dashboardAuthorized(request: Request) {
  const secret = runtimeBinding<string>("DASHBOARD_SESSION_SECRET");
  return Boolean(secret && await isAuthorized(request, secret));
}

async function exportAuthorized(request: Request) {
  const expected = runtimeBinding<string>("MONITOR_EXPORT_TOKEN");
  return Boolean(expected && await isBearerAuthorized(request, expected))
    || await isGitHubActionsExportAuthorized(request);
}

function csvCell(value: string | number) {
  const text = String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function berlinTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(timestamp);
}

function berlinCalendarDate(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(timestamp);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function compactDate(serialDate: Date) {
  return `${String(serialDate.getUTCMonth() + 1).padStart(2, "0")}${String(serialDate.getUTCDate()).padStart(2, "0")}${String(serialDate.getUTCFullYear()).slice(-2)}`;
}

function expectedWeeklyReport(now = Date.now()): ExpectedReport {
  const local = berlinCalendarDate(now);
  const localSerial = Date.UTC(local.year, local.month - 1, local.day);
  const weekday = new Date(localSerial).getUTCDay();
  const daysSinceSaturday = (weekday - 6 + 7) % 7;
  const end = new Date(localSerial - daysSinceSaturday * 86_400_000);
  const start = new Date(end.getTime() - 5 * 86_400_000);
  const range = `${compactDate(start)}-${compactDate(end)}`;
  const fileName = `airq_monitoring_weekly_${range}.pdf`;
  return {
    key: `weekly/${fileName}`,
    fileName,
    periodLabel: range.replace("-", "–"),
  };
}

async function reportAvailable(report: ExpectedReport) {
  const bucket = reportsBucket();
  if (!bucket) return false;
  try {
    const object = await bucket.head(report.key);
    return Boolean(object && (object.size === undefined || object.size > 0));
  } catch {
    return false;
  }
}

async function exportDownloadLog(request: Request) {
  if (!await exportAuthorized(request)) return json({ error: "Unauthorized" }, 401);

  const stub = reportLog();
  if (!stub) return json({ error: "Report log is unavailable" }, 503);

  const url = new URL(request.url);
  const now = Date.now();
  const requestedFrom = Number(url.searchParams.get("from"));
  const requestedTo = Number(url.searchParams.get("to"));
  const from = Number.isFinite(requestedFrom) && requestedFrom >= 0 ? requestedFrom : 0;
  const to = Number.isFinite(requestedTo) && requestedTo > 0 ? Math.min(requestedTo, now + 60_000) : now;
  if (from > to) return json({ error: "Invalid time range" }, 400);

  try {
    const entries = await stub.listReportDownloads(from, to, 5000);
    const rows = [
      ["Download ID", "Downloaded at (Europe/Berlin)", "Downloaded at (UTC)", "First name", "Report"],
      ...entries.map((entry) => [
        entry.id,
        berlinTimestamp(entry.createdAt),
        new Date(entry.createdAt).toISOString(),
        entry.firstName,
        entry.reportName,
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="airq_weekly_report_downloads.csv"',
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return json({ error: "Report log could not be read" }, 503);
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("downloadLog") === "csv") return exportDownloadLog(request);
  if (!await dashboardAuthorized(request)) return json({ error: "Dashboard login required" }, 401);

  const report = expectedWeeklyReport();
  const available = await reportAvailable(report);
  return json({
    available,
    fileName: available ? report.fileName : undefined,
    periodLabel: report.periodLabel,
    message: available ? undefined : REPORT_PENDING_MESSAGE,
  });
}

export async function POST(request: Request) {
  if (!await dashboardAuthorized(request)) return json({ error: "Dashboard login required" }, 401);
  if (!sameOrigin(request)) return json({ error: "Origin rejected" }, 403);

  const payload = await request.json().catch(() => null) as { firstName?: unknown } | null;
  const firstName = cleanFirstName(payload?.firstName);
  if (!validFirstName(firstName)) return json({ error: "Enter your first name" }, 400);

  const report = expectedWeeklyReport();
  const stub = reportLog();
  const bucket = reportsBucket();
  if (!stub || !bucket) return json({ error: REPORT_PENDING_MESSAGE }, 404);

  let object: ReportObject | null = null;
  try {
    object = await bucket.get(report.key);
  } catch {
    object = null;
  }
  if (!object?.body || (object.size !== undefined && object.size <= 0)) {
    return json({ error: REPORT_PENDING_MESSAGE }, 404);
  }

  const entry: ReportDownload = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    firstName,
    reportName: report.fileName,
  };

  try {
    await stub.addReportDownload(entry);
  } catch (error) {
    if (error instanceof Error && error.message.includes("REPORT_RATE_LIMIT")) {
      return json({ error: "Too many downloads; wait one minute" }, 429);
    }
    return json({ error: "Download could not be recorded" }, 503);
  }

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${report.fileName}"`,
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  });
  if (typeof object.size === "number" && object.size > 0) headers.set("Content-Length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}
