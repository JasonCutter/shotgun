# Whole application distribution and runtime identity rehearsal

Date: 2026-10-13. Scope: isolated, synthetic Git `origin/main`, full application
recovery assembly plus a normal-worker HTTP product journey with strict fakes.
This is local development evidence.
It does not establish that the operating installation runs GitHub Canonical.

## Executable proof

`tests/integration/vp-application-distribution.test.ts` now constructs a source
distribution from an explicit runtime allowlist. It includes the actual frontend,
application assembly, modules, adapters, packages, database migrations, root
manifest/lockfile, launcher and runtime operator entrypoints. The tracked
`.env.example` is a placeholder template: empty provider/master/egress entries and
placeholder staging/bootstrap secrets are asserted before it is included. Real
env files, asset stores, authority data, historical reports, frozen evaluations
and Gold-B-7 are excluded. No protected data is opened to make the package.

Each selected source file has a SHA-256 in the distribution manifest. The source
base commit and the content digest are separate: the allowlist includes current
local runtime changes, so the artifact is not the unchanged source-base tree.
The synthetic commit uses the base commit timestamp; the archive is exported
from that synthetic tree. Its inventory is checked against the complete allowlist
plus three verification fixtures, two audited test helpers and manifest. A fresh checkout from the
temporary bare origin is the installation target.

The installation runs real `npm ci` against the existing package lock with a
fresh dependency directory/cache and empty user/global npm and Git configuration.
Install lifecycle scripts are disabled. Public npm package retrieval is allowed;
AI provider egress is forbidden. Every runtime source hash is rechecked after
installation. The real bootstrap help entry is also resolved from the package.

A generated, empty test database receives migrations from the installed
distribution. The actual default Canonical preflight, launch core, launch default
dependencies and process supervisor are reused. The verification entry selects
the existing full `startShotgunApplication` recovery profile, with its normal SPA
build, database/schema verification, T3 launch recovery and same-origin HTTP
readiness. The executable production `launch-local.ts` is shipped but is not
imported or executed against the operating checkout.

## Verified runtime behavior

- Real backend `/health`, built SPA HTML and its emitted JavaScript asset load
  successfully. Anonymous Product API access returns 401.
- The actual identity file records the installed root, freshly fetched synthetic
  main SHA, real OS process start token, PID and nonce. Readiness promotes it to
  `ready`.
- A second Canonical preflight reuses the same proven live owner after HTTP
  readiness, preserving its PID, SHA and nonce.
- Abrupt application-child exit returns the identity to `starting`; the existing
  supervisor starts a fresh application child and restores `ready`. The owner
  PID/nonce is unchanged and a test DB row and asset marker survive.
- Abrupt owner exit makes its application child stop on IPC disconnect. The next
  real preflight removes the dead owner's matching identity, starts a new owner
  with a different nonce, and reaches readiness from the same artifact.
- Graceful shutdown removes only the matching identity. All generated databases,
  source/distribution files, dependencies/cache and asset markers are cleaned up.
- All three recovery assembly generations report no Ask worker and no Canonical
  projects; the isolated global authority store remains empty. Provider calls are
  zero and no operating app/worker/shortcut is started or changed.

The Windows-host test transport resolves `pg` from the fresh distribution and
checks the exact owned container ID, volume and isolated network before using
DockerSocket. It does not use the operating checkout's dependency tree. A normal
local PostgreSQL test target uses the existing test database guard and isolated
database helper without that transport fixture.

The same fresh installation then runs one normal `runtime-test` product journey
before cleanup. The existing audited full-application helper supplies separate
generated product/authority databases, a synthetic encrypted credential vault,
standing/provider transfer policies and strict Fake Provider transport. It uses
the original `startShotgunApplication` factory and normal workers; only the
helper's request transport is replaced with real loopback HTTP requests to the
actual listener. No application or domain implementation is duplicated.

That journey makes **53 HTTP requests**, submits A, B and A's explicit material
revision, and asks **3 questions**. The Ask worker is active. The measured fake
calls are extraction **3**, answer **3**, relation **1**; live provider calls are
**0**. Current citations include revised A and B and exclude old A; evidence rows
bind to those exact source/version IDs. The old AnswerRun's statements, answer
revision and capabilities remain unchanged while it becomes stale. The actual
relation worker records v6 policy plus global claim and semantic attempt bindings
against the separate fake authority. No live DeepSeek meaning or billing result
is certified by these synthetic responses.

## Results and artifact identity

The combined outer rehearsal passes **1/1 in 406.77s**, including the nested
normal-worker journey **1/1 in 122.80s**. The artifact has **858 runtime source
files**, **441 lockfile package entries** and **3 recovery application generations**.

| Identity                        | Captured value                                                     |
| ------------------------------- | ------------------------------------------------------------------ |
| Source base commit              | `e3abc1163918809a0dbb88f4a5f7841d60c47b8a`                         |
| Includes local runtime changes  | `true`                                                             |
| Runtime source manifest SHA-256 | `fc6e7074b2aa42d87283d57bb4c10d95da23c355690d0382761ec4203ee79212` |
| Synthetic main SHA              | `52f45b6bcdee053e033435b15b33cc0ba3b0a543`                         |
| Exported archive SHA-256        | `b0766018e7aed5d2ff4fb144c978dbcba6d642f26ba6bfe4379c85f1980c5f75` |

The artifact records exactly its captured source bytes. It does not prove later
prototype edits, an unchanged published e3 tree, or the operating installation.
Earlier recovery-only proofs are superseded in scope by this combined result.

Two fixture corrections were required: workspace build subprocesses change cwd,
so the test PG bridge resolves its fresh `pg` relative to itself; native HTTP
transport must retain the inject helper's automatic JSON content type for the
initial session bootstrap. Neither correction changes production runtime code.

Existing Canonical launcher, launch-core and supervisor regressions pass
**55/55** across four files. Targeted harness ESLint and root typecheck passed at
the first complete rehearsal; later root media test edits are checked again for
the final snapshot. Full root ESLint has zero errors and two existing unused
disable-directive warnings in authentication.

## Reuse decision, migration and remaining acceptance

This adds verification fixtures rather than a second launcher, installer,
supervisor or recovery implementation. It reuses ADR-167's existing decisions:
Node.js built-in process/filesystem/HTTP APIs ([nodejs/node](https://github.com/nodejs/node), local `v24.15.0`, MIT),
existing Git (`2.54.0.windows.1`) and npm (`11.12.1`). Existing package versions and
integrities are fixed by the root lockfile; no dependency is adopted or changed.
[ADR-167](../../architecture/adr/ADR-167-canonical-desktop-launcher-repository-and-runtime-identity.md)'s `NO_RELEVANT_OSS` launcher-boundary decision, PM2 `REJECT` and gbrain
`REFERENCE_ONLY` remain applicable. The OSS role matrix is unchanged because
production module/adapter boundaries and dependencies are unchanged.

Only newly generated test databases are migrated. Cleanup drops those databases
through the existing namespace guard and removes the verified temporary root.
The explicit developer-only `VP_DISTRIBUTION_PROOF_KEEP_TEMP=true` option retains
the owned source/dependency directory after all process and database cleanup.
Default CI behavior removes it. Rollback removes this test and its three fixtures; no production schema, authority,
asset, environment or startup contract changes need reversal.

This proof establishes that a fresh JavaScript application distribution can be
assembled and that the existing launcher/runtime identity ports supervise the
actual recovery assembly and normal text intake/Ask workers with strict fake
provider transport over HTTP. Python dependency provisioning and converter
execution on a fresh machine, interactive browser intake/Ask from this artifact,
actual owner entry
startup from final GitHub main, operating DB/asset identity and cutover, desktop
shortcut ownership, and Windows reboot remain distinct acceptance evidence.
The source/base/synthetic SHA must not be presented as proof that Canonical
`e3abc1163918809a0dbb88f4a5f7841d60c47b8a` is installed or running.

## Subsequent fresh Python proof

After this captured JavaScript distribution completed, a separate owned virtual
environment installed its exact17 Python pins and ran its unchanged captured
worker through the canonical-compatible adapter over six existing structural
formats. All six conversion/locator/original-hash checks passed; see
[fresh Python verification](./fresh-python-converter-proof.md). This adds concrete
dependency/converter evidence without changing the scope of this original
recovery/normal HTTP proof or claiming a standalone interpreter/operating install.

A copied source/dependency directory at
`C:/dev/artifacts/vp-full-completion-2026-10-12/installed-product-rehearsal` is
**SOURCE_EVIDENCE_ONLY** after original cleanup. Its workspace junctions reference
the original owned temporary tree. Automatic approval review rejected the
attempt to remove/recreate computed workspace junctions with **"blocked by
policy"**; no link was changed and the action was not retried. The successful
runtime proof used the original fresh installation. The safe future alternatives
are the explicit keep option or a new empty installation from the allowlisted
source; the copied directory is not claimed as an independently installed runtime.
