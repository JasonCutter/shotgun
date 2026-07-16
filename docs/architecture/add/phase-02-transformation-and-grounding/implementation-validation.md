<!-- Canonical source: https://app.notion.com/p/39f5181d71ad81a8b1e6ef32bca74aec -->

## 문서 관리
- 범위: Phase 2 구현 검증·운영 설정·후속 Phase 연기 항목
- 상태: **추적 중**
- 관련 ADD: [Phase 2 — 변환·근거화 ADD](https://app.notion.com/p/39f5181d71ad81b89cd8cfa001fad0b5)
## 확정된 정책이며 재논의하지 않는 항목
- 모든 시각 의미 처리와 시각 산출물 검증에 멀티모달 AI 사용
- 스캔 문자 인식은 멀티모달 capability로 처리하고 전통 OCR은 선택적 보조 도구로 사용
- 모든 비한국어 의미 구간 자동 번역
- 번역의 Citation은 원문 EvidenceSpan에 결속
- 원본 보존·보안 검증은 즉시 수행
- 비용성 AI 작업은 일요일 밤 `WeeklyAIBatch`로 실행
- 모호한 StableSource 관계는 자동 병합하지 않음
- EvidenceSpan은 새 SourceVersion에 자동 재부착하지 않음
## 형식별 변환기 검증
- PDF·DOCX·PPTX·XLSX·HTML Adapter별 원본 locator coverage
- 동일 입력·동일 버전·동일 설정의 결정성
- LibreOffice·OpenDataLoader 실행 시 Phase 1 격리 정책 준수
- 손실 없는 인코딩·표·수식·숨김 요소 보존
- 대용량 sheet와 복합 문서의 메모리·시간 한도
## 멀티모달 Provider 검증
- Gemini·GPT 계열과 대체 provider의 한국어 문자 인식 정확도
- 복잡한 표, 병합 셀, 차트 축·범례, 도형 연결, 슬라이드 배치 해석 품질
- page·region bbox와 locator 정확도
- 불확실 영역 표시와 추측 억제 성능
- 모델별 비용·지연·rate limit·데이터 처리 정책
- 전통 OCR 보조 text layer의 교차 검증 효과와 비용 대비 가치
## SourceMap·Evidence 구현 검증
- SourceMap segment 압축·조회·migration 전략
- PDF bbox, DOM path, spreadsheet cell, PPTX shape locator의 공통 API
- 원문 viewer와 highlight·scroll 복귀
- 고아 Evidence 탐지와 재생성 성능
- CompositeEvidence의 중첩·정렬·표시 방식
## StableSource 판정 검증
- 제목·작성자·명시 ID·구조·유사도 신호의 평가 corpus
- 자동 연결 가능 기준과 사용자 확인 기준
- 잘못된 병합·분리의 영향 복구 방식
- 같은 내용의 다른 형식·번역본·재저장본 처리
## 번역 구현 검증
- provider·모델별 품질·비용·개인정보 처리
- 문장 분할·병합의 다대다 alignment coverage
- 고유명사·전문 용어 glossary와 사용자 수정 재사용
- 숫자·단위·날짜·코드·수식·표 구조 보존 검사
- 부분 실패와 재번역 우선순위
## WeeklyAIBatch 운영 설정
- 일요일 밤 정확한 실행 시각
- 시스템이 꺼져 있거나 Job이 밀린 경우 catch-up 규칙
- 주간·월간 비용 한도
- 우선순위와 최대 병렬 실행 수
- 장시간 작업의 중단·재개·부분 실패 표시
- 긴급 자료를 주간 Batch 전에 명시적으로 실행하는 예외 정책
## gbrain 연계 검증
- Minion Queue와 Shotgun Job payload 어댑터
- Job·Attempt·batch_id·idempotency key 스키마
- locking·lease·fencing·retry·recovery
- Activity·Audit·비용 기록과 UI 연결
## 후속 Phase로 연기
- Claim·Entity·Relation·Event·Decision·Action 후보 스키마와 모델 라우팅: Phase 3
- 후보 Provenance·직접 근거 검증: Phase 3
- 기존 Canonical 지식과의 비교·충돌·영향 계산: Phase 4
- 승인과 Canonical 반영: Phase 4\~5
- 검색·문서·내보내기에서의 Citation 패키징: Phase 6
- 멀티모달 기반 시각 콘텐츠 생성의 제품별 템플릿·품질 기준: Phase 6 또는 개별 기능 설계
