/** Cloudflare Worker entry point for the vinext-starter template. */
import { DurableObject } from "cloudflare:workers";
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  CONTEXT_LOG: DurableObjectNamespace;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export type StoredContextEntry = {
  id: string;
  createdAt: number;
  area: "LAB" | "OFFICE" | "OUTDOOR";
  note: string;
};

type StoredContextRow = {
  id: string;
  created_at: number;
  area: "LAB" | "OFFICE" | "OUTDOOR";
  note: string;
};

export type StoredReportDownload = {
  id: string;
  createdAt: number;
  firstName: string;
  reportName: string;
};

type StoredReportDownloadRow = {
  id: string;
  created_at: number;
  first_name: string;
  report_name: string;
};

export type StoredWeeklyReport = {
  id: string;
  reportName: string;
  periodLabel: string;
  byteSize: number;
  sha256: string;
  createdAt: number;
  chunks: string[];
};

type StoredWeeklyReportRow = {
  id: string;
  report_name: string;
  period_label: string;
  byte_size: number;
  sha256: string;
  created_at: number;
};

/**
 * One SQLite-backed object keeps the manual observation stream ordered and
 * append-only. It is private to this Worker; browser requests reach it only
 * through the session-protected /api/context route.
 */
export class ContextLog extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS context_entries (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        area TEXT NOT NULL CHECK (area IN ('LAB', 'OFFICE', 'OUTDOOR')),
        note TEXT NOT NULL CHECK (length(note) BETWEEN 1 AND 500)
      )
    `);
    ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_context_entries_created_at
      ON context_entries(created_at)
    `);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS report_downloads (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        first_name TEXT NOT NULL CHECK (length(first_name) BETWEEN 1 AND 80),
        report_name TEXT NOT NULL CHECK (length(report_name) BETWEEN 1 AND 180)
      )
    `);
    ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_report_downloads_created_at
      ON report_downloads(created_at)
    `);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS weekly_reports (
        id TEXT PRIMARY KEY,
        report_name TEXT NOT NULL CHECK (length(report_name) BETWEEN 1 AND 180),
        period_label TEXT NOT NULL CHECK (length(period_label) BETWEEN 1 AND 80),
        byte_size INTEGER NOT NULL CHECK (byte_size > 0),
        sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
        created_at INTEGER NOT NULL
      )
    `);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS weekly_report_chunks (
        report_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
        payload TEXT NOT NULL,
        PRIMARY KEY (report_id, chunk_index)
      )
    `);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS weekly_report_state (
        state_key TEXT PRIMARY KEY CHECK (state_key = 'current'),
        report_id TEXT NOT NULL
      )
    `);
  }

  async add(entry: StoredContextEntry): Promise<StoredContextEntry> {
    const recent = this.ctx.storage.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM context_entries WHERE created_at >= ?",
        Date.now() - 60_000,
      )
      .one();
    if (recent.count >= 20) throw new Error("CONTEXT_RATE_LIMIT");

    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO context_entries (id, created_at, area, note) VALUES (?, ?, ?, ?)",
      entry.id,
      entry.createdAt,
      entry.area,
      entry.note,
    );
    return entry;
  }

  async list(from: number, to: number, limit = 5000): Promise<StoredContextEntry[]> {
    const boundedLimit = Math.max(1, Math.min(5000, Math.floor(limit)));
    return this.ctx.storage.sql
      .exec<StoredContextRow>(
        "SELECT id, created_at, area, note FROM context_entries WHERE created_at >= ? AND created_at <= ? ORDER BY created_at ASC LIMIT ?",
        from,
        to,
        boundedLimit,
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        area: row.area,
        note: row.note,
      }));
  }

  async addReportDownload(entry: StoredReportDownload): Promise<StoredReportDownload> {
    const recent = this.ctx.storage.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM report_downloads WHERE created_at >= ?",
        Date.now() - 60_000,
      )
      .one();
    if (recent.count >= 30) throw new Error("REPORT_RATE_LIMIT");

    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO report_downloads (id, created_at, first_name, report_name) VALUES (?, ?, ?, ?)",
      entry.id,
      entry.createdAt,
      entry.firstName,
      entry.reportName,
    );
    return entry;
  }

  async listReportDownloads(from: number, to: number, limit = 5000): Promise<StoredReportDownload[]> {
    const boundedLimit = Math.max(1, Math.min(5000, Math.floor(limit)));
    return this.ctx.storage.sql
      .exec<StoredReportDownloadRow>(
        "SELECT id, created_at, first_name, report_name FROM report_downloads WHERE created_at >= ? AND created_at <= ? ORDER BY created_at ASC LIMIT ?",
        from,
        to,
        boundedLimit,
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        firstName: row.first_name,
        reportName: row.report_name,
      }));
  }

  async stageWeeklyReport(report: StoredWeeklyReport): Promise<StoredWeeklyReportRow> {
    if (!report.id || !report.reportName || !report.periodLabel || report.byteSize <= 0
      || !/^[a-f0-9]{64}$/.test(report.sha256) || !Number.isFinite(report.createdAt)
      || !Array.isArray(report.chunks) || report.chunks.length < 1 || report.chunks.length > 128
      || report.chunks.some((chunk) => typeof chunk !== "string" || !chunk || chunk.length > 700_000)) {
      throw new Error("INVALID_WEEKLY_REPORT");
    }

    this.ctx.storage.sql.exec("DELETE FROM weekly_report_chunks WHERE report_id = ?", report.id);
    this.ctx.storage.sql.exec("DELETE FROM weekly_reports WHERE id = ?", report.id);
    this.ctx.storage.sql.exec(
      "INSERT INTO weekly_reports (id, report_name, period_label, byte_size, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      report.id,
      report.reportName,
      report.periodLabel,
      report.byteSize,
      report.sha256,
      report.createdAt,
    );
    report.chunks.forEach((payload, chunkIndex) => {
      this.ctx.storage.sql.exec(
        "INSERT INTO weekly_report_chunks (report_id, chunk_index, payload) VALUES (?, ?, ?)",
        report.id,
        chunkIndex,
        payload,
      );
    });
    return {
      id: report.id,
      report_name: report.reportName,
      period_label: report.periodLabel,
      byte_size: report.byteSize,
      sha256: report.sha256,
      created_at: report.createdAt,
    };
  }

  async getStagedWeeklyReport(reportId: string): Promise<StoredWeeklyReport | null> {
    const rows = this.ctx.storage.sql
      .exec<StoredWeeklyReportRow>(
        "SELECT id, report_name, period_label, byte_size, sha256, created_at FROM weekly_reports WHERE id = ? LIMIT 1",
        reportId,
      )
      .toArray();
    const row = rows[0];
    if (!row) return null;
    const chunks = this.ctx.storage.sql
      .exec<{ payload: string }>(
        "SELECT payload FROM weekly_report_chunks WHERE report_id = ? ORDER BY chunk_index ASC",
        reportId,
      )
      .toArray()
      .map((entry) => entry.payload);
    return {
      id: row.id,
      reportName: row.report_name,
      periodLabel: row.period_label,
      byteSize: row.byte_size,
      sha256: row.sha256,
      createdAt: row.created_at,
      chunks,
    };
  }

  async activateWeeklyReport(reportId: string): Promise<StoredWeeklyReportRow> {
    const rows = this.ctx.storage.sql
      .exec<StoredWeeklyReportRow>(
        "SELECT id, report_name, period_label, byte_size, sha256, created_at FROM weekly_reports WHERE id = ? LIMIT 1",
        reportId,
      )
      .toArray();
    const report = rows[0];
    if (!report) throw new Error("WEEKLY_REPORT_NOT_STAGED");
    const chunkCount = this.ctx.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM weekly_report_chunks WHERE report_id = ?", reportId)
      .one().count;
    if (chunkCount < 1) throw new Error("WEEKLY_REPORT_CHUNKS_MISSING");

    // This single pointer write is the activation boundary. The previously
    // downloadable PDF remains current until the replacement has been stored
    // and verified by the route.
    this.ctx.storage.sql.exec(
      "INSERT INTO weekly_report_state (state_key, report_id) VALUES ('current', ?) ON CONFLICT(state_key) DO UPDATE SET report_id = excluded.report_id",
      reportId,
    );

    const oldIds = this.ctx.storage.sql
      .exec<{ id: string }>("SELECT id FROM weekly_reports WHERE id != ?", reportId)
      .toArray()
      .map((row) => row.id);
    oldIds.forEach((oldId) => {
      this.ctx.storage.sql.exec("DELETE FROM weekly_report_chunks WHERE report_id = ?", oldId);
      this.ctx.storage.sql.exec("DELETE FROM weekly_reports WHERE id = ?", oldId);
    });
    return report;
  }

  async discardStagedWeeklyReport(reportId: string): Promise<void> {
    const current = this.ctx.storage.sql
      .exec<{ report_id: string }>("SELECT report_id FROM weekly_report_state WHERE state_key = 'current' LIMIT 1")
      .toArray()[0]?.report_id;
    if (current === reportId) return;
    this.ctx.storage.sql.exec("DELETE FROM weekly_report_chunks WHERE report_id = ?", reportId);
    this.ctx.storage.sql.exec("DELETE FROM weekly_reports WHERE id = ?", reportId);
  }

  async headWeeklyReport(reportName: string): Promise<Omit<StoredWeeklyReport, "chunks"> | null> {
    const rows = this.ctx.storage.sql
      .exec<StoredWeeklyReportRow>(`
        SELECT r.id, r.report_name, r.period_label, r.byte_size, r.sha256, r.created_at
        FROM weekly_report_state s
        JOIN weekly_reports r ON r.id = s.report_id
        WHERE s.state_key = 'current' AND r.report_name = ?
        LIMIT 1
      `, reportName)
      .toArray();
    const row = rows[0];
    return row ? {
      id: row.id,
      reportName: row.report_name,
      periodLabel: row.period_label,
      byteSize: row.byte_size,
      sha256: row.sha256,
      createdAt: row.created_at,
    } : null;
  }

  async getWeeklyReport(reportName: string): Promise<StoredWeeklyReport | null> {
    const head = await this.headWeeklyReport(reportName);
    return head ? this.getStagedWeeklyReport(head.id) : null;
  }
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    const response = await handler.fetch(request, env, ctx);
    const contentType = response.headers.get("content-type") ?? "";
    if (request.method === "GET" && contentType.includes("text/html")) {
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-store, max-age=0, must-revalidate");
      headers.set("CDN-Cache-Control", "no-store");
      headers.set("Pragma", "no-cache");
      headers.set("Expires", "0");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    return response;
  },
};

export default worker;
