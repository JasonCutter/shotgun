# VP-05 평가 신뢰성 — A1·A2 결정 기록

> **DECIDED_UNDER_USER_DELEGATION / LOCAL_PENDING_CANONICALIZATION**
>
> 기준 `main@cd3cc258dcc5033cb61d7f1dc2f221f5e5016ab6`, 사용자 위임 2026-10-12. Section별 구체화가 완료됐으며 개별 Reference 승인·인증 Gold·평가 실행·Canonical 게시 완료는 아니다.

| 순서 | Section                                                           | 결정 범위                                                                       | 상태                                             |
| ---- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1    | [A1 Reference 승인 책임](./a1-reference-review-responsibility.md) | 인간 owner/독립 reviewer, 전문성·독립성, 실제 review와 증빙                     | 결정 완료; 실제 사람의 case별 검토·승인은 미수행 |
| 2    | [A2 입력 문맥](./a2-evaluation-input-context.md)                  | production Evidence context primary, claim-only 분리, 외부 전제·provenance·부족 | A1 이후 결정 완료; 새 입력/평가 실행 없음        |

## 문서 위치 및 권위

이 경로는 VP 평가의 Section별 ADD 구체화 record다. 기존 Phase 1~6의 승인된 원문 ADD를 재작성하지 않는다. [ADR-098](../../adr/ADR-098-stage-12-1-quality-evaluation-contract.md)과 [ADR-173](../../adr/ADR-173-product-first-development-and-evaluation-trust-strategy.md)를 상위 정책으로, [ADR-172](../../adr/ADR-172-vp-autonomous-knowledge-authority.md)의 제품·Evidence 문맥 경계를 적용한다.

[ADR-117](../../adr/ADR-117-documentation-source-of-truth-canonicalization-and-publication-boundary.md), [ADR-120](../../adr/ADR-120-canonical-cutover-activation-and-legacy-migration-boundary.md), [docs/CANONICAL.md](../../../CANONICAL.md)는 변경하지 않는다. 위임된 문서 결정과 개별 Gold 인간 승인, reviewed `main` 게시, 실제 평가 실행은 각각 별도다. chat·로컬 문서만으로 Canonical 또는 생산 권위를 구성하지 않는다.

관련 ADR에는 탐색용 날짜 있는 additive note만 남긴다. 새 ADR 번호/상위 정책/Gold 승인 registry/runtime/migration은 도입하지 않는다. [Phase A 원본 감사](../../../implementation/vp05-evaluation-trust-phase-a-2026-10-12/report.md)와 초안은 수정하지 않고 당시 미결 상태 그대로 보존한다. 현재 A1/A2 결정은 그 이후의 record이며 전체 metric/reference 계약을 승인한 것이 아니다.

## 남은 범위와 STOP

실제 reviewer 지정과 사람의 Reference별 review/승인, A3 taxonomy/metric과 대표 집합, Git 게시/향후 평가 실행 승인은 남는다. 기존 72/432/B12·stash·B 잔여24·Gold-B-7을 보존한다. 새 AI 호출·운영 변경·prompt/schema 실험·VP-06·push/PR/merge는 수행하지 않는다.

이번 두 Section 결과의 검증·diff·보존은 [완료 보고](../../../implementation/vp05-evaluation-trust-a1-a2-2026-10-12/report.md)에 기록한다. 문서 결정 후 STOP.
