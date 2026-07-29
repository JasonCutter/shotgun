<!-- Canonical source: https://app.notion.com/p/39f5181d71ad81fc99e6d38b85a6e010 -->

## 문서 관리
- 범위: Section 18.1\~18.8
- 상태: **확정 설계**
## 18.1 사용 모드
Shotgun은 모든 활용 결과에 하나의 기본 사용 모드를 지정하고 화면·API·내보내기에 표시한다.
### `CANONICAL_MODE`
- 승인된 Canonical 자원과 readiness를 충족한 Compiled Truth·검색·Graph Projection만 사용한다.
- 현재 유효한 지식뿐 아니라 역사·예정·미해결 Conflict를 필요에 따라 포함한다.
- Fact와 Claim을 구분하고 Citation은 Canonical 자원에서 원문 Evidence까지 추적한다.
- 기본 개인 검색·답변·보고서 모드다.
### `SOURCE_EXPLORATION_MODE`
- 사용자가 선택한 SourceVersion·EvidenceSpan·번역·시각 분석과 명시적으로 선택된 미승인 후보를 탐색한다.
- 결과는 `Source 탐색` 또는 `미승인 후보 포함`으로 표시하고 Canonical 결론과 분리한다.
- 여러 Source를 비교할 수 있지만 자료 간 AI 종합은 `DERIVED_INFERENCE`로 표시한다.
- 결과를 자동 Canonical·Directive로 저장하지 않는다.
### `EXTERNAL_RESEARCH_MODE`
- 웹·Connector·외부 API 등 현재 외부 자료를 조사한다.
- 조사 시각·검색 범위·외부 출처·접근 실패와 최신성 한계를 기록한다.
- 외부 조사 결과는 `EXTERNAL_RESEARCH` Provenance를 가진 후보·결과이며 Canonical과 별도 표시한다.
- 공식 지식으로 반영하려면 Phase 1\~4 또는 적절한 후보 재진입을 거친다.
한 응답에 여러 모드가 필요한 경우 섹션·진술 단위로 모드를 표시한다. AI가 모드를 선택할 수 있지만 사용자에게 숨기지 않으며 사용자가 더 좁은 모드를 지정하면 존중한다. 접근 정책과 안전 정책은 모드보다 우선한다.
## 18.2 질문 해석·검색 계획
모든 요청은 버전화된 `QueryPlan`을 만든다.
필수 필드:
- 사용자 의도와 요청한 결과 유형
- 프로젝트·사용자·접근 범위
- 대상 Entity·주제·시간 범위·언어
- 사용 모드와 필요한 freshness
- Canonical·Compiled Truth·검색·Graph·Source·외부 조사 경로
- 필요한 Connector·도구·멀티모달 입력
- 예상 비용·지연·위험도
- 충돌·Gap·불명확한 요구사항
접근 범위·민감도·readiness 필터는 AI 검색 계획 전에 결정적으로 적용한다. 전체 지식 저장소를 무조건 하나의 프롬프트에 넣지 않고 정확 검색, 필터, Graph traversal, 의미 검색, 원문 복귀를 단계적으로 사용한다.
최신 정보가 필요한 요청은 외부 조사 또는 최신 Source를 요구한다. 최신성 기준을 충족하지 못하면 오래된 자료로 단정하지 않고 제한을 표시한다. 복잡하거나 고위험인 경우 주 분석 모델과 독립 challenger가 검색 누락·범위 오해를 점검할 수 있다.
## 18.3 근거 기반 답변
답변은 `ResultArtifact`와 진술 단위 `AnswerAssertion`으로 표현한다.
각 사실적 진술은 다음 중 하나를 가진다.
- Canonical Fact·Claim·Entity·Relation·Event와 원문 Evidence Citation
- 선택 Source의 EvidenceSpan Citation
- 외부 조사 Citation
- `DERIVED_INFERENCE` 표시와 사용 근거·전제·도출 요약
- `UNKNOWN`, `GAP`, `CONFLICTED`, `TIME_UNCLEAR` 상태
AI는 원문보다 강한 단정, 더 넓은 범위, 다른 주체·시점·수량을 만들지 않는다. Citation이 없는 사실적 진술은 일반 배경 설명·명시적 추론·불확실성으로 구분하거나 제거한다.
Canonical Projection이 `READY_WITH_LAG`, `DEGRADED`, `STALE`이면 해당 상태와 watermark를 결과에 포함한다. 경쟁 Claim이 있으면 하나를 숨겨 단일 Fact처럼 답하지 않고 현재 우선 해석과 반대 근거를 함께 제공한다.
## 18.4 요약·콘텐츠 생성
문서·보고서·이메일·블로그·슬라이드·표·체크리스트·스크립트 등의 결과는 `ContentArtifact`로 만든다.
콘텐츠 생성은 두 층을 구분한다.
- **사실 층:** Canonical·Source·외부 조사 근거, 수치·날짜·인용·고유명사·충돌 상태
- **표현 층:** 구조·문체·길이·설명 순서·예시·시각 디자인·창작 요소
표현을 개선하기 위해 사실 층을 조용히 변경하지 않는다. 창작 예시·가상 시나리오·추정치는 실제 사실과 구분한다. 원문에 없는 사용자 경험이나 수치를 발명하지 않는다.
시각 자료가 입력에 포함되거나 문서·슬라이드·차트·이미지 등 시각 결과를 만들면 실제 렌더링을 멀티모달 AI가 확인한다. 검증 항목에는 잘림, 겹침, 표·축·범례, 이미지와 설명 일치, Citation 위치, 민감정보 노출과 접근성을 포함한다. 생성물 검증 실패는 경고 또는 전달 차단으로 처리하며 조용히 통과시키지 않는다.
## 18.5 행동 후보 생성
외부 상태를 바꿀 가능성이 있는 결과는 텍스트 지시가 아니라 `ActionCandidate`로 분리한다.
필수 필드:
- `action_candidate_id`, revision, 생성 요청
- Action 유형과 Connector capability
- 대상·수신자·외부 자원·파라미터
- 미리보기 내용과 digest
- 실행 전제·정책·필요 권한
- 위험도·민감도·외부 노출 범위
- 되돌릴 수 있음·보상 가능성
- 예상 비용·시간·side effect
- idempotency scope와 중복 가능성
- 사용한 Canonical·Source·외부 조사 근거
ActionCandidate 생성은 실행이 아니다. AI는 대상 주소·파일 경로·금액·시간·수신자처럼 실행에 중요한 값을 추측해 채우지 않는다. 불명확한 값은 unresolved로 남기고 Step 19\~21 검토 전에 확인한다.
## 18.6 인용·충돌·Gap 표시
기본 화면은 읽기 쉬운 결과를 먼저 보여주되 다음 정보를 접을 수 있는 형태로 제공한다.
- 진술별 Citation과 원문 복귀
- Canonical·Source 탐색·외부 조사 모드 배지
- Fact·Claim·추론 구분
- 현재·과거·예정·미해결 Conflict
- Knowledge Gap·누락 Evidence·시간 불명확
- 번역문과 원문 전환
- 모델 간 중요한 불일치
- 사용 Projection readiness와 생성 버전
인용 수가 많아도 문서 수준 링크 하나로 축약하지 않는다. 표·차트·이미지에서 나온 내용은 원본 page·region·cell·shape·bbox까지 복귀할 수 있어야 한다.
## 18.7 모델·비용·지연 선택
GPT·Gemini·Claude는 `AIProviderPool`에서 capability 기반으로 라우팅한다.
라우팅 입력:
- 텍스트·시각·표·코드·긴 문맥 등 입력 특성
- 결과 유형과 구조화 출력 요구
- 위험도·정확성·최신성
- latency budget·비용 한도·rate limit
- 데이터 처리·지역·민감도 정책
- 모델별 과거 품질 지표
일반 결과는 주 모델 하나를 사용한다. 고위험, 근거 정렬 불량, Conflict, 높은 외부 영향, 모델 불확실성은 다른 공급자의 독립 challenger를 추가한다. 다수결은 진실 판정이 아니며 모델별 근거와 불일치를 보존한다.
사용자에게는 필요한 경우 모델 수·비용·지연 예상과 실제 사용량을 보여준다. 공급자 장애 시 다른 모델로 전환하면 새 Attempt와 이유·결과 차이를 기록한다.
## 18.8 대화·결과의 ChangeSet 승격
대화에서 사용자가 사실을 수정하거나 결정을 내리거나 반복 지침을 말해도 대화 본문을 Canonical에 직접 쓰지 않는다.
다음 제안으로 분류한다.
- 새 자료·외부 사실 제공 → Step 1 입력 후보
- 기존 후보의 근거·표현 수정 → Phase 3 후보 revision
- Canonical 사실·관계 변경 → Phase 4 `DraftChangeSet` 후보
- 반복 선호·금지·예외 → `UserDirectiveProposal`
- 일회성 문체·결과 수정 → 현재 ResultArtifact revision
장기 상태로 승격할 때는 사용자의 명시적 의도와 대상 범위를 확인하고 원래 대화·결과·Citation을 Provenance로 결속한다. 단순 만족도·감정·표현 수정은 Fact나 Directive로 승격하지 않는다.
