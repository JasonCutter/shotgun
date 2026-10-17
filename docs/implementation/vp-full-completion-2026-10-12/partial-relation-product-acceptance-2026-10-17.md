# 부분 관계 처리 중 제품 인수 — 2026-10-17

**PARTIAL_RELATION_PRODUCT_ACCEPTANCE_PASS / OPERATING_AI_ACTIVATION_HOLD**

기준은 Canonical `9717186c6543fe71bf5155ec374ff24b1a234c3a`, tree
`5601e570a64018d5f283e6cf42623baa084fe085`다. 이 문서는 이후 로컬 검증이며
별도 게시·merge 전에는 Canonical에 반영된 변경이라고 보고하지 않는다.
이전 Windows/negative 보고서의 작성 시점과 실패 이력을 보존한다.

## 1. 검증이 필요했던 이유

사용자는 남은 관계 작업941개를 모두 처리할 때까지 다른 구현도 기다려야 하는지
질문하고 독립 작업의 계속 진행을 지시했다. 현재 관계 대기량과 전체 제품 구현,
질문 준비 상태를 구별해야 한다. 기존 실제 앱 테스트는 A/B/수정본과 negative의
검색 효과를 검증했지만, 관계 예산 소진 및 명시적 v6 UNRESOLVED 상태에서
실제 HTTP Ask가 어떻게 동작하는지는 직접 고정하지 않았다.

코드 감사에서 확인한 현행 계약은 다음과 같다.

- Ask readiness는 Source/Evidence/Assertion 준비와 권한을 검사한다. 모든
  관계 job의 완료를 프로젝트 전체 질문의 일률적인 선행 조건으로 두지 않는다.
- 검색은 현재 직접 주장과 이미 발행된 관계를 사용한다. 아직 판단하지 않은
  관계나 UNRESOLVED를 positive edge 또는 NO_RELATION으로 사용하지 않는다.
- query-scoped freshness는 실제 근거 shortlist와 SourceVersion watermark를
  비교한다. 무관한 epoch 변화만으로 답변을 stale로 만들지 않는 기존 계약과
  회귀 테스트를 유지한다. 전역 epoch 비교를 새 차단 조건으로 넣지 않았다.

따라서 새 readiness 정책이나 상태 API/UI를 먼저 만들지 않고, 실제 경계에
대한 회귀 검증부터 보완했다. 관련 자연어 관계의 정답 정확도는 이 검증 대상이 아니다.

## 2. 최소 변경과 OSS 재사용

제품 코드·schema·migration·런타임 정책 변경은 없다. 기존
`createVPFullApplicationFixture`에 테스트 전용 relation 응답 주입을 추가하고,
기존 앱 close/start/bootstrap/cookie 재연결 코드를 재사용하는 `restart()`를
노출했다. 기존 negative 정책 재시작도 같은 구현을 사용한다. 두 개의 새
database acceptance case를 추가했다.

**AUGMENT — 기존 Shotgun fixture/Port 재사용**이다. 실제 application, Source
worker, v6 relation worker, Ask worker, PostgreSQL 검색·원장과 기존 Fake adapter를
사용한다. 새 운영 시스템·authority·라이브러리·lockfile·AI 모델은 도입하지 않는다.

기존 [OSS Role Matrix](../../architecture/module-architecture/open-source-role-matrix.md)와
[negative 제품 연결의 재사용 검토](../../architecture/add/vp05-evaluation-trust/negative-ledger-product-integration-proposal.md)를
유지한다. PostgreSQL/pg는 기존 lockfile pin을 재사용하며 gbrain/ddsyasas/
OpenKnowledge의 `REFERENCE_ONLY` 경계를 변경하지 않는다. 외부 runtime이나
저장소를 새로 채택할 기능 변경이 없어 신규 OSS 선정·상위 권위 변경은 없다.
Rollback은 이 테스트·문서 diff만 되돌리면 되며 DB rollback이나 과거 결과 수정은 없다.

## 3. 실제 격리 PostgreSQL + Fake 인수

| 사례                  | 실제 검증                                                                                                                                                                                                                                          | 결과 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 관계 예산100/100      | 합성 authority를 먼저 소진 상태로 만들고 정상 v6 앱을 재시작. 실제 worker의 `RELATION_BUDGET_PAUSED:EXHAUSTED` 후 관계 job은 RETRYABLE, attempt0, 관계 Fake call0/global claim0으로 보존. 같은 앱의 HTTP Ask는 두 현재 Evidence를 인용해 SUCCEEDED | PASS |
| v6 UNRESOLVED         | 실제 worker가 Fake의 명시적 UNRESOLVED를 받아 OUTPUT_STORED·job COMPLETED·attempt1·claim1로 종료. positive/negative receipt 및 edge0. HTTP Ask는 직접 자료의 두 근거로 SUCCEEDED. public-only 검색은 private 근거0                                 | PASS |
| 기존 negative 앱 회귀 | 기존 positive→negative의 Ask 이웃 철회, 과거 이력 보존 및 replay 경로를 같은 fixture로 실행                                                                                                                                                        | PASS |

최종 고유 사례 합계는 **3 PASS / FAIL0 / SKIP0**다. 새 두 사례는 각각 약24.2초/22.6초,
기존 negative 회귀는 약31.0초였다. 실제 provider credential은 사용하지 않고
합성 Vault/standing/configuration 및 별도 생성 DB 두 개씩을 사용했다.
Fake transport 외 모든 fetch를 거부하며 각 사례가 egress0을 확인한다.

관계 예산 소진 사례의 replay는 history/source/candidate 정합성을 통과하지만,
관계 대기가 있으므로 `relationQueueComplete=false`, 종합 `matches=false`다.
이를 전체 관계 처리 PASS로 바꾸지 않는다. 직접 자료 질문의 성공이 모든
미평가 관계를 사용하는 종합 추론의 완전성을 뜻하지 않는다.

기존 timeout·skip·assertion·validator·v6/0.9·검색/권한 의미는 완화하지 않았다.
새 테스트는 기존 full application acceptance의180초 범위를 사용한다. Docker
전송은 이전에 검증한 artifact-only Engine API/PG byte relay를 재사용한다.
테스트 대상 namespace/포트/격리 container를 검사하며 운영 DB fallback은 없다.

초기 `database-results.json`의3/3 성공 이후, 예산 대기 원인까지 확인하는
검사를 강화했다. 중간 `boundary-confirmation-results.json`은1 PASS/1 FAIL이다.
초기 PENDING은 worker의 실제 예산 거절 전 관측일 수 있었고, 최종 정식 상태를
PENDING으로 기대한 검사에서 대기 시간이 만료됐다. 기존 `pauseUnstarted`의
계약은 `RETRYABLE`/`RELATION_BUDGET_PAUSED:EXHAUSTED`/1분 후 재시도이며
attempt0과 lease 해제를 보존한다. 테스트를 이 정확한 상태·사유로 보정하고
Ask 후에도 global usage100·local provider call0인지 추가 검사했다.
`final-boundary-results.json`은 강화된 두 사례2/2 PASS다. 운영 코드·timeout을
바꾸지 않았으며 초기 성공과 중간 실패를 덮어쓰거나 반복을 고유 사례 수에 더하지 않았다.

## 4. 오늘 운영 결과의 읽기 전용 대조

별도로 승인된 관계 작업100회는39 DECIDED/61 UNRESOLVED로 끝났고941개가
대기 중이다. 이번 검증은 그 작업을 재호출하지 않는다.

현재 운영 DB의 **주장105개/활성 관계82개**가 원장 독립 재계산과 일치하고
history epoch가 정합하다. 활성 관계82개는 오늘 채택39개나 전체 관계 row97개와
다른 모집단이다. 과거 판단의 최신 pair/version projection을 반영한 값이다.
Frontier membership integrity는 유효하고 pending941/failed0/unknown0이다.

기존 재무 질문3개의 실제 `PostgresVPAskEvidenceSearch`가 현재 SourceVersion의
권한 있는 근거를 반환하고 같은 snapshot의 현재성을 통과했다. 실제 owner
membership/민감도 계약을 사용했으며 공개 민감도만 허용한 검색의 private 근거는0이다.
새 AnswerRun 생성이나 의미 AI 호출은 하지 않았다. 이번 읽기 대조를 새 답변
의미 품질 인증으로 올리지 않는다.

## 5. 현재 남은 경계

- Windows 기존 설치·바로가기·실제 재부팅 인수는 이후 운영 증거에서 PASS다.
  이를 과거 보고서의 미실행 상태로 계속 설명하지 않는다.
- **일반 앱의 AI 자동 활성화 및 새 자료/새 질문 최초 사용 인수는 남아 있다.**
  현재 standing6disabled이고 일반 앱 환경에 global authority 연결 필드가 없다.
  관계 작업을 위해 일회성 captured environment에서 실행한 사실은 일반 앱의
  영구 연결·활성화 완료와 다르다. 운영 설정·standing 변경을 이번 개발 지시로
  자동 실행하지 않는다. 현행0.9/v6, 동일 credential/config/store/authority를
  보존하는 별도 운영 활성화 범위가 필요하다.
- 남은941개를 모두 처리하는 일은 일일100회의 운영 workload다. 모든 개발이나
  직접 원문 질문을 기다리게 하는 새 Gate로 만들지 않는다. 다음 호출은 실제
  authority의 새 UTC 예산일·사용량·미결 reservation을 확인한 뒤에만 가능하다.
- 인증 reference0/인증 정확도 N/A는 공개할 보장 한계이며, 승인된
  [DoD](../definition-of-done.md)에 따라 제품 인수의 자동 차단 사유로 되돌리지 않는다.
  기존 일별 provider export 대조 PASS와 개별 invoice 귀속 미검증도 구별한다.
- pair별 관계 상태 UI, deferred native Desktop Distribution, raw audio/video,
  새 관계 정책의 운영 활성화를 이 검증으로 완료 처리하거나 새로 착수하지 않는다.

## 6. 증거·보존

외부 artifact packet:
`C:/dev/artifacts/vp-full-completion-2026-10-12/post-budget-product-verification-20261017/`.
`database-results.json`은 세 사례의 정식 실행 결과,
`production-projection.json`은 읽기 전용 원장/검색 대조다. 이전 Windows 설치·제품·
재부팅·관계 실행 packet을 덮어쓰지 않는다. 운영 추가 AI 호출/설정 변경0,
Gold-B-7·72/432/B12·B잔여24·stash 보존, push/PR/merge0을 유지한다.
정적·문서 Gate와 격리 자원 정리 결과는 종료 evidence index에 기록한다.
