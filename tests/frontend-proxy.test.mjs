import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
const wrangler = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const cloudflare = await readFile(new URL("../CLOUDFLARE.md", import.meta.url), "utf8");

test("the neutral bitz display uses a private backend service binding", () => {
  assert.match(wrangler, /"name": "bitz"/);
  assert.match(wrangler, /"binding": "AIRQ_BACKEND"/);
  assert.match(wrangler, /"service": "spark"/);
  assert.doesNotMatch(wrangler, /"durable_objects"|"migrations"/);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\) && url\.pathname !== "\/api\/display-version"/);
  assert.match(worker, /return env\.AIRQ_BACKEND\.fetch\(request\)/);
});

test("deployment documentation names only the neutral public display address", () => {
  assert.match(cloudflare, /bitz\.bioengineering\.workers\.dev/);
  assert.doesNotMatch(cloudflare, /spark\.bioengineering\.workers\.dev/);
  assert.match(cloudflare, /private Cloudflare service binding/);
});
