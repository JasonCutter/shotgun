<!-- Canonical source: https://app.notion.com/p/39f5181d71ad81b08c9dc3607cdb3d05 -->

## 문서 관리
- 범위: Phase 2 ADR-018\~ADR-026
- 상태: **Accepted**
- 기준일: 2026-07-16
- 관련 문서: [Phase 2 — 변환·근거화 ADD](https://app.notion.com/p/39f5181d71ad81b89cd8cfa001fad0b5)
## ADR-018 — 변환과 SourceMap 동시 생성 및 매핑 실패 차단
**상태:** Accepted
**맥락:** 변환이 끝난 뒤 원본 위치를 사후 추정하면 인용이 틀리거나 원문 복귀가 불가능해질 수 있다.
**결정:** `DocumentIR`과 `SourceMap`을 같은 Attempt에서 동시에 생성한다. 필수 콘텐츠가 원본 위치로 매핑되지 않으면 Phase 3 인계를 차단한다.
**제외 대안:** Markdown 변환 후 문자열 검색으로 인용 위치를 복구하는 방식.
**영향:** 모든 Adapter는 locator와 mapping quality를 출력해야 한다.
## ADR-019 — 형식별 Adapter·공통 DocumentIR과 무언 폴백 금지
**상태:** Accepted
**맥락:** 형식별 도구가 제각각 결과를 만들면 후속 처리와 재현이 불가능하다.
**결정:** 모든 변환기는 `TransformerAdapter` 계약과 공통 `DocumentIR`을 사용한다. 다른 도구로 폴백할 때는 새 Attempt와 이유·손실 범위를 기록한다.
**제외 대안:** 도구 실패 시 사용자에게 알리지 않고 다른 변환기를 자동 사용.
**영향:** Adapter·의존성·설정 버전이 Provenance에 포함된다.
## ADR-020 — StableSource 보수적 판정과 모호한 자동 병합 금지
**상태:** Accepted
**맥락:** 비슷한 제목이나 내용만으로 문서를 병합하면 다른 자료의 버전 이력이 섞일 수 있다.
**결정:** 명시 ID, 제목, 작성자, 구조, 사용자 관계 의도 등 복합 신호를 사용한다. 충분히 강한 경우에만 기존 StableSource의 새 SourceVersion으로 연결하고 모호하면 사용자 확인 대상으로 둔다.
**제외 대안:** 의미 유사도 threshold 하나로 자동 병합.
**영향:** 자동화율보다 문서 정체성 보존을 우선한다.
## ADR-021 — EvidenceSpan 불변 버전 결속과 자동 재부착 금지
**상태:** Accepted
**맥락:** 원문 변경 뒤 fuzzy match로 과거 근거를 자동 이동하면 다른 문장을 근거로 연결할 수 있다.
**결정:** EvidenceSpan은 특정 SourceVersion과 원본 hash에 고정한다. 변경 시 새 Span을 생성·검증하며 기존 Span을 자동 재부착하지 않는다.
**제외 대안:** 문자열 유사도로 Canonical Evidence를 자동 갱신.
**영향:** Fuzzy relocate는 UI 탐색 힌트로만 사용한다.
## ADR-022 — 외국어 자료 자동 번역과 원문 Evidence 우선
**상태:** Accepted
**맥락:** 사용자는 외국어 자료가 들어오면 별도 버튼 없이 한국어 번역을 원한다. 번역을 독립 근거로 사용하면 번역 오류가 사실로 승격될 수 있다.
**결정:** 모든 비한국어 의미 구간에 자동 번역 Job을 생성하고 원본과 `TranslationRevision`을 함께 저장한다. 한국어 후보 작성에 번역문을 사용할 수 있지만 모든 Evidence와 Citation은 원문 EvidenceSpan을 가리킨다.
**제외 대안:** 필요한 구간만 번역, 수동 버튼 번역, 번역본을 독립 Source로 등록.
**영향:** 번역 실패는 원문 기반 후보 생성을 막지 않는다.
## ADR-023 — 분석·사용자 수정의 Revision Overlay
**상태:** Accepted
**맥락:** 화자·언어·구조 분석을 사용자가 수정할 수 있어야 하지만 원래 분석 결과와 실행 이력도 보존해야 한다.
**결정:** AI·분석기 결과를 덮어쓰지 않고 `AnalysisRevision`과 사용자 overlay를 누적한다.
**제외 대안:** 현재값만 유지하거나 원본 분석을 직접 수정.
**영향:** 사용자 화면은 유효 revision을 보여주되 전체 이력을 추적할 수 있다.
## ADR-024 — Phase 2 오픈소스 선별 재사용과 책임 경계
**상태:** Accepted
**맥락:** 4개 레퍼런스의 전체 런타임을 합치면 중복 저장소·Job·지식 엔진이 생긴다.
**결정:** gbrain의 Job·Attempt·복구 기반을 우선 재사용하고, lucas llmwiki의 변환·locator·viewer 패턴을 선별 검증한다. ddsyasas와 OpenKnowledge는 주로 UX 참고로 사용한다. SourceMap·EvidenceSpan·StableSource 정책은 Shotgun이 소유한다.
**제외 대안:** 네 프로젝트를 병렬 런타임으로 유지하거나 Markdown 중심 변환 결과를 Canonical로 사용.
**영향:** 모든 외부 구현은 Shotgun Adapter와 공통 계약 뒤에 위치한다.
## ADR-025 — 시각 의미 처리와 시각 산출물 검증의 멀티모달 AI 필수 원칙
**상태:** Accepted
**맥락:** OCR 또는 텍스트 추출만으로는 표 병합, 차트 축·범례, 도형 관계, 페이지 배치와 이미지 의미를 잃을 수 있다.
**결정:** 시각 정보가 의미에 영향을 주는 모든 원본은 실제 렌더링을 승인된 멀티모달 AI가 확인한다. 이를 바탕으로 자료·지식 후보·시각 산출물을 만들 때도 원본 시각 자료를 모델 입력에 포함하고, 생성된 결과는 렌더링 후 다시 멀티모달 검증한다. 결과는 `VisualAnalysisRevision`과 원본 region에 결속한다.
**제외 대안:** 전통 OCR 중심 구조, text-only 지식화, 특정 모델 제품에 영구 고정.
**영향:** `MultimodalAnalysisProvider`를 교체 가능한 계약으로 두며 전통 OCR은 보조 text layer·검증·폴백으로 제한한다.
## ADR-026 — 즉시 원본 검증과 주간 AI Batch 실행 분리
**상태:** Accepted
**맥락:** 사용자는 번역·이미지 분석·요약 등 비용성 AI 처리를 일주일치 모아 일요일 밤 실행하기를 원한다. 원본 검증까지 미루면 자료 손실과 위험 파일 방치가 발생한다.
**결정:** 원본 저장·체크섬·형식·구조·안전·격리·중복 검사는 접수 즉시 수행한다. 멀티모달 분석·번역·요약·지식 후보·시각 자료 생성·검증은 `WeeklyAIBatch`로 실행한다. Source Item·단계별 독립 Job을 같은 `batch_id`로 묶고 실패 항목만 재시도한다.
**제외 대안:** 모든 처리를 즉시 실행, 원본 검증까지 주간 지연, 일주일치를 하나의 단일 AI 요청으로 합침.
**영향:** 정확한 실행 시각·비용 한도·우선순위·catch-up은 운영 설정으로 관리한다.
