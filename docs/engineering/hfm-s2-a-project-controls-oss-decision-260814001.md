# HFM-S2-A Project Controls — OSS Integration Decision

## Scope

This record covers the Project-focused slash-command presentation and test
patterns in HFM-S2-A. Shotgun remains the owner of Project identity, lifecycle,
authorization, revisions, request identity, idempotency, outcome recovery, and
Project binding.

## Decisions

| Candidate            | Official source                          | Pinned baseline                            | License                    | Decision         | Included                                                                             | Excluded                                                                                    |
| -------------------- | ---------------------------------------- | ------------------------------------------ | -------------------------- | ---------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| ddsyasas/llm-wiki    | https://github.com/ddsyasas/llm-wiki     | `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` | MIT, verified              | `REFERENCE_ONLY` | action-centered entry, focused form, busy/error and result feedback patterns         | backend, SQLite, ingest/query runtime, LLM client and Project authority                     |
| Inkeep OpenKnowledge | https://github.com/inkeep/open-knowledge | `f2834c237639e2cff603817ed88182b33f83cf91` | GPL-3.0-or-later, verified | `REFERENCE_ONLY` | human-cockpit grouping, bounded focused review and accessible list fallback patterns | GPL source, runtime, filesystem storage, Markdown/Yjs, search, Git/MCP and Canonical writes |

The existing source registry records ddsyasas as MIT with a pinned validation
baseline and the backend excluded for SSRF and arbitrary-path risks. It records
OpenKnowledge as GPL with pattern-only use and a license re-review required
before any code reuse. No dependency, upstream code, database schema, or
external adapter is added by this slice.

## Shotgun boundaries and replacement

- The shared HFM owner-command registry is the presentation/discovery port.
- `ProjectCommandSurface` is a replaceable focused UI adapter; it consumes the
  existing typed `ShotgunApiClient` methods only.
- Product authority remains `switchActiveProject`, `createProject`,
  `updateProject`, `archiveProject`, `restoreProject`, and
  `requestDeleteProject`.
- Contract tests cover registry discovery, lifecycle availability, mutation
  bindings, and destructive confirmation. A future focused UI replacement must
  pass the same semantic tests without changing Product APIs.
- Rollback is a branch/PR rollback: remove the focused surface and registry
  entries while retaining the existing Settings Project workspace and backend
  contracts. No migration is required.

## Verification status

This is a `REFERENCE_ONLY` decision. No OSS Contract Test or lockfile change is
required because no external runtime is adopted. The focused tests and local
validation for HFM-S2-A are reported in the implementation PR.
