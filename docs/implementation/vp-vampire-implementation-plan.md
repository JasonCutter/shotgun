# 뱀파이어(VP) 리뉴얼 구현계획 — 설계 기준선

> 상태: **사용자 구현 지시 수락 · VP-1 구현 진행 중**  
> 기준: `main@8e07074a73cb9fa062316a10ebd236d9b2cad850`, 2026-09-25  
> 권위 설계: [ADR-172](../architecture/adr/ADR-172-vp-autonomous-knowledge-authority.md)

## 1. 목표와 최종 인수 문장

사용자는 자료를 투입하고, 그 자료에 관해 질문한다. Shotgun은 여러 자료의 주장을 자동으로 분해·연결·통합·구별하고, 새 버전에 맞춰 다시 계산하며, 답변에 출처와 시점을 붙인다. 일반 지식 흐름에는 후보별 클릭·소스 선택·Review·`ADD_CLAIM`·`NO_OP`·승인이 없다. Jev는 빠른 의미 판단, 일반 AI는 추출·복합 추론·서술, 결정적 코드는 무결성·권한·버전·멱등성을 맡는다.

**최종 인수 시나리오:** 빈 프로젝트에서 자료 A를 한 번 넣고 질문한다. 이어 자료 B와 A의 수정 버전을 넣고 같은 질문을 한다. 두 번째 답변은 최신 활성 버전과 B를 반영하며, 합의·조건 차이·충돌을 원문 인용과 함께 구분한다. 이 과정에 추가 사용자 결정은 없다. 질문이 자료 처리보다 먼저 도착하면 같은 AnswerRun이 준비를 기다렸다가 자동 완료한다. 처리에 실패하면 이유를 보여 주고 근거 없는 답을 내지 않는다.

## 2. 범위와 제품 원칙

| 포함                                                                                                   | 제외                                                     |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| 한 번의 파일/텍스트/URL 투입, 자동 처리·중복·재시도, 프로젝트 전체 자동 검색                           | 사용자의 매 문장 승인·비교·재시도, 자동 외부 Action 실행 |
| 원문 위치가 있는 근거, 자동 주장·관계 기록, 증분 지식 갱신, 충돌·시점 보존                             | Jev 확률을 객관적 Fact나 승인으로 간주                   |
| 질문 시 최신 SourceVersion/knowledge epoch 확인, 근거가 붙은 답변, 처리 중 질문 대기                   | 미허용 프로젝트/민감 자료의 외부 AI 전송                 |
| 파일 형식별 Adapter 확대. 기존 오디오/영상 일괄 배제는 VP에 적용하지 않고 근거 selector 검증 후 활성화 | 출처 갱신 주기 밖의 외부 세계 실시간 최신성 보장         |

첫 수직 슬라이스는 현재 지원되는 `.txt`/`.md`를 실제 Product 경로로 통과시킨다. 다음 형식은 PDF·HTML·DOCX·XLSX·PPTX, 이어 오디오/영상 순서로 별도 Golden Corpus와 page/cell/slide/timecode/frame selector를 통과하면 켠다. 형식 확대 전에도 두 동작 계약은 유지하며, 미지원 파일은 제출 시 이유를 명시한다. 공급자 자격 증명·개인정보 egress 설정은 배포/프로젝트 운영 설정으로 처리하고 자료마다 묻지 않는다.

## 3. 현재 기준선과 교체 대상

| 현재 제품/코드                                                                                     | VP 변경                                                                                                        |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `sources-workspace.tsx`: `수집 초안 추가`와 `초안 제출` 두 단계, 수동 중복 선택                    | 한 번 제출하는 Command/UI, 서버 결정적 중복 처리와 작업 상태                                                   |
| `source-detail-workspace.tsx`: `AI 처리 다시 시도`, 후보별 `시맨틱 비교 실행`                      | 백그라운드 자동 재개·비교, 진행/오류/근거 열람만 유지                                                          |
| `frontend-ask-write`/Postgres: 기본 `CANONICAL_ONLY`, `SOURCE_EXPLORATION` 수동 SourceVersion 선택 | `AUTO_PROJECT_KNOWLEDGE` 기본값과 서버 고정 프로젝트 전체 범위. 기존 모드는 마이그레이션 중 호환 읽기로만 사용 |
| `CandidateValidated → ComparisonCompleted → Review → ChangeSetApproved → CanonicalCommitted`       | VP Ledger의 자동 주장·관계 반영 이벤트로 대체. 기존 이력/데이터는 보존                                         |
| Canonical/Compiled Truth 기반 검색과 별도 Source Exploration                                       | VP 활성 Source/Evidence/Assertion의 인가된 단일 검색 조정자와 epoch 일치                                       |

같은 이름의 기존 Port를 의미만 바꿔 재사용하지 않는다. VP 계약은 새 major/event 이름으로 추가하고, 기존 사용자 데이터·이력의 해석을 보존한다. `Source`/`Evidence`와 기존 작업·검색 인프라는 검증되는 범위에서 재사용한다.

## 4. 고정한 모듈·계약 설계

### 4.1 제품 경계

1. `SubmitVPSource@1.0.0`: 파일/텍스트/URL과 client idempotency key만 수신. 서버가 Project·actor·classification·원본 hash·SourceVersion·작업 identity를 만든다. 응답은 `sourceId`, `sourceVersionId`, `jobId`, 상태다.
2. `VPSourceState@1.0.0`: `RECEIVED/EVIDENCE_READY/KNOWLEDGE_UPDATING/READY/RETRYING/DEGRADED/FAILED`, 원인 코드, 활성 version/knowledge epoch, 자동 재시도 시각을 반환한다.
3. `RecordVPAssertion@1.0.0`와 `RecordVPRelation@1.0.0`: 브라우저 공개 명령이 아니다. Evidence·SourceVersion·policy/digest precondition을 서버가 재검증해 append-only VP Ledger에 쓴다. `AutoKnowledgeCommitted@1.0.0`을 outbox로 발행한다.
4. `DecisionProviderPort@1.0.0`: `task kind`, 허용 선택지, 고정된 evidence/주장/비교 범위와 버전, 정책, 예산을 입력으로 받는다. Jev Adapter와 fake/대체 Adapter가 같은 계약을 구현한다. 결정 영수증은 재생 가능한 식별자와 provenance를 가진다.
5. `AskVP@1.0.0`: 질문만 필수 입력. 서버가 프로젝트·권한·지식 epoch·활성 SourceVersion을 고정한다. 준비 중이면 AnswerRun을 `WAITING_FOR_KNOWLEDGE`로 유지하고 완료 후 자동 실행한다. 답변에는 인용, `DIRECT/DERIVED`, 충돌, 자료 확인 시점, 사용 epoch를 반환한다.
6. `VPProjectionStatus@1.0.0`: active epoch, source/evidence/ledger/search watermark를 제공한다. 차이가 있으면 최신 지식으로 표시하지 않는다.

### 4.2 데이터와 처리 의미

- Ledger는 원자적 `VPAssertion`, 관계 `VPRelation`, 출처/시점/조건, `VPDecisionReceipt`, history/outbox를 소유한다. 과거 상태를 덮어쓰지 않는다. 검색/현재 지식은 재생성 가능한 projection이다.
- `DIRECT_SOURCE`는 원문의 직접 진술이다. `DERIVED`는 상위 주장과 추론 단계를 참조한다. `HYPOTHESIS/UNRESOLVED`는 확정된 답변 사실로 승격하지 않는다. 같은 문장의 출처가 둘이면 증거 둘을 유지한다.
- 중복·동의·보완·예외·충돌·시점 변경은 별도 관계다. `EQUIVALENT`라도 서로 다른 원문/출처를 삭제하지 않는다. 충돌은 원본별 주장과 유효 시점을 함께 유지한다.
- 활성 SourceVersion이 바뀌면 관련 관계와 projection을 무효화해 증분 재계산한다. 특정 Project의 증분 결과는 동일 입력의 full rebuild와 논리적으로 같아야 한다.
- Retrieval은 권한/민감도 필터를 **순위화 전에** 적용한다. 원문 citation은 stable SourceVersion/EvidenceSpan으로 검증한다. embedding·Jev confidence·검색 rank는 근거 강도나 사실 확률이 아니다.

### 4.3 Jev 분기와 일반 AI

결정적 코드가 해시·ID·버전·정확 문자열·권한을 먼저 처리한다. Jev는 bounded shortlist에 대한 `관련/무관`, `동일/보완/충돌/불명`, `심층 분석 필요/불필요` 같은 닫힌 판단을 한다. 일반 AI는 주장 추출, 조건·시간·인과가 얽힌 관계 분석, 여러 자료의 종합, 최종 답변을 처리한다. Jev가 불확실하거나 품질 Gate를 통과하지 못하면 Shotgun이 일반 AI로 넘기며, 일반 AI도 근거를 만들지 못하면 `UNRESOLVED`/답변 불가로 남긴다. 작업별 임계값은 Golden Corpus에서 보정하고 버전으로 고정한다.

Jev는 외부 hosted API이므로 프로젝트 민감도/egress 정책을 통과해야 한다. PoC 대상은 공식 TypeSafe JavaScript SDK `v0.6.0` tag/`66880cc` (MIT, 2026-09-15 공개) 또는 공식 HTTP API다. 이는 **평가 기준 pin**이며 현재 저장소 의존성으로 채택했다는 뜻이 아니다. 정확한 commit, 취약점, 유지보수, 데이터 정책, API 접근성, lockfile, Adapter Contract/Replacement Test가 통과하기 전에는 생산 경로에 넣지 않는다. 공급자의 가격·지연 수치는 계획의 성능 보증이 아니라 비교 가설이다. [공식 발표](https://typesafe.ai/blog/introducing-system-one-models-and-jev), [공식 API](https://docs.typesafe.ai/introduction/quickstart), [공식 SDK](https://github.com/typesafe-ai/typesafe-sdk-js/releases)

## 5. 구현 작업 패키지와 순서

| 단계                           | 변경·산출물                                                                                                                                                  | 완료 Gate                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VP-0 권위·기준선**           | ADR-172 사용자 수락 후 ADD/DoD/Role Matrix/관련 ADR의 VP 범위 개정. 현행 Product 경로, DB·출처 계보, Golden Corpus, 비용/지연 baseline, OSS 후보별 결정 기록 | 새 자동 Ledger의 단일 writer·데이터 소유권·보안 경계가 문서와 Contract에 일치. 기존 승인형 데이터 해석 보존                                             |
| **VP-1 두 동작 수직 슬라이스** | 한 번의 파일 제출, durable ingestion, 모든 활성 `.txt/.md` Evidence의 서버 자동 검색, 질문 대기/자동 완료, 원문 인용 답변                                    | 실제 UI·API·PostgreSQL로 `파일 제출 → 질문 → 근거 있는 답변` 통과. 후보·Review·소스 선택 클릭 0회                                                       |
| **VP-2 자동 지식 축적**        | 원자 주장·조건·시점 추출, VP Ledger, 관계/충돌 기록, 증분 projection, SourceVersion 변경 영향 전파                                                           | 두 자료의 합의·차이·충돌과 수정 버전이 인용/epoch와 함께 반영. replay·restart·full rebuild 동등성 통과                                                  |
| **VP-3 Jev 판단 최적화**       | DecisionProviderPort, Jev Adapter PoC, 일반 AI escalation, 작업별 calibration·비용 예산·provider fallback                                                    | Gold 평가에서 품질 비열화 없음. 결정 단계 p95 지연과 실제 총 비용 각각 기준선 대비 최소 20% 절감할 때만 Jev를 기본 활성화. 아니면 Adapter를 비활성 유지 |
| **VP-4 자료 범위·전환**        | PDF/Office/HTML, 이후 오디오/영상 근거 selector 검증; 기존 Canonical 이관, 프로젝트별 shadow/cutover, VP Home/Ask UX, 기존 Review 일반 경로 제거             | 형식별 Golden Corpus, 보안·migration·rollback, 실제 두 동작 E2E, 운영 상태와 사용자 문구 검증. 단일 활성 지식 권위 확인                                 |

VP-1이 먼저 사용자 가치를 제공한다. VP-2/3 실패가 VP-1의 원문 기반 질문을 막지 않도록 각 상태와 fallback을 분리한다. 그러나 최종 VP 완료는 VP-4까지 통과해야 한다. VP-2의 자동 재처리 트리거에는 새 자료·새 버전뿐 아니라 질문에서 드러난 근거 공백, 연동 출처 갱신, 모델/정책 개정, 주기적 미해결 관계 재평가를 포함한다. 새 근거가 없는 재평가는 직접 사실을 새로 만들 수 없다. 각 패키지에서 관련 OSS 검토 → Integration Decision → 구현 → Contract/Golden/Security/Replacement 검증 순서를 지킨다.

## 6. OSS·기존 기능 평가 기준선

아래는 **설계 단계의 결정/평가 출발점**이다. Prototype·Benchmark를 실행하지 않았으므로 새 채택의 완료 판정이 아니다. `oss-source-registry.json`의 pin·license·security·maintenance 증거를 VP-0에서 최신 기준으로 다시 확인한다.

| 후보                    | 공식 URL / 기존 검토 commit                                                                                | VP 판단                                             | 포함/제외·교체 경계                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `garrytan/gbrain`       | <https://github.com/garrytan/gbrain> · `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` · MIT                    | `REFERENCE_ONLY` 시작, Job/Graph 부품은 VP-0 재평가 | Job·Graph·timeline 패턴. 전체 Runtime/DB는 VP Ledger로 승격하지 않음          |
| `lucasastorian/llmwiki` | <https://github.com/lucasastorian/llmwiki> · `ad626a3d81be1480e35ef4e94234de8dbb27a61e` · Apache-2.0       | 기존 locator `EXTRACT` 유지, 형식 확대 시 재평가    | 변환·원문 위치 복원. SQLite/VaultFS 전체 제외                                 |
| `ddsyasas/llm-wiki`     | <https://github.com/ddsyasas/llm-wiki> · `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` · MIT                  | `REFERENCE_ONLY`                                    | 두 동작 UI·상태 표현. Backend/DB/LLM client 제외                              |
| Inkeep OpenKnowledge    | <https://github.com/inkeep/open-knowledge> · `f2834c237639e2cff603817ed88182b33f83cf91` · GPL-3.0-or-later | `REFERENCE_ONLY`                                    | 출처·충돌·활동 표시. 전체 Runtime/Yjs/Canonical 모델 제외                     |
| TypeSafe Jev            | <https://github.com/typesafe-ai/typesafe-sdk-js> · `v0.6.0`/`66880cc` · MIT                                | `DEFER` 생산 채택, VP-3 Adapter PoC 필수            | DecisionProviderPort 뒤 hosted 판단만. 형식 생성·Ledger writer·답변 생성 제외 |

새 VP Ledger·프로젝트 전체 자동 Ask 권위·전환 정책은 Shotgun 고유의 Source/Evidence/권한/역사 계약이므로 직접 구현 후보지만, VP-0에서 해당 기능을 제공하는 OSS 후보 조사 범위·재사용 불가 이유·교체 Port를 결정 기록으로 남겨야 한다. 형식별 변환은 현재 Role Matrix의 Docling/Tika/MarkItDown/PyMuPDF/Office 후보를 각각 Golden Corpus로 비교한다. 기존 PostgreSQL/pgvector/검색 인프라는 교체 가능 Port 뒤에서 우선 재사용한다.

## 7. 검증 시나리오와 출시 기준

1. **기본 사용:** 파일 제출과 질문만으로 인용 답변. Home/Source/Ask에서 Review·후보 선택·수동 소스 선택이 0회.
2. **합치기/나누기:** 동의 문장 두 출처는 하나의 의미 그룹에 두 출처를 유지; 한 문장의 조건·예외·수치·시간은 원자 주장으로 분리.
3. **충돌:** 반대 주장 둘을 모두 보존하고 답변이 한쪽을 근거 없이 사실로 단정하지 않음.
4. **최신성:** 새 SourceVersion 투입 후 이전 검색 cache/embedding이 최신처럼 노출되지 않음. 대기 중 질문은 자동 재개. 만료된 외부 출처는 시점 표시 또는 답변 보류.
5. **근거:** 사실 문장별 유효 SourceVersion/EvidenceSpan 인용. 직접 진술과 도출 추론을 혼동하지 않음. Golden Corpus에서 근거 없는 확정 주장 0건.
6. **회복:** 중복 제출, 이벤트 재전달, worker 중단/재시작, DB commit ACK 유실, Jev timeout/장애, 일반 AI 장애에도 원장 중복·손실 없음. `OUTCOME_UNKNOWN`은 readback으로 해결.
7. **보안:** 프로젝트/민감도 경계 이전 필터, 인용 통한 우회 노출 차단, 프롬프트 주입 방어, 미허용 외부 egress 0건, cross-project 조회 0건.
8. **Jev 비교:** 같은 고정 데이터로 결정적 기준선·현행 일반 AI·Jev·Jev+escalation을 나란히 평가. 정확도/중요 오류, calibration, 호출 수, p50/p95, 총 입력·출력 비용, end-to-end 답변 영향을 측정. 제공자 자체 benchmark를 Shotgun 성능으로 대체하지 않음.
9. **이행:** 기존 승인 Canonical과 미승인 Candidate의 구분, 이관 근거, 단일 활성 권위, 프로젝트별 cutover/rollback을 실제 PostgreSQL에서 검증.
10. **완료 판정:** Module·Flow·Product·Architecture·OSS Integration Gate, 새 자동 지식 권위의 Security Negative·Golden Corpus·Replay·Migration·Replacement Test를 모두 통과. 설계 문서나 PoC만으로 `COMPLETE`라고 보고하지 않음.

## 8. 이행·중단·되돌리기

- Migration은 additive로 시작한다. VP Ledger와 projection을 기존 제품 옆에서 shadow 구축하되, shadow 결과를 사용자 답변의 현재 권위로 혼합하지 않는다. 프로젝트별 epoch/lineage/readback이 일치하면 VP로 단일 cutover한다.
- 기존 Canonical은 `LEGACY_IMPORTED` 계보로 이관 가능한 근거가 확인된 경우에만 VP Ledger에 반영한다. 기존 미승인 Candidate는 원본에서 다시 처리한다. 출처가 불명확하면 이관하지 않고 gap으로 기록한다.
- 정지 조건: 원문 인용 복원 불가, 프로젝트 경계 침범, 중복 원장 기록, 설명 불가능한 지식 역행, 최신성 watermark 불일치, 모델 비용 상한 초과, Jev 품질 비열화. 해당 Project cutover를 멈추고 마지막 정상 epoch로 읽는다.
- 롤백은 VP shadow/발행을 중지하고 컷오버 전에는 기존 제품을 그대로 유지한다. 컷오버 후 VP에서 생성한 지식을 기존 승인형 Canonical에 자동 복사하지 않는다. 보존된 VP 원장에서 정방향 복구하거나 차이를 명시한 제한 읽기로 복귀한다.
- 구현 전 형식·모델 제공자별 개인정보/라이선스/보안/maintenance, 정확한 upstream pin과 lockfile, 대체 Adapter, 비용 한도, 로그 보존을 검증한다.

## 9. 구현 착수 조건과 현재 상태

2026-09-25 사용자가 구현 착수를 지시했다. VP-1의 프로젝트 자동 질문 경로부터 구현한다. VP-0의 기준 문서 충돌과 Canonical ADD 대조, OSS Integration Decision 및 테스트 기준은 단계별 완료 판정 전에 실제 변경 계약으로 반영한다. VP-2~VP-4, Jev API 호출, 생산 benchmark는 아직 완료되지 않았다.

### 2026-09-25 VP-1 구현 체크포인트

- `AUTO_PROJECT_KNOWLEDGE`를 새 Ask 모드와 기본값으로 추가했다. 브라우저의 소스 선택은 받지 않고, 서버가 프로젝트·접근 범위·민감도를 제한한 뒤 완료된 최신 SourceVersion의 Evidence를 검색한다. 검색 결과와 query-plan revision은 AnswerRun attempt에 고정되는 기존 실행 경로를 이용한다.
- 자료 입력 폼의 기본 버튼은 텍스트·`.txt`/`.md`·URL 한 건을 스테이징 후 바로 제출한다. 기존 초안/중복 결정 화면은 이미 생성된 항목의 호환 처리를 위해 남아 있다.
- VP 제출은 동일 프로젝트·동일 보안 분류의 정확 중복을 자동으로 기존 SourceVersion에 연결한다. 보안 분류가 다르면 별도 Source를 만든다. 선택한 중복 정책은 제출과 재시도 사이에 DB에 보존한다. 과거 수동 중복 결정은 그대로 조회·처리할 수 있다.
- VP 질문은 인가된 최신 SourceVersion의 Stage 3 처리가 끝나지 않았거나 자동 투입 항목이 아직 SourceVersion을 만들지 못했으면 QUEUED로 남는다. 실제 Ask worker의 claim 경로에서 준비 상태를 재확인하며, 처리 완료 뒤 같은 AnswerRun이 새 Evidence로 재개되는 DB 테스트를 통과했다. 자동 투입의 보안 분류를 읽어 권한 밖 항목은 대기를 유발하지 않는다. 투입 실패가 종료되면 대기는 풀리지만, 답변에 실패 항목을 별도로 표시하는 기능은 아직 남아 있다.
- VP 자동 제출이 Stage 3 도중 실패해도 복구 worker가 같은 SourceVersion을 완료한다. 별도 자동 조정기가 완료된 제출 항목과 제출 상태를 멱등적으로 정리하므로 사용자 재시도가 필요하지 않다. 실제 PostgreSQL 복구 테스트를 통과했다.
- VP-2의 첫 원장 경로는 기존 Stage 4의 검증된 `DIRECT_EVIDENCE` 후보를 Shadow Ledger의 `DIRECT_SOURCE` 주장으로 자동 기록한다. 원문 Evidence·현재 SourceVersion·Stage 3 완료·후보/검증 개정판·프로젝트·접근 범위를 다시 대조하고 Candidate ID로 멱등화한다. **문자열·접근 범위·민감도가 모두 같은 현재 주장**만 결정적 `EQUIVALENT` 관계와 판단 영수증을 기록하며, 최신 SourceVersion의 주장만 현재 조회에 남는다. Jev·복합 의미 비교·Ask 컷오버는 아직 적용하지 않는다.
- 새 VP 테이블은 프로젝트 지식 초기화의 영향 목록·전용 owner·삭제 순서·체크포인트에 포함했다. 검증된 초기화 요청의 전용 executor에서만 원장 삭제를 허용하고 일반 쓰기·수정은 금지한다.
- `DecisionProviderPort`와 Jev HTTP PoC Adapter는 고정 모델 revision, 인가된 두 주장만 외부 전송, 닫힌 관계 선택지·분포·사용량 검증을 계약으로 갖는다. Jev 자격 증명과 Golden Corpus 평가가 없어 Jev Adapter는 실행 경로에서 제외했다. 실제 Jev 비용·지연 절감은 확인되지 않았다.
- 사용자의 2026-09-26 지시에 따라 **Jev 대신 DeepSeek를 임시 의미 판단 제공자로 연결**했다. 기존 Project별 DeepSeek 모델·Vault 자격 증명·상시 처리 정책 resolver와 일반 AI Adapter를 재사용한다. 인가된 두 주장 텍스트만 구조화 출력 요청에 전달하고, 관계 선택지·확률 합·토큰을 검증한다. `VPRelationJobWorker`는 Shadow Ledger의 자동 관계 큐에서 분당 최대 한 건을 처리하며, 판단 영수증에 `GENERAL_AI`와 실제 모델을 기록한다. Jev Provider는 구성하지 않으며 나중에 동일 Port 뒤에서 평가한다.
- 서로 다른 현재 직접 주장 쌍을 위한 `VPRelationJobStorePort`와 PostgreSQL 작업 큐를 추가했다. 작업은 정책 버전별 유일 키, 임대, 재시도, 최신 SourceVersion 재확인, 결정 영수증, 관계, epoch/history를 갖는다. 오래된 주장에 연결된 미완료 작업은 `SUPERSEDED`로 보존한다. 통합 테스트는 잘못된 임대 토큰 거부와 결정·프로젝트 지식 초기화를 확인했다. DeepSeek 결정→작업자→영수증/관계 기록의 PostgreSQL 테스트를 통과했다.
- 큐·lease 구현은 gbrain의 Job/lock recovery 검증 결과를 `REFERENCE_ONLY` 출발점으로 사용한다. gbrain 전체 Runtime·DB를 VP 원장에 적용하면 Shotgun의 SourceVersion/Evidence, 프로젝트 지식 초기화, 단일 writer 경계를 잃으므로 VP Port 뒤에서 직접 구현했다. `vp-knowledge-postgres` Adapter를 교체 경계로 삼고, 계약·재생·장애 주입 결과를 확보하기 전에는 OSS Integration Gate를 완료로 간주하지 않는다.
- 의미 관계는 정책 개정마다 append-only로 남기고, 현재 관계 View는 활성 주장 쌍별 최신 결정 한 건만 보인다. 같은 결론으로 재평가해도 새 정책 결정 영수증과 관계 이력을 남기는 PostgreSQL 회귀 테스트를 통과했다. `QUALIFIES`는 방향·조건 계약이 아직 없어 관계로 기록하지 않고 해당 정책 작업을 미확정 완료한다. 같은 입력·정책을 매일 재호출하지 않으며 새 SourceVersion 또는 정책 개정에서 다시 평가한다. Migration 117은 새 미확정 작업이 이전 관계의 현재 투영을 철회하되 이력은 남긴다. 대규모 쌍 후보 축소와 비용 상한은 별도 과제다.
- 실 DeepSeek API와 프로젝트 Vault 자격 증명으로 합성 문장 5쌍의 초기 연결을 확인했다. 이후 14쌍 고정 corpus를 더해 시점·대상·측정 항목 차이, 수량 조건, 부정 표현, 단위 변환, 한영 동의, 원문 속 지시문을 검증했다. 첫 평가에서는 다른 연도를 `CONTRADICTS`로 오분류했고, 명시적인 논리 양립성과 범위 기준을 추가한 `vp-deepseek-relation-v2`에서 14쌍을 연속 두 차례 기대 안전 범위로 분류했다. 중간 실행 한 차례에서는 모델 출력이 확률 유효성 검사를 통과하지 못했으며, 이 경우 관계를 기록하지 않고 재시도한다. 이는 소규모 합성 검증이며 대표 Golden Corpus, 확률 calibration, Jev 대비 정확도·비용 benchmark가 아니다. 현재 정책의 선택 확률 하한 `0.9`도 임시 보수 값이다. Shadow Ledger 관계를 활성 Ask의 사실 권위로 승격하기 전 해당 품질 Gate를 통과해야 한다.
- `AskKnowledgeEvidenceSearchPort` 뒤에서 현재 VP 직접 주장과 `EQUIVALENT`·`CONTRADICTS` 관계의 상대 근거를 좁게 찾는 PostgreSQL 읽기 Adapter를 연결했다. `AUTO_PROJECT_KNOWLEDGE`의 `ask-query-plan-vp2`는 VP의 Evidence ID를 힌트로 사용하지만, Ask가 프로젝트·권한·민감도·현재 SourceVersion·Stage 3 완료를 다시 검사한 원문만 답변 Context에 넣는다. VP 검색 장애 시 기존 원문 검색이 유지된다. 실제 PostgreSQL 테스트는 VP 관계 후보 검색, 권한 밖 ID 제거, Context digest 변경을 확인했다. 이것은 원문 기반 Ask의 검색 보완 단계이며 VP Ledger를 유일한 답변 권위로 전환했다는 뜻은 아니다.
- VP Global Shell 기능이 활성화되면 소스 상세 화면은 원문·근거·버전 열람과 자동 처리 안내를 표시하고, 수동 `AI 처리 다시 시도`·`시맨틱 비교 실행`·Review 진입은 표시하지 않는다. 구형 승인 경로 자체는 데이터 이행 전까지 보존한다.
- Home 주의 목록에서 지식 `REVIEW_DECISION`을 제외하고 Review 탐색·Route Guard도 같은 Home 가시성 결과를 사용한다. 외부 실행의 별도 승인과 실패 작업 알림은 유지한다. 과거 미결 Review 데이터를 자동 처리·이관하는 작업은 아직 남아 있다.
- 한 번 제출 경로에 `.pdf/.html/.htm/.csv/.docx/.xlsx/.pptx` (현재 1 MiB 이하)를 추가했다. 서버가 확장자·media type, PDF·Office 서명 및 텍스트 UTF-8을 대조하고 `document`로 저장한다. 기존 Stage 8 Python 변환기에 원본 바이트를 전달해 페이지·CSS·셀·도형 Evidence를 만든다. 더 큰 파일과 이미지/오디오/영상은 아직 활성화하지 않았다.
- DB migration `111_vp_auto_project_ask_mode.sql`은 과거 Ask 모드를 유지하면서 VP 모드를 추가한다. 실제 PostgreSQL 테스트에서 최신 버전과 접근 범위 필터를 확인했다.
- 이 체크포인트는 **VP-1 완료가 아니다.** 모든 실패 형태의 자동 복구, 문장 간 자동 지식 병합, 후보·Review UI 제거, Jev Adapter는 아직 연결되지 않았다. 해당 경로에서 사용자 결정이 요구될 수 있으므로 최종 두 동작 제품 계약을 만족한다고 보고하지 않는다.
