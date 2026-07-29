<!-- Canonical source: https://app.notion.com/p/39f5181d71ad81b89cd8cfa001fad0b5 -->

## 문서 관리
- 상태: **완료**
- 범위: Phase 2 — 변환·근거화, Step 4\~7
- 결정 기준일: 2026-07-16
- 기준 입력: Phase 1의 `OriginalAsset`, `IntakeItem`, `Phase2IntakeManifest`
- 다음 Phase 인계: `Phase3EvidenceManifest`
- 저장 기준본: Notion
## 1. 목적
Phase 2는 원본을 변경하지 않고 형식별 콘텐츠와 시각 의미를 추출하여 `DocumentIR`로 구조화하고, 모든 유효 결과를 원본 위치로 되돌릴 수 있는 `SourceMap`과 `EvidenceSpan`에 결속한다. 외국어 자료는 한국어로 자동 번역하지만 근거는 항상 원문에 남긴다.
Phase 3는 이 Phase가 만든 검증된 근거만 사용해 Claim·Entity·Relation 등의 후보를 생성한다.
## Phase 2 완료 선언
Step 4\~7의 설계, 멀티모달 AI 필수 적용, 외국어 자동 번역, 주간 AI Batch, SourceMap·EvidenceSpan, StableSource·SourceVersion, 오픈소스 재사용 경계와 Phase 3 인계 계약이 모두 확정됐다. 남은 항목은 구현 제품·라이브러리·수치·벤치마크 선택이며 Phase 2 정책 완료를 막지 않는 구현 검증 대기 항목으로 관리한다.
## 2. 완료 조건
완료 판정일: 2026-07-16
승인자: 사용자
승인 방식: 사용자 직접 ADD 검토와 Notion 댓글 반영 후 최종 확정
Phase 2는 다음 조건을 모두 만족할 때 완료된다.
1. Step 4\~7의 출력 계약과 품질 게이트가 구현 가능한 수준으로 정의됐다.
2. 필수 콘텐츠가 원본 page·slide·sheet·cell·region·text range로 역추적된다.
3. 시각 정보가 의미에 영향을 주는 자료는 멀티모달 AI 검토를 통과한다.
4. `StableSource`와 `SourceVersion`의 보수적 판정 결과가 기록된다.
5. 모든 비한국어 의미 구간의 번역 Job과 원문 정렬 계약이 정의됐다.
6. 변환기·분석기·멀티모달 provider·번역기·프롬프트·정책 버전을 재현 가능하게 기록한다.
7. `Phase3EvidenceManifest` 스키마 검증을 통과한다.
## 3. 사용자 확정 정책
### 3.1 멀티모달 AI 필수
페이지 배치, 표, 차트, 도형, 이미지, 스캔 문자, 슬라이드와 시트의 시각 구성이 의미에 영향을 주는 경우 실제 렌더링을 멀티모달 AI가 확인한다.
시각 자료를 바탕으로 요약·설명·지식 후보·문서·슬라이드·도표·이미지를 만들 때도 원본 시각 자료를 모델 입력에 포함한다. 새로 생성한 시각 산출물은 렌더링 후 다시 멀티모달 AI 검증을 거친다.
순수 텍스트 자료에는 의미 없는 이미지 렌더링을 강제하지 않는다.
### 3.2 외국어 자동 번역
모든 비한국어 의미 구간은 별도 번역 버튼 없이 자동 번역한다.
- 원본과 `TranslationRevision`을 함께 보존한다.
- 한국어 번역문은 후보 작성과 사용자 표시용 파생 결과다.
- 번역문은 독립 Source 또는 Evidence가 아니다.
- 모든 Citation은 원문 `EvidenceSpan`을 가리킨다.
- 번역 실패는 원문 기반 지식 후보 생성을 막지 않는다.
### 3.3 주간 AI Batch
원본 저장, 체크섬, 형식·인코딩·구조·보안·격리·정확 중복 검사는 접수 즉시 수행한다.
비용이 드는 멀티모달 분석, 자동 번역, 요약, 지식 후보 생성, 시각 자료 생성·검증은 일주일치를 모아 일요일 밤 운영 설정 시각에 `WeeklyAIBatch`로 시작한다.
Batch는 하나의 거대한 요청이 아니다. Source Item·처리 단계별 독립 Job·Attempt를 같은 `batch_id`로 묶고 실패한 항목만 재시도한다.
## 4. Phase 공통 불변 조건
- 원본 바이트와 원본 표현을 수정하지 않는다.
- 정규화 결과와 SourceMap은 같은 변환 Attempt에서 동시에 만든다.
- 필수 콘텐츠가 원본 위치로 매핑되지 않으면 Phase 3 근거로 사용하지 않는다.
- 파서·멀티모달 분석·번역 결과는 버전화된 파생 자산이다.
- 재처리는 과거 결과를 덮어쓰지 않고 새 Attempt와 revision을 만든다.
- 접근 범위와 민감도는 모든 파생 자산과 provider 요청에 상속한다.
- 결정적 파서와 멀티모달 AI는 상호 보완하며 어느 한쪽이 다른 쪽을 조용히 대체하지 않는다.
- 멀티모달 결과가 불명확한 부분을 추측으로 완성하지 않는다.
- AI가 만든 설명은 승인 전 후보이며 Canonical Fact가 아니다.
- `MaterialKind=CONVERSATION`은 구조·검색·표시 변환은 가능하지만 자동 지식 후보 생성에는 전달하지 않는다.
## 5. 처리 흐름
`Phase2IntakeManifest`
→ `TransformerAdapter.probe`
→ 결정적 콘텐츠·구조 추출
→ 시각 단위 렌더링
→ 멀티모달 시각 분석
→ `DocumentIR` + `SourceMap`
→ 구조·언어·화자·표·시간 분석
→ `StableSource`·`SourceVersion` 판정
→ `EvidenceSpan` 생성·검증
→ 외국어 자동 번역·원문 정렬
→ `Phase3EvidenceManifest`
## 6. 오픈소스·기존 구현 연계
### gbrain
**재사용 우선 영역**
- Minion Queue
- Job·Attempt
- idempotency key
- locking·retry·timeout·recovery
- Audit 이벤트 연결
Shotgun은 Phase 2 payload, 상태 어댑터, 품질 게이트와 Provenance 결속만 추가한다.
### lucasastorian/llmwiki
**선별 재사용·검증 후보**
- HTML element 구조·offset 추출
- PDF·Office 변환 패턴
- LibreOffice·OpenDataLoader 연계 방식
- DOM·Text·PDF 하이라이트와 원문 복귀 UI
다음 방식은 채택하지 않는다.
- Markdown 결과를 Canonical 구조로 사용
- 손실 디코딩 `errors=replace`
- 외부 이미지 자동 다운로드·임베드
- Spreadsheet 100행 절단
- `data_only=True`만으로 수식 처리
- Office→PDF를 원본 OOXML locator의 대체물로 사용
### ddsyasas/llm-wiki
비용·모델·처리 상태·승인 UX만 참고한다. 기존 ingest가 Wiki를 직접 수정하는 방식과 SQLite·파일 기반 backend는 사용하지 않는다.
### Inkeep OpenKnowledge
Agent Activity, Burst Diff, 2D Graph, 원문·변경 표시의 개념을 참고한다. 공개 코드와 라이선스가 확인되기 전까지 Phase 2 코드 의존성은 만들지 않는다.
### 범용 라이브러리와 AI provider
- `openpyxl` 등 검증된 형식별 파서
- 언어 감지 라이브러리
- Gemini·GPT 계열 등 `MultimodalAnalysisProvider`
- 교체 가능한 `TranslationProvider`
- 전통 OCR은 선택적 보조 text layer·교차 검증·폴백
### Shotgun 고유 구현
- `DocumentIR`
- `SourceMap`
- `EvidenceSpan`
- `VisualAnalysisRevision`
- `TranslationRevision`
- `StableSource`·`SourceVersion` 판정 정책
- 형식 간 공통 품질 게이트와 Phase 인계 계약
## 7. Step 4 — 콘텐츠 추출·정규화·SourceMap
### 7.1 Adapter와 라우팅
모든 형식은 `TransformerAdapter`의 `probe → extract → validate` 계약을 따른다. Adapter ID·버전·의존성·설정 digest·지원 capability를 기록한다.
다른 Adapter로 폴백하면 새 Attempt를 만들며 이유와 손실 범위를 남긴다. 무언 폴백은 금지한다.
상태 예시:
`SUPPORTED`, `SUPPORTED_WITH_LIMITS`, `VISUAL_ANALYSIS_REQUIRED`, `VISUAL_ANALYSIS_FAILED`, `UNSUPPORTED_CAPABILITY`, `EXTRACTION_FAILED`, `MAPPING_FAILED`, `RETRYABLE_FAILURE`
### 7.2 DocumentIR
공통 typed node를 사용하되 원본 형식별 locator를 잃지 않는다.
- 문서: document, section, heading, paragraph, list, code, quote
- 페이지: page, slide, shape, speaker_note
- 데이터: table, row, cell, sheet, formula
- 시각: image, figure, caption, chart, diagram, visual_group
- 보조: footnote, comment, metadata
- 대화·시간: speaker_turn, time_segment
명시적 구조와 AI가 추론한 구조를 분리한다. 추론 구조에는 `inferred`, 방법, confidence, analyzer version을 기록한다.
### 7.3 정규화
- 출력 텍스트는 UTF-8·LF 투영을 사용한다.
- 원본 바이트는 그대로 보존한다.
- NFKC, 대소문자 통일, stemming, 자동 맞춤법 교정을 수행하지 않는다.
- 의미 있는 공백·코드 들여쓰기·수식·숫자·단위를 조용히 바꾸지 않는다.
- 표의 Canonical 구조는 셀 grid와 주소이며 Markdown 표는 표시용이다.
- 수식 원문과 cached value를 분리하고 계산하지 않는다.
### 7.4 SourceMap 동시 생성
각 DocumentIR node와 text range는 생성 시점부터 하나 이상의 원본 locator에 결속된다.
Operation 예시:
`COPY`, `DECODE`, `LINE_ENDING_NORMALIZE`, `WHITESPACE_PROJECT`, `STRUCTURE_PROJECT`, `MULTIMODAL_VISUAL_INTERPRET`, `OCR_RECOGNIZE`, `SYNTHETIC_SEPARATOR`
품질:
`EXACT`, `STRUCTURAL`, `MULTIMODAL_DERIVED`, `OCR_DERIVED`, `APPROXIMATE`, `UNMAPPED`
원본에 없는 구분자·표시 제목은 `synthetic=true`이며 단독 Evidence로 사용하지 않는다.
### 7.5 멀티모달 시각 분석
PDF page, slide, sheet viewport, image, chart, diagram과 복잡한 표는 렌더링 후 승인된 멀티모달 AI가 확인한다.
`VisualAnalysisRevision`은 다음을 기록한다.
- 원본 렌더링 digest
- page·slide·sheet·region bbox
- 문자·시각 설명·object relation·reading order
- 불확실 영역
- provider·model·prompt schema version
- 처리 시각·Attempt·비용
시각 자료가 있는데 분석이 실패하면 text-only 결과로 조용히 진행하지 않는다. 필요한 시각 의미가 누락되면 Phase 3 인계를 차단한다.
## 8. Step 5 — 구조·언어·문서 동일성 분석
### 8.1 구조와 시각 영역
결정적 파서 구조를 우선 보존하고, 멀티모달 AI가 읽기 순서·시각적 그룹·표 병합·차트 축·범례·도형 연결을 보완한다.
### 8.2 언어
문서·구간·문장 단위로 감지하며 코드·URL·고유명사·짧은 토큰의 오탐을 통제한다. 혼합 언어 구간은 언어별 span으로 보존한다.
### 8.3 화자·시간
명시 화자·타임스탬프와 추론 결과를 구분한다. 모호한 화자를 임의 확정하지 않는다. 시간 값에는 원문 표현, 파싱값, timezone과 추론 여부를 기록한다.
### 8.4 표·시트·셀
Sheet 이름, row·column, cell address, formula, cached value, merged range, hidden state와 시각적 header/group 분석을 함께 보존한다.
### 8.5 StableSource·SourceVersion
정확 중복이 아닌 자료의 문서 동일성은 제목·작성자·구조·명시 ID·기존 사용자 관계 의도 등 복합 신호로 판단한다.
- 충분히 강한 신호: 기존 StableSource의 새 SourceVersion
- 명백히 다른 자료: 새 StableSource와 첫 SourceVersion
- 모호함: 자동 병합 금지, 사용자 확인 대상
물리 원본이 같다는 이유만으로 StableSource 관계를 확정하지 않는다.
### 8.6 사용자 수정
화자·언어·구조·관계 수정은 원본 분석을 덮어쓰지 않고 `AnalysisRevision` overlay로 저장한다. 이전 값과 변경 이유를 유지한다.
## 9. Step 6 — SourceMap·EvidenceSpan
### 9.1 표준 계약
SourceMap은 normalized range와 source locator, operation, mapping quality, 원본·변환 revision을 연결한다.
EvidenceSpan은 특정 `SourceVersion`과 원본 hash에 고정된다.
### 9.2 Locator 유형
- text byte·character·line range
- paragraph·DOM·XML·JSON path
- PDF page·bbox
- PPTX slide·shape·text range
- spreadsheet sheet·cell·range
- image region bbox
- audio·video time range
### 9.3 근거 단위
문장·문단·셀·시각 영역 등 주장을 직접 뒷받침하는 최소 단위를 사용한다. 여러 비연속 근거는 `CompositeEvidence`로 묶되 개별 Span을 유지한다.
### 9.4 불변성과 고아 근거
원본 또는 변환 결과가 바뀌어도 기존 EvidenceSpan을 새 위치로 자동 재부착하지 않는다. 새 SourceVersion에서 재생성·재검증한다.
Fuzzy relocate는 사용자 화면의 탐색 힌트로만 사용한다.
범위 이탈, hash 불일치, locator 해석 실패, 필수 mapping 누락은 고아 근거로 표시하고 Phase 3 인계를 차단한다.
### 9.5 원문 복귀
모든 Citation은 원문 viewer의 정확한 page·cell·region·text range로 이동할 수 있어야 한다. 원본과 파생 표현의 차이를 표시한다.
### 9.6 Phase 3 인계
`Phase3EvidenceManifest`에는 다음이 포함된다.
- SourceVersion과 OriginalAsset
- DocumentIR revision
- SourceMap revision
- 검증된 EvidenceSpan 집합
- VisualAnalysisRevision
- 언어·구조 분석 revision
- TranslationRevision 참조
- 경고·제외 범위·접근·민감도
- 사용된 모델·도구·정책 버전
## 10. Step 7 — 한국어 자동 번역
### 10.1 실행 대상
한국어가 아닌 의미 구간에 자동 번역 Job을 생성한다. 코드·수식·URL·식별자처럼 번역이 의미를 훼손할 수 있는 항목은 원문 보존 규칙을 적용한다.
### 10.2 원문 정렬
번역 구간은 하나 이상의 원문 EvidenceSpan과 정렬한다. 문장 분할·병합으로 1:1 정렬이 불가능하면 다대다 alignment를 사용하고 coverage를 기록한다.
### 10.3 TranslationRevision
- 원문 언어·대상 언어
- 원문 EvidenceSpan
- 번역 텍스트와 alignment
- provider·model·prompt·glossary version
- 생성 시각·비용·상태·quality signal
- 이전 번역과 재번역 이력
### 10.4 품질과 실패
숫자·단위·날짜·고유명사·전문 용어·표 구조의 보존 검사를 수행한다. 실패 구간은 원문으로 표시하고 다음 Batch 또는 명시적 재처리에서 독립 재시도한다.
사용자가 번역을 수정하면 원본 번역을 삭제하지 않고 `UserTranslationRevision`으로 보존한다.
## 11. Job·Batch·상태 계약
상위 상태:
`QUEUED`, `RUNNING`, `COMPLETED`, `COMPLETED_WITH_WARNINGS`, `ACTION_REQUIRED`, `BLOCKED`, `FAILED_RETRYABLE`, `FAILED_FINAL`, `CANCELLED`
Job 유형 예시:
- transform
- visual-analysis
- structure-analysis
- stable-source-resolution
- evidence-validation
- translation
- phase3-manifest
각 Job은 `OriginalAsset hash + 작업 유형 + 도구·모델·설정 버전` 기반 멱등성 키를 가진다.
WeeklyAIBatch는 Job을 묶는 운영 단위일 뿐 결과의 원자적 단위가 아니다.
## 12. 확정 ADR
- ADR-018 — 변환과 SourceMap 동시 생성 및 매핑 실패 차단
- ADR-019 — 형식별 Adapter·공통 DocumentIR과 무언 폴백 금지
- ADR-020 — StableSource 보수적 판정과 모호한 자동 병합 금지
- ADR-021 — EvidenceSpan 불변 버전 결속과 자동 재부착 금지
- ADR-022 — 외국어 자료 자동 번역과 원문 Evidence 우선
- ADR-023 — 분석·사용자 수정의 revision overlay
- ADR-024 — Phase 2 오픈소스 선별 재사용과 책임 경계
- ADR-025 — 시각 의미 처리와 시각 산출물 검증의 멀티모달 AI 필수 원칙
- ADR-026 — 즉시 원본 검증과 주간 AI Batch 실행 분리
## 13. 구현 검증 대기
- 형식별 Adapter의 locator coverage와 결정성
- LibreOffice·OpenDataLoader의 격리 정책 준수
- Gemini·GPT 계열 provider의 한국어 문자·표·차트·도형 인식 품질과 비용
- region locator 정확도와 멀티모달 결과 교차 검증
- 전통 OCR 보조 계층의 실제 가치
- StableSource 판정 corpus와 threshold
- SourceMap 압축·조회·migration
- 원문 복귀 viewer
- 번역 alignment·glossary·provider 비용
- WeeklyAIBatch 실행 시각·catch-up·우선순위·비용 한도
- gbrain Minion Queue 어댑터
## 14. Phase 2에서 하지 않는 일
- Claim·Entity·Relation 등의 실제 지식 후보 확정
- AI 출력의 Fact 승격
- Canonical 지식 변경
- 충돌 해결과 사용자 승인
- Compiled Truth 갱신
- 외부 Action 실행
이 항목들은 Phase 3 이후의 책임이다.
