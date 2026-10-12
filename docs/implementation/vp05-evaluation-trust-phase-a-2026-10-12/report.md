# VP-05 평가 신뢰성 Phase A — 독립 감사

> 2026-10-12 · **PHASE_A_AUDIT_COMPLETE / EVALUATION_REFERENCE_APPROVAL_PENDING**
>
> Canonical 기준 `cd3cc258dcc5033cb61d7f1dc2f221f5e5016ab6`. 이 문서는 로컬 감사와 계약 초안이다. 인증 Gold, 활성 평가 정책, VP-05 COMPLETE 또는 다음 Phase 착수 승인이 아니다.

## 1. 판정

**기존 실행 기록은 재현 가능한 개발 증거다. 현재 자료만으로 DeepSeek나 SSC의 객관적인 의미 오류율을 인증할 수 없다.** 정답 승인 근거, 입력 문맥, 관계별 허용 방향/근거, 측정 차원에 결함 또는 미결사항이 있다. 따라서 현재 구조를 교체해야 한다는 결론도 이 점수만으로 내릴 수 없다.

| 조사 대상                   | 확인된 사실                                                                                                           | 사용 가능한 해석 / 제한                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 72쌍, 17 annotation/fixture | 30쌍 CANDIDATE, 42쌍 review status 미기록. 조사한 파일·소비된 manifest에서 독립적인 사람의 개별 정답 승인 증빙 미확인 | 전부 틀렸다는 뜻이 아니다. 독립 승인 확인 수는 0이며 외부에 승인 기록이 절대 없다는 뜻도 아니다                        |
| 관계 허용집합               | 50 positive-only, 15 negative-only, 7 mixed; 복수 entry 45쌍(negative NONE alias 포함), 실제 복수 의미 kind 30쌍      | 하나의 유일한 종류를 고른 모델만 정답이라는 평가에 부적합. flat kind/direction 목록으로는 근거별 대안을 구분할 수 없음 |
| 구조 결함                   | 3쌍의 QUALIFIES 대안에 유효한 방향 없음                                                                               | 해당 directed 대안은 평가 불가능. 다른 허용 대안까지 모두 평가 불가능하다고 세지 않음                                  |
| 문맥 의존                   | IRR 주어/제목, 현재가치의 고정 현금흐름·기간/공식이 claim-only 입력에 없음                                            | 이 두 사례의 기존 EQUIVALENT rationale을 입력만으로 독립 확정할 수 없음                                                |
| 432회                       | 72쌍 × 2 arm × 3 run, terminal 432, distinct task/claim/provider response 각각 432. 요청 재구성 digest 432/432 일치   | 실행·기록 정합성. 독립 표본 432개 또는 의미 승인 432건이 아님                                                          |
| B v1                        | 원본 12/36회, 실제 wire 입력/응답 12/12 대조 일치, 잔여 24회 미실행 이력 유지                                         | 5건 witness 길이 위반과 downstream 미평가를 의미 오판과 분리해야 함                                                    |
| 제품 인수                   | 실제 application + PostgreSQL + Fake Provider 기존 13/13 PASS를 재사용                                                | A/B/수정본, 최신 인용, 역사 stale, 권한, WAITING/실패 흐름의 검증. 실제 모델 의미 정확도 인증이 아님                   |

승인 책임과 측정 계약을 결정하는 다음 단계에 사용할 감사 증거는 준비됐다. **새 의미 품질 인증 및 SSC 후속 성능 비교의 기준으로 바로 사용할 준비는 되지 않았다.** 대표 집합은 검토 후보이며 새 실험은 실행하지 않았다.

## 2. 감사 방법과 증거 범위

- Canonical 분리 worktree에서 기준 ADD·ADR-098/172/173, Module ADD, Role Matrix, 실행계획, 로드맵, OSS 계획, DoD, VP tracker를 대조했다. 운영 checkout은 기존 `23be300…`에 그대로 두었다.
- 원본 로컬 VP worktree `C:/Users/lhm24/.codex/worktrees/vampire-vp/shotgun`, HEAD `1a36c7b55562783372dbc73c3188b9d797737c7e`를 읽기 전용으로 조사했다.
- 명시적 allowlist인 17개 fixture/annotation과 소비된 B2~B6의 15개 source 및 manifest를 읽었다. Gold-B-7 경로는 읽기 함수에서 거부한다. 17개 fixture SHA, 15개 원문 SHA가 동결 기록과 일치했다. 이 42쌍의 좌우 84 claim은 해당 보존 원문에 정확한 substring으로 존재했다. 원문에 존재하는 것은 현실적 사실성 또는 관계 정답의 독립 검증과 다르다.
- 72쌍 각각의 좌우 텍스트·kind·direction·출처·기록된 상태를 검사하고 이전 AI 검토와 바이트/필드 동일성을 확인했다. 이전 16건의 의미 우려는 **이전 Codex 해석**으로 별도 표시했다. 이번 검토 역시 사람의 승인으로 승격하지 않았다.
- 432/12의 scorer를 다시 실행하지 않았다. 기존 점수는 저장값을 그대로 인용했다. 새로 만든 합성 관측에만 기존 순수 scorer를 적용하여 지표 의미를 검증했다.
- 모든 조사 대상 82개 파일의 SHA를 읽기 전후 대조했다. 원본 VP HEAD/status/stash와 운영 checkout HEAD/status도 대조했다. audit helper는 artifact reconciliation용이고 생산 평가기나 새 승인 권위가 아니다.

상세 증거와 72행 상태표: [audit.json](C:/dev/artifacts/vp05-evaluation-trust-phase-a-2026-10-12/audit.json). 재현 가능한 읽기 전용 helper: [audit.cjs](C:/dev/artifacts/vp05-evaluation-trust-phase-a-2026-10-12/audit.cjs). 이 helper는 runner를 import하지 않으며 DB·network API를 호출하지 않는다. 원본 파일과 이미 설치된 TypeScript compiler를 사용해 상수와 순수 scorer만 IO 없는 VM에서 읽는다.

## 3. 정답 승인 상태를 해석하는 방법

두 축을 분리했다. 승인 상태는 `CANDIDATE / UNVERIFIED / INDEPENDENTLY_VERIFIED`이고, 평가 적격성은 `쟁점 있음 / 문맥 부족 / 구조 불능 / 승인 후 채점 가능`이다. 여러 문제는 한 사례에 함께 있을 수 있다. 이를 상호 배타적인 숫자로 더해 72를 만들지 않는다.

| 집합                    |  수 | 승인 증거                                                                                    | 현재 판정             |
| ----------------------- | --: | -------------------------------------------------------------------------------------------- | --------------------- |
| finance v1.2            |  14 | 명시 CANDIDATE. PDF source-fidelity 보고서가 독립 분야 검토/Gold 승인이 아님을 명시          | 원문 대조를 거친 후보 |
| synthetic relation v1.2 |  16 | 명시 CANDIDATE, test-authored 문장                                                           | 개발 후보             |
| consumed B2~B6          |  42 | freeze, source hash, allowed label은 있음. 사람의 reviewer/approval receipt 식별 근거 미확인 | 승인 미확인 기준      |

Git author, 파일 이름의 Gold, freeze/digest, 실험 실행 승인, 모델 합의, 이전 보고서의 `authoritative` 표현은 개별 의미 정답 승인 증거가 아니다. ADR-098의 과거 Claim/Search APPROVED corpus 계약·승인 이력은 보존하지만, 그것이 이 72쌍의 관계 정답을 승인했다는 기록은 없다. 중단된 relation-evaluation-v1 stash의 자체 verified/ready 필드도 사용하지 않았다.

구조적으로 확인된 3쌍은 `different-year`, `different-entity`, `same-number-different-measure`다. QUALIFIES가 목록에 있지만 directed direction이 빠졌다. 이 결함은 기계적으로 증명된다. 이들을 어떤 의미 정답으로 바꿀지는 사람 검토와 정책 의미 결정이 필요하다.

## 4. 실제 입력과 평가자가 알고 있는 정보

### 4.1 Frozen A/B 432회

실험 `412c1240-7804-4c49-8c8c-f4099e9a5f40`, identity `de4528034fd297a1f77aa3bec5b4daebf9d04e7253360f2969a6e7b34ff27fdd`.

| 항목                                     | 감사 결과                                                                                                                                                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Corpus                                   | `f7f3c4640093d1259b673b4e5cbb1510865aa2002d4d3a67c244230eb6d0396e`                                                                                                                                 |
| baseline                                 | v11 `vp-deepseek-relation-v11-contractual-protocol-and-physical-generalization`                                                                                                                    |
| candidate                                | `a7a8a0ee63dc0ea5b554d04004796b193f56da90c68cdc041715eac2fa8daaf3`                                                                                                                                 |
| production semantic identity (로컬 실험) | `996ad83ba1fd74e8b50c07ed0811adbe8a4e7e6a1b801c893c251929615bf463`                                                                                                                                 |
| snapshot 파일 SHA                        | `b980cf9063cf6041c1511c9c3e39ccfb7942a79b3c86d5fec01fd0a25c76f929`                                                                                                                                 |
| 기존 completed-evidence digest           | `cfe0e023ad396a75049fd8d806135dfa4274d91cfee5a9d364ebe142d5bd1501` — 역사 기록, 파일 SHA와 다른 표현                                                                                               |
| actual projected input                   | 좌우 claim, 각 `evidenceContext=null`, `evidenceContextTruncated=false`; 제목/공식/전체 source 미전달                                                                                              |
| request 검증                             | 동결 adapter의 v11 문자열·response schema와 candidate 상수를 읽어 요청을 재구성. 저장 request SHA와 432/432 일치                                                                                   |
| version/Evidence                         | annotation 파일 hash에서 만든 synthetic SourceVersion/Assertion/Evidence identity. 실제 제품의 EvidenceSpan/SourceVersion 인가 조회 실험이 아님                                                    |
| 증명 한계                                | 이 snapshot에는 432개 actual HTTP request body/finish_reason이 없음. digest 일치는 요청 재구성의 증거이며 wire 전달 자체를 독립 증명하지 않음. output token 수만으로 완전한 비잘림을 보장하지 않음 |

`truncated=false`는 별도 excerpt를 잘랐다는 표시가 없다는 뜻이다. 평가자의 제목·공식·배경 전제까지 전부 전달됐다는 의미가 아니다. IRR·현재가치 두 사례에서는 기존 source-fidelity 보고서 자체가 그런 추가 문맥을 요구한다.

또 v11 prompt에는 소비된 benchmark와 가까운 예시/구분 규약이 이미 포함되어 있고, 72쌍 자체도 exposed development로 선언됐다. blind generalization 성적으로 사용할 수 없다. Canonical application worker는 `assemblies/shotgun-app/src/application.ts`의 **v6-evidence-context / 0.9**다. 이 v11/structured A/B 점수를 현재 앱 v6의 성적으로 이관할 수 없다.

### 4.2 B v1 12회

실험 `22ae9ead-090d-4080-814f-19e317db67e0`, identity `7d3974458ee85b5485428876be6cd1b2e9e64ed178164f6a405ee855e1a81735`, evidence 파일 SHA `3303be8de9e829216956caa00a12e6521060a77eb79a599fceb10bb1a7fb3784`.

- 12개 HTTP user body의 claim·AssertionId·SourceVersionId·EvidenceId가 frozen task와 일치했다. 원래 문맥은 claim-only이며 별도 context는 없다. JSON body의 truncation flag는 false다.
- 12개 HTTP response의 content와 provider ID가 저장 rawResponse/trace와 일치했다. finish reason은 12개 모두 `stop`, token limit 256.
- 입력은 격리 PostgreSQL에 만든 assertion/Evidence와 연결된 UUID다. quote는 claim과 동일하다. full source나 추가 heading이 전달된 제품 평가로 해석하면 안 된다.
- schema-invalid 5개도 원본 JSON은 남아 있다. cross-field 검사 short-circuit 이후 미평가한 사항을 PASS로 보거나, 지금 재parse해 accepted proposal로 치환하지 않았다.
- shadow receipt이며 production Ledger 채택은 아니다. 원본 screen의 전역 claim/job/attempt 1:1은 보존된 integrity report의 역사 증거로 인용하며 이번에 운영 DB를 다시 조회하지 않았다.

## 5. 종류·방향·근거 쟁점

아래는 **검토 후보 해석**이다. 기존 label 변경도, 모델 의미 오판의 확정 판정도 아니다.

| 사례                                 | 확인한 문제/쟁점                                                                                                                                             | 필요한 결정                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| profit/cash                          | RIGHT는 증가한 이익과 증가하지 않은 현금의 사례. LEFT는 동일 증가 비함의. instance→rule 규약에서 RTL이 합리적; candidate rationale도 독립 검토 대기라고 명시 | 범용 지지/예시 규약과 개별 승인. B의 LTR은 frozen RTL 기준과 불일치하며, 객관 오류율로 일반화하지 않음 |
| every-day / weekdays                 | 매일 개방하면 평일도 개방. 평일 문장이 주말 폐쇄를 주장하지 않음                                                                                             | scope subset과 규칙의 적용 제한을 QUALIFIES에서 어떻게 구별할지 승인                                   |
| exactly / at least 10                | exactly 10은 at least 10을 함의하지만 역은 성립하지 않음                                                                                                     | SUPPORTS/QUALIFIES/RELATED 대안별 warrant와 우선순위. 단일 역할 선언이 올바른지는 별도 의미 검토       |
| TIME_WAIT                            | 수행→중복 혼선 예방, 예방 목적→대기 의무의 서로 다른 warrant 가능                                                                                            | cause와 justification의 방향을 튜플별로 기록. 외부 RFC만으로 Shotgun의 유일한 방향을 지정할 수 없음    |
| threshold / kinetic energy           | 문턱 아래 미방출만으로 문턱 위 선형성을 도출할 수 없음                                                                                                       | 물리 bridge의 입력 포함 여부와 허용 전제. RELATED 대안과 SUPPORTS 대안을 분리                          |
| fixed rate / variable payment        | 이율과 지급액은 다른 속성. 함께 성립할 수 있음                                                                                                               | RELATED와 QUALIFIES의 규약 차이; 지급액이 이율의 범위를 제한한다는 주장 검토                           |
| shared / unique secret               | prover-verifier 공유와 prover별 unique 조건은 다른 범위                                                                                                      | complementary RELATED와 QUALIFIES 구별; uniqueness 대상 역할이 정확한지 검토                           |
| finance unrelated / server vs garden | 기존 허용집합은 RELATED/UNRESOLVED이며 NO_RELATION이 없음. 단순 분야 또는 분리된 주제만 있음                                                                 | 입력에서 직접 연결 부재를 판정할 수 있는지 검토. 안전한 비연결과 정보 부족의 구별                      |
| 일부 negative pair                   | 배경 지식이 있으면 더 넓은 메커니즘 연결을 주장할 수 있지만 claim-only에는 bridge가 없음                                                                     | source-bound 평가와 분야 사실 평가를 분리; 외부 전제를 정답에 조용히 추가하지 않음                     |

SUPPORTS는 전제/원인/사례에서 결론/일반 주장으로, QUALIFIES는 제한에서 제한받는 주장으로 향한다. 방향 계산은 **역할이 맞다고 가정하면** 결정적이다. AI가 전제·결론 또는 규칙·제한을 잘못 지정했는지는 offset·enum·schema로 검증되지 않는다. CONTRADICTS의 숫자/단위·명시적 대상/시점 비교는 기계적으로 점검할 수 있으나 implicit co-reference·동일 조건·분야 전제는 의미 검토가 필요하다. 원문 fact의 현실적 진실성은 source-to-source 관계와 별도다.

새 계약은 [측정·정답 초안](./measurement-contract.draft.md)처럼 kind/direction/warrant를 **한 튜플**로 연결해야 한다. 대안 여러 개 중 하나와 일치하면 1개 정답으로 평가하며, 여러 대안을 모델이 모두 출력해야 하는 multi-label task로 바꾸지 않는다. 현행 closed taxonomy를 조용히 재정의하지 않는다.

## 6. 기존 수치를 어디까지 사용할 수 있는가

| 기존 기록/코드              | 정확한 의미                                                                                                           | 인증 품질로 사용할 수 없는 이유                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| A/B strict precision/recall | frozen reference + kind/direction + emitted 조건의 합성 측정                                                          | 후보 정답, 문맥·tuple 결함, parser와 0.9 채택의 영향. 순수 의미 정확도가 아님                       |
| criticalDirectionAccuracy   | 모든 critical positive run에서 선택 kind가 positive이면 directed allowed direction 또는 non-directed NONE을 세는 지표 | 실제 채택·정답 kind 일치가 없어도 분자에 들어감. 방향 없는 잘못된 kind도 credit 가능                |
| A/B stability               | `emitted ? choice : NONE` + direction 세 run signature                                                                | suppressed raw kind가 바뀌어도 동일. 의미 선언 안정성이나 실제 production Ledger 안정성 인증이 아님 |
| mixed pairResults           | allowed choice이며 미발행이면 correct; 방향 조건 생략                                                                 | 잘못된 방향도 correct 가능; mixed가 strict recall에서는 제외됨                                      |
| percent zero-denominator    | 분모 0을 100으로 반환                                                                                                 | 미측정을 완벽한 정확도로 표시할 수 있음. 승인된 새 계약에서는 N/A 필요                              |
| B direction                 | positive cohort 내 eligible directed proposal 중 allowed direction                                                    | kindOK/의미 evidence 충족을 분모가 요구하지 않음. 새 조건부 방향 계약과 다름                        |
| B schema/anchor/witness     | 문자열 길이·필드·panel offset·구조 조건                                                                               | witness가 의미적 근거라는 보증, 역할 정확도 또는 현실 진실성의 검사 아님                            |
| confidence / 선택 확률 0.9  | 모델 자기보고 확률과 frozen gate                                                                                      | 보정된 성공 확률 또는 정확도 90%라는 뜻이 아님                                                      |
| B schema 실패 / unresolved  | 5 schema 실패, 전체 8 terminal unresolved, 그중 confidence/gate 거부도 포함                                           | model의 자발적인 UNRESOLVED 선언과 혼동 금지                                                        |

432회 structured candidate는 SSC가 아니며 B v1도 SSC 모델 실측이 아니다. 이 기록으로 SSC 의미 오류율을 계산할 수 없다.

기존 저장값 **그대로** baseline strict P 94.87%, recall 74%, critical recall 71.43%; candidate strict P 86.44%, recall 34%, critical recall 0%. 양쪽 overall stability 97.22%. 이것은 위 frozen 개발 측정의 기록이고, 모델의 객관적 오류율 또는 SSC 성적이 아니다. 이 감사는 이전 candidate rejection 결정/기록을 지우거나 뒤집지 않는다.

B 저장값 schema-valid **7/12**, 길이 위반 **5/12**(120, 110, 130, 102, 115 code points; maximum 96), eligible 4/12, 원래 screen의 critical recall 1/4, direction 1/2. 12개 JSON은 모두 parse됐고 truncation은 0이었다. 형식 불합격과 의미 실패를 합쳐 모델 오판률로 보고할 수 없다. remaining 24 미실행이므로 36회/3-run stability 성적으로 보고할 수도 없다.

432 저장 reason은 ACCEPTED 176, CHOICE_PROBABILITY_BELOW_THRESHOLD 122, AUTHORITATIVE_NO_RELATION 129, INVALID_PROVIDER_OUTPUT 5. **5 UNRESOLVED는 parser/output validation 실패 경로의 기록**이며 model 자발적 abstention 5건이라는 뜻이 아니다. 이는 reason의 전사이며 새 scoring이 아니다. 3회 반복은 같은 case의 반복이지 3개의 독립 지식 표본이 아니다. exposed·선택된 corpus이므로 모집단 대표성/일반화 보장도 없다.

### 새 합성 관측으로 확인한 지표 결함

실제 432/12와 무관한 `synthetic-only` 관측에만 기존 scorer를 호출했다.

| 합성 관측                                                                 | 결과                                     | 해석                                     |
| ------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------- |
| reference SUPPORTS/LTR, non-emitted EQUIVALENT/NONE ×3                    | direction 100%, TP 0, relation recall 0% | 조건부 정답 방향 성적으로 사용할 수 없음 |
| suppressed SUPPORTS → QUALIFIES → CONTRADICTS, direction NONE             | stability 100%                           | raw 선언 변동을 숨길 수 있음             |
| mixed QUALIFIES/RELATED/UNRESOLVED, allowed RTL, suppressed QUALIFIES/LTR | pairResults.correct=true                 | mixed 방향 검사 누락                     |
| observations 없음                                                         | strict precision 100%                    | 분모 0의 허위 완벽 표시                  |

## 7. 제품 인수와의 연결 및 병목 판정

PR #382의 Canonical tree와 기존 Fake 제품 인수 13개 PASS를 재사용했다. 이번 Phase A에서는 앱이나 PostgreSQL을 새로 실행하지 않았다. A 42→B 근거 추가→A 43으로 수정, 새 질문의 최신 인용, 과거 답변 stale=true와 현재 답변 stale=false, AnswerRun/Conversation/Branch/Workspace 일치, 권한 비노출, authority query 오류의 fail-closed가 입증됐다. Fake가 정해진 문장을 제공한 성공을 실 AI 의미 정확성으로 승격하지 않는다.

관계 품질은 질문 수준에서 다음을 함께 관측해야 한다.

| 제품 질문 상황         | 필요한 관계 의미 / 답변 검증                                       | 실패 분리                                      |
| ---------------------- | ------------------------------------------------------------------ | ---------------------------------------------- |
| A와 B의 동일 내용      | 둘의 근거 보존, 잘못된 value 합병 없음, 요구된 경우 두 source 인용 | 추출·frontier·관계·검색·답변                   |
| 같은 범위의 42/43 충돌 | 일방 값을 진실로 선택하지 않고 source별 차이를 인용                | 동일 대상/시간 판단 오류 vs 답변 단정          |
| 조건이 다른 두 규칙    | 적용 조건을 답변에 남기고 충돌로 오인하지 않음                     | 추출 qualifier 누락 vs 관계 vs generation      |
| A 수정과 과거 답변     | 현재 질문은 최신 SourceVersion, 과거 저장 답변은 원문 보존+stale   | version/freshness projection; 의미 품질과 별도 |
| 관계가 미채택됨        | 필요한 Evidence가 검색돼 올바른 답변이 가능할 수도 있음            | 미채택 자체와 제품 답변 실패를 등치하지 않음   |
| WAITING/실패/권한 없음 | 성공 또는 NO_RELATION으로 위장하지 않음                            | 실행·검색 접근 경계                            |

현재 판정은 **현행 구조 유지 + 평가 계약의 최소 보완 준비**다. v11/SSC/다른 모델이나 질문 시 추론 전환의 우월성이 입증됐다는 결론은 없다. 평가 신뢰성 문제가 먼저이며 product 영향까지 확인되지 않은 prompt/schema/threshold 수정은 시작하지 않는다.

## 8. 대표 집합과 승인 절차 후보

[대표 집합/승인 초안](./representative-set.draft.md)에 12개 core + 6개 쟁점, 총 18개 기존 exposed pair ID를 제안했다. 새 label을 만든 파일이 아니라 검토 대상을 지정한 목록이다. claim-only와 필요한 동일 EvidenceSpan context를 어떤 task에서 제공할지 승인해야 한다. 기존 72쌍이나 432/12 결과를 새 task로 이관하지 않는다.

AI 해석 초안과 사람의 독립 검토를 분리하고, 작성자와 다른 검토자 및 사용자 지정 승인 책임자가 source/input 범위·허용 tuple/warrant·critical 이유를 승인하도록 제안한다. 서로 타당한 해석이면 다중 허용 tuple, 결정 불가능하면 문맥 부족/분쟁으로 남긴다. 다음 실험 전에 reference와 측정 version을 고정해야 한다. 일상적인 Shotgun 사용자에게 매번 지식 승인 클릭을 추가하는 절차가 아니다.

## 9. 재사용 검토와 이번 작업에서 보완한 방법

기존 `packages/quality-evaluation`의 versioned test artifact·APPROVED gate lane·Unicode Evidence·ratio(0분모 null) 계약을 **REFERENCE_ONLY**로 사용했다. 코드의 EvaluationKind는 CLAIM_EXTRACTION/SEARCH이며 이 VP relation corpus를 자동 포함하거나 인증하지 않는다. 개발 A/B scorer와 기존 audits는 역사 해석과 반례 재현만 재사용했다.

gbrain Job/Graph, lucas locator/validation, ddsyasas Ask UX, OpenKnowledge evidence/review 패턴의 기존 Role Matrix를 검토했다. 이번 정답 승인 책임·평가 의미 감사에 이 runtime을 채택할 이유가 없다. 네 후보의 기존 REFERENCE_ONLY/추출 경계를 유지한다. 새 package/OSS code/lockfile 채택 없음, Role Matrix 변경 없음. 정확한 upstream pin/license/security/adapter replacement 검증은 실제 향후 코드 통합 때 필요하며 이번 감사로 면제되지 않는다.

기존 중단 draft를 복원하거나 새 범용 evaluator를 구현하지 않았다. 대신 요청의 분류를 두 축으로 나누어 중복 쟁점을 숨기지 않았고, wire를 가진 B와 hash만 가진 A/B의 증명 강도를 구분했으며, 432개 요청을 frozen bytes로 재구성해 입력 provenance의 추가 증거를 확보했다. 단순 이전 보고서 요약을 넘어 새 순수 합성 probes와 모든 input identity 대조를 수행했다.

## 10. 검증·보존·남은 승인

| 검증                                                                                                                           | 결과                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Canonical SHA, 17 fixture hash/72 unique ID, 15 source hash/84 substring, 432 distinct task/claim/response, pair/arm별 run 1~3 | PASS                                                                                             |
| 동결 runner/scorer/candidate/schema bytes + request reconstruction                                                             | PASS 432/432                                                                                     |
| B frozen harness bytes, prefix 0~11, wire/claim/version/Evidence/response identity                                             | PASS 12/12                                                                                       |
| 합성 scorer 반례                                                                                                               | PASS 4개; 기존 점수 재계산 0                                                                     |
| 보존된 Fake product 결과 재사용                                                                                                | PASS 13/13 — 이번 재실행 아님                                                                    |
| 보호 파일 SHA / source worktree / stash / 운영 checkout                                                                        | 82개 unchanged, source와 운영 worktree clean, stash unchanged                                    |
| 이번 code unit/DB/typecheck/CI                                                                                                 | NOT_RUN — 생산 코드·schema·dependency·평가기 변경 없음; 과거 CI를 이번 감사 CI라고 주장하지 않음 |

새 감사 worktree에만 이 보고서와 두 draft를 추가한다. source VP/운영 worktree에 변경 없음. 신규 문서의 format·링크·scope 검증은 별도 completion artifact에 남긴다. 청결 상태는 원본 worktree와 새 문서 작업 상태를 구분해서 보고한다.

**다음 Phase 전에 확정할 사항**

1. 정답 승인 책임자와 독립 검토자의 자격·역할·증빙 범위.
2. claim-only 또는 동일 EvidenceSpan context의 task 구분, 외부 unit/logic/분야 전제 허용 범위.
3. SUPPORTS cause/justification, QUALIFIES subset/restriction, RELATED direct bridge, NO_RELATION/UNRESOLVED 경계 및 복수 tuple 승인.
4. 대표 18개 선정과 critical/product 질문 매핑; 노출된 diagnostic을 blind acceptance로 사용하지 않는 원칙.
5. 측정 계약의 분모·N/A·abstention/invalid/runtime 구분 및 prospective threshold/표본/반복/중단 조건.

실제 AI calls 0, DB connections 0, 운영 설정 변경 0, 기존 결과 재채점 0. Gold-B-7 미개봉, B 잔여 24회와 평가 draft STOP 유지, VP-06 미착수. Push/PR/merge 없음. **Phase A 제출 후 STOP.**
