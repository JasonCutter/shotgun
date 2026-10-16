# VP — negative 제품 경계 진단과 새 Canonical Windows 인수

**ISOLATED_CURRENT_CANONICAL_PRODUCT_PASS / NEGATIVE_KNOWLEDGE_CONTRACT_PENDING /
VP_FINAL_ACCEPTANCE_NOT_COMPLETE**

기준은 Canonical `c58ea548b0aa4024f8a9243f4bff7cf941be3ec3`, tree
`586347510571ae32ea4f771c71985696034d567f`다. PR392의 exact-head 및
[main CI38942714053](https://github.com/JasonCutter/shotgun/actions/runs/38942714053)
Quality·Frontend·Required Gates SUCCESS를 재사용한다. 승인 head와 merge tree의
동일성 및 당시 실패·보정 이력은 별도 봉인된 merge packet에 있다.

## 1. 변경 범위와 실제 남은 병목

생산 코드·migration·일반 앱의 v6/0.9·실행/예산 권위는 바꾸지 않았다. 기존 격리
PostgreSQL suite에 진단 한 건을 추가하고 후보 계약 및 진행 이력을 기록했다.

새 진단은 synthetic prior SUPPORTS receipt/edge를 같은 현재 pair에 seed한 뒤
실제 기존 `VPRelationJobWorker`와 global execution 경계로 Fake negative를 완료한다.
기존 Ask의 실제 PostgreSQL 검색 Port를 전후에 호출했다.

| 관측                                        | 실행 전                   | NO_RELATION 완료 후                              |
| ------------------------------------------- | ------------------------- | ------------------------------------------------ |
| 과거 positive receipt/edge                  | 1/1                       | 1/1, 원본 row 불변                               |
| current relation                            | 1                         | 1                                                |
| duplex 질문의 Ask Evidence shortlist        | 2개                       | 같은 2개, 같은 순서                              |
| knowledge epoch                             | 0 (합성 seed의 초기 상태) | 0                                                |
| semantic attempt / global claim / Fake call | 0/0/0                     | 1/1/1                                            |
| 새 실행 결과                                | 없음                      | OUTPUT_STORED / ISOLATED_NO_RELATION / COMPLETED |

합성 seed는 운영 이력이 아니며 SUPPORTS의 의미 정답도 아니다. 이 결과는
**negative가 실행 결과로 보존돼도 현재 지식·Ask는 아직 달라지지 않는다**는
경계의 증명이다. 진단 테스트 PASS를 negative 제품 인수 PASS로 올리지 않는다.
실제 모델의 잘못된 판단 빈도나 자연어 관계 정확도를 계산하지 않았다.

## 2. PostgreSQL·정적 검증

첫 전체 suite는 새 진단의 최초 배치/static import로 **20/20 PASS**였다.
이후 기존19건의 선언 좌표와 byte prefix를 보존하도록 새 진단만 파일 끝에
배치하고 그 안에서 기존 Ask adapter를 import했다. 최종 파일의 snapshot/hash를
먼저 남긴 뒤 다시 전체 **20/20 PASS**, FAIL/SKIP0을 확인했다. 첫 로그도 보존한다.
기존 behavior timeout·assertion·validator·worker 설정을 변경하지 않았다.

Root typecheck, 변경 test ESLint, 문서/ADR/Canonical 검증, 현재 TS6 release 검사와
변경 파일 format 검사 PASS다. 신규 production 함수·TS6 inventory/lineage 변화가
없어 전체 unit/contract/database/TS6 CI를 다시 생성하지 않고 기존 Canonical 증거를
재사용한다. 후보 문서의 후속 검토 보정 뒤 문서/format 검증을 다시 확인한다.

## 3. 다음 최소 계약과 독립 검토

[negative Ledger 제품 연결 후보](../../architecture/add/vp05-evaluation-trust/negative-ledger-product-integration-proposal.md)는
기존 receipt/epoch/history/current projection과 Ask를 재사용한다. call JSON을
current knowledge로 직접 읽는 우회는 제외한다. 새로운 core contract는 아직
승인·구현하지 않았다. 일반 운영 정책 활성화나 신규 실호출도 포함하지 않는다.

독립 AI 코드 검토에서 다음 누락을 발견하고 **후보 문서**에 반영했다.

- Edge가 없는 negative에 필수 receipt/history 연결이 필요함.
- Pair/policy uniqueness상 뒤이은 positive는 새 eligible revision/job이어야 함.
- 현재 lease/current pair 검사는 active-policy commit fence가 아님. 기존 epoch
  owner 아래 scoped binding과 semantic publication guard를 별도로 명시함.
- Migration117의 unresolved-job veto를 receipt-only 재생성으로 잃으면 안 됨.
- 완료된 실험 negative의 자동 승격과 deterministic exact-equivalence 철회 금지.
- Binding guard는 deterministic intake에 적용하지 않음. Binding 변경도 기존
  epoch increment 및 typed history 계약을 지키고 query-scoped Ask 현재성을 보존함.

이는 AI의 설계/코드 검토이며 인간 의미 인증이나 새 Gold가 아니다. 정확한 SQL,
충돌 readback·동시성·rollback·T3/Ask 회귀는 계약 승인 후 구현으로 입증해야 한다.
AGENTS §0 및 전체 실행 지시 §6의 중요한 지식 계약 승인 예외에 따라 별도 질문을
제출했다. 세부 구현 방법 선택이나 개별 reference 검토를 사용자에게 넘기지 않는다.

## 4. 새 Canonical Windows 설치본 제품 검증

이전 d5503922 설치·제품 proof는 재사용하되 source identity를 새 main으로
재명명하지 않았다. c58은 실제 runtime delta가 있으므로 미입증 조합만 실행했다.

- 실제 GitHub c58의 sparse runtime **878개 Git blob**을 대조하고 새 npm 설치,
  bootstrap 도움말, Frontend typecheck/build, clean tracked tree를 확인했다.
- 설치본의 정상 `scripts/launch-local.ts`→preflight→SPA/schema→application 및
  Source/Ask/relation workers로 A v1/B v1/A v2와 질문3을 수행했다.
- HTTP54, Fake7(추출3/답변3/관계1), 구조화 요청7, owner2/child3을 관측했다.
- 과거 답변 stale=true, 현재 답변 stale=false 및 최신 A/B 인용을 확인했다.
  과거 원문·citation, raw span·scope/sensitivity, 재시작 후 rows를 보존했다.
- Claim/job/attempt/execution/provider의 실제 1:1 binding과 미해결 reservation0,
  completed 호출의 중복0, 사용자 project/Source/개별 Review 선택0을 확인했다.
- 생성 DB2개·소유 프로세스·runtime identity를 정리했다. 부모 작업도 연결을
  종료한 뒤 isolated DB client0을 확인하고 기존 격리 container를 다시 정지했다.
  운영 PostgreSQL2개는 계속 exited다.

Exact identity 예: claim `26e657e2-0f08-403d-a239-c43f11848213`, job
`eb858b59-a2f6-4e16-97d5-cf33992cc60e`, attempt
`53879f84-0355-4e2c-9f89-bccfa12caf63`, provider call
`ed7cdb7e-9fad-419a-9ac7-c00621ca20b7`. 전부 생성 test DB와 synthetic authority의
Fake 기록이며 운영 authority 또는 실제 AI call이 아니다.

Source878 digest는 `b41be152c9473c8d0c77f88f8994732d6fb5754d96491b6fd487214037b45d1d`다.
Install packet index는 `7d95fc582ec3e2730149d328b0623129984dfc63c77854b7093ad996b407297e`,
product packet index는 `5b34b078dddbe2ffc946a12bc1aee72b23cf377b74f21e508244f9b371a80cce`다.
첫 product seal의 과거 install/product index 혼동은 auditor 실패로 보존하고
정확한 두 index를 대조해 보정했다. 제품 테스트 재실행이나 assertion 완화는 없다.

## 5. 재사용·한계·다음 경계

**AUGMENT** 기존 Shotgun test fixture/PG bridge/normal launcher·supervisor·Fake
hook·Ask search Port다. 기존 exact-pin OSS 검토와 제외 경계는 후보 계약 §7에서
참조한다. 새 runtime/dependency/installer/knowledge authority는 채택하지 않았다.
Migration/운영 rollback은 없으며 진단과 후보 문서만 revert할 수 있다.

새 Windows proof는 preload Fake adapter와 loopback 요청의 격리 증거다. 실제 AI
의미 정확도·청구·provider HTTP wire, 운영 icon·OS reboot를 인증하지 않는다.
운영 main23be/schema130에서 새 Canonical/schema131–139로의 전환은 별도 exact
release·백업·quiescence·설정/worker 승인 전까지 HOLD다. 기존 실제 AI10회 한도는
소진 상태로 보존하며 추가 실호출은0이다.

[별도 Desktop Distribution](../deferred-windows-desktop-distribution.md)의 독립창/
설치 package와 현재 PowerShell/browser launcher는 다른 범위다. 그 단계의 명시적
활성화 조건을 지우거나 현재 proof를 Setup.exe 완료로 계산하지 않는다.

Raw evidence는 `C:/dev/artifacts/vp-full-completion-2026-10-12/` 아래
`negative-product-preparation-20261017`, `windows-canonical-c58ea548-20261017`,
`windows-product-c58ea548-20261017`에 보존한다. Source와 실행 snapshot·로그·명령 및
정리 readback을 구분한다. 72/432/B12·B 잔여24·Gold-B-7·stash·운영 설정은 유지한다.
계약 승인을 기다리는 동안 이미 가능한 격리 설치 검증을 완료했으며, 미승인
지식 계약 구현이나 운영 전환을 자동으로 시작하지 않는다.
