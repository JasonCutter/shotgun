# Issue #273 — Global Composer provider-eligibility convergence

Status: `VALIDATING` (controller-directed implementation; exact-head CI is
required before controller completion)

## 1. Source audit and authority

The current-main audit started at `main@0f86373e3e8d5db3ddb236ed515b14676b2df3c0`.
`AIWorkspace`, `PrivacyCommandSurface`, `SemanticCommandSurface` and the
owner command surfaces already call the shared `convergeOwnerState` boundary
after successful owner mutations. Before this change,
`ownerStateQueryKeys(projectId)` covered Settings, privacy, the protected
global shell and Project reads, but not Ask provider eligibility.

`AskShellProvider` owns the mounted eligibility read under this full key:

```ts
['ask', 'provider-eligibility', workspace?.projectId, activeConversationId, mode, sourceSelections];
```

The query function still calls the server-authoritative
`getProviderEligibility(...)`. The browser does not synthesize eligibility or
change server policy, privacy, access, provider/model/credential, or standing
policy checks. The defect is that an owner mutation can change the policy while
the mounted query key remains unchanged and its cached result remains stale.

## 2. Final design

The existing convergence boundary now also invalidates:

```ts
['ask', 'provider-eligibility', projectId];
```

React Query treats this as a prefix, so all conversation/mode/source-selection
variants for the target Project refetch while their complete identities remain
unchanged. A different Project's eligibility prefix does not match. No retry,
server-policy, Product authority, Contract Snapshot, ADR or database behavior
was changed.

## 3. OSS and architecture decision

No new runtime or dependency was introduced. Existing reviewed references remain
bounded as follows:

| Candidate                                                         | Version / license                                             | Decision           | Boundary                                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------- |
| [TanStack Query](https://github.com/TanStack/query)               | `5.101.4` / MIT                                               | `ADOPT` (existing) | Browser server-state cache and prefix invalidation only; replacement remains behind the query boundary. |
| [garrytan/gbrain](https://github.com/garrytan/gbrain)             | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` / MIT              | `REFERENCE_ONLY`   | No runtime, provider authority or DB adopted.                                                           |
| [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki) | `ad626a3d81be1480e35ef4e94234de8dbb27a61e` / Apache-2.0       | `REFERENCE_ONLY`   | No conversion/evidence runtime is relevant to this cache correction.                                    |
| [ddsyasas/llm-wiki](https://github.com/ddsyasas/llm-wiki)         | `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` / MIT              | `REFERENCE_ONLY`   | UX patterns only; backend/runtime excluded.                                                             |
| [Inkeep OpenKnowledge](https://github.com/inkeep/open-knowledge)  | `f2834c237639e2cff603817ed88182b33f83cf91` / GPL-3.0-or-later | `REFERENCE_ONLY`   | Activity/cockpit patterns only; GPL runtime/storage excluded.                                           |

The implementation remains inside the existing frontend query-key Port. No
migration or rollback data step is required; rollback is a normal code/PR
revert.

## 4. Verification evidence

- `apps/shotgun-web/src/app/query-keys.test.ts`: project-prefix inclusion,
  mounted Project 1 refetch, Project 2 isolation, full query-key preservation,
  and standing-policy enable → eligible → disable →
  `STANDING_POLICY_DISABLED` transitions without reload.
- `apps/shotgun-web/src/routes/ask-workspace.test.tsx`: mounted Global Composer
  observes the same enable/disable transitions through `convergeOwnerState`.
- `apps/shotgun-web/src/routes/settings/ai-workspace.test.tsx`: standing-policy
  mutation asserts Ask eligibility prefix invalidation.
- `apps/shotgun-web/src/routes/settings/privacy-workspace.test.tsx`: provider
  privacy approval and Project privacy APPLIED mutations assert the same
  project-scoped prefix.
- `apps/shotgun-web/src/commands/privacy-command-surface.test.tsx`: provider
  privacy approval mutation asserts the same prefix invalidation.

Focused frontend tests pass (63 tests across five suites). Web typecheck,
changed-file ESLint and Prettier checks, documentation validation, Frontend
Work Item governance, completion invariants and projection checks pass. The
single exact-head CI result will be reported with final branch, head, PR and
run identifiers before controller review is requested.

## 5. Scope and exclusions

Included: one project-scoped Ask eligibility prefix in the existing convergence
boundary and focused tests for server refetch and cross-Project isolation.

Excluded: client-synthesized eligibility, broad cross-Project invalidation,
query-key refactors, retry changes, server/provider-policy changes, ADR or
Product Contract Snapshot amendments, database migrations, unrelated cleanup,
and automatic canonical/action behavior.
