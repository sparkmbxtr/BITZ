import { env } from "cloudflare:workers";
import { isAuthorized, isBearerAuthorized } from "@/lib/dashboard-auth";
import { isGitHubActionsExportAuthorized } from "@/lib/github-actions-oidc";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const REPORT_INPUT_GUIDE = "RICHARD/JEFF/JESS/LILIANA//Dr.Itzel//Dr.Kaarthik//Dr.Fidelis//airQ-tech";
const REPORT_ALLOWED_NAMES = ["RICHARD", "JEFF", "JESS", "LILIANA", "Dr.Itzel", "Dr.Kaarthik", "Dr.Fidelis", "airQ-tech"] as const;
const REPORT_HIDDEN_TEST_NAME = "SPARKMBXTR";
const REPORT_PENDING_MESSAGE = "Recent week’s report has not been generated yet.";
const REPORT_MAX_BYTES = 25 * 1024 * 1024;
const REPORT_CHUNK_BYTES = 256 * 1024;

type ReportDownload = {
  id: string;
  createdAt: number;
  firstName: string;
  reportName: string;
};

type ReportLogStub = {
  addReportDownload(entry: ReportDownload): Promise<ReportDownload>;
  listReportDownloads(from: number, to: number, limit?: number): Promise<ReportDownload[]>;
  stageWeeklyReport(report: StoredWeeklyReport): Promise<unknown>;
  getStagedWeeklyReport(reportId: string): Promise<StoredWeeklyReport | null>;
  activateWeeklyReport(reportId: string): Promise<unknown>;
  discardStagedWeeklyReport(reportId: string): Promise<void>;
  headWeeklyReport(reportName: string): Promise<StoredWeeklyReportHead | null>;
  getWeeklyReport(reportName: string): Promise<StoredWeeklyReport | null>;
};

type ReportLogNamespace = {
  getByName(name: string): ReportLogStub;
};

type StoredWeeklyReportHead = {
  id: string;
  reportName: string;
  periodLabel: string;
  byteSize: number;
  sha256: string;
  createdAt: number;
};

type StoredWeeklyReport = StoredWeeklyReportHead & { chunks: string[] };

type ExpectedReport = {
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

function acceptedFirstName(value: string) {
  if (!value || value.length > 80 || value === REPORT_INPUT_GUIDE) return null;
  if (value === REPORT_HIDDEN_TEST_NAME) return REPORT_HIDDEN_TEST_NAME;
  return REPORT_ALLOWED_NAMES.find((name) => name.toLocaleLowerCase("en-US") === value.toLocaleLowerCase("en-US")) ?? null;
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
  const daysSinceSaturday = ((weekday - 6 + 7) % 7) || 7;
  const end = new Date(localSerial - daysSinceSaturday * 86_400_000);
  const start = new Date(end.getTime() - 5 * 86_400_000);
  const range = `${compactDate(start)}-${compactDate(end)}`;
  const fileName = `airq_monitoring_weekly_${range}.pdf`;
  return {
    fileName,
    periodLabel: range.replace("-", "–"),
  };
}

async function reportAvailable(report: ExpectedReport) {
  const stub = reportLog();
  if (!stub) return false;
  try {
    const object = await stub.headWeeklyReport(report.fileName);
    return Boolean(object && object.byteSize > 0);
  } catch {
    return false;
  }
}

function byteArrayToBase64(bytes: Uint8Array) {
  let binary = "";
  const stride = 32_768;
  for (let offset = 0; offset < bytes.length; offset += stride) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + stride, bytes.length)));
  }
  return btoa(binary);
}

function base64ToByteArray(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function splitReport(bytes: Uint8Array) {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += REPORT_CHUNK_BYTES) {
    chunks.push(byteArrayToBase64(bytes.subarray(offset, Math.min(offset + REPORT_CHUNK_BYTES, bytes.length))));
  }
  return chunks;
}

function joinReport(chunks: string[], expectedSize: number) {
  if (!Array.isArray(chunks) || !chunks.length || expectedSize <= 0 || expectedSize > REPORT_MAX_BYTES) return null;
  const decoded = chunks.map(base64ToByteArray);
  const size = decoded.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  if (size !== expectedSize) return null;
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of decoded) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function sha256Hex(bytes: Uint8Array) {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", owned.buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function validPdf(bytes: Uint8Array) {
  if (bytes.byteLength < 1024 || bytes.byteLength > REPORT_MAX_BYTES) return false;
  const prefix = new TextDecoder().decode(bytes.subarray(0, Math.min(8, bytes.length)));
  const suffix = new TextDecoder().decode(bytes.subarray(Math.max(0, bytes.length - 2048)));
  return prefix.startsWith("%PDF-") && suffix.includes("%%EOF");
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
  const firstName = acceptedFirstName(cleanFirstName(payload?.firstName));
  if (!firstName) return json({ error: "Bioengineering Lab personnel only." }, 403);

  const report = expectedWeeklyReport();
  const stub = reportLog();
  if (!stub) return json({ error: REPORT_PENDING_MESSAGE }, 404);

  let object: StoredWeeklyReport | null = null;
  try {
    object = await stub.getWeeklyReport(report.fileName);
  } catch {
    object = null;
  }
  const bytes = object ? joinReport(object.chunks, object.byteSize) : null;
  if (!object || !bytes || object.reportName !== report.fileName) {
    return json({ error: REPORT_PENDING_MESSAGE }, 404);
  }

  if (firstName !== REPORT_HIDDEN_TEST_NAME) {
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
  }

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${report.fileName}"`,
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  });
  headers.set("Content-Length", String(bytes.byteLength));
  return new Response(bytes, { status: 200, headers });
}

export async function PUT(request: Request) {
  if (!await exportAuthorized(request)) return json({ error: "Unauthorized" }, 401);
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/pdf") return json({ error: "PDF content required" }, 415);

  const expected = expectedWeeklyReport();
  const reportName = request.headers.get("x-report-name")?.trim() ?? "";
  const suppliedSha256 = request.headers.get("x-content-sha256")?.trim().toLowerCase() ?? "";
  if (reportName !== expected.fileName || !/^[a-f0-9]{64}$/.test(suppliedSha256)) {
    return json({ error: "Report identity rejected" }, 400);
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && (contentLength < 1024 || contentLength > REPORT_MAX_BYTES)) {
    return json({ error: "Report size rejected" }, 413);
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!validPdf(bytes)) return json({ error: "Report validation failed" }, 400);
  const calculatedSha256 = await sha256Hex(bytes);
  if (calculatedSha256 !== suppliedSha256) return json({ error: "Report hash mismatch" }, 400);

  const stub = reportLog();
  if (!stub) return json({ error: "Report storage is unavailable" }, 503);
  const reportId = crypto.randomUUID();
  const staged: StoredWeeklyReport = {
    id: reportId,
    reportName,
    periodLabel: expected.periodLabel,
    byteSize: bytes.byteLength,
    sha256: calculatedSha256,
    createdAt: Date.now(),
    chunks: splitReport(bytes),
  };

  try {
    await stub.stageWeeklyReport(staged);
    const stored = await stub.getStagedWeeklyReport(reportId);
    const storedBytes = stored ? joinReport(stored.chunks, stored.byteSize) : null;
    if (!stored || !storedBytes || stored.reportName !== reportName
      || stored.byteSize !== bytes.byteLength || stored.sha256 !== calculatedSha256
      || await sha256Hex(storedBytes) !== calculatedSha256 || !validPdf(storedBytes)) {
      await stub.discardStagedWeeklyReport(reportId);
      return json({ error: "Stored report verification failed" }, 500);
    }
    await stub.activateWeeklyReport(reportId);
    return json({ published: true, fileName: reportName, periodLabel: expected.periodLabel, size: bytes.byteLength });
  } catch {
    await stub.discardStagedWeeklyReport(reportId).catch(() => undefined);
    return json({ error: "Report publication failed" }, 503);
  }
}
