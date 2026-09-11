# Cloudflare Workers deployment

This repository is ready to run as the `spark` Cloudflare Worker. With the
Workers account subdomain set to `bioengineering`, its public address is
`spark.bioengineering.workers.dev`.

## Cloudflare Builds

- Production branch: `main`
- Build command: `npm run build`
- Deploy command: `npm run deploy`
- Root directory: `/`

## Automatic display updates

After a display loads the updater-enabled page, it checks `/api/display-version`
every 30 seconds. Two consistent observations of a different build trigger an
automatic navigation to the new page, usually within one minute of deployment.
The build fingerprint covers application source, styles, assets and build inputs.
The version endpoint is independent of the sensor connection and uses no-store
headers. Existing tabs that predate this feature adopt it on their next normal
page load; this rollout sends them no restart or recovery command.

Updates wait while a context note or report is open or the page is hidden. The
display preserves its saved login, presentation layout and scroll position.
An in-memory-only login must have a verified persistent cookie before navigating.
Network failures retain the current page, and repeated attempts to load the same
build are limited to prevent reload loops. Browser-native fullscreen remains
subject to the device browser's navigation policy; the dashboard's fitted
presentation layout is restored automatically.

Configure these production secrets in Cloudflare before the first public
deployment. Never commit their values to Git:

- `AIRQ_API_KEY`
- `AIRQ_LAB_DEVICE_ID`
- `AIRQ_OFFICE_DEVICE_ID`
- `DASHBOARD_PASSWORD_HASH`
- `DASHBOARD_SESSION_SECRET`
- `CONTEXT_ENTRY_PASSWORD_HASH`
- `MONITOR_EXPORT_TOKEN`

`CONTEXT_ENTRY_PASSWORD_HASH` is the SHA-256 verifier for the separate context-entry password. A successful check issues a five-minute, HttpOnly, same-origin capability that is consumed after one saved entry. Context submission therefore requires both the main dashboard session and the separate context password; ordinary dashboard sessions cannot read the stored context log.

`MONITOR_EXPORT_TOKEN` is a separate server-to-server secret for importing the
complete sensor cycle and manual LAB, OFFICE and OUTDOOR observations into the
monitoring workbook. It is accepted only as a Bearer authorization header for
explicit exports from `GET /api/airq` and for `GET /api/context`; it is never
sent to dashboard visitors or stored in the browser. Ordinary dashboard use
and context submission continue to require the protected dashboard session.

The context export is JSON with a stable schema version, Europe/Berlin timezone,
export timestamp, requested range and append-only entries. Workbook imports
deduplicate entries by their context ID.

The private GitHub workflow `Archive air-Q monitoring cycle` uses GitHub's
short-lived OIDC identity to request the same exports without copying any
long-lived token into GitHub or ChatGPT. The Worker accepts that identity only
for this repository, this workflow on `main`, the dedicated export audience,
and scheduled, manual or initial deployment runs. The resulting JSON is kept as
a private, expiring GitHub Actions artifact for downstream workbook processing.


The `Publish weekly airQ report` workflow runs on Sunday after the completed
Monday-Saturday period. It retrieves the protected exports, creates the A2
landscape chart report, validates the PDF and its SHA-256 digest, and uploads it
through the same short-lived GitHub OIDC trust path. The Worker stores the PDF
in bounded SQLite chunks inside the existing Durable Object. A single current
pointer is changed only after a complete read-back and hash verification, so a
failed replacement leaves the previous report untouched. The dashboard serves
only the exact most recently completed Monday-Saturday filename and never falls
back to an older week.

Optional numerical configuration:

- `LAB_VOLUME_M3`
- `LAB_ACH`
- `OFFICE_VOLUME_M3`
- `OFFICE_ACH`

When `AIRQ_API_KEY` is configured as a Worker secret, visitors are never asked
for the air-Q API key. They see only the dashboard password gate.

