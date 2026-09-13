# Issue #255 — Ask conversation summary terminal convergence

Status: `VALIDATING` (controller-directed implementation; exact-head CI is
required before controller completion)

## 1. Source audit and authority

The audit started from the controller's canonical base
`main@065cebc45bd5ec51573b485ed33d55cac9ca64b4`. The selected conversation
turn can use the fresher `runOverrides[answerRunId]` AnswerRun snapshot, while
the conversation list renders the server-provided
`workspace.conversations[].latestRunState`. A terminal AnswerRun can already
be present in the mounted workspace while that summary remains `QUEUED`, so a
terminal poll must converge both views without synthesizing summary state in
the browser.

The existing polling effect now performs one bounded authoritative
`askClient.getWorkspace(activeConversationId)` read when either (a) the poll
crosses from a non-terminal state into an existing polling-complete state or
(b) the mounted conversation summary state disagrees with the observed
terminal AnswerRun. The response is installed only if cancellation, project,
and active-conversation checks still match the current Ask scope.

## 2. Implementation and safety boundary

- `apps/shotgun-web/src/routes/ask-workspace.tsx`: terminal polling compares
  the authoritative summary state and refreshes the existing workspace read
  once when convergence is required; `runOverrides` remains the selected-run
  freshness mechanism.
- `apps/shotgun-web/src/routes/ask-workspace.test.tsx`: regression coverage
  for queued-to-terminal convergence, terminal-at-mount stale summaries, and
  stale refresh responses after conversation navigation.

No browser-side `latestRunState` synthesis, broad polling, query/cache
refactor, state-machine change, source-selection or draft reset, retry/cancel
change, Canonical/Review/Approval mutation, ADR, Product Contract Snapshot,
or database migration was introduced. Existing cancellation and scope guards
discard responses from a previous Project or conversation.

## 3. OSS and architecture decision

No new runtime or dependency is relevant to this read-model convergence seam.
The four reviewed references remain `REFERENCE_ONLY`:

- [garrytan/gbrain](https://github.com/garrytan/gbrain) — commit
  `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT; retry/idempotency patterns
  only, no runtime or DB adopted.
- [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki) — commit
  `ad626a3d81be1480e35ef4e94234de8dbb27a61e`, Apache-2.0; no relevant
  converter/evidence component.
- [ddsyasas/llm-wiki](https://github.com/ddsyasas/llm-wiki) — commit
  `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`, MIT; UX reference only.
- Inkeep OpenKnowledge — commit `f2834c237639e2cff603817ed88182b33f83cf91`,
  GPL-3.0-or-later; activity/read-model UI patterns only, runtime/storage
  excluded.

The existing Ask workspace and AnswerRun clients remain behind their current
ports. Replacement is a normal code/PR revert; no data migration or rollback
step is required.

## 4. Focused verification

- Ask workspace UI tests cover terminal `SUCCEEDED` and `FAILED` convergence,
  terminal-at-mount stale summary repair, exactly one refresh for a settled
  terminal poll, selected-turn rendering, and stale response rejection after
  navigation.
- Existing Ask execution, command, retry/cancel/recovery, and Issue #257
  `NO_SUPPORTED_ANSWER` `EXPORT`-only tests remain unchanged and are rerun in
  the focused and CI suites.
- PostgreSQL is not changed; the authoritative server workspace/read contract
  supplies the summary state.

## 5. Scope and exclusions

Included: one bounded server-authoritative workspace refresh at terminal
convergence and focused same-session regressions.

Excluded: client reconstruction of summary state, continuous workspace
polling, broad cache invalidation, new contracts or persistence, unrelated Ask
refactors, and changes to Issues #256/#257/#258/#259.

## 6. Review handoff

- Branch: `codex/issue-255-ask-summary-terminal-convergence`
- Canonical base: `main@065cebc45bd5ec51573b485ed33d55cac9ca64b4`
- Implementation head, PR number, and exact-head CI run are recorded in the
  controller handoff after final validation. Merge is intentionally not
  performed.
