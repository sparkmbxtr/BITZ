# Nucleosome progress dashboard

The root of `https://spark.bioengineering.workers.dev` displays the research
progress dashboard. The neutral airQ display and its protected backend routes
keep their existing routing and storage.

The interface uses a dark monospace theme. Its top header contains
`SPARK BMC-LMU` on the left and the information update timestamp in `MMDDYYHHMM`
on the right, in Europe/Berlin time. The timestamp changes when information is
published. The browser checks for updates every 30 seconds.

`GET /api/nucleosome-progress` returns the six selected runs, original-guard
pass/fail state, cumulative progress, study stages and update times. The seed
snapshot remains available while the automatic writer is being activated.

The private `sparkmbxtr/nucleosome` repository publishes a compact snapshot after
checkpoint journal changes on `codex/nucleosome-c-sync`. Its
`.github/workflows/publish-nucleosome-progress.yml` workflow authenticates `PUT`
requests with a short-lived GitHub OIDC token. The receiver verifies the RSA
signature, audience, immutable repository and owner IDs, private visibility,
branch, workflow and token expiry. No deployment or repository credentials reach
the browser.

Progress is stored in a separate named instance of the existing `ContextLog`
Durable Object class. Updates preserve completed/guard-stopped runs and reject
step regressions. The writer checks the persisted response and public readback.
Existing backend secrets, Durable Object identity and migrations are retained.

The existing Cloudflare Builds integration for BITZ runs the normal neutral
display deployment, then `scripts/deploy-existing-spark.mjs` deploys the same
compiled Worker to the existing spark target. The script reads spark settings
with the current build credential, verifies the original Durable Object class,
preserves existing bindings and variables, and verifies the live progress page.

Stage completions and watchdog arming are maintained in the private
`sync/tools/progress_dashboard/dashboard-context.json` after verified evidence.
Baseline completion is calculated from terminal run outcomes. The data path
creates no scientific jobs and changes no scientific guard or resource setting.

Validation: `node --test tests/nucleosome-*.test.mjs`. The normal Cloudflare build
also runs these checks through `npm run test:dashboard`.
