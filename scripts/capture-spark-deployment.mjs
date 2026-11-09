import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const account = "a7cd65e439e0104c20c59023ca18b85c";
const result = { scope: "website deployment metadata; not the scientific VM", observed_at: new Date().toISOString(),
  account_id: account, worker: "spark", source_revision: null, bindings: [], namespaces: [], errors: [] };
try { result.source_revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* Explicitly unavailable. */ }
const token = process.env.CLOUDFLARE_API_TOKEN;
if (token) {
  async function get(path, operation) {
    try {
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, {
        headers: { Authorization: "Bearer " + token, "User-Agent": "SPARK-Deployment-Metadata/1.0 (+https://github.com/sparkmbxtr/BITZ)" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) { result.errors.push({ operation, status: response.status }); return null; }
      const payload = await response.json();
      if (!payload.success) { result.errors.push({ operation, status: "provider_error" }); return null; }
      return payload.result;
    } catch { result.errors.push({ operation, status: "unavailable" }); return null; }
  }
  const settings = await get("workers/scripts/spark/settings", "spark_settings");
  if (settings) {
    result.bindings = (settings.bindings ?? []).map(({ name, type, namespace_id, class_name, script_name, environment }) =>
      ({ name, type, namespace_id, class_name, script_name, environment }));
    result.migration_tag = settings.migration_tag ?? null;
  }
  const service = await get("workers/services/spark", "spark_service");
  if (service?.default_environment?.script) result.script = {
    id: service.default_environment.script.id,
    migration_tag: service.default_environment.script.migration_tag ?? null,
  };
  const namespaces = await get("workers/durable_objects/namespaces?per_page=1000", "namespace_inventory");
  if (Array.isArray(namespaces)) result.namespaces = namespaces.filter(item => ["spark", "bitz"].includes(item.script) || item.class === "ContextLog")
    .map(({ id, class: class_name, script, use_sqlite }) => ({ id, class_name, script, use_sqlite }));
} else result.errors.push({ operation: "build_credential", status: "not_configured" });
await mkdir(".wrangler", { recursive: true });
await writeFile(".wrangler/spark-deployment-metadata.json", JSON.stringify(result) + "\n");
console.log("Captured allowlisted deployment identity metadata for the authenticated Git diagnostic path.");
