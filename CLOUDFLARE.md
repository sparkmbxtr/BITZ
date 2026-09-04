# Cloudflare Workers deployment

This repository is ready to run as the `spark` Cloudflare Worker. With the
Workers account subdomain set to `bioengineering`, its public address is
`spark.bioengineering.workers.dev`.

## Cloudflare Builds

- Production branch: `main`
- Build command: `npm run build`
- Deploy command: `npm run deploy`
- Root directory: `/`

Configure these production secrets in Cloudflare before the first public
deployment. Never commit their values to Git:

- `AIRQ_API_KEY`
- `AIRQ_LAB_DEVICE_ID`
- `AIRQ_OFFICE_DEVICE_ID`
- `DASHBOARD_PASSWORD_HASH`
- `DASHBOARD_SESSION_SECRET`
- `MONITOR_EXPORT_TOKEN`

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

Optional numerical configuration:

- `LAB_VOLUME_M3`
- `LAB_ACH`
- `OFFICE_VOLUME_M3`
- `OFFICE_ACH`

When `AIRQ_API_KEY` is configured as a Worker secret, visitors are never asked
for the air-Q API key. They see only the dashboard password gate.
