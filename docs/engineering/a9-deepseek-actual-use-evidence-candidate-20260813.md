# A9 DeepSeek Actual-Use Evidence Candidate — Resume #2

## Scope and status

This record canonicalizes the non-secret evidence from the previously completed **A9 DeepSeek Actual-Use Verification — Resume #2**. It does not execute a new Ask, retry, Test Connection, provider approval, credential write, deployment, or production verification.

| Field                                                   | Value                                                                                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Evidence class                                          | `GATE_RECORD`                                                                                                                 |
| Status authority                                        | `A9_ACTUAL_USE_EVIDENCE_CANDIDATE`                                                                                            |
| Source verification                                     | `a9_actual_use_verification_resume2_report.md`                                                                                |
| Local runtime head                                      | `bf00d53a62032f59311d99d665694e6a3331b4cb`                                                                                    |
| Current evidence PR                                     | [#112](https://github.com/JasonCutter/shotgun/pull/112), Draft                                                                |
| Canonical base                                          | `f07527761c563120a0be41090b6860da0f81dd0c`                                                                                    |
| Deterministic-evidence exact head preceding this record | `3b7ec0b6041d2fd83558fe21bb8b5383f86c4b16`                                                                                    |
| Exact-head CI preceding this record                     | [31730599021](https://github.com/JasonCutter/shotgun/actions/runs/31730599021): Quality, Frontend, and Required Gates SUCCESS |

## Actual-use result

| Field                                    | Non-secret durable evidence                                              |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| AnswerRun                                | `run-f8705f47-d1eb-49ad-ac06-bc5efc32fe13`                               |
| Attempt                                  | `attempt-62ea3564-e428-4150-bab6-fc59d72fea6f`                           |
| Attempt kind                             | `INITIAL` / attempt `1`                                                  |
| Run and attempt outcome                  | `SUCCEEDED`                                                              |
| Provider / model                         | `deepseek` / `deepseek-v4-flash`                                         |
| AI configuration / credential revision   | `1` / `1`                                                                |
| Selected context                         | Exactly one public synthetic SourceVersion; SourceVersion-only selection |
| Canonical Evidence selection / citations | `0` / `0`                                                                |
| Provider usage                           | Non-zero durable provider usage recorded                                 |
| Paid actual-use count for Resume #2      | Exactly `1`                                                              |

The actual-use execution persisted the expected lifecycle from `QUEUED` through `RUNNING` to `SUCCEEDED`. The final durable result had no citations, which is the required normal outcome for SourceVersion-only context. The execution used the durable server-owned provider/model/configuration/credential pin; browser input did not become provider, model, or credential authority.

## Security and action boundaries

| Boundary                                                                                                             | Result                    |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Selected external context                                                                                            | Public SourceVersion only |
| Private or restricted selected context                                                                               | None                      |
| Canonical Evidence selected                                                                                          | None                      |
| Citations emitted                                                                                                    | None                      |
| New Ask / Retry / Test Connection while recording this evidence                                                      | NOT EXECUTED              |
| API key, credential plaintext/ciphertext, authorization material, raw provider response, provider request identifier | NOT RECORDED              |
| Existing prior failed run and private Sources                                                                        | Preserved; not mutated    |
| Deployment / Production Verification                                                                                 | NOT STARTED               |

## Canonicalization limits

This is a candidate record of a prior actual-use event, not a new live execution. It does not declare A9 complete and does not authorize Ready for Review or merge. The separately captured one-time Test Connection candidate and the deterministic E2E evidence remain distinct records.
