import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("LAB critical panel remains a calculated test-system advisory", () => {
  assert.match(pageSource, /Calculated early-warning ALERT will be displayed here\./);
  assert.match(pageSource, /This is a test system; follow official instructions from authorised managers and directors\./);
  assert.doesNotMatch(pageSource, /EVACUATE/i);
  assert.doesNotMatch(pageSource, /Leave the LAB/i);
});
