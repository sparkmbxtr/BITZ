import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const ACCOUNT = "a7cd65e439e0104c20c59023ca18b85c";
const WORKER = "spark";
const CLIENT_HEADERS = { "User-Agent": "SPARK-Worker-Deployment/1.0 (+https://github.com/sparkmbxtr/BITZ)" };

export function sparkDeploymentConfig(generated, settings) {
  const config = structuredClone(generated);
  config.name = WORKER;
  config.account_id = ACCOUNT;
  config.workers_dev = true;
  config.keep_vars = true;
  config.compatibility_date = settings.compatibility_date ?? generated.compatibility_date;
  config.compatibility_flags = settings.compatibility_flags ?? generated.compatibility_flags;
  for (const key of ["services", "durable_objects", "migrations", "d1_databases", "kv_namespaces", "r2_buckets", "vars", "routes", "route", "env"]) delete config[key];
  const bindings = settings.bindings ?? [];
  const storage = bindings.find(binding => binding.name === "CONTEXT_LOG");
  if (!storage || storage.type !== "durable_object_namespace" || !storage.namespace_id
    || (storage.class_name && storage.class_name !== "ContextLog")
    || (storage.script_name && storage.script_name !== WORKER)) throw new Error("Existing spark storage identity must be retained");
  for (const binding of bindings) {
    switch (binding.type) {
      case "secret_text": case "plain_text": case "json": break;
      case "assets":
        if (config.assets?.binding !== binding.name) throw new Error("Asset binding differs");
        break;
      case "images":
        if (config.images?.binding !== binding.name) throw new Error("Images binding differs");
        break;
      case "durable_object_namespace":
        if (binding.name !== "CONTEXT_LOG") throw new Error("Unreviewed Durable Object binding");
        config.durable_objects = { bindings: [{ name: "CONTEXT_LOG", class_name: "ContextLog" }] };
        break;
      case "service":
        (config.services ??= []).push({ binding: binding.name, service: binding.service,
          ...(binding.environment ? { environment: binding.environment } : {}),
          ...(binding.entrypoint ? { entrypoint: binding.entrypoint } : {}) });
        break;
      case "d1":
        if (!binding.id) throw new Error("D1 identity missing");
        (config.d1_databases ??= []).push({ binding: binding.name, database_id: binding.id, database_name: binding.name });
        break;
      case "kv_namespace":
        (config.kv_namespaces ??= []).push({ binding: binding.name, id: binding.namespace_id });
        break;
      case "r2_bucket":
        (config.r2_buckets ??= []).push({ binding: binding.name, bucket_name: binding.bucket_name,
          ...(binding.jurisdiction ? { jurisdiction: binding.jurisdiction } : {}) });
        break;
      default: throw new Error("An existing binding needs an explicit deployment mapping: " + binding.type);
    }
  }
  if (settings.migration_tag && settings.migration_tag !== "context-log-v1") throw new Error("Existing migration identity differs from the preserved backend configuration");
  config.migrations = [{ tag: "context-log-v1", new_sqlite_classes: ["ContextLog"] }];
  return config;
}

async function command(executable, args) {
  const child = spawn(executable, args, { stdio: "inherit",
    env: { ...process.env, WRANGLER_CI_OVERRIDE_NAME: WORKER } });
  await new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolvePromise() : reject(new Error("Spark deployment command failed with exit " + code)));
  });
}

async function deploySpark() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("Cloudflare Builds deployment credential is unavailable");
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/${WORKER}/settings`, {
    headers: { ...CLIENT_HEADERS, Authorization: "Bearer " + token }, signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("Cannot verify the existing spark settings (HTTP " + response.status + ")");
  const payload = await response.json();
  if (!payload.success || !payload.result) throw new Error("Existing spark configuration readback failed");
  const redirect = resolve(".wrangler/deploy/config.json");
  const pointer = JSON.parse(await readFile(redirect, "utf8"));
  const generatedPath = resolve(dirname(redirect), pointer.configPath);
  const generated = JSON.parse(await readFile(generatedPath, "utf8"));
  const config = sparkDeploymentConfig(generated, payload.result);
  const deploymentPath = resolve(dirname(generatedPath), "wrangler.spark.json");
  await writeFile(deploymentPath, JSON.stringify(config, null, 2) + "\n");
  console.log("Verified the existing spark storage and bindings; deploying the progress interface.");
  await command(process.execPath, [resolve("node_modules/wrangler/bin/wrangler.js"), "deploy", "--config", deploymentPath, "--keep-vars"]);
  const page = await fetch("https://spark.bioengineering.workers.dev/", { headers: CLIENT_HEADERS, signal: AbortSignal.timeout(20_000) });
  const html = await page.text();
  if (!page.ok || !html.includes("SPARK BMC-LMU") || !html.includes('action="/api/nucleosome-auth"') || html.includes('id="history"')) throw new Error("Live spark login verification failed");
  const status = await fetch("https://spark.bioengineering.workers.dev/api/nucleosome-progress", { headers: CLIENT_HEADERS, signal: AbortSignal.timeout(20_000) });
  if (status.status !== 401) throw new Error("Live spark progress must require authentication");
  const auth = await fetch("https://spark.bioengineering.workers.dev/api/nucleosome-auth", { headers: CLIENT_HEADERS, signal: AbortSignal.timeout(20_000) });
  const access = auth.ok ? await auth.json() : null;
  if (!access?.configured || access.authorized || access.session_days !== 7) throw new Error("Live spark weekly access configuration verification failed");
  console.log(JSON.stringify({ spark_login_verified: true, anonymous_progress_denied: true, session_days: 7, url: "https://spark.bioengineering.workers.dev" }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await deploySpark();
}
