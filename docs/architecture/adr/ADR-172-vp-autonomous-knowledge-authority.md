# ADR-172 — VP 자동 지식 권위와 두 동작 제품 계약

> 상태: **ACCEPTED · 단계별 구현 진행 중**  
> 코드명: 뱀파이어(VP)  
> 기준: `main@8e07074a73cb9fa062316a10ebd236d9b2cad850`, 2026-09-25  
> 실행 계획: [VP 구현계획](../../implementation/vp-vampire-implementation-plan.md)

## 1. 제품 계약과 결정

일상 사용에서 사용자가 하는 일은 **자료 투입**과 **투입된 자료에 관한 질문** 두 가지다. 후보 선택, 시맨틱 비교 실행, `ADD_CLAIM`/`NO_OP`, Review 승인, 소스 수동 선택, 실패한 Job 재시도는 이 흐름의 필수 동작이 아니다. 진행·근거·충돌·실패 상태를 확인할 수는 있지만, 확인을 지식 처리의 승인으로 해석하지 않는다.

VP는 원문에 근거한 자동 지식 기록을 Shotgun의 **유일한 활성 지식 권위**로 정의한다. 원본·원문 위치·버전은 불변으로 보존하고, 추출 주장과 의미 관계는 출처·시점·모델/정책 버전을 가진 기록으로 추가한다. 현재 지식 화면과 질문 검색은 이 기록에서 재생성 가능한 읽기 모델이다. AI의 출력, Jev의 확률, 벡터 유사도는 단독으로 객관적 진실이 되지 않는다.

VP는 승인형 Canonical 쓰기 계약을 **대체**한다. VP Knowledge Ledger가 자동 지식 원장을 소유하고, 원문 근거·버전·정책 검증을 통과한 시스템 결정을 기록한다. 자료 투입 후 일반 지식 처리에서 Review→Approval→Canonical 경로는 호출하지 않는다. 기존 승인형 Canonical/Approval/History는 migration과 감사에 필요한 역사 자료로 보존하지만, 프로젝트 VP 전환 완료 후에는 현재 지식의 병렬 권위가 아니다. 새 주장과 관계의 활성 읽기 권위는 VP Ledger 하나뿐이다.

## 2. 기존 결정과의 관계

사용자는 VP를 Shotgun 리뉴얼의 최우선 제품 결정으로 지정하고, 이를 방해하는 이전 프로젝트 제약을 대체하도록 지시했다. 따라서 현행 Module Architecture ADD, Implementation README/DoD, ADR-085·086·135·160·163의 **사용자 승인형 지식 반영, 미승인 Candidate 금지, Canonical-only Ask, 승인 지식만 의미 검색** 규칙은 VP의 활성 지식 경로에 적용하지 않는다. 구현 착수 전 이 ADR과 관련 ADD·DoD·Role Matrix·API 계약을 VP 권위에 맞춰 개정한다. 기존 문서는 역사적 동작과 데이터 해석의 근거로만 남긴다.

VP의 사용자 동작을 늘리던 설정·승인 제약은 제거하거나 배포 시 한 번의 시스템 설정으로 흡수한다. 프로젝트 간 접근 격리, 원문 무결성, 비밀 유출 방지, 외부로 실제 쓰기를 수행하는 Action 권한은 지식을 안전하게 처리하기 위한 불변 조건으로 둔다. 이는 이전 승인 UX의 존속이 아니라 VP 자체의 데이터 보호 계약이다. 허용된 AI 제공자가 없거나 개인정보 경계가 충족되지 않으면 자료별 승인 창을 띄우지 않고, 로컬/인가된 대체 경로 또는 설명 가능한 처리 불가 상태로 끝낸다.

## 3. 소유권과 데이터 의미

| 자원                                                                    | 소유자                           | 불변 또는 갱신 규칙                                                                                                                           |
| ----------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `Source`, `SourceVersion`, `OriginalAsset`, `SourceMap`, `EvidenceSpan` | 기존 Intake·Asset·Evidence owner | 기존 stable ID와 원문 바이트·위치를 유지. 새 내용은 새 버전으로 추가                                                                          |
| `VPAssertion`                                                           | VP Knowledge Ledger owner        | 하나의 원자적 주장. `DIRECT_SOURCE`, `DERIVED`, `HYPOTHESIS`를 구분하고 원문 근거 또는 상위 주장 계보를 필수로 기록                           |
| `VPRelation`                                                            | VP Knowledge Ledger owner        | `EQUIVALENT`, `SUPPORTS`, `QUALIFIES`, `CONTRADICTS`, `SUPERSEDES`, `RELATED`. 관계의 양쪽 ID, 적용 조건·시간, 결정 근거를 기록               |
| `VPDecisionReceipt`                                                     | VP Decision owner                | 규칙/Jev/일반 AI 중 누가 무엇을 판단했는지, 입력 digest, provider/model/prompt/policy 버전, 비용, 결과, 불확실성을 기록. 권위의 대체물이 아님 |
| `VPCurrentKnowledge`                                                    | VP Projection owner              | 활성 SourceVersion, 주장·관계·시간 조건으로 재생성. 덮어쓰기 가능한 projection이며 역사 원장이 아님                                           |
| `VPAnswer`                                                              | Ask owner                        | 사용한 지식 epoch와 SourceVersion·EvidenceSpan, 추론 여부, 충돌·최신성 상태를 인용과 함께 보존                                                |

`Claim`과 `Fact`는 구별한다. 자료에 적힌 문장은 우선 **그 자료가 주장한 내용**이다. 여러 자료의 합의나 모델 확률만으로 객관적 Fact가 되지 않는다. 복수 출처가 다르면 양쪽 주장과 적용 시점을 보존한다. `DERIVED`는 어떤 근거·추론으로 도출됐는지 답변에서 구별하며, 원문 직접 진술로 위장하지 않는다. 근거 없이 새 사실을 외부 지식으로 채우지 않는다.

## 4. 자동 처리 파이프라인

1. **투입:** 파일 한 번 제출. 시스템이 형식·크기·권한·해시를 검증하고 원본/SourceVersion을 고정한다. 같은 바이트와 같은 프로젝트 범위의 완전 중복은 idempotent 재사용한다. 서로 다른 출처의 같은 문장은 출처를 합쳐 보존하며 삭제하지 않는다.
2. **변환·근거:** 기존 Stage 3의 DocumentIR, SourceMap, EvidenceSpan을 재사용한다. 처리 완료 전 SourceVersion은 질문의 최신 근거로 광고하지 않는다.
3. **주장 분해:** 생성형 모델은 원문에 직접 명시된 원자적 주장만 추출한다. 문장 하나에 여러 주장·조건·예외·시간이 있으면 분리한다. 검증기는 모든 직접 주장을 정확한 EvidenceSpan에 연결한다.
4. **비교·통합:** 정확한 ID/해시/문자열 비교는 결정적 코드가 처리한다. 인가된 검색이 비교 후보를 좁힌다. Jev는 관련성·동일 의미·보완·충돌 가능성·추가 분석 필요 여부처럼 닫힌 선택지의 빠른 확률적 분류를 맡는다. 모호한 조건·수량·인과·시간·복수 문장 추론은 일반 AI가 분석한다. 최종 분기와 저장 자격은 Shotgun의 versioned policy가 결정한다.
5. **기록:** 충분한 직접 근거와 정책 검증을 통과한 주장·관계만 VP Ledger에 추가한다. 불확실한 관계는 `UNRESOLVED`로 남기며 임의의 `EQUIVALENT`나 `NO_OP`으로 축소하지 않는다. 모델 장애나 비용 한도 도달은 재시도/미해결 상태로 남긴다.
6. **투영·발전:** 바뀐 SourceVersion과 영향을 받는 주장·관계만 재계산한다. 새 자료·자료 버전·연동 출처 갱신·모델/정책 개정·질문에서 발견한 근거 공백·주기적 미해결 재평가가 자동 재처리의 트리거다. 새 근거가 없다면 관계·요약을 개선할 수는 있어도 새로운 직접 사실을 만들지 않는다. 삭제·수정된 원문의 과거 계보는 남기고 활성 읽기 모델에서는 최신성 규칙에 맞춰 제외한다. 전체 재생성과 증분 재생성의 활성 결과가 같아야 한다.
7. **질문:** 기본 범위는 해당 프로젝트의 접근 가능한 모든 활성 자료와 VP 지식이다. 서버가 SourceVersion을 고정하고 근거를 검색한다. 생성형 모델이 답변을 쓰며, 시스템이 사실 문장의 인용·권한·버전·충돌 상태를 확인한다. 답이 없으면 `근거 없음`, 새 자료 처리 중이면 `처리 중`, 충돌하면 양쪽 근거와 시점을 제시한다.

## 5. Jev와 모델 분기 계약

`DecisionProviderPort@1.0.0`의 입력은 최소 `project/security scope`, `task kind`, 고정한 SourceVersion·Evidence/주장 ID, 텍스트 digest, 허용 선택지, provider/model/policy revision, 비용·시간 예산을 가진다. 출력은 선택지·분포·확률·usage·request identity다. 브라우저가 모델, 민감도, 정책, 최종 저장 동작을 지정할 수 없다.

우선순위는 **결정적 규칙 → Jev의 짧은 의미 판단 → 일반 AI의 심층 분석 → 근거 부족/미해결**이다. Jev를 `참/거짓`의 세계 지식 판사로 사용하지 않는다. 질문은 “이 원문이 이 주장을 직접 지지하는가?”, “고정된 두 주장이 같은 범위·시점에서 같은 뜻인가?”처럼 주어진 근거와 범위를 포함한다. Jev의 확률은 현장 Golden Corpus로 보정한 작업별 분기에만 사용하며, 보편적인 `0.97` 임계값을 설계 상수로 두지 않는다. Jev가 외부로 보낼 수 없는 자료, API 장애 또는 품질 Gate 실패는 인가된 일반 AI/결정적 경로로 대체하거나 미해결로 남긴다. 확률만으로 원장 변경을 무검증 실행하지 않는다.

Jev는 문장 생성기가 아니므로 주장 문장 추출, 복합 추론 서술, 사용자 답변 작성은 일반 AI가 담당한다. 외부 제공자 데이터 정책·로그·비용 상한은 기존 provider 정책에 포함되어야 한다.

## 6. 최신성·불확실성·실패 의미

`latest`는 **Shotgun이 확인한 최신 SourceVersion과 처리 watermark 기준**이다. 업로드가 처리 중이거나 projection watermark가 새 SourceVersion보다 뒤처지면 최신인 척 답하지 않는다. 질문은 제한 시간 동안 완료를 기다리거나 `처리 중` 상태를 반환한다. 외부 URL/연동 자료는 last-checked 시간과 freshness TTL을 기록하며, TTL이 지났거나 갱신에 실패하면 현재 사실로 단정하지 않는다. 외부 세계 전체의 실시간 최신성은 연결된 출처의 갱신 주기 밖에서 보장할 수 없다.

처리 상태는 `RECEIVED → EVIDENCE_READY → KNOWLEDGE_UPDATING → READY` 또는 `RETRYING/DEGRADED/FAILED`로 노출한다. 각 작업은 SourceVersion·stage·policy revision의 멱등 키, lease/attempt, 재시작 복구, DLQ를 가진다. `OUTCOME_UNKNOWN`은 같은 ID의 authoritative readback으로만 확인한다. 답변은 사용한 epoch/watermark를 고정하고, 권한·민감도·citation 검증 실패 시 결과를 게시하지 않는다.

## 7. 제품 표면

- Home: **자료 추가**, **질문** 두 주요 동작. 처리 상태·최근 인용·충돌 표시만 제공한다.
- Sources: 한 번의 파일 제출, 자동 중복/재시도, 원문·버전·처리 상태 열람. `AI 처리 다시 시도`, `시맨틱 비교 실행`은 일반 흐름에서 제거한다.
- Ask: 기본값 `AUTO_PROJECT_KNOWLEDGE`; 수동 소스 선택은 고급 검색 범위로만 제공한다. 답변은 원문 인용, 추론 표시, 충돌·자료 시점·처리 지연을 표시한다.
- Review: 일반 지식 흐름에서 제거한다. 기존 승인형 이력은 읽기 전용 감사 자료로 남긴다.

## 8. 보존·이행·되돌리기

새 테이블/계약과 provider adapter는 additive migration으로 도입한다. 기존 Source/Evidence를 재사용하고, 기존 Candidate/Comparison/Review/Canonical/History는 삭제·자동 승인하지 않는다. 기존 승인된 Canonical은 SourceVersion·Evidence가 복원되는 항목만 `LEGACY_IMPORTED` 계보로 VP Ledger에 가져온다. 현재 미승인 후보는 승인 여부를 추측해 이관하지 않고 원문 근거에서 VP 정책으로 다시 처리한다. 프로젝트별 그림자 처리·readback·지식 epoch 수렴을 확인한 뒤 활성 읽기 권위를 VP로 **단일 전환**한다. 전환 후 기존 Canonical은 일반 Ask 결과의 두 번째 권위로 섞지 않는다.

컷오버 전 롤백은 VP 그림자 처리를 중지하고 기존 제품을 유지한다. 컷오버 후에는 안전한 기존 Ask로 읽기를 되돌릴 수 있으나, 그동안 VP에서 추가된 지식을 기존 Canonical에 자동 이식하지 않는다. VP Ledger와 결정 영수증은 보존하고, 차이를 표시한 후 재컷오버 또는 정방향 복구한다. 외부 Action이나 자료 삭제는 이 롤백에 포함하지 않는다.

## 9. 구현 권한과 이행

사용자는 계획 검토 후 VP 구현을 명시적으로 지시했다. 이 ADR은 `ACCEPTED`이며 VP의 자동 지식 경로를 구현한다. Phase 1~6 Canonical ADD의 Notion 원문은 이 작성 환경에서 열리지 않아 저장소의 공식 요약·관련 ACCEPTED ADR로 충돌을 확인했다. 기존 승인 정책은 VP 설계의 선결 거부 조건으로 사용하지 않는다. 기존 데이터와 API는 프로젝트별 전환이 검증될 때까지 보존한다.
