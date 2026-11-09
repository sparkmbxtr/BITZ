import assert from "node:assert/strict";
import test from "node:test";
import { deploymentMetadata, routeDeploymentMetadata } from "../worker/nucleosome-deployment.mjs";

test("the Git diagnostic endpoint is separate, read-only and requires the pinned OIDC writer", async () => {
  const request = new Request("https://bitz.bioengineering.workers.dev/api/nucleosome-deployment-metadata");
  assert.equal((await routeDeploymentMetadata(request, {}, async () => false)).status, 401);
  const response = await routeDeploymentMetadata(request, { source_revision: "a".repeat(40) }, async () => true);
  assert.equal((await response.json()).source_revision, "a".repeat(40));
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(await routeDeploymentMetadata(new Request("https://spark.bioengineering.workers.dev/api/nucleosome-deployment-metadata"), {}, async () => true), null);
  assert.equal((await routeDeploymentMetadata(new Request(request.url, { method: "PUT" }), {}, async () => true)).status, 405);
});

test("only namespace identity and binding names/types can leave the build", () => {
  const value = { password: "sensitive-example", bindings: [{ name: "PASSWORD_HASH", type: "secret_text", text: "sensitive-example" }],
    namespaces: [{ id: "existing-id", class_name: "ContextLog", script: "bitz", private_key: "sensitive-example" }],
    errors: [{ operation: "namespace_inventory", status: 403, body: "sensitive-example" }] };
  const serialized = JSON.stringify(deploymentMetadata(value));
  assert.ok(!serialized.includes("sensitive-example"));
  assert.match(serialized, /existing-id/);
  assert.match(serialized, /not the scientific VM/);
});
