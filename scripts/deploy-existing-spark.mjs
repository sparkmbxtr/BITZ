import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const ACCOUNT = "a7cd65e439e0104c20c59023ca18b85c";
const WORKER = "spark";
// Identity returned by the existing provider inventory and supplied in the
// deployment failure record. This is an identifier, not a credential.
export const SPARK_CONTEXT_NAMESPACE = "d19f77532fc94146aea211c8e41895be";
const CLIENT_HEADERS = { "User-Agent": "SPARK-Worker-Deployment/1.0 (+https://github.com/sparkmbxtr/BITZ)" };

export function resolveSparkStorage(settings, namespaces, expectedNamespace = SPARK_CONTEXT_NAMESPACE) {
  const binding = (settings.bindings ?? []).find(item => item.name === "CONTEXT_LOG");
  if (binding && binding.type !== "durable_object_namespace") throw new Error("Existing CONTEXT_LOG binding has a different resource type");
  const matches = namespaces.filter(item => !binding ? item.id === expectedNamespace && item.class === "ContextLog" && item.script === WORKER
    : binding.namespace_id ? item.id === binding.namespace_id
    : item.class === binding.class_name && item.script === (binding.script_name ?? WORKER));
  if (matches.length !== 1) throw new Error("Existing storage namespace must resolve uniquely; no namespace will be created");
  const found = matches[0];
  if (!found.id || found.id !== expectedNamespace || found.class !== "ContextLog" || ![WORKER, "bitz"].includes(found.script)
    || (binding?.class_name && binding.class_name !== found.class)
    || (binding?.script_name && binding.script_name !== found.script)
    || (binding?.environment && binding.environment !== "production")
    || found.use_sqlite !== true) throw new Error("Existing storage ownership/class/SQLite engine differs from the reviewed framework");
  return { namespace_id: found.id, class_name: found.class, script_name: found.script,
    ...(binding?.environment ? { environment: binding.environment } : {}) };
}

export function verifySparkStorageUnchanged(before, after, beforeSettings, afterSettings) {
  const identity = value => [value.namespace_id, value.class_name, value.script_name, value.environment ?? "production"];
  if (JSON.stringify(identity(before)) !== JSON.stringify(identity(after))
    || (beforeSettings.migration_tag ?? null) !== (afterSettings.migration_tag ?? null)) throw new Error("Existing storage identity or migration tag changed");
  const names = value => (value.bindings ?? []).map(binding => `${binding.name}:${binding.type}`).sort();
  const oldNames = names(beforeSettings), newNames = names(afterSettings);
  if (oldNames.some(name => !newNames.includes(name))
    || newNames.some(name => !oldNames.includes(name) && !["ASSETS:assets", "IMAGES:images", "CONTEXT_LOG:durable_object_namespace"].includes(name))) throw new Error("Existing binding inventory changed");
}

export function sparkDeploymentConfig(generated, settings, storage) {
  if (!storage?.namespace_id || storage.class_name !== "ContextLog" || ![WORKER, "bitz"].includes(storage.script_name)) throw new Error("Verified existing storage identity is required");
  const config = structuredClone(generated);
  config.name = WORKER;
  config.account_id = ACCOUNT;
  config.workers_dev = true;
  config.keep_vars = true;
  config.compatibility_date = settings.compatibility_date ?? generated.compatibility_date;
  config.compatibility_flags = settings.compatibility_flags ?? generated.compatibility_flags;
  for (const key of ["services", "durable_objects", "migrations", "d1_databases", "kv_namespaces", "r2_buckets", "vars", "routes", "route", "env"]) delete config[key];
  const bindings = [...(settings.bindings ?? [])];
  if (!bindings.some(binding => binding.name === "CONTEXT_LOG")) {
    if (storage.namespace_id !== SPARK_CONTEXT_NAMESPACE || storage.script_name !== WORKER) throw new Error("Only the pinned existing namespace can repair the missing binding");
    bindings.push({ name: "CONTEXT_LOG", type: "durable_object_namespace" });
  }
  const storageBinding = bindings.find(binding => binding.name === "CONTEXT_LOG");
  if (storageBinding.namespace_id && storageBinding.namespace_id !== storage.namespace_id) throw new Error("Resolved namespace differs from the existing binding");
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
        config.durable_objects = { bindings: [{ name: "CONTEXT_LOG", class_name: storage.class_name,
          ...(storage.script_name !== WORKER ? { script_name: storage.script_name } : {}),
          ...(storage.environment ? { environment: storage.environment } : {}) }] };
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
  // A tag-only entry matches the provider's existing tag. Wrangler then sends
  // no migration steps. There are no create/rename/delete/transfer operations.
  if (settings.migration_tag) config.migrations = [{ tag: settings.migration_tag }];
  return config;
}

export function sparkMetadataSummary(settings, namespaces) {
  return { migration_tag: settings.migration_tag ?? null,
    bindings: (settings.bindings ?? []).map(({ name, type, namespace_id, class_name, script_name, environment }) =>
      ({ name, type, namespace_id, class_name, script_name, environment })),
    relevant_namespaces: namespaces.filter(item => [WORKER, "bitz"].includes(item.script) && item.class === "ContextLog")
      .map(({ id, class: class_name, script, use_sqlite }) => ({ id, class_name, script, use_sqlite })) };
}

async function existingMetadata(token) {
  const get = async path => {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/${path}`, {
      headers: { ...CLIENT_HEADERS, Authorization: "Bearer " + token }, signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error("Existing spark metadata read failed (HTTP " + response.status + ", " + path.split("?")[0] + ")");
    const payload = await response.json();
    if (!payload.success || !payload.result) throw new Error("Existing spark metadata readback failed");
    return payload;
  };
  const settings = (await get(`workers/scripts/${WORKER}/settings`)).result;
  const service = (await get(`workers/services/${WORKER}`)).result;
  const script = service.default_environment?.script;
  if (!script) throw new Error("Existing spark production script metadata is unavailable");
  if (settings.migration_tag && script.migration_tag && settings.migration_tag !== script.migration_tag) throw new Error("Provider migration metadata disagrees");
  settings.migration_tag ??= script.migration_tag;
  const namespaces = [];
  for (let page = 1; page <= 100; page++) {
    const payload = await get(`workers/durable_objects/namespaces?per_page=1000&page=${page}`);
    if (!Array.isArray(payload.result)) throw new Error("Namespace inventory is unavailable");
    namespaces.push(...payload.result);
    if (page >= (payload.result_info?.total_pages ?? 1)) return { settings, namespaces };
  }
  throw new Error("Namespace inventory exceeds the verification bound");
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
  const before = await existingMetadata(token);
  // Only binding names/types and namespace identity metadata are logged. Secret
  // values and plain-text/JSON binding contents are never included.
  console.log(JSON.stringify({ existing_spark_metadata: sparkMetadataSummary(before.settings, before.namespaces) }));
  const storage = resolveSparkStorage(before.settings, before.namespaces);
  const redirect = resolve(".wrangler/deploy/config.json");
  const pointer = JSON.parse(await readFile(redirect, "utf8"));
  const generatedPath = resolve(dirname(redirect), pointer.configPath);
  const generated = JSON.parse(await readFile(generatedPath, "utf8"));
  const config = sparkDeploymentConfig(generated, before.settings, storage);
  const deploymentPath = resolve(dirname(generatedPath), "wrangler.spark.json");
  await writeFile(deploymentPath, JSON.stringify(config, null, 2) + "\n");
  console.log("Verified the existing spark storage and bindings; deploying the progress interface.");
  await command(process.execPath, [resolve("node_modules/wrangler/bin/wrangler.js"), "deploy", "--config", deploymentPath, "--keep-vars"]);
  const after = await existingMetadata(token);
  verifySparkStorageUnchanged(storage, resolveSparkStorage(after.settings, after.namespaces), before.settings, after.settings);
  console.log(JSON.stringify({ existing_storage_identity_unchanged: true, namespace_id: storage.namespace_id,
    storage_owner: storage.script_name, migration_tag: after.settings.migration_tag ?? null }));
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
