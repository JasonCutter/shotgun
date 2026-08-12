# A4 Provider-specific Privacy & Deployment Authority Implementation

Date: 2026-08-12
Branch: `codex/a4-provider-privacy-deployment-authority`
Base: `03df231511ca0e4e960b97c9b6083ae3e4fc5003`

## Scope

Implemented the A4 frozen boundary from ADR-133 §9–§10 and the A4 section of
the runtime-selectable AI settings completion contract:

- Project/provider-scoped `ProviderExternalTransferApproval` authority.
- Separate Project Owner proposal and approval operations.
- Immutable provider/project approval history with a revisioned current pointer.
- Provider-aware, default-deny `AI_PRIVATE_EGRESS_ALLOWED_PROVIDERS` parsing.
- `GEMINI_ALLOW_PRIVATE` compatibility only for Gemini when the provider
  allowlist is not configured.
- Historical `privacy.externalTransferAllowed=true` compatibility only for
  Gemini when no Gemini-specific authority exists.
- Restricted hard deny and private dual-gate evaluation.
- Existing Ask source-selection authorization and masking path unchanged; the
  provider policy resolver receives only server-authorized sensitivities.

Explicitly excluded: Settings → AI UI, credential Product UI/API, Test
Connection, real provider adapters, EffectiveAIConfigurationResolver, Provider
Router, runtime provider switching, and real private egress.

## Integration and ownership

The existing Settings review proposal and audit tables are reused for the
high-risk review workflow. A4 owns only:

- `settings.provider_external_transfer_approval_revisions`
- `settings.provider_external_transfer_approvals`

The A4 module does not import another domain module or database infrastructure.
The PostgreSQL adapter is behind the A4 repository port. A3 provider registry
validation remains server-owned and arbitrary provider IDs cannot create an
approval or raise the deployment ceiling.

## OSS Integration Gate

Reviewed the repository OSS source registry, OSS Integration Roadmap, OSS
Evaluation Plan, module architecture, and Definition of Done.

| Candidate                                                | Decision                                                     | Boundary and reason                                                                                                                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PostgreSQL 16.14 pinned image                            | `ADOPT` (existing)                                           | Used for additive persistence, transactions, row locks, constraints, and immutable triggers through the existing PostgreSQL adapter boundary.                                                    |
| gbrain, llmwiki, ddsyasas/llm-wiki, Inkeep OpenKnowledge | `REFERENCE_ONLY` / `NO_RELEVANT_OSS` for A4 policy authority | Their reviewed boundaries do not provide the Shotgun Project/provider approval, historical compatibility, deployment ceiling, or Ask authorization semantics. No runtime or schema was imported. |
| Generic policy/approval package                          | `NO_RELEVANT_OSS`                                            | Introducing a second authority would risk duplicating the existing Settings review/audit boundary and could not own Shotgun-specific provider/project invariants.                                |

No new external dependency or lockfile entry was added. No OSS adapter
replacement test is applicable; the A4 security/approval tests cover the
Shotgun-owned port and persistence boundary.

## Migration and rollback

Migration `038_a4_provider_external_transfer_authority.sql` is additive. It
does not rewrite or delete Settings history, generic privacy values, or A2/A3
records. Approval revisions are append-only and immutable; the current pointer
is revision-monotonic and cannot be deleted. Existing database reset/backup
procedures remain the rollback boundary; no destructive migration was run.

## Verification

- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npm run format:check`: PASS
- `npm run test:architecture`: PASS
- A4 unit tests: PASS (6)
- Existing Ask provider policy unit tests: PASS (14)
- Full `npm run check`: BLOCKED by 11 unrelated pre-existing unit failures in
  Knowledge graph failure/retry and Knowledge/Settings draft controller tests;
  docs validation, lint, format, typecheck, and all A4/Ask tests passed before
  the unrelated failures. No A4 test failed.
- PostgreSQL A4 test: NOT RUN locally because `TEST_DATABASE_URL` and
  `.env.test` are absent in the Codex environment. `DATABASE_URL` was not used
  as a substitute. CI must provide the test database authority.

### A4 acceptance criteria

| Criterion | Result                    | Evidence                                                                                                      |
| --------- | ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| A4-AC01   | PASS                      | A4 module authority types/service and additive persistence                                                    |
| A4-AC02   | PASS locally / DB pending | Project/provider composite keys, immutable history trigger, revision CAS; PostgreSQL test pending CI database |
| A4-AC03   | PASS locally / DB pending | Owner-gated `propose` then `approve`; review proposal and audit reuse                                         |
| A4-AC04   | PASS                      | Provider allowlist parser, default deny, Gemini compatibility fallback                                        |
| A4-AC05   | PASS                      | Unknown IDs ignored by deployment ceiling and rejected by registry/service/DB checks                          |
| A4-AC06   | PASS                      | Legacy Gemini flag and generic approval are never used for OpenAI or DeepSeek                                 |
| A4-AC07   | PASS                      | Gemini-specific false authority overrides generic legacy approval; no record permits compatibility fallback   |
| A4-AC08   | PASS                      | Restricted sensitivity returns hard deny before approval evaluation                                           |
| A4-AC09   | PASS                      | Private evaluation requires deployment allow plus matching provider/project approval                          |
| A4-AC10   | PASS                      | Existing Ask source/evidence authority reader and preflight/submit boundary unchanged                         |
| A4-AC11   | PASS                      | No real private egress or provider adapter was added                                                          |
| A4-AC12   | PASS                      | A5–A9 runtime/UI/Test Connection work remains excluded                                                        |

## Existing DeepSeek worktree

The pre-existing root worktree `C:\dev\shotgun` on
`codex/deepseek-v4-flash-provider-switch` was inspected read-only. Its existing
changes were preserved and not reused, reset, stashed, deleted, or modified.
The A4 implementation is isolated in its own worktree and branch.

## Next gate

After the missing TEST_DATABASE_URL-backed database test is supplied by the
normal CI environment, commit and push this branch, create a Draft PR, and
inspect only its automatic exact-head CI. Ready for Review and Merge remain
separate approvals and are not part of this implementation request.
