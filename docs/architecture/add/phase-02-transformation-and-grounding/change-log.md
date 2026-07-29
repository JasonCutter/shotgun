<!-- Canonical source: https://app.notion.com/p/39f5181d71ad8197b069c809317f91c7 -->

## 문서 관리
- 범위: Phase 2 설계·결정·저장소 운영 변경
- 상태: **누적 기록**
- 관련 ADD: [Phase 2 — 변환·근거화 ADD](https://app.notion.com/p/39f5181d71ad81b89cd8cfa001fad0b5)
## 2026-07-16
### Phase 2 설계 운영 방식 전환
31개 Section을 각각 긴 회의로 진행하지 않고 Step 4\~7의 핵심 정책·계약을 통합 설계해 ADD에 기록하기로 했다. 사용자 결정이 필요한 제품 경험·비용·외부 처리 경계만 별도 Notion 결정안으로 분리했다.
### 오픈소스 연계 검토
- gbrain Minion Queue를 Job·Attempt·멱등성·잠금·재시도·복구의 우선 재사용 기반으로 결정했다.
- lucasastorian/llmwiki의 HTML 구조·offset, PDF·Office 변환 패턴과 Highlight viewer를 선별 재사용 후보로 정했다.
- ddsyasas/llm-wiki는 비용·상태·승인 UX 참고로 제한했다.
- Inkeep OpenKnowledge는 공개 코드·라이선스 확인 전까지 Activity·Diff·Graph UI의 개념 참고로만 사용한다.
- SourceMap·EvidenceSpan·StableSource 정책은 Shotgun 고유 책임으로 확정했다.
### Step 4 핵심 설계
형식별 `TransformerAdapter`, 공통 `DocumentIR`, 보수적 정규화, 변환과 SourceMap 동시 생성, 무언 폴백 금지, 파생 자산·재현성과 부분 실패 규칙을 확정했다. ADR-018·019에 기록했다.
### Step 5 핵심 설계
명시적 구조 우선, 혼합 언어·화자·시간·표·시각 영역 분석, StableSource와 SourceVersion의 보수적 판정, 사용자 수정 revision overlay를 확정했다. 모호한 문서 동일성은 자동 병합하지 않는다. ADR-020·023에 기록했다.
### Step 6 핵심 설계
SourceMap 스키마, 형식별 locator, EvidenceSpan·CompositeEvidence, 불변 버전 결속, 원문 복귀, 고아 근거 검증과 `Phase3EvidenceManifest` 게이트를 확정했다. Fuzzy relocate로 Canonical Evidence를 자동 재부착하지 않는다. ADR-021에 기록했다.
### 외국어 자동 번역 정책
사용자가 외국어 자료의 자동 번역과 원본·번역본 보존을 결정했다. 모든 비한국어 의미 구간에 자동 번역 Job을 생성한다. 번역문은 한국어 후보 작성에 사용할 수 있지만 독립 Source·Evidence가 아니며 모든 Citation은 원문 EvidenceSpan에 결속한다. ADR-022를 확정했다.
### 멀티모달 AI 필수 원칙
사용자가 시각적으로 확인하고 자료를 만들거나 지식으로 변환하는 모든 과정에 멀티모달 AI를 사용하도록 결정했다. 페이지·슬라이드·시트·표·차트·도형·이미지·레이아웃은 실제 렌더링을 멀티모달 AI가 확인한다. 이 자료를 바탕으로 만든 시각 산출물도 렌더링 후 멀티모달 검증을 통과해야 한다. 전통 OCR은 보조 text layer·검증·폴백으로 제한했다. ADR-025에 기록했다.
### 주간 AI Batch 운영 원칙
원본 저장·체크섬·형식·구조·보안·격리는 접수 즉시 수행하고, 멀티모달 분석·번역·요약·지식 후보·시각 자료 생성과 검증은 일주일치를 모아 일요일 밤 실행한다. 자료·단계별 독립 gbrain Job을 같은 `batch_id`로 묶고 실패 항목만 재시도한다. ADR-026에 기록했다.
### ADD Canonical 저장소 전환
Google Drive 원시 Markdown 교체 과정에서 파일 참조·MIME 처리 문제가 반복됐다. 사용자는 완료 문서의 다운로드·프로젝트 정리를 Codex에 맡기고 설계 문서의 정확성에 집중하기로 했다.
진행 중·완료 ADD의 Canonical 작성 위치를 Notion으로 변경했다. Phase 완료 후 Codex가 Notion 문서를 내려받아 프로젝트 `docs/architecture/add/completed`에 정리한다. Google Drive는 ADD 저장소에서 제외한다.
### Notion Canonical 문서 구성
- Project Shotgun ADD 허브
- Phase 2 — 변환·근거화 ADD
- Phase 2 — Architecture Decision Records
- Phase 2 — 미결사항·구현 검증 대기
- Phase 2 — 변경 이력
Notion Canonical 문서 검증 후 Google Drive의 `Project Shotgun ADD` 작업 폴더 전체와 과거 Google Docs ADD 참조본, Markdown Snapshot, 단일 파일 참조본을 삭제했다. ADD 제목 검색 결과가 비어 있음을 확인했다. Knowledge Flow 기준본·Detailed Map·오픈소스 검증 자료는 보존했다.
### Phase 2 완료 처리
사용자가 Phase 2 ADD를 직접 검토하고 Notion 댓글·메모를 남겼으며, OCR을 멀티모달 AI 중심 추출로 전환하고 시각 자료 확인·자료 생성·지식 변환 전 과정에 멀티모달 AI를 필수 적용하도록 최종 결정했다. 자동 번역과 주간 AI Batch 정책도 확정됐다.
Step 4\~7의 정책·계약·오픈소스 연계·ADR·Phase 3 인계 조건이 모두 확정되어 Phase 2를 2026-07-16 완료 처리했다. 남은 라이브러리·모델·운영 수치·벤치마크 항목은 구현 검증 대기이며 Phase 완료를 막지 않는다. 현재 설계 대상은 Phase 3 — 지식 후보 생성으로 전환한다.
