<!-- Canonical source: https://app.notion.com/p/39f5181d71ad8176abd7efa4671706fe -->

## 문서 관리
- 범위: Section 22.1\~22.9
- 상태: **확정 설계**
## 22.1 피드백 유형
모든 피드백은 `FeedbackEvent`로 기록하고 다음 유형을 구분한다.
- `FACT_CORRECTION`: 사실·수치·시간·Entity·Relation 수정 주장
- `EVIDENCE_CORRECTION`: 잘못된 Citation·원문 연결·근거 누락
- `EXPRESSION_EDIT`: 문체·표현·길이·구조 수정
- `PREFERENCE`: 개인 선호·출력 형식·설명 방식
- `USER_DIRECTIVE_INTENT`: 반복 적용할 금지·규칙·예외 의도
- `RESULT_RATING`: 유용성·품질·만족도 평가
- `ERROR_REPORT`: 시스템·검색·렌더링·Connector 오류 신고
- `NEW_MATERIAL`: 새 파일·URL·텍스트·외부 결과 제공
- `ACTION_OUTCOME`: 외부 Action의 실제 성공·실패·후속 상태
- `SUPPRESSION`: 특정 제안을 다시 보지 않으려는 의도
하나의 메시지가 여러 유형을 가질 수 있으나 각 조각의 대상과 범위를 분리한다. AI는 분류를 제안하고 결정적 규칙이 가능한 경로를 제한한다.
## 22.2 반환 경로 분류
피드백은 다음 경로로 라우팅한다.
- 새 자료·외부 증거 → Step 1 Intake 후보
- 후보의 값·근거·Provenance 수정 → Phase 3 CandidateRevision
- Canonical Fact·Claim·Entity·Relation 수정 → Phase 4 DraftChangeSet 후보
- 반복 선호·금지·예외 → Phase 4 `UserDirectiveProposal`
- 현재 결과의 표현 수정 → ResultArtifact revision
- Citation·SourceMap 오류 → Phase 2 재검증
- 추론 계보 오류 → Phase 3 Step 9 재검증
- Action 결과 → ActionOutcomeEvidence 또는 새 Source 후보
- 단순 평가 → 품질 지표·모델 routing 평가용 비Canonical 기록
라우팅 결과와 이유를 사용자에게 보여준다. 피드백을 저장할 경로가 불명확하면 자동 장기화하지 않고 현재 결과 수정으로 제한한다.
## 22.3 원래 맥락·Provenance 보존
`FeedbackEvent`는 다음 맥락에 결속한다.
- 원래 사용자 요청·대화 turn
- ResultArtifact·DeliveryPackage·ActionExecutionRecord revision
- 수정 대상 assertion·문단·표·시각 영역·Action parameter
- 당시 사용 모드·Canonical snapshot·Projection watermark
- Citation·Evidence·모델·프롬프트·정책
- 피드백 시각·사용자·프로젝트·접근 범위
부분 문장 수정도 전체 결과와 대상 위치를 함께 기록한다. 과거 결과가 stale하더라도 당시 상태를 덮어쓰지 않고 새 피드백 revision을 만든다.
## 22.4 사실·선호·표현 경계
- “나는 짧은 답변이 좋아”는 선호 또는 Directive 후보이지 외부 Fact가 아니다.
- “이 문장을 더 부드럽게”는 표현 수정이지 지식 변경이 아니다.
- “프로젝트 X의 마감일은 8월 1일이야”는 사용자 Claim이며 근거·범위 검토가 필요한 변경 후보다.
- “앞으로 이 프로젝트에서는 항상 원문을 먼저 보여줘”는 반복 Directive 의도다.
- “좋았어/별로야”는 결과 평가이며 자동 Fact·Directive가 아니다.
사용자 발언은 사용자 자신·의도에 관한 직접 근거가 될 수 있으나 외부 세계의 사실 근거와 분리한다. AI가 선호를 일반 성격·능력·정체성 Fact로 확대하지 않는다.
## 22.5 승인·검증 재진입
피드백 유형별 재진입:
- 새 자료 → Step 1\~3 원본 보존 후 표준 파이프라인
- Source·Citation 오류 → Step 4\~7 재변환·근거화
- 후보 내용·계보 오류 → Step 8\~9
- Canonical 수정 → Step 10 비교부터 Phase 4 승인
- 표현만 수정 → Step 18 콘텐츠 revision, Canonical 영향 없음
- User Directive 의도 → Step 14 별도 승인
- Action parameter 수정 → Step 18 ActionCandidate 새 revision 후 Step 19\~21 재검증
- Action 결과의 지식화 → Source 또는 후보로 재진입
이미 승인된 Action·ChangeSet을 피드백으로 직접 수정하지 않는다. 새 revision과 새 승인 경계를 만든다.
## 22.6 중복·루프 방지
피드백과 재진입은 `feedback_signature`를 가진다.
서명 입력:
- 피드백 유형·대상 resource·대상 field
- 정규화된 의미와 범위
- 기준 snapshot·result revision
- 사용자·프로젝트
동일 피드백이 반복되면 기존 처리 상태를 재사용한다. 거절·보류·suppression 이유를 보존하고 같은 근거·같은 정책에서 동일 제안을 반복하지 않는다.
다음 변화가 있을 때만 재등장할 수 있다.
- 새 Evidence·SourceVersion
- Canonical·Directive·Priority 변경
- 대상 결과·Action revision 변경
- 사용자가 suppression을 해제
- 정책상 재검토 기간 도래
자동 피드백 → Discovery → 후보 → 결과 → 자동 피드백의 무한 순환을 금지한다. 자동 생성 피드백은 사람이 제공한 피드백과 구분하고 depth·cost·횟수 budget을 적용한다.
## 22.7 영향·재처리
사실·근거·Directive·Action 결과 수정은 Phase 4의 Recursive Impact를 다시 계산한다.
영향 대상:
- Canonical Fact·Claim·Conflict·History
- Compiled Truth·검색·Semantic Graph
- 기존 답변·요약·문서·추천·내보내기
- 공개·전달된 결과의 정정 필요성
- 예약·실행된 Action과 후속 ActionCandidate
- cache·readiness·Discovery Gap
이미 외부에 게시·전송된 결과를 자동 수정하거나 회수하지 않는다. `CorrectionCandidate`, 후속 메시지, 파일 revision, 공개 정정 등 별도 Action 후보를 생성하고 승인받는다.
## 22.8 사용자 상태·결과 표시
피드백 상태:
`RECEIVED → CLASSIFYING → ROUTED → VALIDATING → APPLIED` 또는 `NEEDS_REVIEW`, `DEFERRED`, `REJECTED`, `SUPPRESSED`, `FAILED`
사용자는 다음을 볼 수 있어야 한다.
- 어떤 유형으로 분류됐는가
- 어느 Phase·Step으로 돌아갔는가
- 현재 Job·검토·승인 상태
- 무엇이 바뀌었고 무엇은 바뀌지 않았는가
- 기존 결과·Canonical·외부 Action에 미친 영향
- 거절·보류·suppression 이유
- 새 결과·ChangeSet·Directive·Action 링크
표현 수정처럼 즉시 반영 가능한 결과도 Canonical까지 변경됐다는 오해가 없도록 범위를 표시한다.
## 22.9 History·개인화 경계
피드백 이력은 append-only revision으로 보존하며 사용자는 허용 범위에서 철회·삭제·Directive 비활성화를 요청할 수 있다. 법적·감사상 필요한 최소 이력과 삭제 가능한 개인화 데이터를 구분한다.
장기 개인화에 사용할 수 있는 것은 사용자가 명시적으로 승인한 `UserDirective`, 명확한 출력 선호와 프로젝트 설정이다. 다음은 자동 개인화에 사용하지 않는다.
- 단일 결과에 대한 일회성 문체 수정
- 감정적 반응·모호한 평가
- 외부 사실 수정 주장
- 고위험 행동 승인
- 민감한 개인 정보에서 추론한 선호
사용자는 활성 Directive·선호의 출처·범위·마지막 사용·영향을 확인하고 수정·비활성화할 수 있어야 한다. 개인화 규칙 변경은 과거 결과를 조용히 다시 쓰지 않는다.
## Phase 6 생명주기 종료·재진입
Step 22는 고정된 다음 Phase로 넘기지 않는다. 결과는 다음 중 하나로 닫히거나 이전 Phase로 되돌아간다.
- 정보 결과 제공 완료
- 외부 Action 실행·검증 완료
- 피드백 평가만 기록
- 새 자료 Intake
- Candidate·ChangeSet·Directive 재진입
- Action 수정·재승인
모든 경로는 correlation ID와 Activity·Audit으로 연결한다.
