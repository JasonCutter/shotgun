# VP-09 Product Review Route Boundary — 2026-10-02

## Result

The VP product shell no longer advertises the legacy Review workspace, even when legacy Review work is present. The server route guard also denies direct navigation to `/review` with `FEATURE_UNAVAILABLE`. This closes the Review navigation loophole in VP mode; VP-09 remains open for its privacy, prompt-injection, cross-scope, and external-egress negative tests.

## Implementation and verification

- Both product assembly paths opt into the existing `automaticKnowledgeEnabled` projection policy.
- `InMemoryGlobalShellProjection` suppresses Review navigation in that mode; the command palette inherits the hidden route from the shell.
- `InMemoryRouteGuardProjection` denies direct Review navigation in the same mode. Non-VP projections retain their existing configurable Review behavior.
- The product shell contract and route-guard unit tests passed: 9 tests across 2 files. ESLint, Prettier, and `git diff --check` passed.
- No schema, migration, dependency, or external action behavior changed. Rollback reverts the projection option, assembly wiring, tests, and this report.

## OSS decision

No new OSS package or runtime is relevant to this route policy. The existing `ddsyasas/llm-wiki` decision remains `REFERENCE_ONLY` for Source/Ask/Action UX; its backend and review model are excluded. The policy uses Shotgun's existing Product Read and Route Guard contracts. The [Open-source Role Matrix](../architecture/module-architecture/open-source-role-matrix.md) and [VP architecture ADD](../architecture/module-architecture/shotgun-module-architecture-add.md) remain the ownership references.

## Remaining security acceptance

This change removes a user-facing route; it is not evidence that API-level access, project isolation, sensitivity filtering, prompt-injection handling, citation leakage, or unauthorized provider egress are safe. Those negative tests remain required before VP-09 can close.
