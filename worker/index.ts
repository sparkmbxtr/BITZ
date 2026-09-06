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
