import assert from "node:assert/strict";
import test from "node:test";
import { deploymentFailureSummary, resolveSparkStorage, sparkDeploymentConfig, sparkMetadataSummary, SPARK_CONTEXT_NAMESPACE, verifySparkStorageUnchanged } from "../scripts/deploy-existing-spark.mjs";

const generated = { name: "bitz", main: "index.js", assets: { directory: "../client", binding: "ASSETS" },
  images: { binding: "IMAGES" }, services: [{ binding: "AIRQ_BACKEND", service: "spark" }],
  compatibility_date: "2026-09-03", compatibility_flags: ["nodejs_compat"], vars: { DISPLAY_ONLY: "value" } };
const settings = { compatibility_date: "2026-09-03", migration_tag: "context-log-v1", bindings: [
  { type: "durable_object_namespace", name: "CONTEXT_LOG", namespace_id: SPARK_CONTEXT_NAMESPACE, class_name: "ContextLog" },
  { type: "images", name: "IMAGES" }, { type: "assets", name: "ASSETS" },
  { type: "secret_text", name: "AIRQ_API_KEY" }, { type: "plain_text", name: "KEEP_REMOTE", text: "private" },
] };
const namespaces = [{ id: SPARK_CONTEXT_NAMESPACE, class: "ContextLog", script: "spark", use_sqlite: true }];
const storage = resolveSparkStorage(settings, namespaces);

test("spark deployment retains the existing backend namespace and variables", () => {
  const config = sparkDeploymentConfig(generated, settings, storage);
  assert.equal(config.name, "spark");
  assert.equal(config.keep_vars, true);
  assert.deepEqual(config.durable_objects.bindings, [{ name: "CONTEXT_LOG", class_name: "ContextLog" }]);
  assert.deepEqual(config.migrations, [{ tag: "context-log-v1" }]);
  assert.equal(config.services, undefined);
  assert.equal(config.vars, undefined);
  assert.ok(!JSON.stringify(config).includes("private"));
  assert.equal(generated.name, "bitz");
});

test("provider settings without a namespace ID resolve through the actual inventory", () => {
  const value = structuredClone(settings);
  delete value.bindings[0].namespace_id;
  assert.deepEqual(resolveSparkStorage(value, namespaces), storage);
  const tag = { ...value, migration_tag: "actual-provider-tag-v3" };
  assert.deepEqual(sparkDeploymentConfig(generated, tag, storage).migrations, [{ tag: "actual-provider-tag-v3" }]);
});

test("an existing namespace owned by bitz stays external; it is never recreated under spark", () => {
  const value = structuredClone(settings);
  delete value.bindings[0].class_name;
  const external = resolveSparkStorage(value, [{ ...namespaces[0], script: "bitz" }]);
  assert.equal(external.namespace_id, storage.namespace_id);
  assert.deepEqual(sparkDeploymentConfig(generated, value, external).durable_objects.bindings,
    [{ name: "CONTEXT_LOG", class_name: "ContextLog", script_name: "bitz" }]);
  assert.ok(!JSON.stringify(sparkDeploymentConfig(generated, value, external)).includes("new_sqlite_classes"));
});

test("unavailable, ambiguous, conflicting or incompatible storage blocks deployment", () => {
  assert.throws(() => resolveSparkStorage({ bindings: [] }, []));
  assert.throws(() => resolveSparkStorage(settings, []));
  assert.throws(() => resolveSparkStorage(settings, [...namespaces, ...namespaces]));
  assert.throws(() => resolveSparkStorage(settings, [{ ...namespaces[0], class: "OtherLog" }]));
  assert.throws(() => resolveSparkStorage(settings, [{ ...namespaces[0], use_sqlite: false }]));
  assert.throws(() => resolveSparkStorage(settings, [{ ...namespaces[0], use_sqlite: undefined }]));
  assert.throws(() => sparkDeploymentConfig(generated, { bindings: [] }, { ...storage, namespace_id: "unknown" }));
  assert.throws(() => sparkDeploymentConfig(generated, settings, { ...storage, namespace_id: "replacement" }));
  assert.throws(() => sparkDeploymentConfig(generated, { ...settings, bindings: [...settings.bindings, { type: "unreviewed", name: "OTHER" }] }, storage));
});

test("post-deployment checks require the same namespace, migration tag and existing bindings", () => {
  verifySparkStorageUnchanged(storage, storage, settings, settings);
  verifySparkStorageUnchanged(storage, { ...storage, environment: "production" }, settings, settings);
  assert.throws(() => verifySparkStorageUnchanged(storage, { ...storage, namespace_id: "replacement" }, settings, settings));
  assert.throws(() => verifySparkStorageUnchanged(storage, storage, settings, { ...settings, migration_tag: "changed" }));
  assert.throws(() => verifySparkStorageUnchanged(storage, storage, settings, { ...settings, bindings: settings.bindings.slice(1) }));
});

test("deployment diagnostics contain identity metadata but exclude secret and plain binding contents", () => {
  const value = structuredClone(settings);
  value.bindings.push({ type: "secret_text", name: "DASHBOARD_PASSWORD_HASH", text: "sensitive-verifier-example" });
  const logged = JSON.stringify(sparkMetadataSummary(value, namespaces));
  assert.ok(logged.includes(SPARK_CONTEXT_NAMESPACE));
  assert.doesNotMatch(logged, /sensitive-verifier-example|private/);
});

test("the missing binding is restored to the provider-verified existing namespace without migration operations", () => {
  const value = structuredClone(settings);
  value.bindings = value.bindings.filter(binding => binding.name !== "CONTEXT_LOG");
  const existing = resolveSparkStorage(value, namespaces);
  const config = sparkDeploymentConfig(generated, value, existing);
  assert.deepEqual(config.durable_objects.bindings, [{ name: "CONTEXT_LOG", class_name: "ContextLog" }]);
  assert.deepEqual(config.migrations, [{ tag: value.migration_tag }]);
  assert.doesNotMatch(JSON.stringify(config), /new_classes|new_sqlite_classes|deleted_classes|transferred_classes/);
  const repaired = { ...value, bindings: [...value.bindings, settings.bindings[0]] };
  verifySparkStorageUnchanged(existing, resolveSparkStorage(repaired, namespaces), value, repaired);
  assert.throws(() => verifySparkStorageUnchanged(existing, existing, value, value), /still missing/);
  assert.throws(() => resolveSparkStorage(value, [{ ...namespaces[0], id: "replacement" }]));
});

test("the wrapper retains the actual Wrangler failure instead of only exit 1", () => {
  const value = deploymentFailureSummary("upload progress\n\u001b[31mERROR\u001b[0m A request to the Cloudflare API failed\nreason example [code: 10000]\nLogs were written\n");
  assert.match(value, /reason example \[code: 10000\]/);
  assert.doesNotMatch(value, /upload progress|\u001b/);
});
