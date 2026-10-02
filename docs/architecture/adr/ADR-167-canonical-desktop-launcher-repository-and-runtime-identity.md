# ADR-167 — Canonical Desktop Launcher Repository and Runtime Identity

_Status: Accepted for RUS-2-C1 (2026-09-15)_

## Context

The owner-facing `npm run launch` path previously validated environment, built
the SPA, verified PostgreSQL, started the canonical application composition and
waited for readiness, but it did not prove that the repository or an existing
runtime belonged to the current canonical `main`. A launcher could therefore
run stale code or start a second process without an observable runtime
identity.

RUS-2 is a live owner acceptance gate, so repository canonicality and local
runtime ownership must be proven before SPA, database, application or browser
work begins.

## Decision

The owner-facing launcher is a local runtime authority boundary only. It does
not become the authority for Product state, Canonical knowledge, database
migrations, or provider outcomes.

Before any SPA build, database probe/verification, application import/start or
readiness request, the launcher:

1. requires the current branch to be `main` and fails closed on tracked,
   staged or unmerged changes;
2. preserves unrelated untracked files, including the two user documents in
   this repository;
3. fetches `origin main` and resolves the freshly fetched `origin/main`;
4. advances local `main` only with `git merge --ff-only origin/main`, failing
   closed for ahead or diverged state; and
5. proves final `HEAD === origin/main`.

When a fast-forward changes `HEAD`, the launcher self-reexecutes from the new
tree before importing the application composition. The reexec preserves
arguments and environment and is fenced to one bounded re-entry. The old-SHA
process performs no SPA, DB or application startup work.

## Runtime identity

The launcher exclusively reserves and then atomically owns
`.data/launcher/runtime.json`, which is ignored by Git. Initial startup uses a
create-only filesystem operation; it never uses read-then-replace as the
reservation authority. Its versioned record contains:

`schemaVersion`, `launcherId`, `phase`, `pid`, `processStartedAt`, `repoRoot`,
`branch`, `sha`, `host`, `port`, `url`, `startedAt`, and `ownershipNonce`.

`phase` is `starting` before application startup and is promoted to `ready`
after the existing readiness boundary succeeds. A future launch may reuse a
runtime only when the record is valid, the PID is live, the command/process
identity proves the same launcher and repository, the SHA equals freshly
fetched `origin/main`, host/port match, and the normal readiness check succeeds.
Reuse starts no second application and does not rebuild or remigrate.

If a proven live identity is still `starting`, a competing launcher fails with
`RUNTIME_START_IN_PROGRESS`; it does not terminate the owner, replace the
identity or start Product work. A reservation race loser re-reads and follows
the existing runtime classification rules. A dead `starting` identity may be
removed and replaced after ownership-safe validation. Ready promotion may use
atomic replacement only after the create-only reservation has been acquired.

A dead record removes only its own identity file. A live runtime with a
different SHA is stopped only after ownership is proven, then its matching
identity is removed. A live PID with unverified ownership, a malformed identity,
or a stale-runtime stop failure fails closed; the launcher never terminates an
arbitrary PID. Normal shutdown removes only the current PID/nonce identity and
preserves the existing exactly-once SIGINT/SIGTERM cleanup contract.

## Failure taxonomy and observable evidence

The launcher retains its existing actionable `code`, `check` and `command`
failure shape and adds narrow categories for non-main branch, unsafe tracked
worktree, Git fetch, fast-forward-only update, final SHA mismatch, invalid
identity, unverified ownership, stale stop failure and canonical reexec
failure, plus live startup-in-progress. Successful startup logs the canonical
branch/SHA, runtime PID/SHA/URL and readiness. Fast-forward and reuse paths log
their old/target identity.

## OSS integration decision

`NO_RELEVANT_OSS`: this correction uses the existing Git executable, Node.js
standard library process/filesystem APIs and the existing launcher ports. The
four Shotgun reference repositories do not provide a safe canonical-repository
or local process-ownership authority that can be adopted behind this boundary.
No new runtime dependency is introduced. Existing PostgreSQL, Connector Runtime,
Action, Canonical, Evidence and Approval ownership remains unchanged.

## Verification, migration and rollback

The launcher contract tests cover preflight ordering, branch/worktree policy,
fresh fetch, fast-forward-only update, self-reexec, exclusive concurrent
reservation, live-starting fail-closed behavior, runtime identity lifecycle,
same-SHA reuse, stale cleanup, ownership safety and existing shutdown/readiness
behavior. Real temporary filesystem tests prove one create-only winner and
complete JSON contents; real temporary bare-origin/clone tests cover remote
fast-forward, dirty worktree refusal, ahead/diverged refusal, preserved
untracked files and changed-SHA reexec. No database migration or Product data
change is required.

Rollback removes the launcher preflight/runtime wiring and ADR reference while
leaving Product and database schema state untouched. A replacement launcher
implementation must pass the same contract, real-Git and runtime-ownership
tests before adoption.

## Amendment history

### 2026-09-18 — Proven PID-reuse recovery

The original fail-closed rule remains valid whenever ownership is genuinely
unverified. The launcher now distinguishes a proven Windows PID reuse from
that case only when the live process has a different OS process-start token
and its available command line does not prove same-repository `launch-local`
ownership. In that narrow case, the launcher removes only the matching stale
runtime identity through the existing nonce/identity-safe removal path,
records the recorded and current start tokens, and reserves a fresh identity.
The reused live PID is never terminated. This is a recovery clarification
within the existing local launcher boundary and does not create a new Product
or runtime authority.

### 2026-09-30 — VP-07 supervised application restart

The canonical launcher remains the sole owner of `.data/launcher/runtime.json`
and now supervises a replaceable application child through Node's built-in
`child_process.fork` IPC. The child executes the existing `runLaunch` path,
including environment validation, SPA build, non-destructive database/schema
checks, T3 launch recovery, application startup, and the existing HTTP/SPA
readiness test. It sends `ready` only after that complete boundary succeeds.
The parent then marks the runtime `ready` and opens the browser once. If the
child exits, the parent immediately returns the identity to `starting`, applies
bounded exponential restart delay (1 to 30 seconds), and retries temporary
database/network startup failures or an unexpected post-readiness exit. A
configuration, schema, port, or build failure is reported and ends supervision
without retry. SIGINT/SIGTERM stop the child and release only the parent's
matching PID/nonce identity. If the owner process disappears, the child
fail-closes on IPC disconnect.

The process supervisor does not write Product data or claim that backup,
database restore, cutover, rollback, or full VP-07 recovery acceptance has
passed. These remain separately verified launch/release gates.

#### OSS integration decision

| Candidate                 | Source and reviewed pin                                                                                              | Decision          | Scope and boundary                                                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js child process API | [nodejs/node](https://github.com/nodejs/node), runtime `v24.15.0`; MIT                                               | `NO_RELEVANT_OSS` | Existing Node runtime's built-in `fork`/IPC only; no new dependency or lockfile entry. The runtime version is recorded as the local verification baseline, not as a Shotgun package adoption. |
| PM2                       | [Unitech/pm2](https://github.com/Unitech/pm2), `v7.0.4`, commit `cd6b1b4c592117212d7349d6932288613f336c15`; AGPL-3.0 | `REJECT`          | Would add a separate daemon/process-identity authority and copyleft deployment review. Its Windows startup hook also requires an external package. No PM2 code or runtime is included.        |
| gbrain Minion recovery    | [garrytan/gbrain](https://github.com/garrytan/gbrain), commit `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`; MIT        | `REFERENCE_ONLY`  | Existing Job retry/lease patterns were reviewed; the gbrain runtime does not supervise this local desktop process or own its launcher identity.                                               |

This change adds a Shotgun-owned runtime process boundary because no examined
OSS supervisor fits the canonical PID/nonce ownership and local Windows
launcher contract. `tests/unit/launch-supervisor.test.ts` covers transient and
terminal startup failures, readiness, phase transitions, browser-once behavior
and restart; `tests/integration/launch-supervisor-process.test.ts` exercises
the real Node child process and IPC shutdown/restart path. No database
migration is required. On 2026-10-01, a guarded disposable PostgreSQL database
and local TCP proxy test also verified active session loss, a failed child
startup while connections were blocked, and application readiness after
connections returned. A second disposable-container test then stopped and
restarted the pinned PostgreSQL server: after the database returned at the
same loopback address, the supervisor started a replacement child and its
authenticated project-list API returned the persisted project. The test also
confirmed the PostgreSQL postmaster start time changed and the row remained.
Idle-client `57P01` pool events are handled and logged rather than emitted as
uncaught process errors. The existing maintenance-lock contract still
fail-stops the child on session loss; recovery occurs through supervised child
replacement. These tests do not establish data-bearing Job convergence,
backup/restore, cutover, or rollback. Full details are in the
[VP-07 restart report](../../implementation/vp-runtime-restart-supervision-2026-09-30.md).
Rollback restores the previous in-process launcher entry and removes the
supervisor module/tests; application modules and Product data remain unchanged.
