import { env } from "cloudflare:workers";
import { decryptApiKey, encryptApiKey } from "@/lib/dashboard-auth";

type PreparedStatement = {
  bind: (...values: unknown[]) => PreparedStatement;
  first: () => Promise<Record<string, unknown> | null>;
  run: () => Promise<unknown>;
};

type Database = {
  prepare: (query: string) => PreparedStatement;
};

const SETTING_KEY = "airq_api_key";

function database() {
  const runtimeEnv = env as unknown as Record<string, unknown>;
  const db = runtimeEnv.DB as Database | undefined;
  if (!db?.prepare) throw new Error("Secure settings storage is unavailable");
  return db;
}

export async function readStoredApiKey(sessionSecret: string) {
  const row = await database()
    .prepare("SELECT value FROM secure_settings WHERE key = ? LIMIT 1")
    .bind(SETTING_KEY)
    .first();
  return typeof row?.value === "string" ? decryptApiKey(row.value, sessionSecret) : null;
}

export async function storeApiKey(apiKey: string, sessionSecret: string) {
  const encrypted = await encryptApiKey(apiKey, sessionSecret);
  await database()
    .prepare("INSERT INTO secure_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(SETTING_KEY, encrypted, Date.now())
    .run();
}
