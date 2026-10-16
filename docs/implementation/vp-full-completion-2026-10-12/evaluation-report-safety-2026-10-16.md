# VP-05 — 평가 결과 오독 방지와 정책 쟁점 분리

- 상태: **LOCAL IMPLEMENTATION / NOT PUBLISHED**
- 기준: Canonical `89c14c5e2fee9559e21b6b964098a11f4e8cc0e2`
- 작업 branch: `codex/vp05-evaluation-report-safety-20261016`
- 범위: 순수 offline 평가 보고0.2, 합성 계약 검증, 정책 미채택 초안

## 1. 문제와 결정

외부 AI 검토가 지적한 일부 계산은0.1 계약과 일치했지만 사용자 관점에서 전체 성능0%·근거까지100%검증으로 오해될 위험이 있었다. 계약 일치만으로 해결을 끝내지 않고 보고서 의미를 보완했다. 이 작업은 기존72/432/B12의 정답·결과를 수리하거나 재채점하는 작업이 아니다.

## 2. 실제 로컬 변경

- [A3 측정0.2](../../architecture/add/vp05-evaluation-trust/a3-relation-reference-measurement-0.2.md): 종류·방향 일치와 warrant 포함 품질 분리, 미확정 full-tuple 점수 N/A, 유한 표본 bounds.
- 채점 가능한 outcome과 실제 warrant 검증 응답의 count/coverage를 분리했다. WITHHELD가 required positive를 놓친 FN이라는 사실은 유지하고, 그것을 warrant 검증 완료로 표시하지 않는다.
- 주된 구조·기권·안정성은 eligible reference scope로 한정하고 전체 실행의 값은 `operational`에 별도 보존했다. 제외 이유·미완료·invalid/UNKNOWN을 숨기지 않는다.
- disputed/invalid warrant의 상세 rejection 사유를 노출했다. AI 판단을 인간 검증으로 승격하지 않는다.
- measurement version0.1 plan은 새 validator에서 거부한다. 과거 계약은 Git과 기존 봉인 자료에 보존한다.

수정 파일은 `packages/vp-relation-evaluation/src/types.ts`, `metrics.ts`, 기존 unit test 및 관련 문서다. production provider/router/projector/worker/DB/schema, v6/0.9·보존 v11/SSC는 변경하지 않는다. 이 offline package를 제품 runtime에 연결하지 않는다.

## 3. 사용자가 제기한 다섯 문제의 처리

| 항목                               | 처리                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 0점 착시                           | kind/direction99/100은 tuple-only99%. warrant 미확정99이면 full-tuple point는 N/A와 bounds0~99%를 표시           |
| 안전장치 보류를 근거 채점으로 오인 | adopted miss1과 assessed warrant0을 별도 표시. 미채택을 정답·NO_RELATION·분모 제외로 바꾸지 않음                 |
| 무효 시험의 일관성 혼입            | 주된 안정성에서 제외하고 전체 운영 지표에는 제외 수와 함께 보존                                                  |
| 옛72개 정답 문제                   | 기존 방향 누락/문맥 부족 감사와 라벨을 보존. 새 평가에서 구조/문맥 부적격으로 다루며 원래 점수를 재채점하지 않음 |
| 외부 인간만 승인하는 규칙          | 인증 Gold와 제품 인수·AI 진단의 범위를 분리하는 정책 변경안을 준비. 현행 인간 인증 계약을 자동 폐기하지 않음     |

`NO_RELATION`은 입력이 충분한 관계 부재와 입력 부족을 구별하기 위한 유효한 제안이다. 하지만 v6에는 없는 선택지이므로 현재 평가에서 요구하거나 운영 prompt/schema에 즉시 추가하지 않는다. [정확한 정책 변경안](../../architecture/add/vp05-evaluation-trust/relation-negative-and-acceptance-policy-draft.md)에 RELATED 유지/범위·negative outcome·Gate·격리 검증·승인 경계를 정리했다.

## 4. 검증 및 보존

초기 로컬 관련 unit47/47 PASS(기존32+신규7, accounting8). 기존 timeout/negative assertion/skip 완화 없음. 추가 정적·문서·보존 검증의 최종 결과는 후속 기록에 추가한다. 첫 신규 범위 테스트는 합성 입력만 사용하며 모델 성적이나 인간 검토를 생성하지 않는다.

전체 root typecheck와 변경 파일 ESLint PASS. 실제 provider 호출·운영 DB 접속·앱/worker 시작·설정/권위 변경·Gold-B-7 개봉·기존 실험 재개·push/PR/merge는0이다. 새 본문이 참조하는 과거 PR 게시 상태는 Git/CI의 완료 증거를 재사용하고 당시 LOCAL/HOLD 문구와 구분한다.

최종 관련 검증은 **51/51 PASS**(relation41, accounting8, 기존 quality ratio2)다.
추가9개 relation 계약 사례는99/100과 미관측 warrant, WITHHELD와 실제 검증 수,
eligible/전체 안정성, 분쟁 사유, 미확정2건의 가능한4개 결과에 대한 bounds,
확정 방향 오류와 critical/noncritical 분리 및0.1 재해석 거부를 확인한다.
Root typecheck·ESLint·Prettier·문서/ADR/Canonical 검증(링크789건) PASS.
기존 TS6 C2 release 검증도 source inventory/AST 및 v8 재생성·역사 동일성 전부
PASS하며 coordinate·timeout·frozen bytes를 바꾸지 않았다.
Private 실행 로그는 `C:/dev/artifacts/vp-full-completion-2026-10-12/evaluation-report-safety-20261016/`에 보존한다.

## 5. 재사용·교체·rollback

기존 `packages/quality-evaluation`의 ratio, contracts의 digest, A1/A2 validator, relation evaluation unit fixtures를 AUGMENT했다. [기존 A3 OSS 검토](./evaluation-a3-implementation.md)의 고정 upstream commit/license/Port 결정을 재사용한다. 네 우선 레퍼런스의 runtime/DB는 평가 의미를 제공하지 않으므로 REFERENCE_ONLY/DEFER 경계 유지. 새 외부 package·lockfile·runtime 권위가 없다.

Port/데이터 소유권은 offline artifact 경계다. 교체 시0.2의 partial/N/A·bounds·집계scope·원본 보존 계약을 통과해야 한다. Migration은 없고 rollback은 해당 로컬 offline 변경 commit만 되돌리는 것이다. 과거 실험 원장·예산·UNKNOWN을 되돌리지 않는다.

## 6. 남은 정책 및 인수 조건

NO_RELATION 신규 policy 및 제품 인수 Gate 범위 조정은 아직 미채택이다. 승인되어도 운영 적용·신규 실제 AI/대량 평가·과거 재채점은 별개다. 이 보고서가 전체 VP 인수나 인증 정확도를 완료하지 않는다. 유료 외주를 먼저 시작할 이유로 삼지 않는다.
