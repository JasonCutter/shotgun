# VP-05 평가 신뢰성 — A1·A2 결정 기록

## 2026-10-12 후속 구현 상태

A1·A2는 PR #383, `main@aba6ff27f9620ee1a3f408f8df81e8aad21cc584`에 게시됐으며 아래 PUBLICATION_HOLD는 당시 기록이다. 후속 전체 구현 승인으로 [A3 관계 Reference·측정 계약](./a3-relation-reference-measurement.md)의 오프라인 구현과 합성 계약 검증을 진행한다. 새 인증 Gold는 0, 실모델 의미 품질은 N/A다. 과거 Phase A 초안 및 72/432/B12 재채점이나 운영 평가 권위 변경은 하지 않는다. [연속 실행 기준](../../../implementation/vp-full-completion-2026-10-12/master-execution-plan.md)을 따른다.

> **A1_REVIEW_CORRECTED / A2_CONDITIONALLY_ACCEPTED / PUBLICATION_HOLD**
>
> 기준 `main@cd3cc258dcc5033cb61d7f1dc2f221f5e5016ab6`. 2026-10-12 선행 위임 결정 `e8d0f7d769722f4482ff26a9828812f37e1270cc` 뒤의 명시적 사용자 정정을 현재 계약으로 적용한다. 개별 Gold 검증·평가 실행·Canonical 게시는 완료하지 않았다.

| 순서 | Section                                                           | 결정 범위                                                                       | 상태                                              |
| ---- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1    | [A1 Reference 검증 책임](./a1-reference-review-responsibility.md) | agent 운영, 사용자 외부 독립 검증/동등 외부 reference provenance                | 사용자 개별 승인·검토자 지정 의무 제거; 새 Gold 0 |
| 2    | [A2 입력 문맥](./a2-evaluation-input-context.md)                  | production Evidence context primary, claim-only 분리, 외부 전제·provenance·부족 | A1 이후 결정 완료; 새 입력/평가 실행 없음         |

## 문서 위치 및 권위

이 경로는 VP 평가의 Section별 ADD 구체화 record다. 기존 Phase 1~6의 승인된 원문 ADD를 재작성하지 않는다. [ADR-098](../../adr/ADR-098-stage-12-1-quality-evaluation-contract.md)과 [ADR-173](../../adr/ADR-173-product-first-development-and-evaluation-trust-strategy.md)를 상위 정책으로, [ADR-172](../../adr/ADR-172-vp-autonomous-knowledge-authority.md)의 제품·Evidence 문맥 경계를 적용한다.

[ADR-117](../../adr/ADR-117-documentation-source-of-truth-canonicalization-and-publication-boundary.md), [ADR-120](../../adr/ADR-120-canonical-cutover-activation-and-legacy-migration-boundary.md), [docs/CANONICAL.md](../../../CANONICAL.md)는 변경하지 않는다. 위임된 문서 결정과 개별 Gold 인간 승인, reviewed `main` 게시, 실제 평가 실행은 각각 별도다. chat·로컬 문서만으로 Canonical 또는 생산 권위를 구성하지 않는다.

관련 ADR에는 날짜 있는 note와 후속 정정 관계를 남긴다. 새 ADR 번호/Gold 승인 registry/runtime/migration은 도입하지 않는다. [Phase A 원본 감사](../../../implementation/vp05-evaluation-trust-phase-a-2026-10-12/report.md)와 초안은 당시 미결 상태 그대로 보존하며 현재 A1 책임 의무로 적용하지 않는다. 선행 A1 결정/승인 기록은 e8d0f7d76의 Git 이력으로 보존하되, 사용자 최종 Reference 승인·reviewer 지정 구조는 이후 정정으로 대체했다. 전체 metric/reference 계약은 아직 확정하지 않았다.

## 남은 범위와 STOP

외부 독립 의미 검증 증거 확보와 정확한 input/profile 대응, A3 taxonomy/metric과 대표 집합, 별도 Git 게시/평가 실행 허가는 남는다. 증거 수집·검사·분류·측정 운영은 상위 에이전트가 담당하며 사용자는 개별 reviewer/approver 또는 reviewer 지정자가 아니다. 인증 Gold가 없어도 일반 제품에 사용자 review 클릭을 추가하지 않는다. 기존 72/432/B12·stash·B 잔여24·Gold-B-7을 보존하고 금지된 실행/게시를 수행하지 않는다.

이번 두 Section 결과의 검증·diff·보존은 [완료 보고](../../../implementation/vp05-evaluation-trust-a1-a2-2026-10-12/report.md)에 기록한다. 문서 결정 후 STOP.
