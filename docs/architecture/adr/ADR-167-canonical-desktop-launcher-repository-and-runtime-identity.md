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

The launcher atomically owns `.data/launcher/runtime.json`, which is ignored by
Git. Its versioned record contains:

`schemaVersion`, `launcherId`, `phase`, `pid`, `processStartedAt`, `repoRoot`,
`branch`, `sha`, `host`, `port`, `url`, `startedAt`, and `ownershipNonce`.

`phase` is `starting` before application startup and is promoted to `ready`
after the existing readiness boundary succeeds. A future launch may reuse a
runtime only when the record is valid, the PID is live, the command/process
identity proves the same launcher and repository, the SHA equals freshly
fetched `origin/main`, host/port match, and the normal readiness check succeeds.
Reuse starts no second application and does not rebuild or remigrate.

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
failure. Successful startup logs the canonical branch/SHA, runtime PID/SHA/URL
and readiness. Fast-forward and reuse paths log their old/target identity.

## OSS integration decision

`NO_RELEVANT_OSS`: this correction uses the existing Git executable, Node.js
standard library process/filesystem APIs and the existing launcher ports. The
four Shotgun reference repositories do not provide a safe canonical-repository
or local process-ownership authority that can be adopted behind this boundary.
No new runtime dependency is introduced. Existing PostgreSQL, Connector Runtime,
Action, Canonical, Evidence and Approval ownership remains unchanged.

## Verification, migration and rollback

The launcher contract tests cover preflight ordering, branch/worktree policy,
fresh fetch, fast-forward-only update, self-reexec, runtime identity lifecycle,
same-SHA reuse, stale cleanup, ownership safety and existing shutdown/readiness
behavior. Real temporary bare-origin/clone tests cover remote fast-forward,
dirty worktree refusal, ahead/diverged refusal, preserved untracked files and
changed-SHA reexec. No database migration or Product data change is required.

Rollback removes the launcher preflight/runtime wiring and ADR reference while
leaving Product and database schema state untouched. A replacement launcher
implementation must pass the same contract, real-Git and runtime-ownership
tests before adoption.
