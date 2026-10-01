# TS-6 Current Authority Coordinate Audit — 2026-10-01

## Scope

The VP relation-job adapter changes moved TypeScript source coordinates used by the live TS-6 authority inventory. This audit checks that each inherited coordinate still identifies the same method, classification, and reachability, and records the VP methods now visible to the static transaction scanner. The frozen v2-v7 authority artifacts and their historical counts remain unchanged.

## Inherited coordinate remaps

The following 11 records were matched by owning class and method, then checked against their live classification and reachability. Only source coordinates changed.

| Previous candidate ID                                             | Current candidate ID                                              | Method                                                  | Classification / reachability   |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------- |
| `safe:adapters/frontend-ask-execution-postgres/src/index.ts:1976` | `safe:adapters/frontend-ask-execution-postgres/src/index.ts:2091` | `PostgresAskAnswerExecutionRepository.transaction`      | `PORT_INFERRED / PORT_INFERRED` |
| `safe:adapters/frontend-ask-execution-postgres/src/index.ts:2658` | `safe:adapters/frontend-ask-execution-postgres/src/index.ts:2808` | `PostgresAskAnswerExecutionRepository.poolTransaction`  | `TX_BOUNDARY / PROVEN`          |
| `safe:adapters/postgres/src/index.ts:1106`                        | `safe:adapters/postgres/src/index.ts:1115`                        | `PostgresProjectAdministrationRepository.updateStatus`  | `TX_BOUNDARY / PROVEN`          |
| `safe:adapters/postgres/src/index.ts:1229`                        | `safe:adapters/postgres/src/index.ts:1238`                        | `PostgresProjectBootstrapUnitOfWork.bootstrap`          | `PORT_INFERRED / PORT_INFERRED` |
| `safe:adapters/postgres/src/index.ts:1500`                        | `safe:adapters/postgres/src/index.ts:1509`                        | `PostgresSettingsRepository.updatePrincipalPreferences` | `PORT_INFERRED / PORT_INFERRED` |
| `safe:adapters/postgres/src/index.ts:1813`                        | `safe:adapters/postgres/src/index.ts:1822`                        | `PostgresSettingsRepository.applySettingsCommand`       | `PORT_INFERRED / PORT_INFERRED` |
| `safe:adapters/postgres/src/index.ts:818`                         | `safe:adapters/postgres/src/index.ts:827`                         | `PostgresProjectAdministrationRepository.createProject` | `PORT_INFERRED / PORT_INFERRED` |
| `safe:adapters/postgres/src/index.ts:971`                         | `safe:adapters/postgres/src/index.ts:980`                         | `PostgresProjectAdministrationRepository.updateProject` | `PORT_INFERRED / PORT_INFERRED` |
| `safe:adapters/vp-knowledge-postgres/src/index.ts:43`             | `safe:adapters/vp-knowledge-postgres/src/index.ts:114`            | `PostgresVPKnowledgeLedger.ingestValidatedDirectClaims` | `PORT_INFERRED / PORT_INFERRED` |
| `safe:adapters/vp-knowledge-postgres/src/relation-jobs.ts:167`    | `safe:adapters/vp-knowledge-postgres/src/relation-jobs.ts:256`    | `PostgresVPRelationJobs.claimNext`                      | `PORT_INFERRED / PORT_INFERRED` |
| `safe:adapters/vp-knowledge-postgres/src/relation-jobs.ts:240`    | `safe:adapters/vp-knowledge-postgres/src/relation-jobs.ts:641`    | `PostgresVPRelationJobs.completeDecision`               | `PORT_INFERRED / PORT_INFERRED` |

The eight `covers[]` references in the frozen approved-regression input were remapped to those same audited functions. Test identities, names, coverage kinds, and the source digest of `golden.v7.derived.json` are unchanged.

## Three additional VP method boundaries

The static inventory now recognizes these transaction-owning methods directly:

| Candidate ID                                                   | Method                                      | Classification / reachability   |
| -------------------------------------------------------------- | ------------------------------------------- | ------------------------------- |
| `safe:adapters/vp-knowledge-postgres/src/relation-jobs.ts:387` | `PostgresVPRelationJobs.claim`              | `PORT_INFERRED / PORT_INFERRED` |
| `safe:adapters/vp-knowledge-postgres/src/relation-jobs.ts:506` | `PostgresVPRelationJobs.storeOutput`        | `PORT_INFERRED / PORT_INFERRED` |
| `safe:adapters/vp-knowledge-postgres/src/relation-jobs.ts:591` | `PostgresVPRelationJobs.markOutcomeUnknown` | `PORT_INFERRED / PORT_INFERRED` |

`claim` and `storeOutput` now call `withSafePostgresTransaction` directly inside the owning Port methods; the local `insert` and `update` closures were removed because the scanner could not establish the owner relationship through them. Their SQL operations, transaction options, conservative readback, and error handling are retained. No transaction site was added or removed: the current inventory still reports 11 raw transaction sites.

## Authority and verification

- Live inventory: 129 candidates, 122 transaction boundaries, 11 raw transaction sites, and one participant.
- Current classifications: `TX_BOUNDARY 16`, `PORT_INFERRED 89`, `NON_TX 7`, `TEST_ONLY_OR_DEAD 17`, `TX_PARTICIPANT 0`, `TX_DELEGATE 0`, `REVIEW_REQUIRED 0`.
- Legacy scoring over the same current inventory: `TX_BOUNDARY 109`, `NON_TX 7`, `TEST_ONLY_OR_DEAD 13`, with no unresolved review records.
- Frozen `golden.v7.derived.json` SHA-256 remains `3d973d0ec484ca6907be1ed4020ea8ad3b0501714c8ad0fe2b1057a3ce959337`.
- Reproduction commands: `npm run ts6:v8:check`, `npm run verify:ts6-c2`, and `npm run test:ts6-audit`.

The live test expectations track the scanner output; historical v2-v7 fixture totals remain assertions against their own frozen records.

## 2026-10-02 URL freshness projection addendum

The Ask URL-freshness projection added code before existing transaction candidate locations in three PostgreSQL adapters. This moved ten AST candidate coordinates. The audit matched each live candidate by `functionKey`, `sourceNeedle`, owning class/method, candidate kind, classification, and production-reachability grade. All ten mapped to the same transaction-owning methods recorded in the 2026-10-01 audit; only source coordinates changed.

| Previous candidate ID | Current candidate ID | Method | Classification / reachability |
| --- | --- | --- | --- |
| `safe:adapters/frontend-ask-execution-postgres/src/index.ts:2091` | `safe:adapters/frontend-ask-execution-postgres/src/index.ts:2161` | `PostgresAskAnswerExecutionRepository.transaction` | `PORT_INFERRED / PORT_INFERRED` |
| `safe:adapters/frontend-ask-execution-postgres/src/index.ts:2808` | `safe:adapters/frontend-ask-execution-postgres/src/index.ts:2883` | `PostgresAskAnswerExecutionRepository.poolTransaction` | `TX_BOUNDARY / PROVEN` |
| `safe:adapters/frontend-ask-write-postgres/src/index.ts:173` | `safe:adapters/frontend-ask-write-postgres/src/index.ts:177` | `PostgresAskConversationRepository.transaction` | `PORT_INFERRED / PORT_INFERRED` |
| `safe:adapters/frontend-ask-write-postgres/src/index.ts:645` | `safe:adapters/frontend-ask-write-postgres/src/index.ts:649` | `PostgresAskWorkspaceProjection.loadConversation` | `TX_BOUNDARY / PROVEN` |
| `safe:adapters/postgres/src/index.ts:1115` | `safe:adapters/postgres/src/index.ts:1132` | `PostgresProjectAdministrationRepository.updateStatus` | `TX_BOUNDARY / PROVEN` |
| `safe:adapters/postgres/src/index.ts:1238` | `safe:adapters/postgres/src/index.ts:1255` | `PostgresProjectBootstrapUnitOfWork.bootstrap` | `PORT_INFERRED / PORT_INFERRED` |
| `safe:adapters/postgres/src/index.ts:1509` | `safe:adapters/postgres/src/index.ts:1526` | `PostgresSettingsRepository.updatePrincipalPreferences` | `PORT_INFERRED / PORT_INFERRED` |
| `safe:adapters/postgres/src/index.ts:1822` | `safe:adapters/postgres/src/index.ts:1839` | `PostgresSettingsRepository.applySettingsCommand` | `PORT_INFERRED / PORT_INFERRED` |
| `safe:adapters/postgres/src/index.ts:827` | `safe:adapters/postgres/src/index.ts:844` | `PostgresProjectAdministrationRepository.createProject` | `PORT_INFERRED / PORT_INFERRED` |
| `safe:adapters/postgres/src/index.ts:980` | `safe:adapters/postgres/src/index.ts:997` | `PostgresProjectAdministrationRepository.updateProject` | `PORT_INFERRED / PORT_INFERRED` |

Ten approved `covers[]` references to these boundaries were updated in `approved-regression-relations.v8.json`. Test IDs, names, coverage kinds, and the frozen v7 source SHA-256 are unchanged.

Current totals remain 129 candidates, 122 transaction boundaries, and 11 raw transaction sites; classifications remain `TX_BOUNDARY 16`, `PORT_INFERRED 89`, `NON_TX 7`, and `TEST_ONLY_OR_DEAD 17`, with no participants, delegates, or review-required records. The v2-v7 historical artifacts are unchanged. After updating the reviewed manifest and approved coordinate references, `npm run ts6:v8:rebuild`, `npm run ts6:v8:check`, `npm run verify:ts6-c2`, and `npm run test:ts6-audit` reproduce and verify the current v8 lineage.
