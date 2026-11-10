/** Cloudflare Worker entry point for the vinext-starter template. */
import { routeNucleosomeProgress } from "./nucleosome-progress.mjs";
import { routeDeploymentMetadata } from "./nucleosome-deployment.mjs";
import { routePilotLibrary } from "./pilot-library.mjs";
import { PilotStorage } from "./pilot-storage.mjs";
import { MonitorPasswordStorage } from "./monitor-password-storage.mjs";
import { routeExtraMonitorAccess } from "./monitor-extra-password.mjs";
declare const __SPARK_DEPLOYMENT_METADATA__: Record<string, unknown>;
import { DurableObject } from "cloudflare:workers";
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  AIRQ_BACKEND: Fetcher;
  CONTEXT_LOG?: DurableObjectNamespace;
  DB?: D1Database;
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

export type StoredDisplayPairing = {
  id: string;
  code: string;
  pollSecretHash: string;
  createdAt: number;
  expiresAt: number;
};

type StoredDisplayPairingRow = {
  id: string;
  code: string;
  poll_secret_hash: string;
  created_at: number;
  expires_at: number;
  session_token: string | null;
};

export type DisplayPairingPoll = {
  status: "pending" | "approved" | "expired";
  sessionToken?: string;
};

/**
 * The legacy class name is retained so existing display-pairing and weekly
 * report storage keeps its Cloudflare Durable Object identity.
 */
export class ContextLog extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
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
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS display_pairings (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL CHECK (length(code) BETWEEN 6 AND 10),
        poll_secret_hash TEXT NOT NULL CHECK (length(poll_secret_hash) = 64),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        session_token TEXT
      )
    `);
    ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_display_pairings_expires_at
      ON display_pairings(expires_at)
    `);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS nucleosome_progress (state_key TEXT PRIMARY KEY CHECK (state_key = 'current'), payload TEXT NOT NULL, observed_at INTEGER NOT NULL)`);

  }

  async writeNucleosomeProgress(payload: string, observedAt: number): Promise<void> {
    const prior = this.ctx.storage.sql.exec<{ payload: string }>(
      "SELECT payload FROM nucleosome_progress WHERE state_key = 'current' LIMIT 1",
    ).toArray()[0]?.payload;
    if (prior) {
      const previous = JSON.parse(prior);
      const incoming = JSON.parse(payload);
      if (previous.jobs.some((old: { id: string; step: number; status: string }) => {
        const next = incoming.jobs.find((job: { id: string }) => job.id === old.id);
        return !next || next.step < old.step
          || (["completed", "guard_stop"].includes(old.status) && next.status !== old.status);
      })) return;
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO nucleosome_progress (state_key, payload, observed_at) VALUES ('current', ?, ?) ON CONFLICT(state_key) DO UPDATE SET payload = excluded.payload, observed_at = excluded.observed_at WHERE excluded.observed_at >= nucleosome_progress.observed_at",
      payload, observedAt,
    );
  }

  async readNucleosomeProgress(): Promise<string | null> {
    return this.ctx.storage.sql.exec<{ payload: string }>(
      "SELECT payload FROM nucleosome_progress WHERE state_key = 'current' LIMIT 1",
    ).toArray()[0]?.payload ?? null;
  }

  async readPilotManifest(revision: string) { return new PilotStorage(this.ctx.storage.sql).manifest(revision); }
  async readExtraMonitorAccess(enrollment: string) { return new MonitorPasswordStorage(this.ctx.storage.sql).read(enrollment); }
  async putExtraMonitorAccess(enrollment: string, payload: string) { return new MonitorPasswordStorage(this.ctx.storage.sql).put(enrollment, payload); }
  async putPilotManifest(revision: string, payload: string) { return new PilotStorage(this.ctx.storage.sql).putManifest(revision, payload); }
  async readPilotChunk(revision: string, asset: string, part: number) { return new PilotStorage(this.ctx.storage.sql).chunk(revision, asset, part); }
  async putPilotChunk(revision: string, asset: string, part: number, payload: ArrayBuffer) { return new PilotStorage(this.ctx.storage.sql).putChunk(revision, asset, part, payload); }
  async pilotAssetStatus(revision: string, asset: string) { return new PilotStorage(this.ctx.storage.sql).status(revision, asset); }

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

  async createDisplayPairing(pairing: StoredDisplayPairing): Promise<void> {
    const now = Date.now();
    this.ctx.storage.sql.exec("DELETE FROM display_pairings WHERE expires_at < ?", now);
    const recent = this.ctx.storage.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM display_pairings WHERE created_at >= ?",
        now - 60_000,
      )
      .one();
    if (recent.count >= 20) throw new Error("PAIRING_RATE_LIMIT");

    this.ctx.storage.sql.exec(
      "INSERT INTO display_pairings (id, code, poll_secret_hash, created_at, expires_at, session_token) VALUES (?, ?, ?, ?, ?, NULL)",
      pairing.id,
      pairing.code,
      pairing.pollSecretHash,
      pairing.createdAt,
      pairing.expiresAt,
    );
  }

  async approveDisplayPairing(code: string, sessionToken: string): Promise<boolean> {
    const now = Date.now();
    const row = this.ctx.storage.sql
      .exec<StoredDisplayPairingRow>(
        "SELECT id, code, poll_secret_hash, created_at, expires_at, session_token FROM display_pairings WHERE code = ? LIMIT 1",
        code,
      )
      .toArray()[0];
    if (!row || row.expires_at < now) return false;
    this.ctx.storage.sql.exec(
      "UPDATE display_pairings SET session_token = ? WHERE id = ?",
      sessionToken,
      row.id,
    );
    return true;
  }

  async consumeDisplayPairing(id: string, pollSecretHash: string): Promise<DisplayPairingPoll> {
    const row = this.ctx.storage.sql
      .exec<StoredDisplayPairingRow>(
        "SELECT id, code, poll_secret_hash, created_at, expires_at, session_token FROM display_pairings WHERE id = ? LIMIT 1",
        id,
      )
      .toArray()[0];
    if (!row || row.poll_secret_hash !== pollSecretHash || row.expires_at < Date.now()) {
      if (row?.id) this.ctx.storage.sql.exec("DELETE FROM display_pairings WHERE id = ?", row.id);
      return { status: "expired" };
    }
    if (!row.session_token) return { status: "pending" };

    this.ctx.storage.sql.exec("DELETE FROM display_pairings WHERE id = ?", row.id);
    return { status: "approved", sessionToken: row.session_token };
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

    // The neutral display Worker owns the page and its build fingerprint. All
    // protected API work stays in the existing credential-bearing Worker via a
    // private service binding, so no sensor or access secret is duplicated.
    const isNeutralDisplay = url.hostname === "bitz.bioengineering.workers.dev";
    const deploymentMetadata = await routeDeploymentMetadata(request, __SPARK_DEPLOYMENT_METADATA__);
    if (deploymentMetadata) return deploymentMetadata;
    if (isNeutralDisplay && url.pathname.startsWith("/api/") && url.pathname !== "/api/display-version") {
      const backendUrl = new URL(request.url);
      backendUrl.hostname = "spark.bioengineering.workers.dev";
      return env.AIRQ_BACKEND.fetch(new Request(backendUrl, request));
    }

    const extraAccessResponse = await routeExtraMonitorAccess(request, env);
    if (extraAccessResponse) return extraAccessResponse;
    const pilotResponse = await routePilotLibrary(request, env);
    if (pilotResponse) return pilotResponse;
    const progressResponse = await routeNucleosomeProgress(request, env);
    if (progressResponse) return progressResponse;

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

