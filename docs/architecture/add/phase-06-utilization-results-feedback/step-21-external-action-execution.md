<!-- Canonical source: https://app.notion.com/p/39f5181d71ad816fa85dcd062a2fc0ca -->

## 문서 관리
- 범위: Section 21.1\~21.9
- 상태: **확정 설계**
## 21.1 Action 유형·Connector 계약
외부 변경은 자유 형식 tool call이 아니라 버전화된 `ConnectorCapability`와 `ActionContract`를 사용한다.
Action 유형 예시:
- 메일·메시지 작성·발송·회신·전달
- 일정 생성·변경·취소·응답
- 파일 생성·업로드·수정·이동·보관·삭제
- 문서·데이터베이스·이슈·PR 변경
- 외부 API·Webhook 호출
- 알림·게시·공유 권한 변경
Connector 계약 단계:
`describe_capability → validate_input → preview → preflight → execute → verify → compensate(optional)`
각 capability는 읽기·쓰기, 대상 범위, 필요한 권한, idempotency 지원, 되돌리기·보상 가능성, 비밀정보 요구, rate limit과 오류 의미를 선언한다. 지원하지 않는 기능을 AI가 임의 API 조합으로 우회하지 않는다.
## 21.2 승인·권한 토큰
실행은 `ActionAuthorizationToken`을 요구한다.
토큰 결속 항목:
- 사용자·승인자·역할
- ActionCandidate·Action revision·preview digest
- Connector·capability·대상·수신자
- 허용 파라미터 범위·횟수·비용
- 민감정보 범위
- 발급 시각·만료·one-time 여부
- 적용 ActionDelegationPolicy
- 취소·회수 상태
기본은 Action revision별 one-time 토큰이다. 제한 위임은 정책 범위 안에서만 반복 토큰을 만들 수 있다. 대상·본문·첨부·금액·시간·권한이 승인 후 바뀌면 토큰을 재발급해야 한다. 토큰은 Connector 자격 증명과 분리하며 모델에 노출하지 않는다.
## 21.3 실행 전 점검
`ActionPreflight`는 실제 실행 직전에 현재 외부 상태를 다시 확인한다.
점검 항목:
- 대상·수신자·리소스가 실제 존재하며 승인 대상과 일치하는지
- 현재 버전·ETag·일정 상태·파일 상태
- 실행 본문·첨부·파라미터 digest
- 민감정보·비밀정보·외부 공개 범위
- 중복 실행 ledger와 최근 유사 Action
- Connector 권한·토큰 만료·rate limit
- 예상 비용·수량·시간대
- 정책·Directive·법적·안전 조건
- compensation 가능 여부
외부 상태가 바뀌었거나 미리보기와 실제 변경이 다르면 실행하지 않고 새 미리보기·승인을 요구한다. AI는 Preflight 결과를 설명하지만 통과 여부를 임의로 변경하지 않는다.
## 21.4 실행·멱등성
`ActionExecution`은 안정적인 `execution_id`와 idempotency key를 가진다.
원칙:
- 동일 승인·revision·대상에 대해 결정적 idempotency key 생성
- 내부 Job은 lease·fencing token으로 중복 worker 실행 방지
- Connector가 idempotency를 지원하면 외부 key 전달
- 지원하지 않으면 실행 ledger·외부 검색·readback으로 중복 위험 최소화
- 순서 의존 Action은 dependency와 sequence를 명시
- bulk Action은 항목별 실행 상태와 atomicity 한계를 표시
외부 시스템에서 완전한 exactly-once를 보장한다고 가정하지 않는다. 요청 timeout 뒤 결과가 불명확하면 즉시 재시도하지 않고 `OUTCOME_UNKNOWN`으로 검증 경로에 보낸다.
## 21.5 재시도·시간 초과·보상
오류는 다음으로 분류한다.
- 입력·권한·정책 실패: 수정 전 재시도 금지
- rate limit·일시 장애: backoff 재시도 가능
- timeout·응답 유실: 외부 상태 검증 후 결정
- 부분 성공: 항목별 상태와 후속 처리
- 영구 실패: 사용자 복구 경로
재시도는 idempotent하거나 중복 여부를 검증할 수 있는 경우에만 자동 수행한다. 취소는 아직 실행되지 않은 Job을 중단하는 것이며 이미 발생한 외부 side effect를 없애지 않는다.
`compensate`는 가능한 경우 반대 작업을 제안하는 것이며 완전한 rollback과 동일하지 않다. 보상 Action도 새 위험 판단·승인·Audit을 요구한다. 메일 발송처럼 되돌릴 수 없는 작업은 보상 불가로 명시한다.
## 21.6 결과·외부 ID·증거
`ActionExecutionRecord`는 다음을 기록한다.
- execution·candidate·authorization·Job·Attempt ID
- 시작·종료 시각과 상태
- Connector·capability·버전
- 요청 digest와 안전하게 정리된 파라미터
- 외부 객체 ID·thread ID·event ID·file revision 등
- 응답 status·오류 code·rate limit
- verify/readback 결과와 확인 시각
- 실제 변경 전후 요약 또는 digest
- 비용·처리량·보상 가능성
외부 응답 본문 전체를 무조건 로그에 저장하지 않는다. 필요한 증거만 민감정보 정책에 맞게 보존한다. 성공 응답을 받았어도 verify가 실패하면 `SUCCEEDED_UNVERIFIED`로 구분한다.
## 21.7 Audit·History 연결
추적 체인은 다음을 연결한다.
`사용자 요청 → ResultArtifact → ActionCandidate → RiskDecision → Preview → 승인·토큰 → Preflight → Job·Attempt → Connector call → verify → 결과 → FeedbackEvent`
각 단계는 correlation ID와 이전 revision을 가진다. 사용자에게는 누가 무엇을 승인했고 외부에서 무엇이 바뀌었는지 시간순 Activity로 보여준다.
외부 Action 결과는 곧 Canonical Fact가 아니다. 실행 결과가 지식 변경을 의미하면 Step 22에서 `ActionOutcomeEvidence` 또는 Source 입력으로 전환해 Phase 3\~4 검토를 거친다.
## 21.8 비밀정보·Connector 권한
Connector 자격 증명은 전용 secret vault에 암호화해 보관하고 사용자·프로젝트·Connector별로 격리한다.
원칙:
- OAuth scope·API permission 최소화
- access token을 모델 prompt·결과·일반 Audit·클라이언트에 노출하지 않음
- 짧은 수명 token·rotation·revocation 지원
- service credential과 사용자 credential 분리
- 테스트·개발·운영 자격 증명 분리
- secret 접근 자체를 Audit
- Connector 연결 해제 시 예약 Job·위임 토큰 재검증
- 비밀 값 대신 secret reference ID만 사용
AI는 필요한 capability만 요청하며 자격 증명 값을 읽거나 조합하지 않는다.
## 21.9 실패 후 사용자 복구
복구 화면은 모호한 “실패” 대신 현재 상태와 가능한 조치를 제공한다.
상태:
- `NOT_EXECUTED`
- `BLOCKED_PREFLIGHT`
- `RUNNING`
- `SUCCEEDED_VERIFIED`
- `SUCCEEDED_UNVERIFIED`
- `PARTIALLY_SUCCEEDED`
- `FAILED_RETRYABLE`
- `FAILED_TERMINAL`
- `OUTCOME_UNKNOWN`
- `COMPENSATION_REQUIRED`
- `COMPENSATED`
사용자는 안전 재시도, 파라미터 수정 후 새 승인, 외부 상태 다시 확인, 남은 항목만 실행, 보상 Action 제안, 수동 처리 지침을 선택할 수 있다. 이미 성공한 항목을 실수로 다시 실행하지 않도록 기본 선택에서 제외한다.
지원 정보에는 사용자에게 안전한 오류 설명, Connector 상태, 외부 ID, 마지막 검증 시각과 Audit 링크를 포함한다. 비밀정보나 내부 stack trace는 노출하지 않는다.
