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
dashboard and regression checks; `npm run deploy` preserves the existing `spark`
bindings and storage. The helper resolves the existing namespace through the
provider inventory, retaining an existing external `bitz` owner when present. It
pins that namespace ID before deployment and verifies it, the migration tag and
existing binding inventory afterward. A tag-only migration entry sends no
create, rename, delete or transfer steps. Missing, ambiguous or incompatible
namespace metadata stops deployment. The deployment helper verifies the login form, anonymous
API denial and configured seven-day authentication. Production password success
must be verified without logging the supplied password or cookie.

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
