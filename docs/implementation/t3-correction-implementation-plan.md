# T3 수정 구현계획서

> - 상태: **PROPOSED — 구현 전 검토용**
> - 기준선: `origin/main@5d351ecc71f96f9b22403475bb14e049f2e94581`
> - 작성일: 2026-09-23
> - 범위: TS-6 감사 권위, Source 및 파생 데이터 정리, 실제 제품 경로 인수 검증

## 1. 목적과 권한

T3는 The Second(TS-0~TS-7)의 역사적 완료 기록을 소급해서 다시 쓰는 프로젝트가 아니다. 이후 점검에서 확인된 **감사 증거의 정합성**, **프로젝트를 보존하는 Source 정리 기능의 부재**, **TS-7 자동 인수 검증과 실제 검증 범위의 차이**를 각각 수정하고 하나의 최종 제품 검증으로 묶는다.

이 문서는 구현 순서와 완료 기준을 제안한다. 문서 병합만으로 T3의 설계 결정이나 제품 변경이 승인·완료되지는 않는다. 구현 시점의 `origin/main`이 전진했다면 T3-0에서 기준선을 다시 확인한다.

### 1.1 우선하는 경계

1. Canonical·Evidence·Approval·Claim/Fact·Action 안전 경계와 관련 ADD·ADR
2. Module Architecture의 Port·Adapter·데이터 소유권
3. 검증된 OSS의 재사용 가능성과 OSS Integration Gate
4. 이 계획서의 작업 순서와 구현 제안

특히 `docs/architecture/module-architecture/shotgun-module-architecture-add.md`, `docs/architecture/module-architecture/open-source-role-matrix.md`, `docs/implementation/definition-of-done.md`, ADR-170 및 관련 Source·History·Canonical ADR을 각 작업의 시작점으로 사용한다. Source 삭제가 불변 원본·History·Canonical 승인 결정과 충돌하는 부분은 **새 ADR에서 해결한 뒤 구현**한다.

### 1.2 사용자 결과

- JasonMemo를 포함한 프로젝트 identity, 로그인 계정·세션 정책, AI Provider·모델·비밀정보·승인 설정은 유지한다.
- 사용자가 지정한 Source 또는 프로젝트의 모든 Source와 그 자료에서 파생된 제품 콘텐츠를 정리할 수 있다.
- 정리 뒤 Library·Search·Ask·Citation·Review·Projection·History payload 및 재시작 후 조회에서 해당 자료가 다시 나타나지 않는다.
- Source와 공유되지 않는 원본 CAS 객체는 안전한 GC 절차를 거쳐 제거한다. 다른 Source가 참조하는 객체는 보존한다.
- T3의 완료 주장은 실제 제품 경로, 영속성 readback, 장애·재시도 증거와 통과한 CI로 재현된다.

## 2. 기준선과 확인된 문제

| ID   | 현재 관찰                                                                                                                                                                                    | T3에서 고칠 것                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| T3-A | TS-6 v6/v7 재생성 스크립트가 문자열 `derivedFrom`을 객체로 펼쳐 숫자 키를 만들었다. v7에서는 71/113 boundary와 caller의 증거 ID가 다르고 일부 caller ID는 증거 목록에 없다.                  | 손상된 계보·관계 데이터를 정정하고 생성기·검증기에 재발 방지 검사를 둔다.           |
| T3-B | TS-6의 상세 감사 테스트 37개가 `test:ci`에 포함되지 않고, 일부 verifier 조건은 현재 데이터에서 실질적으로 실패할 수 없다. 96 PROVEN 중 79개는 실제 배선 확인이 아닌 단일 Port 구현 추론이다. | 독립적인 변조·음성 검증을 CI에 배선하고 증거 등급과 문구를 실제 검증 범위에 맞춘다. |
| T3-C | 저장된 Source를 삭제하는 Product API·UI가 없다. 웹의 Remove는 제출 전 draft만 제거한다.                                                                                                      | Project identity·Auth·AI Settings를 보존하는 Source 정리 계약·제품 경로를 만든다.   |
| T3-D | 미추적 TS-7 계약 테스트는 제품 객체를 자체 구성하며 타입 오류 23개를 낸다. DB 테스트는 일부 임의 행과 모의 함수를 검사하므로 Source→Ask 전체 경로를 자동 재현하지 않는다.                    | 실제 Assembly/Product API와 격리된 DB를 통과하는 인수 테스트로 교체한다.            |
| T3-E | 로컬 작업 트리의 타입·lint·서식 게이트가 실패하고 단위 테스트 두 건은 전체 병렬 실행에서 5초 제한에 걸린다. 문서·해시 매니페스트 일부가 현재 상태와 다르다.                                  | 기준선과 미추적 자료의 영향을 분리하고 관련 게이트·문서를 정리한다.                 |

TS-7 번들에는 실제 데스크톱 실행과 DB readback을 기록한 별도 자료가 있다. T3-D는 **그 실행 자체를 부정하지 않는다.** 수동 기록과 자동 테스트가 각각 무엇을 증명하는지 정확하게 분리한다. 미추적 자료는 사용자의 별도 정리 지시 없이 이동·삭제하지 않는다.

### 2.1 이전 감사 보고서의 채택 판정

두 외부 보고서는 결함 후보와 근거로 사용한다. 보고서의 우선순위·구현 지시를 자동으로 채택하지 않고 T3-0에서 clean baseline과 실제 제품 경로로 다시 확인한다.

| 보고서 지적                                                                                                               | 판정                      | 반영 위치·처리                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| TS-6 `derivedFrom` 문자열 손상(D1), boundary/caller 증거 불일치(D5)                                                       | **채택**                  | T3-1에서 계보 재생성, 관계 정합화 및 음성 검증.                                                                                |
| 37개 감사 테스트 CI 누락, 실패 불가능한 verifier, 무효 변이 테스트, 지원되지 않는 `DELEGATE_PATH`·`PARTICIPANT_ATOMICITY` | **채택**                  | T3-1에서 테스트 실행 경로와 resolver 계약을 실제 실패 사례로 검증.                                                             |
| 단일 Port 구현을 production 배선으로 간주한 79개 PROVEN, `literalPortBindings`의 반환되지 않는 객체 수집                  | **채택**                  | T3-1에서 증거 등급을 구분하고 composition 연결 또는 별도 증거로 확인.                                                          |
| v6의 5/4 status move 불일치(D2), 옛 PROVEN reason(D3), 고아 evidence(D4), 상속된 `baseSha`(D9)                            | **채택**                  | T3-1에서 원본 수치·의미를 재계산하고 새 정정 lineage에 반영.                                                                   |
| stale SHA manifest(D10), v6를 현재로 가리키는 문서(D8), 반대 의미의 주석(D12), 깨진 주석 문자(D11)                        | **채택 — 증거·문서 정리** | T3-1 및 T3-5에서 실제 blob/hash와 현재 권위를 맞추되 역사 파일은 보존.                                                         |
| crosswalk의 과거 100/13을 현재 96/17로 직접 교체하자는 권고(D7)                                                           | **방식 수정 후 채택**     | 과거 crosswalk는 frozen으로 보존하고 현재 권위 96/17을 검증하는 별도 비교·게이트를 추가.                                       |
| TS-7 미추적 테스트의 타입 오류와 자체 구성·모의 assertions                                                                | **채택**                  | T3-0에서 로컬/추적 트리 영향 분리, T3-4에서 실제 제품 경로 테스트로 교체.                                                      |
| 단위 테스트 CSV 5초 timeout, Prettier 불일치                                                                              | **채택**                  | T3-0에서 전체 실행 부하와 추적 여부를 재현, T3-5에서 원인에 맞춰 수정. 특정 15초 제한을 근거 없이 일괄 적용하지 않음.          |
| Windows launcher의 `process.kill`이 자식 트리를 남긴다는 주장                                                             | **증명 전 보류**          | 실제 desktop 재시작에서 고아 프로세스·포트 잔류를 재현하면 T3-5에 포함. `taskkill /T /F`는 대상 확인·종료 부작용 검증 뒤 결정. |
| TS-6 스크립트의 폴더 이동·아카이빙                                                                                        | **후순위**                | 재생성 경로·해시 참조·CI를 깨지 않는다는 증거가 있을 때만 수행. 기능·증거 복구의 완료 조건으로 삼지 않음.                      |
| 과거 v3/v4에 현재 validator를 소급 적용해 무효 처리하자는 해석                                                            | **채택하지 않음**         | 당시 규칙의 역사 snapshot으로 남기고 현재 배포 기준과 분리해 표시.                                                             |

## 3. 범위와 비범위

### 범위

1. TS-6 감사 lineage, boundary↔caller↔regression evidence, reachability 등급, verifier 및 CI.
2. Source 단위와 프로젝트 내 모든 Source 단위의 콘텐츠 정리. Project·Auth·AI Settings는 보존.
3. Source에서 직접 또는 간접 파생된 Evidence·Candidate·Review·Canonical·Projection·Discovery·Ask·Citation·History payload의 영향 판정과 정리.
4. 실제 Product 경로 인수 테스트, 데스크톱 재시작 검증, 문서와 CI의 완료 판정 정합화.

### 비범위

- 프로젝트 자체 삭제, 계정 재생성, AI 설정 초기화.
- AI 결과를 승인 없이 Canonical에 자동 반영하거나 기존 승인 의미를 약화하는 변경.
- TS-0~TS-7의 과거 Issue closure와 frozen 증거 파일을 조용히 덮어쓰기.
- 결함 증거가 없는 별도 리팩터링, 새 런타임 또는 중복 DB·OSS 도입.

## 4. 작업 패키지와 의존 순서

### T3-0 — 기준선·결정 기록 고정

**산출물**

- 최신 `origin/main` SHA, clean checkout, 로컬 미추적 TS-7 자료의 목록·해시·소유 상태.
- `typecheck`, `lint`, `format:check`, unit/contract/integration/architecture/frontend/database, TS-6 verifier의 재현 결과를 **추적 트리와 로컬 미추적 자료**로 구분한 표.
- 세 과제의 결함→코드·테스트·문서 근거 표와 별도 작업 Issue. TS 이슈는 역사 기록으로 남긴다.
- 관련 ADD·ADR와 OSS 후보·기존 Shotgun Port의 검토 기록. 후보별 `ADOPT`/`EXTRACT`/`AUGMENT`/`REFERENCE_ONLY`/`DEFER`/`REJECT` 또는 근거 있는 `NO_RELEVANT_OSS`를 구현 전에 결정한다.

**통과 조건:** 재현 가능한 기준선과 오염되지 않은 테스트 환경이 준비되고, T3-A~E가 누락 없이 작업에 배정된다.

### T3-1 — TS-6 감사 권위 정정

**구현 순서**

1. v2 frozen crosswalk와 v3~v7 기존 파일의 byte hash를 먼저 기록한다. 과거 `100/13` 수치를 현재 `96/17`로 덮어쓰지 않는다.
2. 문자열 `derivedFrom`을 객체로 펼치는 두 재생성 스크립트를 수정하고, 입력 형태·계보 대상·재생성 결정성을 검증한다.
3. v6/v7의 문제를 명시한 **새 정정 lineage**를 생성한다. 이미 공개된 역사 파일을 수정해야 한다면 별도의 변경 근거와 이전·이후 hash를 남기고 승인된 방식을 따른다.
4. boundary와 caller 관계의 단일 권위 또는 명시적 동기화 규칙을 정한다. 모든 ID의 존재, 역참조, `covers`의 비공백·상호 일치, 고아 증거 부재를 검사한다.
5. `REVIEW_REQUIRED`·PROVEN·inventory 검사에 독립 입력과 실패 가능한 음성 사례를 둔다. 단일 Port 구현 추론은 실제 composition 배선이 확인되지 않으면 별도 증거 등급으로 표시한다. `literalPortBindings`는 반환되지 않는 객체를 배선으로 오인하지 않도록 검증한다.
6. `scripts/ts6-audit` 상세 테스트를 CI에 포함하고 mutation/no-op 변이가 실제로 실패하는지 확인한다. stale 해시 매니페스트와 현재 상태 문서를 갱신한다.

**통과 조건:** 새 lineage를 원본 소스로 재생성하면 byte 동일하고, 불일치 ID·고아 관계·잘못된 Port 배선·no-op 변이를 각각 독립 검사에서 거부한다. CI가 상세 감사 테스트를 실행하며 frozen 역사 기록을 보존한다.

### T3-2 — Source 정리 정책·ADR·데이터 지도

**선행 설계 결정**

- “삭제”의 단위: Source 하나, 선택한 Source 집합, 프로젝트의 모든 Source. 모두 동일한 서버 권위의 command를 사용한다.
- 원본·파생물·불변 History의 의미: **콘텐츠와 개인 자료는 제품 및 활성 저장소에서 제거**하되, 감사상 필요한 최소 identity tombstone을 남길 수 있는지 ADR에서 결정한다. tombstone에는 원문·제목·파일명·URL·프롬프트·인용문 등 Source 콘텐츠를 담지 않는다.
- 독립 근거를 공유하는 Canonical Claim/Fact, 다른 Source가 참조하는 CAS 객체, Source를 포함한 Ask 대화 등 다중 출처 상태의 판정 규칙.
- 승인된 Canonical 내용을 폐기·수정해야 할 경우 기존 Review/Approval/Canonical Write 권한을 거치는 방법. 영향이 모호하면 실행을 차단하고 소유자에게 영향 목록을 제시한다.
- 백업의 보존·만료, 복원 시 purge tombstone 재적용, 암호화된 비밀정보와 로그·내보내기의 잔존 범위. 보장할 수 없는 저장 영역은 완료 보고에 명시한다.

**데이터 지도:** Source ID와 Project ID를 따라 intake, asset/CAS, transform, evidence, generation, candidate, validation, comparison, review, canonical, projection/search/graph, discovery, Ask, History/Audit, command ledger, 임시 staging, 백업까지 **테이블·파일·캐시별 owner·참조 방향·정리 방식·재구성 방식**을 기록한다. 직접 DB 연쇄 삭제를 기본 구현으로 삼지 않는다.

**통과 조건:** ADR과 데이터 지도가 Canonical·History 불변성 및 사용자의 전체 Source 콘텐츠 정리 요구를 동시에 설명하고, 보존 대상 Project/Auth/AI Settings를 명시한다. 기존 Port·CAS GC·Product UI 패턴의 재사용 결정이 기록된다.

### T3-3 — Source 정리 제품 구현

**계약과 제품 흐름**

1. Project Owner 권한, CSRF, Project scope, 대상 집합, 예상 revision·digest, idempotency key를 포함한 preview/confirm command.
2. Preview는 삭제 대상 및 공유·독립 출처·승인된 Canonical 영향과 복구 제한을 표시한다. Confirm은 preview의 고정된 digest를 소비한다.
3. 요청 접수 즉시 해당 Source의 새 처리·검색 노출·AI 재생성을 차단한다. 동시 Job·lease·outcome-unknown과 경합하면 안전하게 대기 또는 실패하고, 같은 command 재시도는 하나의 결과에 수렴한다.
4. 각 owner 모듈의 Port 또는 명시적인 Application Coordinator로 파생물과 민감 payload를 정리한다. Canonical 변경은 정해진 승인·commit 경로를 통과하고, Projection은 watermark를 따라 재구성한다.
5. 공유 CAS 객체는 다른 live 참조가 없는 것을 확인한 뒤 ADR-170의 grace→quarantine→재확인→최종 삭제 흐름에 맡긴다. 실패 시 즉시 파일을 삭제하거나 전체 Project를 초기화하지 않는다.
6. Library에서 저장된 Source의 정리·진행·실패·완료를 표시하고 프로젝트 전체 Source 정리도 제공한다. 계정·프로젝트·AI 설정 화면과 값은 유지한다.

**통과 조건:** 정상·중복·중단·재시작·부분 실패·권한 거부·stale preview·공유 CAS·공유 Claim을 포함한 Contract/DB/Product/보안 음성 테스트가 통과한다. Library, Search, Ask, Citation, Review, Projection 및 민감 History payload의 정리 결과가 DB와 UI에서 일치하고, Project/Auth/AI Settings의 전후 snapshot이 동일하다.

### T3-4 — 실제 경로 자동 인수 검증

1. 기존 미추적 TS-7 테스트의 타입·lint 오류를 해결한다. 자체 생성한 계약 객체·가짜 처리 함수를 전체 제품 증거로 세지 않는다.
2. 격리된 `shotgun_test`에서 실제 Assembly/Product API로 Source 제출→Transformation/Evidence→Candidate→Review/Approval→Canonical→Projection→Ask/Citation을 실행한다. 불안정한 외부 공급자 호출은 Port 뒤의 결정적 Adapter로 격리하되 제품 orchestration·권한·DB 경계는 실제로 통과한다.
3. 같은 Source·Evidence·Claim·Answer ID를 전 단계와 재시작 후 readback으로 대조한다. 실패 주입은 실제 worker, lease, URL 취득, CAS GC, Postgres transaction 경계에 연결한다.
4. T3-3 정리 후 동일 경로에서 Source 및 파생 콘텐츠가 보이지 않고, 보존 대상 설정이 유지되는지 검증한다. 새 Source를 다시 제출해 처음 사용자처럼 정상 동작하는지도 확인한다.
5. 수동 데스크톱 검증은 자동 테스트와 별도 증거로 남긴다. 테스트별 “실제로 호출한 제품 경로”와 “모의한 외부 경계”를 기록한다.

**통과 조건:** 클린 체크아웃에서 TS-7 및 T3 테스트가 타입 검사와 CI에 포함되고, 실제 경로·재시작·정리·재사용이 재현된다. 기존 TS-7 기록은 역사 증거로 보존하되 자동 증거로 과장하지 않는다.

### T3-5 — 통합·운영 완료 판정

- Module·Flow·Product·Architecture·OSS Integration Gate를 각각 판정한다.
- lint, format, typecheck, unit, contract, integration, architecture, frontend, database, OSS, secret scan, TS-6 audit과 최종 인수 검증을 **동일 exact head**에서 실행한다. 단위 테스트 시간 초과는 임의의 전역 제한 상향 대신 원인·부하 재현 결과에 맞춰 수정한다.
- migration 전·후, 중도 실패, rollback, 백업 복원과 purge 재적용을 연습한다. CAS의 물리 삭제는 quarantine 기간 전까지 완료로 주장하지 않는다.
- PR merge 후 `main` CI와 실제 데스크톱 실행을 확인하고, 미해결 제한을 명시한다.

**T3 완료 조건:** 세 수정 과제의 개별 증거와 통합 증거가 모두 통과하고, 설정 보존·콘텐츠 부재·새 Source 정상 사용을 실제 제품에서 확인한다. 실패한 Gate를 `COMPLETE_WITH_LIMITS`로 우회하지 않는다.

## 5. 검증 매트릭스

| 시나리오           | 필수 관찰                                                               |
| ------------------ | ----------------------------------------------------------------------- |
| 감사 산출물 재생성 | 동일 입력에서 동일 hash; 누락·오염 관계를 거부                          |
| verifier 변조      | 잘못된 계보, 고아 증거, 무배선 Port, no-op 음성 사례에 비영 exit        |
| 단일 Source 정리   | 선택한 Source의 콘텐츠·파생물만 사라지고 독립 Source·공유 CAS 유지      |
| 전체 Source 정리   | Library/Search/Ask/Projection/History payload에서 과거 콘텐츠 부재      |
| 보존 경계          | Project ID/이름, Principal, Membership, AI 설정·비밀정보의 전후 값 동일 |
| Canonical 영향     | 독립 근거 보존, 단독 근거 폐기에는 고정된 승인과 History 기록           |
| 동시성·재시도      | 중복 command, 작업 중 lease, crash, COMMIT ack loss 후 단일 결과        |
| 재시작·복원        | 종료/재시작 후에도 삭제 상태 유지; 백업 복원 뒤 재등장 방지 절차 통과   |
| 재사용             | 동일 프로젝트에서 새 Source 제출부터 인용 답변까지 성공                 |

## 6. PR·Issue 및 변경 관리

- 부모 추적 Issue 1개와 T3-0~T3-5의 검증 가능한 작업 Issue를 만든다. 부모 Issue는 세 수정 과제와 최종 Gate만 집계한다.
- 구현 PR은 **감사 권위**, **Source 정리 ADR/계약**, **Source 정리 구현**, **자동 인수 검증**, **최종 게이트**로 분리한다. 선행 ADR 없이 Source 데이터 migration을 병합하지 않는다.
- 각 PR에 기준 commit, 변경·제외 범위, OSS Integration Decision, Contract/Golden/Security/Replacement 결과, migration·rollback, 전후 증거를 기록한다.
- 기존 TS-6/TS-7 Issue와 closure를 다시 열거나 기록을 고치지 않는다. 필요한 정정은 T3 Issue와 새 lineage·증거로 연결한다.

## 7. 완료 전 확인할 결정

1. Source 콘텐츠와 최소 감사 tombstone의 구체적 경계.
2. 공유 출처 Claim과 이미 승인된 Canonical 내용을 정리할 때 사용자에게 제시할 영향·승인 방식.
3. 백업·내보내기·외부 공급자 보유 데이터의 삭제 보장 범위와 기간.
4. v6/v7 역사 파일 보존과 새 정정 lineage의 파일명·버전.

이 네 결정은 T3-2와 T3-1의 ADR·증거 검토로 해결한다. 결정을 미뤄 둔 상태에서 “모든 파생물 삭제” 또는 “감사 완료”라고 보고하지 않는다.
