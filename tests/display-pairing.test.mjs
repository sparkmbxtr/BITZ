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

test("access screen retains concise password and phone approval choices", () => {
  assert.match(page, /type="password"/);
  assert.doesNotMatch(page, />PASSWORD</);
  assert.match(page, /pairing-qr/);
  assert.match(page, /aria-label="Phone approval"/);
  assert.doesNotMatch(page, /Use when a keyboard is available/);
  assert.doesNotMatch(page, /Scan once when the wall display/);
  assert.doesNotMatch(page, /Open <strong>\{new URL\(pairing\.approvalUrl\)\.host\}/);
  assert.doesNotMatch(page, /This approval remains valid for three months/);
  assert.doesNotMatch(page, /Open with the display password or authorise this screen from a phone/);
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

test("short landscape laptops fit the complete wallboard into the viewport", () => {
  assert.match(page, /availableWidth < 1920 \|\| availableHeight < 960/);
  assert.match(page, /setFitViewport\(fitted\)/);
  assert.match(page, /presentationMode \|\| fitViewport/);
  assert.match(page, /presentationMode \? 1080 : 960/);
  assert.match(page, /wallboard-auto-fit/);
});

test("PAIR is adjacent to CODES and visible whenever the screen is portrait", () => {
  assert.match(page, /className="footer-context-cluster"/);
  assert.match(page, /className="pair-trigger" href="\/pair"/);
  assert.match(css, /\.pair-trigger \{ display: none;/);
  assert.match(css, /@media \(orientation: portrait\) \{\s*\.pair-trigger \{ display: inline-flex; \}/);
});

test("fitted landscape decision cards do not clip their two text rows", () => {
  assert.match(css, /\.meaning-evidence > \.meaning-signal \{\s*grid-template-rows: minmax\(0, 1fr\) auto;/);
  assert.match(css, /\.meaning-evidence b\.meaning-status \{\s*height: auto;\s*min-height: 0;/);
});
