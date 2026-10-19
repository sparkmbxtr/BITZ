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

test("the access surface and board do not expose removed data-entry controls", () => {
  assert.doesNotMatch(page, /context-trigger|context-popover|>CODES<|\/api\/context/);
  assert.doesNotMatch(css, /context-trigger|context-popover|context-input-row|context-password-row/);
  assert.doesNotMatch(page, /report-trigger|SHOW_WEEKLY_REPORT_DOWNLOAD|\/api\/report/);
});

test("the graph board has responsive full-height rows without legacy card rules", () => {
  assert.match(css, /\.graphs-shell \{[\s\S]*grid-template-rows: repeat\(5, minmax\(142px, 1fr\)\)/);
  assert.match(css, /@media \(orientation: portrait\), \(max-width: 720px\)/);
  assert.doesNotMatch(css, /meaning-evidence|hepa-status|airflow-status|activity-event-label|closed-period-copy/);
});
