<!-- Canonical source: https://app.notion.com/p/39f5181d71ad814da2eceb5d12394f43 -->

## 문서 관리
- 범위: Phase 6 구현 기술·벤치마크·운영 설정
- 상태: **추적 중**
- 관련 ADD: [Phase 6 — 활용·결과·피드백 ADD](https://app.notion.com/p/39f5181d71ad81948c94cbf0a894ea01)
## 확정 정책이며 재논의하지 않는 항목
- Canonical·Source 탐색·외부 조사 모드 분리
- 사실 진술의 Citation·추론·Gap·Conflict 표시
- 시각 이해·시각 산출물의 멀티모달 AI 검증
- ActionCandidate 생성과 실행 권한 분리
- 다차원 위험 분류와 불확실 시 상향
- 기본 쓰기 실행 직전 승인과 제한된 R2 위임
- 읽기 API와 외부 쓰기 Action 분리
- 내보내기의 Provenance·접근정책 상속
- 외부 exactly-once 가정 금지
- Connector secret의 AI·로그 격리
- 피드백의 유형별 재진입과 조용한 기억 금지
## 검색·답변 구현 검증
- QueryPlan의 의도·시간·프로젝트·freshness 정확도
- exact·hybrid·Graph·Source 검색 orchestration 품질
- claim-level Citation coverage·오인용·누락률
- Conflict·Gap·stale Projection 표시 이해도
- 외부 조사 최신성·출처 다양성·실패 처리
- GPT·Gemini·Claude별 답변·요약·장문 품질·비용·지연
## 멀티모달·콘텐츠 검증
- 시각 원본 포함 여부와 page·region grounding
- DOCX·PPTX·PDF·HTML 렌더링 품질
- 표·차트·축·범례·이미지·캡션 일치
- overflow·겹침·잘림·폰트 대체·접근성
- 민감정보 노출 탐지와 redaction
- 시각 검증 실패의 차단·경고 기준
## 위험 정책 검증
- R0\~R4 분류 평가 corpus
- false-low와 과도한 상향 비율
- 법률·의료·재정·보안·민감정보 도메인 별 정책
- ActionDelegationPolicy의 범위·만료·회수·긴급 중지
- 승인 digest 변경·stale Projection·모델 불일치 재승인
- 위험 설명과 안전 대안의 사용자 이해도
## 출력·API·내보내기 검증
- 읽기 API 자원·cursor·snapshot·ETag 계약
- 후보·민감정보 존재 여부의 권한 밖 유출 방지
- Markdown·HTML·PDF·Office·JSON·CSV 변환기
- CSV formula injection·HTML active content·Office macro 안전성
- ProvenanceManifest와 원문 Citation portability
- large result streaming·cancel·resume·cache isolation
- 접근성·한국어 기본·원문·번역 전환
## Connector·Action 실행 검증
- Connector capability schema와 version migration
- Gmail·Calendar·Drive·GitHub·Notion 등 각 Connector preflight·verify 의미
- AuthorizationToken 발급·만료·회수·one-time 사용
- idempotency key·ledger·lease·fencing·순서 보장
- timeout·응답 유실·OUTCOME_UNKNOWN readback
- bulk·partial success·compensation·irreversible Action UX
- 외부 ID·receipt·증거와 민감 로그 최소화
- Connector secret vault·scope·rotation·revocation
## 피드백·재진입 검증
- FeedbackEvent 자동 분류 정확도
- 사실·선호·표현·Directive 경계 오분류율
- Step 1·2·3·9·10·13·14 재진입 contract
- feedback_signature의 중복·loop 억제율과 오억제율
- 기존 결과·Canonical·Action impact 재계산
- 외부 게시 결과의 정정 후보와 재승인
- 개인화 Directive의 출처·범위·비활성화 UX
## 운영 설정
- 모델별 latency·cost budget과 challenger trigger
- 읽기 결과 캐시 TTL·접근 범위 key
- 대형 내보내기 size·time·retention 한도
- Action preview·authorization token 만료 시간
- Connector retry·backoff·timeout 수치
- Feedback·Action Audit 보존 기간
## 구현 이후 검토할 항목
- 고위험 Action 유형별 위임 가능 여부 세부표
- 실제 Connector별 보상 가능성·한계
- 외부 조사 Source의 장기 보존·재접근 정책
- 공개 결과의 정정·철회·재게시 UX
- 전체 6개 Phase end-to-end 성능·비용·안전성 검증
