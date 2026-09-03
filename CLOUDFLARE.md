# Cloudflare Workers deployment

This repository is ready to run as the `bitz-lab-air-monitoring` Cloudflare
Worker. Its public address will use the account's standard `workers.dev`
subdomain.

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

Optional numerical configuration:

- `LAB_VOLUME_M3`
- `LAB_ACH`
- `OFFICE_VOLUME_M3`
- `OFFICE_ACH`

When `AIRQ_API_KEY` is configured as a Worker secret, visitors are never asked
for the air-Q API key. They see only the dashboard password gate.
