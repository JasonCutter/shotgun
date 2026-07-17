# ADR-093 - Action Candidate Server-side Binding and Approval Snapshot

- 상태: **Proposed - Stage 12.1 P0-2 사용자 승인 대기**
- 날짜: 2026-07-17
- 상위 전략: [Stage 12.1 Hardening Strategy](../../engineering/stage-12-1-hardening-strategy.md)
- 관련 결정: [ADR-091 - Risk-controlled External Action](ADR-091-stage-11-risk-controlled-external-action.md), [ADR-XXX - HTTP Identity and Authorization Boundary](ADR-XXX-http-identity-and-authorization-boundary.md)

## 배경

현재 `POST /actions/preview`는 클라이언트가 만든 완성된 `ValidatedActionCandidate`를 요청 본문으로 받는다. 이 구조에서는 클라이언트가 Candidate, Validation, Evidence, 민감도 또는 실행 대상 값을 바꾼 뒤에도 서버가 이를 실행 준비 입력으로 삼을 위험이 있다.

ADR-091은 Action의 위험도, Preview, 승인, Preflight, 실행, 검증의 순서와 실행 중복 방지 원칙을 이미 결정했다. 이 ADR은 그 결정을 대체하지 않는다. 대신 Action의 **입력 신뢰 경계**를 서버 저장소로 옮겨, 승인한 Preview와 실제 실행이 같은 근거를 사용하도록 보강한다.

P0-1이 만든 Trusted SecurityContext는 이 ADR의 선행 조건이다. Project selector, actor, scope, sensitivity는 HTTP 요청 본문이나 헤더가 아니라 인증과 서버 측 인가 결과에서만 얻는다.

## 결정

### 1. 클라이언트 Action 입력은 참조로 제한한다

Action Preview 요청은 다음 세 값만 받는다.

| 입력               | 의미                                            | 서버 처리                                                                                    |
| ------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `candidateId`      | 실행 후보 식별자                                | 서버 저장소에서 후보를 조회한다.                                                             |
| `expectedRevision` | 사용자가 본 후보의 revision                     | 현재 revision과 다르면 거부한다.                                                             |
| `requestedAction`  | 사용자가 선택한 실행 의도 또는 허용된 operation | 저장된 후보의 허용 operation과 일치하는지 확인한다. 실행 대상이나 매개변수를 덮어쓸 수 없다. |

클라이언트는 `ValidatedActionCandidate`, Validation 결과, Evidence 목록, risk, sensitivity, rendered payload, project ID, approval 정보를 전달하거나 결정할 수 없다. 이러한 값이 Action Preview API에 포함되면 요청 전체를 거부한다.

### 2. Preview 생성 전에 서버가 근거를 재검증한다

서버는 Trusted SecurityContext의 project와 principal을 사용하여 아래 정보를 저장소와 정책에서 직접 다시 읽는다.

1. Action Candidate와 현재 revision
2. Candidate가 참조한 Validation Result와 만료 여부
3. Evidence reference의 존재, Candidate/SourceVersion 소속, digest
4. Source의 sensitivity와 principal의 sensitivity clearance
5. Candidate의 project ownership와 요청 project의 일치
6. 결정적 Risk classification
7. Candidate와 Validation의 expiration 또는 invalidation 상태
8. 현재 principal의 Preview 권한

하나라도 없거나, 변경됐거나, 다른 project에 속하거나, 권한 범위를 벗어나면 Preview를 만들지 않는다. Risk는 Candidate나 클라이언트가 제공한 값이 아니라 서버의 `stage11.action-risk.v1` 정책으로 다시 계산한다.

```text
candidateId + expectedRevision + requestedAction
  -> Candidate 조회
  -> 최신 revision 확인
  -> Validation 조회
  -> Evidence 존재 및 소속 확인
  -> Source sensitivity 확인
  -> Risk 재계산
  -> Preview Snapshot 저장
  -> 사용자 승인
  -> 승인 Snapshot digest 확인
  -> Preflight
  -> Execute
  -> Verify
  -> Audit
```

### 3. Preview Snapshot은 불변의 서버 저장 레코드다

서버는 재검증이 끝난 뒤에만 아래 값을 하나의 불변 `ActionPreviewSnapshot`으로 저장한다.

| Snapshot 값                          | 목적                                 |
| ------------------------------------ | ------------------------------------ |
| candidate ID와 revision              | 승인 대상 후보를 고정한다.           |
| validation ID와 validation digest    | 검증 근거를 고정한다.                |
| evidence IDs와 evidence digest       | 근거 자료를 고정한다.                |
| source sensitivity                   | 민감도 하향 조작을 막는다.           |
| 계산된 risk와 policy version         | 위험 정책 결과를 고정한다.           |
| server-rendered action payload       | 실행 대상과 매개변수를 고정한다.     |
| project ID와 requesting principal ID | project 경계와 요청 주체를 기록한다. |
| 생성 시각과 만료 시각                | 오래된 Preview의 사용을 막는다.      |
| snapshot digest                      | 사용자가 본 Preview 전체의 식별자다. |

`snapshot digest`는 위 값을 정규화하여 계산한다. Snapshot 생성 뒤 Candidate, Evidence, Validation, source sensitivity, policy version 또는 rendered payload가 변경되면 기존 Snapshot은 실행에 사용할 수 없다. 새 Preview와 새 승인이 필요하다.

### 4. 승인은 Snapshot에 결속된 기록이다

승인은 boolean 값이나 클라이언트가 보관하는 token이 아니다. 서버는 다음을 포함한 승인 기록을 저장한다.

- preview snapshot digest
- approver principal ID
- 승인에 사용된 scope와 authentication method
- 승인 시각, 만료 시각
- approval reason 또는 note

승인자는 `action:approve` 권한을 가진 사용자 principal이어야 한다. 승인 요청은 현재 Snapshot digest와 서버가 저장한 Snapshot digest가 정확히 일치할 때만 성공한다. Snapshot이 무효화되거나 만료되면 승인도 자동으로 무효다.

### 5. Execute는 요청 본문이 아니라 승인된 Snapshot만 사용한다

Execute 요청은 `actionId`와 승인된 Snapshot의 식별자만 참조할 수 있다. 서버는 실행 시 다음을 다시 확인한다.

1. 요청 principal의 `action:execute` 권한과 project membership
2. 승인 record의 유효성, 승인 Snapshot digest, 만료 여부
3. Candidate revision, Validation, Evidence digest, source sensitivity의 현재 일치 여부
4. Connector allowlist, Connector 활성화 조건, 지원 operation
5. 이미 실행됐거나 실행 중인 동일 Snapshot인지 여부

실행 payload는 승인된 Snapshot에서만 읽는다. Execute 요청에 들어 있는 Candidate, target, parameter, risk, project 또는 approval 값을 사용하거나 신뢰하지 않는다. Preflight, 단일 Worker claim, `OUTCOME_UNKNOWN`, Verify, compensation Action의 별도 승인 원칙은 ADR-091을 그대로 따른다.

### 6. 거부와 감사 정책

| 상황                                                          | 결과                                                       |
| ------------------------------------------------------------- | ---------------------------------------------------------- |
| Candidate 또는 Validation이 없음                              | `404 ACTION_REFERENCE_NOT_FOUND`                           |
| 다른 project Candidate 또는 Evidence                          | 외부 존재를 드러내지 않는 `404 ACTION_REFERENCE_NOT_FOUND` |
| revision, validation, evidence, sensitivity, payload가 변경됨 | `409 STALE_ACTION_SNAPSHOT`                                |
| Preview 또는 approval 만료                                    | `409 STALE_APPROVAL`                                       |
| scope, membership, sensitivity clearance 부족                 | `403 ACTION_AUTHORIZATION_DENIED`                          |
| 허용되지 않거나 비활성인 Connector                            | `403 ACTION_CONNECTOR_NOT_ALLOWED`                         |
| 요청 본문에 금지된 완성 Candidate/security 값 포함            | `400 ACTION_SERVER_BINDING_REQUIRED`                       |
| Provider 응답 유실 또는 timeout                               | `202 OUTCOME_UNKNOWN`; 자동 재실행 금지                    |

Audit에는 candidate ID/revision, validation/evidence/snapshot digest, policy version, project ID, principal ID, approval/execute/verify 결정과 correlation ID를 append-only로 기록한다. Action payload의 민감 원문, credential, session/API token, Authorization header는 기록하지 않는다.

## 대안 검토

| 대안                                                     | 장점                                                   | 배제 이유                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 클라이언트가 완성된 `ValidatedActionCandidate` 전송      | 현재 구현과 호환된다.                                  | 보안 경계 밖의 Candidate, Validation, Evidence, risk, target을 신뢰하게 된다. |
| Preview 때만 서버 조회하고 Execute 때는 client body 사용 | Preview 생성은 안전해진다.                             | 승인 후 요청 body 변경으로 다른 작업을 실행할 수 있다.                        |
| Execute 때 Candidate를 매번 최신 상태로 다시 렌더링      | 항상 최신 값으로 실행할 수 있다.                       | 사용자가 승인한 Preview와 실제 실행이 달라질 수 있다.                         |
| 서버 재검증 + 불변 Snapshot + 승인 digest                | 승인 대상과 실행 대상이 동일하며 감사·재현이 가능하다. | Snapshot 저장과 invalidation 처리가 필요하다. 채택한다.                       |

## 영향과 이행 원칙

- 이 ADR이 Accepted가 된 뒤 Action Preview API는 참조 입력 contract로 바뀐다. 현재의 full `ValidatedActionCandidate` body는 보안 호환 기간 없이 제거한다.
- UI, E2E, script, test helper는 같은 구현 변경에서 새 요청 contract와 server-generated Preview를 사용하도록 전환한다.
- Module 내부 계약은 후보 저장소와 Validation/Evidence 조회 Port를 명시적으로 받아야 한다. HTTP Adapter가 후보 내용을 Module Command에 주입해서는 안 된다.
- 기존 Stage 11 `ActionExecutionRecord`, row lock, Preflight, Verify, Fake Draft Connector는 유지하되 Snapshot의 근거 digest를 포함하도록 확장한다.
- 실제 Gmail, Calendar, GitHub 등 외부 Connector는 이 ADR의 Acceptance Test와 별도 Connector 승인 조건을 통과하기 전까지 활성화하지 않는다.

## Acceptance Test

다음 테스트가 모두 통과하기 전에는 실제 Connector를 활성화하지 않는다.

1. 존재하지 않는 Candidate 또는 Validation을 Preview할 수 없다.
2. 다른 project의 Candidate, Validation, Evidence를 참조할 수 없다.
3. stale revision을 사용하면 새 Preview가 거부된다.
4. restricted source sensitivity를 낮춰 Preview 또는 Execute할 수 없다.
5. 승인 뒤 Candidate, Validation, Evidence, payload 중 하나라도 바뀌면 Execute가 거부된다.
6. approval snapshot digest나 approval reference를 위조하면 Execute가 거부된다.
7. 같은 승인/Snapshot을 동시에 또는 재전송해도 외부 실행은 한 번만 claim된다.
8. timeout 또는 응답 유실은 `OUTCOME_UNKNOWN`으로 남으며 자동 재실행되지 않는다.
9. 권한 없는 principal은 Preview, Approval, Execute, Verify와 Audit 조회를 할 수 없다.
10. 정상 흐름에서는 서버가 조회한 Candidate와 Evidence로 만든 Preview를 사용자가 승인하고, 동일 Snapshot만 Preflight, Execute, Verify까지 통과한다.

## 결과

- Action Candidate는 실행 명령이 아니라 서버가 재검증해야 하는 참조 대상이 된다.
- 사용자가 승인한 Preview와 Connector가 실행하는 payload가 digest로 연결된다.
- cross-project, stale revision, evidence 변경, sensitivity 하향, 승인 위조를 실행 직전에 차단할 수 있다.
- 이 결정만으로 실제 외부 Action Connector가 활성화되지는 않는다. P0-1 구현, 이 ADR의 구현과 Acceptance Test, 그리고 Connector별 별도 승인이 모두 필요하다.
