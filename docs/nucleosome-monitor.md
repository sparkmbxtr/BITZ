# Nucleosome program monitor

The existing `spark` Cloudflare Worker serves the graphical experiment overview
at `https://spark.bioengineering.workers.dev/`. Its source and changes are
auditable in this Git repository. The independent air-Q application and existing
Durable Object storage identities are retained.

## Access

The monitor reuses the framework's password verifier and session signing secret.
Keep `DASHBOARD_PASSWORD_HASH` and `DASHBOARD_SESSION_SECRET` in the existing
Worker's secret configuration. An optional `NUCLEOSOME_PASSWORD_HASH` overrides
the verifier for this monitor only. Passwords and verifiers must never be
committed to source, build output, or diagnostic logs.

A successful login sets a signed, Secure, HttpOnly, host-only cookie for exactly
604800 seconds. A separate cookie name and HMAC scope prevent a longer air-Q
wallboard session from granting monitor access. Reading the monitor does not
extend the expiry. The page and JSON API require authentication; a reader cannot
publish status. Cookies are remembered per browser profile, including on phones
and tablets. Clearing cookies or using a private browser session removes access.
The monitor reuses the existing non-empty framework signing key without adding
a separate key-length requirement or rotating it. Configuration diagnostics
report verifier/signing readiness as booleans, never secret values or lengths.

## Verifiable update path

1. A read-only observer on the actual computation host samples process start
   identity, CPU advancement, completed observation rows, original guards,
   verified checkpoint archives and watchdog status. It never integrates or
   acknowledges the communication watchdog.
2. The observer commits small immutable `spark-monitor-*` snapshot/evidence
   packages to the existing private scientific Git journal. Full scientific
   files and machine identifiers stay in that private repository.
3. The journal's `publish-nucleosome-progress.yml` workflow runs the exact
   commit-pinned `scripts/publish-nucleosome-progress.py` from this repository.
   GitHub issues a short-lived OIDC token for the pre-existing pinned repository,
   branch, workflow and audience. There is no stored publisher credential.
4. The Worker validates and persists only the allowlisted overview fields, then
   the workflow independently reads back the protected JSON and checks saved
   steps and the original cloud observation timestamp.

The browser refreshes every 30 seconds; the observer normally publishes every
five minutes. Neither a Git commit nor a page refresh proves a running process.
Runtime confirmation expires after six minutes without a new actual observation.
The feed and checkpoint ages remain separate. Persistent storage rejects step
regressions and changes to already terminal jobs.

## Design and estimates

All six study stages and all six baseline replicas remain in the viewport on
phones, tablets, laptops and monitors. Larger screens add history and detailed
runtime properties. Baseline completion is saved steps out of its original
600000-step cap. Completed study stages are a separate count, not an invented
whole-program percentage.

The overview lives in the `Nucleosome-C` workspace tab, with a dark Bordeaux
and plum theme. `worker/dashboard-tabs.mjs` holds the section registry so later
sections can have their own route and theme. The existing `/nucleosome` route
opens this selected tab under the same protected seven-day device session.

The reviewed program has six bound replicas, nine standalone controls and six
initial force scouts. Up to twelve refinement runs and up to thirty-six held-out
runs are conditional: the 69-row ceiling is capacity, not a released force sweep.
Component and apparatus qualifications and frozen held-out decisions remain
prerequisites.

Time estimates use a measured step delta divided by actual elapsed wall time on
the identified CPU, including startup, checkpoint and verification overhead.
The dashboard cites that sample, CPU type, four threads, CPU quota, visible CPU
count and memory. Provider VM type is explicitly unavailable when unexposed.
Later-stage durations are same-rate reference budgets: their Hamiltonians and
costs differ and their speeds have not yet been measured. Qualification work,
communication stops and other interruptions add time. Estimates do not renew a
lease or guarantee uninterrupted uptime.

## Deployment and verification

Use the existing Git-to-Cloudflare Builds deployment. `npm run build` runs the
dashboard and regression checks. Each existing Worker has its own linked Git
build: `bitz` uses `npm run deploy:bitz` (also the default `npm run deploy`);
`spark` uses `npm run deploy:spark`. Both use this repository's `main` branch
and the repository root. In Cloudflare, open the existing `spark` Worker and
connect its Builds configuration to this repository if it is not yet connected.
Set build command `npm run build` and deploy command `npm run deploy:spark`.
Do not create a replacement Worker. The linked-Worker safety check remains
enabled; a `bitz` build cannot perform the `spark` deployment.

The root `wrangler.jsonc` names `spark`, matching its linked Git settings.
The unchanged neutral display configuration is in `wrangler.bitz.jsonc`.
Vite selects the corresponding source file from Cloudflare's existing linked
Worker name without overriding the provider name or tag. For local production
builds use `npm run build:spark` or `npm run build:bitz`; the ordinary local build
retains the neutral display default. Both Cloudflare build commands remain
`npm run build` with no dashboard-setting changes required.

The Spark helper preserves the existing bindings and storage. It resolves the existing namespace through the
provider inventory, retaining an existing external `bitz` owner when present. It
pins that namespace ID before deployment and verifies it, the migration tag and
existing binding inventory afterward. A tag-only migration entry sends no
create, rename, delete or transfer steps. Missing, ambiguous or incompatible
namespace metadata stops deployment. The deployment helper verifies the login form, anonymous
API denial and configured seven-day authentication. Production password success
must be verified without logging the supplied password or cookie.

The provider-confirmed ContextLog namespace is pinned in the helper. If its
binding is missing, the helper can restore the binding only to that existing
SQLite namespace under `spark`. The namespace ID is checked again afterward;
the repair creates no namespace or class migration.

The optional `Deploy existing spark Worker from Git` workflow can reuse an
already configured GitHub `CLOUDFLARE_API_TOKEN` secret. It skips deployment when
that existing binding is absent and records the reason in its job summary.
Credentials are not copied from another machine. The workflow deploys only the
existing `spark` Worker through the same binding-preserving helper.

Run `node --experimental-strip-types --test tests/nucleosome-*.test.mjs` for session expiry, tampering,
reader/writer separation, OIDC signature and claim checks, payload validation,
freshness and deployment binding preservation. Responsive browser checks should
include small portrait and landscape phones, tablet, laptop and large monitor.

The explicit type-stripping flag keeps direct TypeScript auth-module tests
compatible with the existing Node22.13 minimum; it does not depend on the later
Node22 release that enables stripping by default.

The existing neutral Worker also exposes `/api/nucleosome-deployment-metadata`
only to the pinned GitHub OIDC publisher. Its build captures an allowlist of
binding names/types, namespace identities and provider read errors. Secret
values and binding contents are excluded at capture and response time. The
private Git verification job retrieves this to diagnose deployments without
manual log transfers. It cannot modify configuration, renew a lease or run MD.
