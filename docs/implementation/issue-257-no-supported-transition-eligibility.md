# Issue #257 — NO_SUPPORTED_ANSWER transition eligibility

Status: `VALIDATING` (controller-directed implementation; exact-head CI is
required before controller completion)

## 1. Source audit and authority

The audit started from the controller's canonical base
`main@c563ad147bd75406882cf1378d319f6d8a044cf4` and traced terminal
`AskAnswerRunSnapshot.capabilities`, persisted `answer_run_attempts.context_supported`,
and all three transition-seed paths (`CREATE_INTAKE_DRAFT`,
`CREATE_DRAFT_CHANGE_SET`, `PROPOSE_DIRECTIVE`). The in-memory adapter derives
context status from the resolved typed context; the PostgreSQL adapter persists
the same status on the attempt and now re-reads it for terminal projections and
seed creation. `EXPORT` remains independent.

The browser-visible capability array is not authoritative. The shared typed
rule is:

```text
SUCCEEDED + SUPPORTED          => EXPORT + the three proposal capabilities
SUCCEEDED + NO_SUPPORTED_ANSWER => EXPORT only
```

Both the execution service and each persistence adapter fail closed when a
transition seed is requested for a terminal `NO_SUPPORTED_ANSWER` run. The
PostgreSQL workspace read projection also derives the terminal capability list
from the persisted attempt status, so stale stored proposal capabilities do
not reappear in the browser.

## 2. Implementation and safety boundary

- `modules/frontend-ask-execution`: shared typed capability derivation and
  transition-seed authority guard.
- `adapters/frontend-ask-execution-in-memory`: persisted-context capability
  normalization, completion capabilities, and direct seed guard.
- `adapters/frontend-ask-execution-postgres`: persisted `context_supported`
  read-back for terminal capabilities and completion, plus an authoritative
  seed guard in and outside command transactions.
- `adapters/frontend-ask-write-postgres`: terminal workspace projection derives
  capabilities from the latest persisted attempt status.
- `apps/shotgun-web`: focused command-surface negative coverage; no browser
  policy or new transition kind was added.

No answer-text parsing, browser authority, Canonical write, Review mutation,
conversation/project/access/sensitivity scope relaxation, retry change, ADR,
Product Contract Snapshot amendment, or database migration was introduced.

## 3. OSS and architecture decision

No new runtime or dependency is relevant to this typed server-authority seam.
The four reviewed references remain `REFERENCE_ONLY`:

- [garrytan/gbrain](https://github.com/garrytan/gbrain) — commit
  `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT; no runtime or DB adopted.
- [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki) — commit
  `ad626a3d81be1480e35ef4e94234de8dbb27a61e`, Apache-2.0; no conversion or
  evidence runtime is relevant.
- [ddsyasas/llm-wiki](https://github.com/ddsyasas/llm-wiki) — commit
  `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`, MIT; UX patterns only.
- Inkeep OpenKnowledge — commit `f2834c237639e2cff603817ed88182b33f83cf91`,
  GPL-3.0-or-later; UI patterns only and runtime/storage excluded.

The existing PostgreSQL and in-memory adapters remain behind the existing
execution/read ports. Replacement is a normal code/PR revert; no data
migration or rollback step is required.

## 4. Focused verification

- Unit execution tests cover stale/tampered proposal capabilities on a
  `NO_SUPPORTED_ANSWER`, `EXPORT`-only projection, all three fail-closed seed
  requests, supported-answer proposal capabilities, and exact replay of a
  supported seed.
- Frontend command tests cover hiding all three proposal commands while
  retaining Export for an `EXPORT`-only projection.
- PostgreSQL Issue #277 coverage exercises supported and no-supported terminal
  attempts, persisted capability parity, workspace projection parity,
  authoritative seed rejection, and supported idempotent seed replay.
- Root typecheck, web typecheck, architecture boundaries, changed-file ESLint,
  Prettier, focused unit tests, and focused frontend tests pass locally.
  PostgreSQL execution is present but cannot run locally without the dedicated
  `TEST_DATABASE_URL` service.

## 5. Scope and exclusions

Included: one shared typed capability rule, terminal read-model convergence,
server fail-closed transition-seed authority, and focused adapter/UI tests.

Excluded: new transition kinds, text/content inference, browser-only guards,
automatic approval or Canonical writes, retry/replay redesign, unrelated Ask
UI cleanup, changes to Issues #255/#256/#258/#259, ADR/Contract/migration work,
and merge.

## 6. Review handoff

- Branch: `codex/issue-257-no-supported-transition-eligibility`
- Canonical base: `main@c563ad147bd75406882cf1378d319f6d8a044cf4`
- Implementation head, PR number, and one exact-head CI run are recorded in
  the controller handoff after the final validation commit. Merge is
  intentionally not performed.
