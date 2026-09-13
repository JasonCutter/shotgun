# Issue #256 — Ask Export Markdown overflow

Status: `VALIDATING` (controller-directed implementation; exact-head CI is
required before controller completion)

## 1. Source audit and authority

The audit started from the controller's canonical base
`main@d07e5fe1fa12c905fca920f83666ad7da6a6896d`. Ask export content is returned
by the existing AnswerRun-bound export client and is presented by
`ConversationPane`. The pane emitted a bare `<pre>` for `exportedContent`,
while the existing `.ask-export-surface` presentation contract already
provided bounded height, wrapping, and overflow-safe styling.

The defect is therefore a presentation wiring gap, not an export-content or
authority problem. The raw Markdown string remains unchanged and the existing
AnswerRun export path remains authoritative.

## 2. Implementation and safety boundary

- `apps/shotgun-web/src/routes/ask-shell-presentation.tsx`: wraps the existing
  exported Markdown `<pre>` in the existing `ask-export-surface` section and
  labels it with the localized `ask.answer_export` message.
- `apps/shotgun-web/src/routes/ask-workspace.test.tsx`: exercises ordinary
  prose plus a long unbroken token and asserts that the exact returned Markdown
  is preserved inside the export surface.

No export API, AnswerRun identity, persistence, backend, Source, Evidence,
Canonical, Review, Approval, policy, or capability behavior changed. No
content normalization, truncation, or wrapping characters are added to the
returned Markdown. The existing CSS contract remains responsible for
`white-space: pre-wrap`, `overflow-wrap: anywhere`, bounded height, and the
inner scroll boundary.

## 3. OSS and architecture decision

The four reviewed references remain `REFERENCE_ONLY`; no new runtime or
dependency is relevant to this local presentation wiring seam:

- [garrytan/gbrain](https://github.com/garrytan/gbrain) — commit
  `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT; execution/runtime patterns
  are unrelated and no runtime or DB is adopted.
- [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki) — commit
  `ad626a3d81be1480e35ef4e94234de8dbb27a61e`, Apache-2.0; transformation and
  Evidence components are unrelated to Ask export presentation.
- [ddsyasas/llm-wiki](https://github.com/ddsyasas/llm-wiki) — commit
  `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`, MIT; Ask/Chat output UX is a
  reference only, with its backend and storage excluded.
- Inkeep OpenKnowledge — commit
  `f2834c237639e2cff603817ed88182b33f83cf91`, GPL-3.0-or-later; visual/source
  presentation patterns are reference only, with the runtime and Markdown
  authority excluded.

Direct implementation is justified because the relevant change is one
existing Shotgun presentation class being connected to the existing export
preview; adopting or extracting an external runtime would add coupling without
providing a replaceable Port or a matching contract.

## 4. Verification plan

- Focused Ask workspace regression, including long-token content preservation.
- Frontend full test suite, typecheck, lint/format and architecture/document
  validation.
- Exact-head CI with Quality, Frontend, and Required Gates all `SUCCESS`.

## 5. Migration, rollback and exclusions

No migration or runtime dependency is introduced. Rollback is a normal code
revert of the wrapper, regression, and this implementation record; existing
export data and AnswerRun history remain intact.

Excluded: export API changes, Markdown rewriting or truncation, download
behavior, feedback, persistence, provider/model changes, Source/Evidence or
Canonical mutations, ADR changes, Contract Snapshot changes, and Issue #256
scope expansion.

## 6. Review handoff

- Branch: `codex/issue-256-export-markdown-overflow`
- Canonical base: `main@d07e5fe1fa12c905fca920f83666ad7da6a6896d`
- Implementation head, PR number, and exact-head CI run are recorded after
  final validation. Merge is intentionally not performed.
