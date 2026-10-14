# VP-05 A3 오프라인 구현 및 재사용 기록

- Record: `VP05-FULL-EVALUATION-A3-20261012`
- Base: `aba6ff27f9620ee1a3f408f8df81e8aad21cc584`
- Scope: [A3 측정 계약](../../architecture/add/vp05-evaluation-trust/a3-relation-reference-measurement.md), 순수 test-artifact types/digest/validation/metrics, synthetic unit contract tests
- Runtime authority, source extraction/search/Ask, source DB, policy/prompt/schema/confidence gate: 변경 없음
- Certification evidence: 새 독립 인간/동등 외부 검증 reference **0**. 의미 인증 Gate 미충족은 구현 중단이나 사용자 개별 검토 의무로 바꾸지 않음

## 1. 기존 증거·계약 검토

보정 A1·A2, ADR-098/172/173, Module Architecture·OSS Role Matrix·Implementation/OSS 계획·DoD의 relevant 평가/소유권 경계를 먼저 검토했다. Phase A 원문은 감사 결과로 읽었으며 기존 432/B12 출력, Gold-B-7, 중단 stash를 열거나 새 채점에 사용하지 않았다. 기존 scorer의 조건부 방향/0분모/안정성 문제는 새 synthetic fixture로만 검증한다.

현재 application은 v6 6종 출력이며 warrant가 없다. 이 제한을 고치기 위해 새 prompt/schema나 provider를 도입하지 않았다. kind 결과를 먼저 별도로 측정하고 warrant 미검증인 output의 full-tuple coverage/N/A와 operational confirmed yield를 노출하는 절충을 선택했다. 이 방식은 평가가 가능한 범위를 보여주며 의미 증거를 자동 생성하지 않는다.

## 2. OSS/기존 구현 판단 — 구현 전에 수행

| 대상 / 공식 Repository                                                                                | 고정 검토 기준                                                           | 판단 및 재사용 범위                                                                                                             | 제외 이유 / 안전·유지보수                                                                                                                 |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Shotgun `packages/quality-evaluation` / [JasonCutter/shotgun](https://github.com/JasonCutter/shotgun) | Canonical base `aba6ff27f9620ee1a3f408f8df81e8aad21cc584`, package 1.0.0 | **AUGMENT existing Shotgun package patterns**: `ratio` 직접 재사용, contracts `stableJson/sha256Text/unicodeLength` 직접 재사용 | Claim/Search scorer·APPROVED runtime lane을 relation 권위로 오용하지 않음. 새 외부 dependency 없음                                        |
| [garrytan/gbrain](https://github.com/garrytan/gbrain)                                                 | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT                          | **REFERENCE_ONLY**: 기존 provenance/idempotency/history 패턴의 경계 확인                                                        | Job/Graph runtime이 relation label/warrant 승인·측정 계약을 제공하지 않음. 기존 Source Registry security/maintenance 확인, runtime 미도입 |
| [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki)                                     | `ad626a3d81be1480e35ef4e94234de8dbb27a61e`, Apache-2.0                   | **REFERENCE_ONLY for A3**: 원문/locator와 의미 검증 분리. 기존 EXTRACT locator 자체는 유지                                      | Evidence offset 성공이 warrant 참이라는 증거가 아님. SQLite/VaultFS/MCP runtime 미도입                                                    |
| [ddsyasas/llm-wiki](https://github.com/ddsyasas/llm-wiki)                                             | `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`, MIT                          | **REFERENCE_ONLY**: 두 동작 Ask UX 유지                                                                                         | label 독립 검증/metric 계약 없음. Backend SSRF/absolute-path 위험으로 기존 backend 제외 유지                                              |
| [Inkeep OpenKnowledge](https://github.com/inkeep/open-knowledge)                                      | `f2834c237639e2cff603817ed88182b33f83cf91`, GPL-3.0-or-later             | **REFERENCE_ONLY**: Evidence와 검토 provenance 표시의 경계                                                                      | 독립 Gold 승인 대체 불가. GPL runtime/code copying 미도입, 기존 pin 유지                                                                  |

네 upstream runtime의 일반 Job·UI·annotation은 이 exact target/input/tuple/warrant 계약을 제공하지 않는다. 신규 범용 평가 플랫폼도 필요한 최소 pure 계산보다 DB/서비스/telemetry 권위를 늘린다. 기존 Shotgun ratio/digest와 별도 test artifact를 보완하는 것이 최소 변경이다. 관련 외부 코드를 복사·설치하지 않았고 lockfile/OSS Role Matrix의 upstream 채택 상태를 바꾸지 않는다. 실제 코드 통합을 수행할 때 upstream 계약/license/security Gate를 새로 면제하지 않는다.

## 3. 외부 독립 reference 확보 경로 검토

아래는 공식 공개 설명의 조사이며 dataset 다운로드·새 모델 평가·label 변환을 실행하지 않았다. dataset의 이름이나 사람 label 존재만으로 Shotgun Gold를 만들지 않는다.

| 후보                                                                                                                     | 확인한 provenance                                                                                                        | Shotgun 호환성 한계 / 결정                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [SNLI 1.0 공식 소개](https://nlp.stanford.edu/projects/snli/) 및 [원 논문](https://nlp.stanford.edu/pubs/snli_paper.pdf) | human-written sentence pairs, entailment/contradiction/neutral; 일부 별도 validation과 annotator labels; CC BY-SA 4.0    | **REFERENCE_ONLY / IMPORT DEFER**. English NLI의 entailment는 Shotgun SUPPORTS/QUALIFIES 역할과 동일하지 않음. 인간 검토 범위·개별 이견·외부 전제·입력 동등성을 확인해야 하며 자동 label mapping 금지                                                  |
| [FEVER 공식 dataset 설명](https://fever.ai/dataset/fever.html)                                                           | Wikipedia에서 변형한 claim을 source sentence를 모른 채 검증; supported/refuted/not-enough-info와 annotator evidence sets | **REFERENCE_ONLY / IMPORT DEFER**. 여러 Wikipedia 문장 retrieval/사실 검증 task는 두 claim+동일 EvidenceSpan 관계 task와 다름. evidence 제공 범위·검증 책임·case revision/license 확인과 taxonomy mapping의 독립 검증 없이는 equivalent reference 아님 |

현재 사용 가능한 외부 자료는 **검토 후보**이며 독립 reference 인증 count는 0이다. 좁은 외부 label을 재사용할 때는 원래 입력/label 범위 내의 별도 diagnostic으로 한정하고, Shotgun tuple로 변환하려면 그 exact 변환의 검증 증거가 필요하다. 사용자에게 reviewer를 지정하거나 label을 승인하라는 절차를 넣지 않는다. dataset import는 향후 승인된 범위와 실제 동등성 검증의 작업이며 이번에 다운로드하지 않았다.

## 4. 구현·검증 및 남은 조건

구현은 다음을 포함한다.

- A1 provenance·A2 exact input·target/profile/revision·허용 kind/direction/warrant tuple·assumptionRules digest.
- duplicate/unscheduled/mismatched task, unknown choices/directions, invalid crop/context/probability, runtime/adoption 모순의 fail-closed 검사.
- raw/adopted P/R/F1와 critical recall, 조건부 방향의 올바른 분모, explicit negative와 voluntary abstention, schema/runtime/UNKNOWN/missing 분리.
- 미관측 warrant의 full-tuple N/A 및 coverage, confirmed-positive operational yield.
- raw 원본 choice/direction 안정성과 adoption-state 안정성의 분리. 모든 예정 반복 중 엄격 안정성·완료 coverage.
- 독립 검증 positive membership의 Frontier coverage artifact 계산. all-N² 재도입 없음, eligible positive 0이면 N/A.

검증은 synthetic unit fixture만 사용한다. fixture의 가상 외부 record는 필드/digest/scope 오류 검사이며 실제 사람/승인 receipt가 아니다. 결과와 실행 명령은 이 문서의 후속 validation 절에 기록한다. production DB/provider/authority 연결 없이 구현하며 기록된 결과를 인증 Gold나 전체 VP-05 COMPLETE로 승격하지 않는다.

Migration: 없음. Rollback/replacement: 이 offline package와 호출부를 제거/교체하면 된다. 원문/모델/원장/생산 schema 변경 없음. 후속 evaluator 교체는 동일 synthetic contract와 versioned input/output digest를 유지해야 한다. 새 runtime adoption 또는 threshold 조정은 이 구현에 포함되지 않는다.

남은 실제 의존성은 외부 인간/동등 검증 provenance, product-question obligations·표본 대표성, v6 warrant 측정 가능 범위와 confidence calibration/billing/품질 Gate다. independent evidence absent를 actual AI 의미 오류라고 단정하거나 반복 fake 성공으로 보완하지 않는다. 구현 완료와 제품 의미 인증 상태를 별도로 보고한다.

## 5. 로컬 검증 기록

| 검증                                                                               | 결과 / 범위                                                                                                                              |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `vitest run tests/unit/vp-relation-evaluation.test.ts --maxWorkers=1`              | **24 PASS**. 순수 synthetic contract만 실행                                                                                              |
| A3 + 기존 `tests/unit/quality-metrics.test.ts`                                     | **26 PASS**. 기존 ratio/digest 활용의 회귀 포함                                                                                          |
| `eslint packages/vp-relation-evaluation tests/unit/vp-relation-evaluation.test.ts` | **PASS**                                                                                                                                 |
| `tsc -p packages/vp-relation-evaluation/tsconfig.build.json --noEmit`              | **PASS**. package 및 재사용 shared-source compile                                                                                        |
| 소유 파일 prettier                                                                 | **PASS**. 코드·계약·구현 기록 정규화                                                                                                     |
| 전체 root typecheck 첫 관측                                                        | A3 오류 **0**. 다른 병행 source-refresh test의 임시 타입 오류 관측을 상위 에이전트에 전달. 전체 Gate 결과는 최종 통합 검증 기록에서 판정 |

외부 verification 필드 검사의 가상 fixture는 `FICTIONAL_FORMAT_TEST_NOT_A_PERSON`과 synthetic locator로 명시한다. 이 fixture를 인증 reference로 저장하거나 실제 사람/승인 이력으로 보고하지 않았다. confidence/selected probability는 구조 range와 별도 관측 count만 검사하며 calibration 또는 0.9 gate 정확도 PASS로 보고하지 않는다. 기존 frozen output을 읽어 이 metric으로 재계산한 결과는 없다.

Export는 `packages/vp-relation-evaluation/src/index.ts`에서 types/digest/validation/metrics/frontier 함수만 제공한다. 전체 workspaces/tsconfig의 기존 `packages/*`/`packages/**/*.ts`가 발견하므로 공유 barrel 수정은 필요 없다. workspace lockfile 등록과 전체 documentation/architecture Gate는 상위 통합 단계의 범위다. 새 package를 운영 bootstrap/worker에 import하지 않는다.

## 6. 2026-10-14 외부 원본 검증 범위 확보

이전 dataset 미다운로드 기록은 당시 이력이다. 후속 전체 실행에서 exact e-SNLI
commit과 공식 SNLI archive를 확보하고 12건의 원문·native label·5 annotator vote를
대조했다. 원본 pair/label은 12/12 일치하며 Shotgun 인증 reference는 **0**이다.
Label을 보여준 뒤 작성한 인간 설명과 독립 label 검증, native NLI와 현재 v6
tuple/Evidence Context의 동등성을 구분했다. Dataset import·Gold 채택·새 평가
실행은 하지 않았다. [확보 결과와 남은 조건](./external-reference-readiness.md),
[exact 외부 증거 manifest](./external-reference-readiness-manifest.json)를 따른다.
