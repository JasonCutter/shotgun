# RUS-2-C7 — Canonical-Driven Semantic Projection Convergence

- 검증일: 2026-09-16
- 기준: `main@7c3f02d67467fe1f4eb9343cc2503bcdb0d3aae6`
- 대상: Semantic Projection Convergence, CanonicalCommitted handoff, bounded recovery
- ADR: [`ADR-168`](../../architecture/adr/ADR-168-canonical-driven-semantic-projection-convergence.md)
- 상태: 보정 구현 완료, 로컬 정적·집중 게이트 통과 (실 PostgreSQL/CI 증적 대기)

이번 보정은 PR #327 리뷰의 `CHANGES_REQUIRED` 항목을 반영한다. Semantic
generation의 exact-current 판정은 source watermark/profile identity만 보지 않고
기존 `SemanticEmbeddingResolverPort`를 통해 전체 실행 호환성 identity를 확인한다.
Periodic recovery도 startup과 동일한 bounded recorder를 사용해 성공·실패 결과를
health/recovery registry에 남기며, background exception을 격리한다. Canonical,
Approval, outbox, refresh authority, generation CAS, Ask 및 lexical fallback의
경계는 변경하지 않았다.

## 범위

포함 범위는 다음과 같다.

- 현재 `SemanticCorpusSourceWatermark`와 활성 READY generation의 exact-current 판정
- 기존 `SemanticProjectionRefreshPort`를 통한 stale/absent generation refresh
- `CanonicalCommitted@1.0.0`의 독립 best-effort 소비자 및 Connector Runtime dead-letter/replay 경계
- 이미 발행된 Canonical 이벤트 공백을 복구하는 bounded startup/periodic reconciliation
- 중복 이벤트·recovery race에서 기존 generation activation CAS와 project별 in-process serialization 재사용
- provider/policy/configuration failure의 안전 코드와 `RECOVERY_PENDING`/`DEGRADED` 관찰

제외 범위는 Canonical/Approval/Claim/Evidence 변경, 새 outbox·테이블·scheduler authority,
semantic refresh service 중복 구현, lexical retrieval redesign, Ask-triggered refresh,
provider fallback, live RUS-2 B 후보 재비교·재승인이다.

## OSS Integration Decision

정확한 `CanonicalCommitted → SemanticProjectionRefreshPort` 수렴 권위를 제공하는
검증된 외부 OSS 후보는 없으므로 `NO_RELEVANT_OSS`다. 기존 Shotgun Connector Runtime,
Canonical transactional outbox, corpus watermark, SemanticGenerationBuilder/CAS,
Recovery Registry를 Port 경계 그대로 사용한다. Open-source Role Matrix의 기존 역할은
변경하지 않았다.

| 후보                  | 공식 URL                                 | 검토 pin / License                                                                                            | 결정             | C7 범위와 제외                                                                       |
| --------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------ |
| garrytan/gbrain       | https://github.com/garrytan/gbrain       | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` / MIT                                                              | `REFERENCE_ONLY` | retry/idempotency/PostgreSQL lock/recovery 패턴만 참고; 전체 runtime·DB 제외         |
| lucasastorian/llmwiki | https://github.com/lucasastorian/llmwiki | `ad626a3d81be1480e35ef4e94234de8dbb27a61e` / Apache-2.0                                                       | `REFERENCE_ONLY` | reconcile/validation 패턴만 참고; SQLite·FTS·VaultFS·MCP runtime 제외                |
| ddsyasas/llm-wiki     | https://github.com/ddsyasas/llm-wiki     | `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` / MIT                                                              | `REFERENCE_ONLY` | 상태·복구 UX만 참고; backend·storage 제외                                            |
| Inkeep OpenKnowledge  | https://github.com/inkeep/open-knowledge | `f2834c237639e2cff603817ed88182b33f83cf91` / GPL-3.0-or-later                                                 | `REFERENCE_ONLY` | review/activity 시각 패턴만 참고; runtime·DB·Git/MCP/Yjs 제외 (`Yjs=DEFER`)          |
| pgvector              | https://github.com/pgvector/pgvector     | `pgvector/pgvector:pg16@sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b` / PostgreSQL | `DEFER`          | 기존 SemanticIndexRepositoryPort adapter 후보; C7에서 dependency·migration 변경 없음 |

직접 구현한 조정 계층은 위 후보가 제공하지 않는 Canonical authority, Shotgun module
handoff, existing Port, approval/evidence 경계에 한정된다. 교체 시
`SemanticProjectionRefreshPort`, `SemanticActiveGenerationReaderPort`,
`SemanticCorpusSourceSnapshotReaderPort`, generation CAS 및 아래 acceptance contract를
그대로 통과해야 한다.

## Contract / Golden / Security / Replacement

| 항목                                                                  | 결과                                                            |
| --------------------------------------------------------------------- | --------------------------------------------------------------- |
| exact-current generation은 refresh하지 않음                           | PASS — focused unit                                             |
| stale generation은 기존 refresh Port만 호출                           | PASS — focused unit                                             |
| profile 미설정은 `NOT_CONFIGURED/NO_OP`                               | PASS — focused unit                                             |
| non-required consumer가 publisher acknowledgement를 요구하지 않음     | PASS — focused unit/manifest                                    |
| Canonical outbox·다른 consumer가 semantic provider 장애로 막히지 않음 | PASS — C7 integration 1/1; non-required consumer dead-letter    |
| duplicate event / recovery race 및 CAS cutover                        | 실 PostgreSQL 필요 — C7 DB test 정의 완료, 로컬 URL 부재로 skip |
| restart 후 already-published gap recovery                             | 실 PostgreSQL 필요 — C7 DB test 정의 완료, 로컬 URL 부재로 skip |
| provider unavailable/denied isolation 및 restore                      | 실 PostgreSQL 필요 — C7 DB test 정의 완료, 로컬 URL 부재로 skip |
| stale semantic fail-closed, lexical fallback 유지                     | PASS — 기존 semantic/hybrid contract + C7 integration           |
| Ask grounded evidence/citation 및 Canonical immutability              | 실 PostgreSQL causal acceptance 필요 — CI에서 실행              |

## 실행 결과

| 게이트                                                            | 결과                                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm run test:unit`                                               | PASS — 148 files / 1,161 tests                                                                         |
| `npm run test:contract`                                           | PASS — 66 files / 686 tests                                                                            |
| `npm run test:integration`                                        | 65 files / 504 tests PASS; `recovery-harness-isolation` 1 suite는 `TEST_DATABASE_URL` 부재로 실행 차단 |
| `npm run typecheck` / `npm run lint`                              | PASS                                                                                                   |
| C7 변경 파일 `prettier --check`                                   | PASS                                                                                                   |
| `npm run test:architecture`                                       | PASS                                                                                                   |
| `npm run test:stage12-package` / `stage12:reuse-operations-gate`  | standalone 및 assembly 계약 PASS; quality/database 단계는 `TEST_DATABASE_URL` 부재로 차단              |
| `npm run docs:validate`                                           | PASS — ADR 1–168 및 문서 registry 검증                                                                 |
| `npm run secret:scan` / `npm run oss:verify`                      | PASS — OSS 68 decisions / 45 baseline references                                                       |
| `npm run frontend:typecheck` / `frontend:test` / `frontend:build` | PASS — 50 files / 383 tests; build warning은 기존 chunk-size 안내                                      |
| `npm run frontend:test:e2e`                                       | `TEST_DATABASE_URL` 부재로 실행 차단                                                                   |
| C7 real PostgreSQL database test                                  | 1 test skip — `TEST_DATABASE_URL` 부재; CI에서 causal acceptance 필요                                  |

전체 `format:check`에는 C7 범위 밖의 기존 `modules/comparison/src/orchestration-v2.ts`와
`modules/frontend-knowledge-draft/src/product-api.ts` 경고가 남아 있다. C7 변경 파일은
별도 targeted check를 통과했으며, 해당 기존 파일은 이 PR의 범위를 넓히지 않도록 수정하지 않았다.

## 보정 반복 검증 결과 (2026-09-16)

| 게이트                                 | 결과                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                    | PASS                                                                                                    |
| 변경 파일 ESLint                       | PASS                                                                                                    |
| C7 Unit + database-target guard        | PASS — 13 tests                                                                                         |
| Semantic embedding Product integration | PASS — 13 tests                                                                                         |
| `npm run test:integration`             | 65 suites / 504 tests PASS; `recovery-harness-isolation` 1 suite는 `TEST_DATABASE_URL` 부재로 실행 차단 |
| Knowledge Model contract 재실행        | PASS — 12 tests (`--maxWorkers=1 --testTimeout=30000`)                                                  |
| C7 PostgreSQL causal acceptance        | 1 test skip — `TEST_DATABASE_URL` 부재; CI에서 실행 필요                                                |
| `git diff --check`                     | PASS                                                                                                    |

전체 Contract 실행에서는 기존 Knowledge Model 두 테스트가 기본 5초 제한으로 timeout되었으나,
단일 worker와 30초 제한 재실행에서는 12/12 통과했다. PostgreSQL acceptance는 실제
Canonical repository commit, durable outbox, Stage 7 projection, restart recovery,
provider 장애·복구, hybrid stale exclusion, normal Ask evidence/citation을 포함하며
로컬 DB가 없어 skip되었다.

## Migration / Rollback

DB migration은 없다. 변경을 revert하면 기존 Canonical, lexical projection, semantic
generation 및 Connector Runtime 상태를 유지한 채 C7 consumer와 recovery wiring만
제거할 수 있다. 자동 rollback은 Canonical commit이나 approval을 되돌리지 않는다.

## 변경 파일

- `modules/semantic-generation/src/convergence.ts`
- `modules/semantic-generation/src/compatibility.ts`
- `modules/semantic-generation/src/index.ts`
- `modules/canonical-knowledge/src/index.ts`
- `assemblies/shotgun-app/src/server.ts`
- `assemblies/shotgun-app/src/product-api/ai-settings-routes.ts`
- `tests/unit/semantic-projection-convergence.test.ts`
- `tests/integration/semantic-projection-convergence.test.ts`
- `tests/integration/semantic-embedding-profile-product.test.ts`
- `tests/database/semantic-projection-convergence.database.test.ts`
- `tests/contract/handoff-topology.contract.test.ts`
- `tests/unit/health.test.ts`
- `modules/semantic-generation/module-manifest.json`
- `modules/canonical-knowledge/module-manifest.json`
- `docs/architecture/adr/ADR-168-canonical-driven-semantic-projection-convergence.md`
- `docs/architecture/adr/README.md`
- `docs/architecture/adr/adr-registry.json`
