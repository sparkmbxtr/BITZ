import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { workerConfigPath } from "../build/worker-config.mjs";

test("each linked Worker builds from a configuration with its own name", async () => {
  for (const name of ["spark", "bitz"]) {
    const config = JSON.parse(await readFile(new URL("../" + workerConfigPath({ WRANGLER_CI_OVERRIDE_NAME: name }), import.meta.url), "utf8"));
    assert.equal(config.name, name);
    assert.equal(config.main, "./worker/index.ts");
    assert.deepEqual(config.compatibility_flags, ["nodejs_compat"]);
    assert.equal(config.compatibility_date, "2026-09-03");
    assert.ok(!config.migrations);
    assert.ok(!config.durable_objects);
  }
  assert.equal(workerConfigPath({}), "wrangler.bitz.jsonc");
  assert.equal(workerConfigPath({ BITZ_WORKER_TARGET: "spark" }), "wrangler.jsonc");
});

test("explicit targets cannot override the provider's linked Worker", () => {
  assert.throws(() => workerConfigPath({ WRANGLER_CI_OVERRIDE_NAME: "bitz", BITZ_WORKER_TARGET: "spark" }), /differs/);
  assert.throws(() => workerConfigPath({ WRANGLER_CI_OVERRIDE_NAME: "unknown" }), /existing/);
});
