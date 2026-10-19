# VP 최종 설치본 실AI 인수 및 종결 판정 — 2026-10-19

**현재 판정: `VP_PRODUCT_ACCEPTANCE_PASS / FINAL_CANONICAL_CLOSURE_PENDING`.**

필수 제품 실행은 통과했다. 이 문서 작성 시 최종 종결 문서의 Git 게시·병합은
별도 승인 전이며, [전체 지시 §8](./execution-directive.md#8-완료-판정-기준)의
Canonical 반영 조건까지 완료했다고 미리 선언하지 않는다. 코드·문서가 승인된
exact head로 main에 병합되고 사후 필수 CI가 통과하면 `VP_FINAL_ACCEPTANCE_COMPLETE`
종결 조건을 충족한다. 운영 배포·새 AI 기능 활성화의 승인은 포함하지 않는다.

## 1. 실행 신원과 실제 제품 결과

- 실행 당시 최신 GitHub main: `c0e21c301c25dbc600c2af9ef048c750461b0260`,
  tree `af5d9b200364dfac4c49db9d440d5c706fdbe273`. PR394의 승인 head와 동일 tree이고
  [main CI39108234072](https://github.com/JasonCutter/shotgun/actions/runs/39108234072)의
  Quality·Frontend·Required Gates가 SUCCESS다.
- 실제 Windows 격리 설치의 runtime Git blob881개, lockfile 기반441항목 설치,
  Frontend typecheck/build, bootstrap 도움말을 검증했다. 실제 실행 전 봉인895파일은
  실행 후에도 같은 bytes다. 정상 `.lnk`→launch-local owner→supervised child→
  application/worker/Ask 경로이며 Fake Provider로 대체하지 않았다.
- 전용 바로가기와 격리 DB·assets·포트만 사용했다. 기존 운영 바로가기는 실행하지
  않았다. 자료·질문은 정상 인증/CSRF·frontend product API로 투입했고, 브라우저에서
  빈 공간·현재 답변·과거 답변을 직접 확인했다. 여섯 동작을 모두 브라우저 form으로
  제출했다고 주장하지 않는다. 사용자의 지식 Review·project/source 선택은0회다.

| 순서                  | 실제 관측                                                             | 판정 |
| --------------------- | --------------------------------------------------------------------- | ---- |
| 설치 아이콘→빈 공간   | Sources0, intake/AI/Ask/assertion/relation-call 원장 각각0            | PASS |
| A v1→질문             | 42건, A v1의 exactQuote·SourceVersion·Evidence 인용                   | PASS |
| B 추가→질문           | 42·43을 함께 제시하고 어느 값이 맞는지 임의 확정하지 않음, A/B 인용   | PASS |
| A v2 수정→질문        | 43·44, 현재 A v2와 B 인용, 이전42를 현재 답으로 사용하지 않음         | PASS |
| 과거 A v1 답변 재조회 | SUCCEEDED·42건 원문·citation·capability 보존, stale=true 및 UI 경고   | PASS |
| 현재 답변 재조회      | stale=false, 두 현재 SourceVersion 인용                               | PASS |
| 관계 실행             | 실제 v6 CONTRADICTS/NONE, 선택 확률0.97로 기존0.9 gate 통과; attempt1 | PASS |

새 실 provider HTTP는 **7회 = 추출3 + Ask3 + 관계1**이다. 새 UNKNOWN0, 재호출0,
중복 wire0, 최종 실패0이다. 준비한 기존9회 guard를 변경하지 않았고 승인 상한10회
이하에서 종료했다. 남은 호출을 소진하지 않는다. 총 input4,729/output382/total5,111
토큰을 실제7응답에서 합산했다. configured model은 `deepseek-flash`; 응답별 실제
provider-reported model과 원문 digest는 [기계 판독 증거](./final-acceptance-evidence-2026-10-19.json)에 남긴다.

## 2. 원장·출처·실행 권위의 독립 대조

7개 실제 응답을 저장된 추출 output3·Ask attempt3·관계 output1에 귀속했고,
응답 원문과 저장된 완료 statement의 정확한 문자열·토큰을 대조했다. 세 SourceVersion/
Evidence/quote tuple이 실제 주장·추출 호출과 맞으며, 관계 receipt의 원래 input digest를
SourceVersion·Evidence·claim·원문 context·v6 정책으로 **독립 재계산해 일치**시켰다.

전역 claim `e2333fc3-b40d-4819-b7b8-ebf282f367ca`, job
`b7a762a3-0970-4f66-bc71-3e126f1ee1b9`, semantic attempt
`07b89f0f-31c9-495d-bf57-887aa6819f97`, execution key·local call·provider 응답은
정확히1:1이다. 성공 job은 next_attempt_at/last_failure_code=null이다. v6 positive
receipt의 `provider_call_id`는 기존 nullable 계약대로 NULL이며 직접 FK 연결이
있다고 꾸미지 않는다. 해당 receipt는 고유 project/pair/policy와 위 input digest로
대조했다. 새 Fake-only negative 계약·FK를 v6에 소급 적용하지 않았다.

같은 영속 store `eac263d9-b96c-4a6f-aa95-ef0be89d01e0` /
authority `5773b389-e122-4003-9505-2cf361c07ecc`가 UTC2026-10-19,
기본 일일100·counter0→1·잔량99·미해결 reservation0을 보고했다. 관계1회만
relation counter에 계상되며 나머지 추출/Ask6회는 전체 HTTP 상한에 계상된다.
기존841건 한시 허용은 CLOSED, 새 claim의 temporary_allowance_id는 null이다.
이전 실행의 UNKNOWN1은 그대로 보존하며 이번7회에 섞거나 재호출하지 않는다.

## 3. 재사용한 Gate와 정확한 미검증 범위

[2026-10-18 매트릭스](./final-closure-2026-10-18.md)의 기존 성공·실패 이력은
보존한다. 아래는 현재 종료 판정이며 과거 미실행 상태를 소급 지우지 않는다.

| Gate                      | 판정 근거와 범위                                                                                                                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VP-0 / VP-01·02·원장 권위 | 기존 단일 Ledger·SourceVersion/Evidence·writer·독립 replay PASS 재사용. 오늘 원문/버전/receipt digest·실행 결합을 추가 검증                                                                                            |
| VP-1·2 / VP-03·09·11      | 이번 최종 main의 실제 설치 아이콘→빈 공간→A/B/수정본→실AI 질문 단일 여정 PASS. 사용자 개별 지식 승인0                                                                                                                  |
| VP-3 / VP-05              | 승인된 A1/A2/A3·분모/방향/warrant/채택 분리 및 제품 검증 PASS. 구성한 수치·출처 검증이며 인증 Gold0/모집단 precision·recall·calibration N/A                                                                            |
| VP-4 / VP-04·08·10        | 기존 지원 형식 Golden·원문/locator·URL 갱신/만료·출처/민감도 경계 PASS 재사용. PDF 수식/글리프 fidelity·inline PDF preview 한계, 이미지 생성 관측 UNVERIFIED, audio/video DEFER 유지                                   |
| VP-06·07 / 복구           | 기존 ACK loss·UNKNOWN·중복 방지·PG/worker restart·backup/restore·운영 Windows reboot PASS 재사용. 오늘 새 OS reboot/새 live DB의 독립 full replay는 수행하지 않음                                                      |
| Module·Flow·Product       | 기존 실제 app/worker/Ask·권한 음성·상태 계약의 exact-code 회귀 + 이번 실제 모델 응답/출처/최신성 PASS                                                                                                                  |
| Architecture·OSS          | 기존 ADR172/173·Module/Port·license/lock/security·교체 계약 재사용. 새 production 구현·의존성·runtime 권위·migration 없음                                                                                              |
| 비용·예산                 | 실제7회 사용량/중복 방지/상한·same global authority PASS. 기존 사용자 export의 일별9응답/6,916토큰·보고 비용 대조 PASS는 원래 날짜 범위에서 재사용. 이번7회 실제 청구액과 건별 invoice 귀속·엄밀 adapter latency는 N/A |
| Canonical 종료            | PR394 코드/기존 증거는 Canonical 완료. 이 최종 증거·판정 문서의 별도 게시·exact-head CI·merge 및 사후 CI는 아직 PENDING                                                                                                |

신규 live DB가 정상 정리된 뒤 추가 SQL span snapshot을 읽으려던 보조 관측은
DB-not-found로 불가했다. 이를 product 실패나 span SQL 재검증 PASS로 쓰지 않는다.
저장된 exactQuote·추출 input evidence·SourceVersion tuple과 독립 receipt digest 검증,
기존 같은 구현의 SourceMap/span·replay·권한/복구 회귀를 사용한다. 이 변경·재사용
범위를 공개하고 관측 누락을 메우려고 provider를 재호출하거나 이력을 복원·조작하지 않았다.
새 full replay/reboot를 매 live 예제마다 반복하는 Gate도 추가하지 않는다.

마지막 지시의12개 조건 중1–10과 적용 가능한 제품·안전 Gate는 이 증거 및
기존 PASS 재사용으로 충족한다. 11(Canonical 최종 증거)·12(게시 blocker0)는
게시 승인과 Git/CI readback 뒤 닫는다. 인증 분모0이나 미지원 DEFER만으로 새
사용자 개별 검토·전문가 고용·모델 연구를 만들지 않는다. 현재 발견된 필수 제품/
안전 결함은 없다. 제한을 `COMPLETE_WITH_LIMITS`로 우회하는 판정도 하지 않는다.

## 4. 보존·정리와 실패 이력

운영 DB212개 테이블의 전후 count/SHA-256이 정확히 같다. .env·Vault/config·
standing·운영 checkout9717186c는 바꾸지 않았고 운영 앱/worker를 시작하지 않았다.
기존 PostgreSQL의 조건부 기동과 정상 복구 쓰기는 별도 명시 승인으로 수행했다.
이 서비스는 승인된 기동 상태로 남기고 임의로 운영 DB를 중지하지 않았다.
격리 owner/child·수신 포트는 종료, 소유 workload DB는 snapshot 후 정리,
격리 container는 원래 exited로 복원했다. transport는 성공 종료 STOP latch로 닫았다.

초기 focused harness typecheck의 TS2688은 artifact 밖 type-library 탐색 경로 문제였다.
동일 Node/Vitest 선언을 설치본 경로로 연결한 뒤 PASS했다. 별도 사후 대조기에서
완료 시 null인 partial_text를 완성 답변으로 오인한 오류는 원본 script/실패를
남기고 실제 `frontend_ask.statements`의 정확한 문자열·토큰 대조로 보정했다.
모델 응답·정답·schema·parser·timeout·production 코드나 실험 결과는 바꾸지 않았고,
두 보정으로 추가 provider 호출도 발생하지 않았다.

새 테스트 입력 파일의 마지막 LF는 fixture가 투입 전 제거한다. 파일53byte와 실제
제출52byte의 SHA-256을 별도로 기록했다. 내용·조건·단위를 버리는 normalization이
아니며 실제 model wire/quote와 대조했다. 파일 bytes와 제출 bytes가 같다고 허위 보고하지 않는다.

## 5. 남은 승인과 운영 범위

이 문서·기계 판독 증거·tracker/Master Plan 변경만 Git 검토 대상으로 준비한다.
새 제품 코드나 과거 평가 재채점은 없다. 최종 증거를 별도 승인된 PR로 게시·검토·
병합하고 사후 CI를 확인하면 Canonical 종결을 보고할 수 있다. 이때 실행 release는
계속 위 C0이다. 문서만 바뀐 closing commit을 C0에서 실제 실행했다고 바꿔 쓰지
않으며, runtime881파일/lock/launcher bytes 동일성으로 제품 코드 변경0을 검증한다.
이 문서 게시 때문에 동일 실모델 여정을 자동 반복하지 않는다.

운영 checkout의 새 release 적용·정상 앱 시작은 이번 인수에 포함하지 않는다.
v11/SSC/새 모델, negative 정책의 정상 앱 활성화, 동결72/432/B12·B 잔여24·Gold-B-7,
새 대량 비교·VP 이후 확장 개발은 자동 착수하지 않는다. 이후 제품 개발은 ADR173에
따른 별도 목표로 진행한다. 원시 wire/화면/보존·정리 및 검증 도구는 로컬 sealed packet에,
공개 가능한 합성 답변/인용/응답 identity와 digest는 Git evidence에 남긴다.
