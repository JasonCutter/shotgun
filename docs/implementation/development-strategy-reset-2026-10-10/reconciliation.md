# ADR-173 기존 결정 정합성 정리

> 2026-10-10 · 사용자 승인 결정의 로컬 문서 정비. Canonical `main` 게시와 운영 변경은 별도다.

## 검토 방법과 범위

ADR registry의 개별·통합 owner, Phase ADD, Module ADD, VP 계획/tracker, DoD, OSS·평가·릴리스 및 agent 원칙을 대조했다. [alignment-audit.json](./alignment-audit.json)은 ADR/ADD 파일의 전체 텍스트를 읽어 수행한 **자동 경계 screening**의 path/SHA/상태·주제 신호를 기록한다. 이 screening을 모든 의미 결정의 독립 승인 또는 무충돌의 수학적 증명으로 표시하지 않는다.

아래 표의 제품·원장·평가·provider·게시·agent·Gate 관련 핵심 결정은 절별로 검토했다. 적용 범위가 다르거나 아직 선택하지 않은 대안은 실제 충돌로 세지 않았다. 기존 ADR 전체를 SUPERSEDED로 바꾼 항목은 **0개**다.

## 실제 활성 해석/진행 문제와 조치

| 항목 | 기존 위치 / 문제                                                                | 조치와 대체 범위                                                                                                 | 보존                                             |
| ---- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| R1   | tracker `다음 작업 순서`의 2026-10-02 지시가 현재 우선순위로 보임               | ADR-173 A–E를 현재 착수 기준으로 추가. 옛 순서는 날짜가 있는 역사 기록으로 한정                                  | 원래 순서·당시 수치·증거·checkbox 보존           |
| R2   | tracker의 미생성 eligible/N² 쌍을 전부 필수 backlog로 읽을 수 있음              | 현행 ADR-172 §13의 승인된 CandidateFrontier membership을 완료 모집단으로 재확인. 이론적 PairUniverse는 참고 지표 | Frontier·DB·digest·threshold 변경 없음           |
| R3   | frozen/candidate benchmark 수치를 인증 의미 품질로 확대하는 실행 관행           | ADR-098 보완·ADR-173 D2·testing/OSS/DoD에 검증 상태·제공 입력·분모·미평가·표본 한계 규칙                         | scorer·원본 결과·구버전 기준 untouched           |
| R4   | 구현/OSS 후보 검토가 제품/평가/필요성 진단 없이 다음 기술 착수로 이어질 수 있음 | AGENTS·roadmap·OSS 문서의 앞단에 제품→평가→병목을 추가. 필요한 구현 범위 내부의 OSS-first는 유지                 | 기존 후보 핀·license·security·Contract Gate 보존 |
| R5   | COMPLETE_WITH_LIMITS를 다음 Gate 자동 허가로 오해할 수 있음                     | 적격성·남은 필수 요건·해제 계획을 명시. 현재 VP-05 제한부 완료 및 VP-06 착수 미승인                              | 상태 정의·기존 완료/승인 이력·비우회 Gate 보존   |
| R6   | ADR registry가 171까지만 검사하여 존재하는 ADR-172를 owner 검사에서 빠뜨림      | expectedRange와 마지막 owner range를 173까지 확장, ADR-172/173의 단일 owner 등록                                 | 번호 재사용·reserved gap 변경·renumber 없음      |

R1은 실제 활성 일정 지시의 대체이고 R2는 이미 승인된 Frontier 계약과 오래된 지시의 정합성 회복이다. R3–R5는 사용자가 승인한 전략에 따른 현재 실행/보고 규칙의 제한적 변경이다. R6은 registry coverage 결함이다. “현재 ADR-098/172 전체가 새 전략과 충돌한다”는 판정은 하지 않았다.

## 중요한 기존 결정의 판정

| 결정 / 절                                      | 판정                              | 이유 / 이번 변경                                                                                          |
| ---------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| ADR-098 Decision 1–8                           | CONSISTENT / REPORTING AMENDMENT  | test oracle≠Claim/Fact, AI label은 사람 검토 전 CANDIDATE. 향후 관계 보고 차원/분모만 보완                |
| ADR-098 Decision 8                             | CONSISTENT                        | 탐색 baseline 후 gate를 정하는 단계와 prospective 비교 전 기준 고정을 구분. 역사 threshold/승인 변경 없음 |
| ADR-172 §§1–4, §10                             | RETAINED                          | 두 동작·단일 공간·자동 VP Ledger·원문/버전·추론 구분이 전략의 제품 계약                                   |
| ADR-172 §13.1                                  | EVIDENCE INTERPRETATION AMENDMENT | 후보 Gold freeze는 독립 의미 승인이 아님. 100% critical / ≥99% overall candidate recall 요구는 유지       |
| ADR-172 §13.2–13.10                            | RETAINED                          | Frontier identity·writer·membership·READY/농축·예산·재생·정규화 결정 권위 변화 없음                       |
| ADR-161/164                                    | RETAINED                          | DeepSeek-only, deepseek-flash, no fallback. 새 모델 후보는 미채택이므로 현재 충돌 없음                    |
| ADR-117/120/121                                | RETAINED / PUBLICATION BOUNDARY   | Git main만 Canonical, 사용자 승인≠merge, 하나의 ADR 번호 owner                                            |
| ADR-169/170, 기존 runtime/budget 증거          | RETAINED                          | commit ambiguity, Asset CAS, 실행/복구·egress·예산 무결성은 속도/점수로 완화하지 않음                     |
| ADR-160 및 승인형 Phase ADD/ADR-085/086/135 등 | ALREADY SCOPED BY ADR-172         | 기존 승인형 경로와 VP 범위가 이미 구분됨. 새 전략으로 두 번째 전면 supersession을 하지 않음               |
| Module ADD §0.2·Port/데이터 소유권             | RETAINED                          | 전략 적용 안내 추가, owner/type/DB/공통 계약 변화 없음                                                    |
| 기존 UI/Approval·외부 Action 결정              | RETAINED IN THEIR SCOPE           | 일반 VP 지식 승인 클릭은 ADR-172에 따라 없음. 외부 Action 승인은 유지                                     |
| 기존 OSS Role Matrix·ADR-079–092               | RETAINED                          | 필요한 범위의 관련 후보 검토와 공통 Gate. runtime·내부 DB 전체 도입 안 함                                 |
| VP-0~VP-4 / VP-01~VP-11 / DoD                  | RETAINED + PRIORITY CLARIFIED     | A–E는 전략 우선순위. 추적 ID·제품 단계·Gate 재번호화/완료 강등 없음                                       |
| SSC·Qwen/NLI/Jev·질문 시 관계 평가             | UNSELECTED HYPOTHESIS             | 자동 관계 기록과 충돌하는 새 운영 결정은 아직 하지 않음. 실제 전환 시 별도 ADR 필요                       |

## 문서 변경 owner

- ADR-173: 확정 전략, 범위·미결사항·한정 amendment·publication·권한.
- ADR-098/172: 원문 뒤에 날짜가 있는 amendment만 추가. 과거 결정·SQL/type/digest 정의 유지.
- ADR README/registry, ADD root, Module ADD: 단일 owner와 전략 적용 안내.
- Implementation README/roadmap, VP plan/tracker: 현재 착수 기준과 역사 체크포인트 해석 분리.
- DoD/testing/release/OSS plans: 의미/형식/발행/안정성/분모·제품 인수·비우회 Gate.
- AGENTS.md: 목표 중심 자율성, 근거 우선, HOLD/STOP/별도 승인 경계.

기존 frozen 인수 계약 v1.0, Gold annotations, source corpus, 실험 reports/scores/raw, evaluator code, production code와 데이터는 변경하지 않는다. 새 평가 산출물의 적용 계약은 후속 과제에서 따로 검증해야 한다.

## 원본·중지 초안·미결 참조

[원본 전략](./source-proposal.md)은 byte-identical 사본이고 provenance SHA를 기록했다. “검토용 v0.1”이었던 과거 상태도 지우지 않는다. 사용자 승격 요청이 새 ADR의 승인 근거다.

중지된 relation-evaluation draft 20개 파일은 stash `57b05edb2ebe262180d15383850121a50f26655a`의 untracked tree에 바이트별로 일치함을 검증했다. [manifest](./paused-drafts.json)에 원래 hash와 보존 identity를 기록했다. 이 산출물을 이번 commit의 채택 평가기로 포함하거나 6개 사례가 승인됐다는 근거로 사용하지 않았다. B v2 기존 stash `6ff388bdcacd3d519381ab625892c39a583a43d2`도 유지했다.

원본 §11의 SSC v0.2 문서는 현재 검토 worktree와 primary checkout의 해당 경로에 없다. 이를 새 전략 채택에 필요한 전제나 현행 설계 권위로 만들지 않았다. 원본 자체의 문구는 보존하고 missing reference로 기록했다.

## 남은 승인과 publication

새 전략의 결정 내용은 이번 사용자 요청으로 승인됐다. 이 세션의 문서 정비 방법에 대한 추가 사전 승인은 필요 없다. Canonical `main` 반영은 기존 reviewed merge 절차가 남아 있고, 운영 정책/데이터·권위 변경·Gold-B-7·VP-06·push/PR/merge는 이번에 실행하지 않았다.
