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

test("access screen shows only the field and pairing code", () => {
  assert.match(page, /type="password"/);
  assert.doesNotMatch(page, />PASSWORD</);
  assert.match(page, /<div className="pairing-code" aria-live="polite">\{pairing \? <b>\{pairing\.code\}<\/b> : null\}<\/div>/);
  assert.doesNotMatch(page, /pairing-qr/);
  assert.doesNotMatch(page, /QR code for display code/);
  assert.doesNotMatch(page, /aria-label="Phone approval"/);
  assert.doesNotMatch(page, />DISPLAY CODE</);
  assert.doesNotMatch(page, /Generating secure display code/);
  assert.doesNotMatch(page, /Generate new code/);
  assert.doesNotMatch(page, /Use when a keyboard is available/);
  assert.doesNotMatch(page, /Scan once when the wall display/);
  assert.doesNotMatch(page, /Open <strong>\{new URL\(pairing\.approvalUrl\)\.host\}/);
  assert.doesNotMatch(page, /This approval remains valid for three months/);
  assert.doesNotMatch(page, /Open with the display password or authorise this screen from a phone/);
});

test("Tizen login and an already-authorised phone issue the same signed session grant", () => {
  assert.match(page, /Tizen\|SMART-TV\|TizenBrowser/);
  assert.match(page, /X-BITZ-Session-Mode/);
  assert.match(authRoute, /sessionGrant/);
  assert.match(auth, /x-bitz-display-session/);
  assert.match(auth, /return validSessionValue\(request\.headers\.get\(SESSION_HEADER_NAME\)/);
  assert.doesNotMatch(approvalPage, /Display password/);
  assert.doesNotMatch(approvalPage, /pairing-password/);
  assert.doesNotMatch(approvalPage, /type="password"/);
  assert.match(approvalPage, /body: JSON\.stringify\(\{ code \}\)/);
  assert.match(pairingRoute, /if \(!await isAuthorized\(request, configured\.sessionSecret\)\)/);
  assert.doesNotMatch(pairingRoute, /verifyPassword|passwordAccepted/);
  assert.match(approvalPage, /remain authorised for three months/);
});

test("pairing secrets stay off URLs and are one-time after approval", () => {
  assert.match(pairingRoute, /PAIRING_LIFETIME_MS = 10 \* 60_000/);
  assert.match(pairingRoute, /pollSecretHash: await sha256\(pollSecret\)/);
  assert.doesNotMatch(pairingRoute, /QRCode|qrSvg|approvalUrl/);
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

test("OFFICE activity timing prioritizes sustained sound-max transitions", () => {
  assert.match(page, /const SOUND_MAX_SIGNAL: ActivitySignal/);
  assert.match(page, /direction === "BEGIN"\s*\? maxSustained && soundSustained/);
  assert.match(page, /acousticCloseCandidates\.length[\s\S]*officeCloseCandidates\.length/);
  assert.match(page, /candidate\.acoustic\.matched && \(room === "OFFICE" \|\| candidate\.changed >= 2\)/);
  assert.match(page, /sustained sound-max drop and exit silence/);
});

test("LAB HEPA card includes a provisional airflow-rate assessment", () => {
  assert.match(page, /HEPA STATUS \/\/ AIRFLOW RATE/);
  assert.match(page, /LAB_VOLUME_ESTIMATE_M3 = 50/);
  assert.match(page, /LAB_FLOOR_AREA_ESTIMATE_M2 = 18/);
  assert.match(page, /latestCalendar\.minuteOfDay < 6 \* 60 \? "EST\. −50%" : "EST\. 0%"/);
  assert.match(page, /Math\.max\(tvocAdjustment, co2Adjustment, pm25Adjustment, pm10Adjustment\)/);
  assert.match(page, /EST\. \+20–50%/);
  assert.match(page, /status: `GOOD \/\/ \$\{airflow\}`/);
});
