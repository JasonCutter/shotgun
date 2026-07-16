<!-- Canonical source: https://app.notion.com/p/39f5181d71ad81e68a22f268707c0dcd -->

## 문서 관리
- 범위: Phase 3 정책 미결·구현 검증·후속 Phase 연기 항목
- 상태: **사용자 결정 1건 · 구현 검증 추적 중**
- 관련 ADD: [Phase 3 — 지식 후보 생성 ADD](https://app.notion.com/p/39f5181d71ad813494a2f1fed9a2b854)
## 사용자 결정 대기
### P3-DEC-01 — 기본 WeeklyAIBatch의 추론 후보 생성 범위
- A안 권장: 원문에 직접 명시된 후보만 자동 생성
- B안: 직접 후보와 근거 기반 추론 후보를 함께 자동 생성
- 결정 페이지: [Phase 3 — 사용자 결정 1건](https://app.notion.com/p/39f5181d71ad810c8da0c6d93db9f7ff)
## 확정된 정책이며 재논의하지 않는 항목
- `FactCandidate`를 만들지 않음
- AI 결과는 승인 전 후보
- CandidateStore와 gbrain Canonical Fact 저장소 분리
- 직접 후보는 원문 EvidenceSpan 필수
- 번역문은 Evidence가 아님
- 시각 후보는 원본 region과 멀티모달 revision에 결속
- 대화 자료는 기본 자동 후보 생성에서 제외
- 후보 수정·재추출은 불변 CandidateRevision과 Attempt로 기록
- 품질을 하나의 종합 trust score로 합치지 않음
- ActionCandidate는 외부 실행 권한을 갖지 않음
- 의미 중복·충돌·Fact Priority·Canonical 비교는 Phase 4에서 처리
## Candidate schema 구현 검증
- 유형별 payload의 정확한 필드·enum·JSON Schema
- 안정 `candidate_id`와 revision ID 생성 방식
- 후보 fingerprint와 같은 Attempt 내 정확 중복 접기
- n-ary relation의 argument 표현
- modality·negation·quantifier·attribution·temporal scope 표현
- `UserDirectiveProposal`과 일반 DecisionCandidate 경계
## CandidateStore 구현 검증
- 저장 backend와 transaction 경계
- CandidateSet·CandidateRevision 조회 성능
- SourceVersion·EvidenceSpan·Provenance graph 인덱스
- 논리 폐기·tombstone·물리 삭제 정책 연계
- 대규모 후보 집합의 pagination·streaming
- Phase 4 인계 Manifest 생성의 멱등성
## 추출 Provider·모델 검증
- 한국어·영어·혼합 언어별 structured extraction 정확도
- Claim·Entity·Relation·Event·Decision·Action 유형별 평가 corpus
- 표·차트·슬라이드·이미지 후보의 멀티모달 grounding
- 긴 문서의 EvidenceBundle 크기와 인접 문맥 범위
- provider별 schema 준수·비용·지연·rate limit·민감정보 처리
- 모델 폴백 시 손실 범위와 재시도 정책
## 보조 NLP·deterministic validator 검증
- 문장 분할·토큰화·NER·날짜 파서의 언어별 성능
- 숫자·단위·부정·조건·인용 주체 보존 검사
- 표 cell·PDF bbox·PPTX shape·HTML DOM Evidence 검증
- 보조 NLP 오탐이 최종 후보를 확정하지 않도록 하는 contract test
- 동일 입력·동일 버전의 결과 비교와 nondeterministic diff 표시
## semantic verifier 검증
- `SUPPORTED`, `PARTIALLY_SUPPORTED`, `CONTRADICTED`, `UNSUPPORTED`, `UNRESOLVED` 판정 corpus
- 직접 추출보다 강한 단정·범위 확대·시점 변경 탐지
- 별도 verifier 실행 조건과 비용 상한
- 추출 모델과 verifier 모델 조합의 편향·공통 오류
- verifier 실패 시 후보 보류·재시도·수동 검토 상태
## Provenance·품질 신호 검증
- dependency graph 저장·순환 탐지
- prompt template·tool·policy version 기록 범위
- 민감 원문을 로그에 복제하지 않는 redaction
- field-level Evidence link의 저장 크기와 조회 성능
- 다차원 품질 신호의 enum·설명·validator version
- dependency 변경 시 stale 전파와 재검증 범위
## WeeklyAIBatch 운영 설정
- Phase 2 Batch와 Phase 3 extraction Job의 dependency·우선순위
- 후보 유형별 병렬도와 비용 예산
- 긴급 SourceVersion의 수동 선실행 예외
- Batch 중 모델 장애·부분 실패·resume
- 후보 폭증 방지를 위한 extraction budget와 warning 기준
## Phase 4로 연기
- 기존 Canonical Entity와 후보의 동일성·Alias 병합
- 문서 간 의미 중복·부분 중복·충돌
- 출처 권위·Fact Priority·시간 유효성
- 후보 묶음·의존성·ChangeSet 구성
- Decision·Action 후보의 Review Center 우선순위와 알림 UX
- 사용자 승인·수정·보류·거절
- UserDirectiveProposal의 공식 Directive 승격
## 후속 Phase로 연기
- 승인 후보의 gbrain Fact·Claim·Entity·Relation 반영: Phase 5
- KnowledgeGap 기반 자동 발견·질문·조사 후보: Phase 5 Step 17
- Candidate·Evidence를 활용한 답변·콘텐츠·Action 생성: Phase 6
- 외부 조사 모드의 웹 자료 수집·표시·승인 경계: Phase 6
