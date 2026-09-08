import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const approvalPage = await readFile(new URL("../app/pair/page.tsx", import.meta.url), "utf8");
const pairingRoute = await readFile(new URL("../app/api/device-pair/route.ts", import.meta.url), "utf8");
const authRoute = await readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8");
const auth = await readFile(new URL("../lib/dashboard-auth.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("access screen retains password and phone approval choices", () => {
  assert.match(page, />PASSWORD</);
  assert.match(page, />PHONE APPROVAL</);
  assert.match(page, /pairing-qr/);
  assert.match(page, /This approval remains valid for three months/);
  assert.match(page, /Pairing code expired\. Refreshing/);
});

test("Tizen password and phone pairing issue the same signed session grant", () => {
  assert.match(page, /Tizen\|SMART-TV\|TizenBrowser/);
  assert.match(page, /X-BITZ-Session-Mode/);
  assert.match(authRoute, /sessionGrant/);
  assert.match(auth, /x-bitz-display-session/);
  assert.match(auth, /return validSessionValue\(request\.headers\.get\(SESSION_HEADER_NAME\)/);
  assert.match(approvalPage, /remain authorised for three months/);
});

test("pairing secrets stay off URLs and are one-time after approval", () => {
  assert.match(pairingRoute, /PAIRING_LIFETIME_MS = 10 \* 60_000/);
  assert.match(pairingRoute, /pollSecretHash: await sha256\(pollSecret\)/);
  assert.match(pairingRoute, /const approvalUrl = `\$\{origin\}\/pair\?code=/);
  assert.doesNotMatch(pairingRoute, /approvalUrl.*pollSecret/);
  assert.match(worker, /DELETE FROM display_pairings WHERE id = \?/);
  assert.match(worker, /status: "approved", sessionToken/);
});

test("lock removes both cookie and kiosk session", () => {
  assert.match(page, /dashboardFetch\("\/api\/auth", \{ method: "DELETE" \}\)/);
  assert.match(page, /clearDisplaySession\(\);\s*setAuthorized\(false\)/);
});

test("landscape laptops retain the two-room wallboard", () => {
  assert.match(page, /pointer: fine/);
  assert.match(page, /hover: hover/);
  assert.match(page, /!signage && !desktopInput/);
  assert.match(page, /touchFirstViewport && \(availableWidth <= 900 \|\| availableHeight > availableWidth\)/);
  assert.match(css, /@media \(pointer: coarse\) and \(max-width: 900px\)/);
  assert.doesNotMatch(css, /@media \(max-width: 900px\), \(orientation: portrait\)/);
  assert.doesNotMatch(css, /@media \(max-width: 1699px\), \(orientation: portrait\)/);
});
