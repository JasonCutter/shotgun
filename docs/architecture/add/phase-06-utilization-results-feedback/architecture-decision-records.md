<!-- Canonical source: https://app.notion.com/p/39f5181d71ad8167ba22c49184c8f74a -->

## 문서 관리
- 범위: ADR-061\~ADR-075
- 상태: **Accepted**
- 기준일: 2026-07-16
- 관련 ADD: [Phase 6 — 활용·결과·피드백 ADD](https://app.notion.com/p/39f5181d71ad81948c94cbf0a894ea01)
## ADR-061 — Canonical·Source 탐색·외부 조사 모드의 명시적 분리
**상태:** Accepted
**맥락:** 승인 지식, 선택 원문과 외부 조사 결과를 한 응답에서 구분하지 않으면 후보가 사실처럼 보일 수 있다.
**결정:** 모든 결과는 `CANONICAL_MODE`, `SOURCE_EXPLORATION_MODE`, `EXTERNAL_RESEARCH_MODE` 중 하나 이상의 표시된 구간을 가진다. 서로 다른 모드의 진술을 조용히 혼합하지 않는다.
**제외 대안:** 모델이 내부적으로 자료를 섞고 최종 답변만 표시.
**영향:** ResultArtifact·Citation·UI·API·내보내기에 mode 필드가 필요하다.
## ADR-062 — 진술 단위 Grounding과 Conflict·Gap 보존
**상태:** Accepted
**결정:** 사실적 진술은 Canonical 또는 Evidence Citation, 외부 조사 Citation, 명시적 추론이나 unknown·gap·conflict 상태 중 하나를 가진다. 문서 링크 하나를 답변 전체 근거로 대체하지 않는다.
**제외 대안:** 답변 끝 참고문헌만 제공하거나 모델 confidence로 무근거 문장을 허용.
**영향:** assertion-level Citation coverage와 원문 복귀 검증이 필요하다.
## ADR-063 — 콘텐츠의 사실 층·표현 층 분리와 멀티모달 결과 검증
**상태:** Accepted
**결정:** 문서·보고서·슬라이드·이미지 생성에서 사실 층과 문체·구조·디자인의 표현 층을 분리한다. 시각 원본을 이해하거나 시각 산출물을 만들면 실제 렌더링을 멀티모달 AI가 검증한다.
**제외 대안:** 표현 개선 과정에서 사실을 자유롭게 재작성하거나 텍스트만 검사.
**영향:** ContentArtifact schema, render digest, visual validation revision이 필요하다.
## ADR-064 — ActionCandidate와 외부 실행의 강한 분리
**상태:** Accepted
**결정:** 일정·메일·파일·API 등 외부 변경 가능 결과는 구조화된 `ActionCandidate`로만 생성하며 생성 자체는 실행 권한을 갖지 않는다.
**제외 대안:** 자연어 요청을 Connector tool call로 직접 변환.
**영향:** Step 19 위험 판단과 Step 21 승인·Preflight 없이는 execute 상태에 진입할 수 없다.
## ADR-065 — 다차원 위험 분류와 불확실 시 상향
**상태:** Accepted
**결정:** 외부 영향·공개 범위·민감도·금전·법률·의료·안전·가역성·규모·권한을 분리 평가해 R0\~R4 정책 등급을 만든다. 불확실한 경우 낮게 추정하지 않고 상향한다.
**제외 대안:** 모델이 단일 위험 점수를 생성해 자동 허용.
**영향:** 결정적 Risk Policy Engine과 버전화된 RiskDecision이 필요하다.
## ADR-066 — 제한 위임과 고위험 실행별 재승인
**상태:** Accepted
**결정:** 기본은 외부 쓰기 직전 명시적 승인이다. 사전 위임은 좁고 되돌리기 쉬운 R2 Action에 한해 유형·대상·기간·횟수·비용·민감도 한도를 가진 `ActionDelegationPolicy`로 허용한다. 공개·금전·계약·의료·보안·민감정보·비가역 작업은 실행별 재승인을 요구할 수 있다.
**제외 대안:** 광범위한 영구 자동 실행 또는 모든 쓰기의 무조건 수동 승인.
**영향:** 만료·회수·긴급 중지·사용 이력과 digest 재검증이 필요하다.
## ADR-067 — 읽기 결과 제공과 외부 공유·게시의 경계
**상태:** Accepted
**결정:** 개인 화면·로컬 다운로드·읽기 API·비공개 초안은 읽기 결과다. 발송·게시·외부 업로드·공유 권한 변경·외부 문서 수정은 Step 21 Action이다.
**제외 대안:** ‘내보내기’라는 이름 아래 외부 업로드까지 읽기로 처리.
**영향:** DeliveryPackage target과 destination에 따라 쓰기 경계를 강제한다.
## ADR-068 — 출력·내보내기의 Provenance와 접근 정책 상속
**상태:** Accepted
**결정:** 화면·문서·파일·API 결과는 사용 모드, Canonical snapshot, Projection watermark, Citation, 모델·정책 버전과 접근 범위를 보존한다. 가장 제한적인 포함 자원의 정책을 상속한다.
**제외 대안:** 내보내기에서 경고·Citation·권한 메타데이터 제거.
**영향:** ProvenanceManifest, redaction, 공유 링크 만료와 cache key 격리가 필요하다.
## ADR-069 — 결과 Artifact의 불변 Version과 재현 한계 명시
**상태:** Accepted
**결정:** ResultArtifact·DeliveryPackage는 불변 revision으로 보존한다. 동일 버전 재생성은 논리적 재현이며 생성형 출력의 byte-identical 결과를 보장하지 않는다. 외부 조사 snapshot이 없으면 완전 재현 불가를 표시한다.
**제외 대안:** 현재 결과만 덮어쓰기 또는 재생성 결과를 원본과 동일하다고 간주.
**영향:** 원 생성물 보존과 reproduce lineage가 필요하다.
## ADR-070 — Versioned Connector Capability 계약
**상태:** Accepted
**결정:** 외부 Action은 `describe → validate → preview → preflight → execute → verify → compensate` capability 계약을 사용한다. 지원하지 않는 기능을 AI가 임의 API 조합으로 우회하지 않는다.
**제외 대안:** 자유 형식 tool call과 Connector별 비표준 실행.
**영향:** capability manifest, schema version, 권한·idempotency·보상 선언이 필요하다.
## ADR-071 — Action revision에 결속된 승인 토큰
**상태:** Accepted
**결정:** `ActionAuthorizationToken`은 사용자·Action revision·preview digest·Connector·대상·범위·만료에 결속한다. 승인 후 중요한 값이 바뀌면 토큰을 재발급한다. Connector secret과 토큰은 분리하고 모델에 노출하지 않는다.
**제외 대안:** 채팅의 일반적인 “승인” 상태를 이후 모든 실행에 재사용.
**영향:** one-time token, delegation token, revocation ledger가 필요하다.
## ADR-072 — 외부 Exactly-once 가정 금지와 Outcome Unknown 상태
**상태:** Accepted
**결정:** 내부 idempotency·ledger·fencing과 Connector key를 사용하지만 외부 exactly-once를 가정하지 않는다. timeout·응답 유실 뒤 결과가 불명확하면 `OUTCOME_UNKNOWN`으로 두고 readback 전 자동 재시도하지 않는다.
**제외 대안:** timeout이면 무조건 재호출하거나 성공·실패를 추정.
**영향:** verify/readback, dedupe와 수동 복구 경로가 필요하다.
## ADR-073 — 보상 Action은 Rollback이 아니며 별도 승인
**상태:** Accepted
**결정:** 이미 발생한 side effect의 반대 작업은 보상 후보이며 원래 작업을 없애는 rollback이 아니다. 보상도 위험 판단·승인·Audit을 다시 거친다.
**제외 대안:** 실패 시 자동 반대 호출 또는 모든 작업이 되돌릴 수 있다고 표시.
**영향:** compensation capability와 irreversible 표시가 필요하다.
## ADR-074 — Connector Secret의 AI·로그 격리
**상태:** Accepted
**결정:** 사용자·프로젝트·Connector별 secret vault와 최소 권한을 사용한다. secret 값은 AI prompt·결과·일반 로그·클라이언트에 포함하지 않고 reference만 전달한다.
**제외 대안:** 모델이 token을 읽어 직접 API 요청 생성.
**영향:** secret access Audit, rotation·revocation, 환경 격리가 필요하다.
## ADR-075 — 피드백의 유형별 재진입과 조용한 장기 기억 금지
**상태:** Accepted
**결정:** 피드백을 사실·근거·표현·선호·Directive 의도·평가·오류·새 자료·Action 결과로 분리하고 Step 1·2·3·4·9·10·13·14·18·21의 적절한 경로로 돌린다. 단일 표현 수정·평가·감정 반응을 Fact나 장기 개인화로 자동 승격하지 않는다.
**제외 대안:** 대화 피드백을 자동 기억하거나 결과 수정으로 Canonical을 직접 변경.
**영향:** FeedbackEvent, signature·suppression, Directive 승인과 impact 재계산이 필요하다.
