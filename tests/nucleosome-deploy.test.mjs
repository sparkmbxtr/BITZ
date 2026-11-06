import assert from "node:assert/strict";
import test from "node:test";
import { sparkDeploymentConfig } from "../scripts/deploy-existing-spark.mjs";

const generated = { name: "bitz", main: "index.js", assets: { directory: "../client", binding: "ASSETS" },
  images: { binding: "IMAGES" }, services: [{ binding: "AIRQ_BACKEND", service: "spark" }],
  compatibility_date: "2026-09-03", compatibility_flags: ["nodejs_compat"], vars: { DISPLAY_ONLY: "value" } };
const settings = { compatibility_date: "2026-09-03", migration_tag: "context-log-v1", bindings: [
  { type: "durable_object_namespace", name: "CONTEXT_LOG", namespace_id: "preserved-namespace", class_name: "ContextLog" },
  { type: "images", name: "IMAGES" }, { type: "assets", name: "ASSETS" },
  { type: "secret_text", name: "AIRQ_API_KEY" }, { type: "plain_text", name: "KEEP_REMOTE", text: "private" },
] };

test("spark deployment retains the existing backend namespace and variables", () => {
  const config = sparkDeploymentConfig(generated, settings);
  assert.equal(config.name, "spark");
  assert.equal(config.keep_vars, true);
  assert.deepEqual(config.durable_objects.bindings, [{ name: "CONTEXT_LOG", class_name: "ContextLog" }]);
  assert.deepEqual(config.migrations, [{ tag: "context-log-v1", new_sqlite_classes: ["ContextLog"] }]);
  assert.equal(config.services, undefined);
  assert.equal(config.vars, undefined);
  assert.ok(!JSON.stringify(config).includes("private"));
  assert.equal(generated.name, "bitz");
});

test("unavailable storage, unexpected bindings and migration changes block deployment", () => {
  assert.throws(() => sparkDeploymentConfig(generated, { bindings: [] }));
  assert.throws(() => sparkDeploymentConfig(generated, { ...settings, migration_tag: "different-migration" }));
  assert.throws(() => sparkDeploymentConfig(generated, { ...settings, bindings: [...settings.bindings, { type: "unreviewed", name: "OTHER" }] }));
});
