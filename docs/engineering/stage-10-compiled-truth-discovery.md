# Stage 10 — Compiled Truth, Graph and Discovery

## 완료 상태

**COMPLETE — 2026-07-17**

## 구현 범위

- `modules/compiled-truth`: 전체·증분 build, 상태·lag, bounded Discovery
- `adapters/stage10-in-memory`: Contract Test용 저장소
- `adapters/postgres-stage10`: Projection·suppression 영속 저장
- `packages/contracts/src/compiled-truth.ts`: Projection·Graph·Discovery 공통 계약
- `/compiled-truth/*`, `/knowledge/discovery/*`: 조회·실행 API
- `/knowledge`: Cytoscape 2D Graph와 동일 데이터의 목록·표 fallback
- `010_stage10_compiled_truth_discovery.sql`: Stage 10 스키마

## 데이터 흐름

1. `GetCanonicalSnapshot`, `GetCanonicalClaim`, `ListKnowledgeGroups`로 승인 입력을 읽는다.
2. ID 순서로 item과 승인 Typed Edge를 정렬한다.
3. source snapshot digest와 logical digest를 계산한다.
4. Full Rebuild 또는 Incremental 모드로 `projection.compiled_truth`를 갱신한다.
5. Discovery는 최대 node·제안 수 안에서 관계가 없는 Entity를 찾는다.
6. 결과를 `DERIVED_INFERENCE → VALIDATION` 후보로 발행하고 fingerprint로 반복을 억제한다.

## 완료 기준 검증

| 기준                                        | 검증                                            |
| ------------------------------------------- | ----------------------------------------------- |
| 동일 Snapshot·Projector Version의 동일 결과 | source/logical digest 계약 테스트               |
| 증분과 Full Rebuild 동등                    | 두 mode의 item·edge·digest 비교                 |
| 현재·과거·예정·충돌 구분                    | 4개 temporal state fixture                      |
| 추론 Edge의 Canonical Graph 혼입 금지       | Graph source 제한 및 빈 edge 검증               |
| `DERIVED_INFERENCE` Phase 3 재진입          | event payload와 `VALIDATION` 검증               |
| 반복 제안 억제                              | 같은 fingerprint 두 번 실행                     |
| 비용·범위 제한                              | `maxNodes`, `maxSuggestions` Schema와 결과 검증 |
| Projection 상태·Lag                         | `NOT_BUILT`, `READY`, lag 계약                  |
| 2D Graph와 fallback                         | local Cytoscape·canvas·table 통합 테스트        |
| DB 재시작·원자 기록                         | PostgreSQL adapter restart·duplicate test       |

## 운영과 Rollback

- Projection 문제 시 Canonical·Stage 9 승인 데이터는 그대로 두고 Stage 10 표만 다시 만든다.
- `DEGRADED`는 Projection 실패 상태이며 Canonical 손실을 의미하지 않는다.
- Cytoscape를 제거해도 API와 목록·표 fallback은 유지된다.
- 대형 Graph·Vector 제품으로 교체할 때도 `CompiledTruthRepositoryPort`와 Contract Test를 유지한다.

## 현재 제한

- Incremental 모드는 현재 작은 MVP 데이터에서 목표 결과를 원자적으로 교체한다. row 단위 delta
  최적화는 대표 데이터에서 rebuild 비용 한계가 측정될 때 추가한다.
- Discovery는 결정적인 Knowledge Gap만 생성한다. AI 관계 제안은 기존 AI Provider 정책과
  별도 품질 평가가 준비될 때 같은 `DERIVED_INFERENCE` 계약 뒤에 추가한다.
