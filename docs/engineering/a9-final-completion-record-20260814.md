# A9 Final Completion Record — Runtime-selectable AI Settings

> **Record ID:** `A9-FINAL-COMPLETION-RECORD-20260814`
> **Class:** `COMPLETION_RECORD`
> **Subject canonical main:** `f6f8cddba4a7c6db465228ec5429569a23bf1429`
> **Status authority:** `Runtime-selectable AI Settings — COMPLETE / FINAL_AFTER_MERGE / ACTUAL_USE_VERIFIED`

This completion record remains a Candidate while PR #114 is unmerged and becomes Canonical only when PR #114 is merged to `main`. The subject canonical main remains the verified Program subject commit above; the later completion-record merge commit does not replace that subject identity.

## Completion decision

A9 now closes the finite A1–A9 Runtime-selectable AI Settings Program. The original closure audit identified deterministic cross-boundary evidence gaps and an unrecoverable historical Test Connection record. PR #112 supplied the missing deterministic E2E evidence without Product behavior, schema, or migration changes; its merge commit is the subject canonical main. The independently recorded bounded DeepSeek Test Connection and prior DeepSeek actual-use records complete the authorized live evidence. [1] [2] [3] [4]

| Final subject                                                     | Value                                                                                                                            |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Evidence PR                                                       | [#112](https://github.com/JasonCutter/shotgun/pull/112) — `test(a9): final closure evidence-gap verification — E2E-A–F, E2E-I–N` |
| Merge method / commit                                             | Merge commit / `f6f8cddba4a7c6db465228ec5429569a23bf1429`                                                                        |
| Canonical main after merge                                        | `f6f8cddba4a7c6db465228ec5429569a23bf1429`                                                                                       |
| PR #112 exact-head CI                                             | [31731659903](https://github.com/JasonCutter/shotgun/actions/runs/31731659903) — SUCCESS                                         |
| Post-merge main CI                                                | [31733659469](https://github.com/JasonCutter/shotgun/actions/runs/31733659469) — SUCCESS                                         |
| Required gates                                                    | Quality, Frontend, and Required Gates — all SUCCESS                                                                              |
| Product, API, UI, schema, migration change in closure evidence PR | None                                                                                                                             |
| Deployment                                                        | `NOT_STARTED`                                                                                                                    |
| Production Verification                                           | `NOT_STARTED`                                                                                                                    |

The completion decision is confined to the frozen Program contract. It does not imply deployment, production verification, private/restricted external egress, provider failover, new model support, cost optimization, or any other future capability. [5] [6]

## Evidence set and provenance

| Evidence ID                                               | Final state                           | Purpose                                                                                                                                                                                                                                        |
| --------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `A9-DEEPSEEK-TEST-CONNECTION-EVIDENCE-CANDIDATE-20260814` | PASS / canonical non-secret candidate | One user-authorized bounded DeepSeek Test Connection returned Connected. It did not Save, retry, perform a paid Ask, approve a provider, deploy, or perform production verification.                                                           |
| `A9-DEEPSEEK-ACTUAL-USE-EVIDENCE-CANDIDATE-20260813`      | PASS / canonical non-secret candidate | Resume #2 recorded one public SourceVersion-only DeepSeek Ask: AnswerRun `run-f8705f47-d1eb-49ad-ac06-bc5efc32fe13`, initial attempt `attempt-62ea3564-e428-4150-bab6-fc59d72fea6f`, `SUCCEEDED`, zero citations, and non-zero provider usage. |
| PR #112 deterministic database evidence                   | PASS                                  | `tests/database/a9-final-closure-evidence.test.ts` proves E2E-A–F, E2E-J, E2E-K, and E2E-N against the guarded PostgreSQL test boundary.                                                                                                       |
| PR #112 deterministic integration evidence                | PASS                                  | `tests/integration/a9-final-closure-safety.test.ts` proves E2E-I, E2E-L, and E2E-M; E2E-I spans actual credential write, vault encryption/persistence, vault-routed transport, projections, and captured log negative scans.                   |
| Existing canonical evidence                               | PASS / reused                         | E2E-G and E2E-H remain reused, not duplicated, because they were already proven on the relevant canonical path.                                                                                                                                |
| A9 Blocking Repair #5                                     | PASS / merged                         | PR #113 corrected pin-first worker claims before PR #112 was rebased; its merge commit `f07527761c563120a0be41090b6860da0f81dd0c` and post-merge CI establish the recovered-run behavior consumed by E2E-N.                                    |

All live evidence used public/synthetic context only. Neither record contains an API key, credential plaintext or ciphertext, authorization material, raw provider response, provider request identifier, private/restricted source content, or a new paid action beyond the previously authorized Resume #2 Ask. [2] [3]

## A9 acceptance matrix

| Criterion | Final result | Final evidence and disposition                                                                                                                                                 |
| --------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A9-AC01   | PASS         | E2E-A through E2E-N are complete: A–F, J, K, N by PostgreSQL cross-boundary evidence; G–H by reused canonical evidence; I, L, M by Product integration evidence.               |
| A9-AC02   | PASS         | One bounded DeepSeek Test Connection succeeded, and the separate public/synthetic DeepSeek actual-use AnswerRun succeeded.                                                     |
| A9-AC03   | PASS         | E2E-B/E2E-C exercise all registered DeepSeek, OpenAI, and Gemini routes through the saved Settings control plane; adapters are operational, not placeholders.                  |
| A9-AC04   | PASS         | E2E-G/E2E-H prove restricted hard deny and provider-specific private eligibility without mandatory private live egress; actual use selected public SourceVersion-only context. |
| A9-AC05   | PASS         | E2E-I proves no plaintext, encrypted envelope, or authorization material disclosure outside the vault boundary across required Product and test-observed surfaces.             |
| A9-AC06   | PASS         | E2E-D/E2E-E/E2E-F prove revision pin preservation, exact-revocation fail-closed behavior, and current-policy revalidation without identity substitution.                       |
| A9-AC07   | PASS         | E2E-K proves the one-way legacy Gemini compatibility to PROJECT_MANAGED transition and no fallback resurrection.                                                               |
| A9-AC08   | PASS         | E2E-L proves the non-AI Product survives unavailable/no-capability AI state and exposes safe AI-unavailable behavior.                                                          |
| A9-AC09   | PASS         | E2E-M covers the frozen provider/Ask taxonomy, including `TIMEOUT`.                                                                                                            |
| A9-AC10   | PASS         | PR #112 exact head `d060d00e1993727a51c088f95ec45b0812bea8b2` passed Quality, Frontend, and Required Gates in CI 31731659903.                                                  |
| A9-AC11   | PASS         | PR #112 merged as `f6f8cdd…`; automatic canonical-main CI 31733659469 passed all required gates.                                                                               |
| A9-AC12   | PASS         | Final security and architecture evidence contains no unresolved Critical/High gap; secret, authority, egress, retry, and compatibility negative paths are covered.             |
| A9-AC13   | PASS         | This record is created only after A9-AC01 through A9-AC12, PR #112 merge, and its automatic post-merge main CI passed.                                                         |

## Whole-Program acceptance matrix

| Criterion | Final result | Final evidence and disposition                                                                                                                                      |
| --------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-AC01    | PASS         | A1–A9 section criteria are closed by the merged implementations, A9 matrices above, and final post-merge CI.                                                        |
| P-AC02    | PASS         | Server-owned provider registry restricts choices to registered providers.                                                                                           |
| P-AC03    | PASS         | Fresh Project DeepSeek default is proven by E2E-A and existing Settings Product evidence.                                                                           |
| P-AC04    | PASS         | E2E-A and supporting configuration/vault evidence prove no credential or managed configuration is fabricated before authorized save.                                |
| P-AC05    | PASS         | E2E-B/E2E-C and runtime routing prove DeepSeek, OpenAI, and Gemini configuration and execution paths.                                                               |
| P-AC06    | PASS         | E2E-I plus vault/backend evidence prove secret-safe create, replacement, removal, and non-disclosure boundaries.                                                    |
| P-AC07    | PASS         | Operational provider Test Connection exists; the authorized bounded DeepSeek Test Connection succeeded with public/synthetic-only operational intent.               |
| P-AC08    | PASS         | E2E-G/E2E-H and A4 authority evidence prove provider-specific privacy and deployment enforcement.                                                                   |
| P-AC09    | PASS         | E2E-D/E2E-E/E2E-F and E2E-N prove immutable identity, exact credential behavior, retry, and recovery semantics.                                                     |
| P-AC10    | PASS         | E2E-B/E2E-C prove saved provider/model/credential changes affect the next new Ask without restart.                                                                  |
| P-AC11    | PASS         | E2E-B/E2E-C/E2E-D/E2E-N prove current Settings do not mutate in-flight or durable execution pins.                                                                   |
| P-AC12    | PASS         | E2E-K proves legacy Gemini compatibility cannot revive after PROJECT_MANAGED transition.                                                                            |
| P-AC13    | PASS         | E2E-M proves the required definitive and indeterminate provider error taxonomy, including correct timeout mapping.                                                  |
| P-AC14    | PASS         | E2E-I verifies browser/Product reload and projection surfaces do not redisplay secret material.                                                                     |
| P-AC15    | PASS         | The mandatory E2E-A through E2E-N matrix is complete under exact-head CI.                                                                                           |
| P-AC16    | PASS         | The DeepSeek Resume #2 public/synthetic actual-use record is durable, succeeded, citation-free for SourceVersion-only context, and records non-zero provider usage. |
| P-AC17    | PASS         | PR #112 exact-head CI 31731659903 passed Quality, Frontend, and Required Gates.                                                                                     |
| P-AC18    | PASS         | PR #112 merge commit `f6f8cdd…` is canonical main and automatic post-merge CI 31733659469 passed.                                                                   |

## Final status and preserved boundaries

> **Runtime-selectable AI Settings**
> **`COMPLETE / FINAL_AFTER_MERGE / ACTUAL_USE_VERIFIED`**

| State                                                                        | Final value                                                           |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| A9 Program completion                                                        | `COMPLETE / FINAL_AFTER_MERGE / ACTUAL_USE_VERIFIED`                  |
| Deployment                                                                   | `NOT_STARTED`                                                         |
| Production Verification                                                      | `NOT_STARTED`                                                         |
| Additional paid Ask, Retry, or Test Connection during this completion record | `NOT_EXECUTED`                                                        |
| Product / test / migration change in this completion-record PR               | `NONE`                                                                |
| Completion-record PR disposition                                             | Draft only; Ready for Review and merge require separate authorization |

The `Completion-record PR disposition` row and the `ready` and `merge` values stored for this record in `docs/engineering/evidence-registry.json` describe PR #114 only at completion-record creation time. They are retained as historical creation-state metadata and must not be interpreted as the current PR lifecycle after a later Ready-for-Review or merge transition. The record itself becomes Canonical only after PR #114 merges to `main`.

## References

[1]: a9-final-closure-audit-blocked-20260813.md 'A9 Final Closure Audit — Evidence-Gap Finding'
[2]: a9-deepseek-test-connection-evidence-candidate-20260814.md 'DeepSeek Test Connection evidence candidate'
[3]: a9-deepseek-actual-use-evidence-candidate-20260813.md 'DeepSeek Actual-Use Resume #2 evidence candidate'
[4]: https://github.com/JasonCutter/shotgun/pull/112 'PR #112 — final closure evidence-gap verification'
[5]: ../architecture/ai-settings/a9-end-to-end-actual-use-completion-detailed-design.md 'A9 Detailed Design — End-to-End Actual-use Completion Closure'
[6]: ../architecture/ai-settings/runtime-selectable-ai-settings-master-completion-contract.md 'Runtime-selectable AI Settings — Master Completion Contract'
