# Stage 12.1 P0-2 - Action Candidate Server-side Binding Implementation Plan

- 상태: **승인됨 / 구현 대기**
- 범위: Action Candidate Server-side Binding and Approval Snapshot
- ADR: [ADR-094](../architecture/adr/ADR-094-action-candidate-server-side-binding-and-approval-snapshot.md)
- 선행 ADR: [ADR-093](../architecture/adr/ADR-093-http-identity-and-authorization-boundary.md), [ADR-091](../architecture/adr/ADR-091-stage-11-risk-controlled-external-action.md)
- 제외: 제품 코드, DB migration, 설정, 테스트 코드, 실제 외부 Connector 활성화

## 1. 목표와 고정 경계

P0-2는 클라이언트가 완성된 Action Candidate나 실행 payload를 보내는 경로를 없앤다. Preview는 `candidateId`, `expectedRevision`, `operationKey`만 받고, 서버가 저장된 Candidate·Validation·Evidence·민감도·Risk Policy·Connector allowlist를 다시 확인한다.

이 계획은 다음을 하지 않는다.

- P0-1 인증·세션·API token을 구현하거나 우회한다.
- 실제 Gmail, Calendar, GitHub Connector를 활성화한다.
- Candidate 생성, Validation 의미, Stage 9/10의 Canonical 관계를 변경한다.
- 현재 DB schema를 수정하거나 migration을 작성한다.

## 2. 선행 조건과 통합 구현 순서

P0-2는 P0-1의 Trusted SecurityContext 없이 구현하지 않는다. Action의 project, principal, scope, sensitivity는 ADR-093의 인증·인가 계층이 만든 값만 사용한다.

1. ADR-093과 ADR-094가 Accepted임을 확인하고, 제품 구현은 별도 구현 승인 뒤에만 시작한다.
2. P0-1을 먼저 구현한다. legacy security header와 owner fallback 제거, Browser/API auth, project membership, server-side scope와 sensitivity 검사를 완료한다.
3. P0-1 공격 회귀 테스트를 통과시킨 뒤 P0-2의 Repository Port와 server-side Preview binding을 구현한다.
4. Snapshot, Approval, Execution transaction과 Verify Worker를 구현한다.
5. 기존 UI, E2E, script, test helper를 같은 변경에서 새 API contract로 전환한다.
6. P0-1/P0-2 통합 공격 테스트와 Action contract test를 통과시킨다.
7. 실제 Connector는 별도 Connector 승인과 activation gate가 통과할 때까지 OFF로 유지한다.

## 3. Repository Port 후보

P0-2 Module은 HTTP request body가 아니라 아래 Port를 통해 server-owned record를 읽고 쓴다.

| Port                                  | 최소 책임                                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `ActionCandidateRepositoryPort`       | project ID, candidate ID, revision으로 Candidate와 허용 operation을 읽는다.                         |
| `ValidationRepositoryPort`            | Candidate revision에 결속된 Validation, digest, invalidation/expiry를 읽는다.                       |
| `EvidenceRepositoryPort`              | Evidence 존재, sourceVersion 소속, 결정적 evidence digest set, source sensitivity를 읽는다.         |
| `ActionPolicyPort`                    | risk, risk policy version, approval policy, approver rule, Connector allowlist를 서버에서 계산한다. |
| `ActionPreviewSnapshotRepositoryPort` | canonical Snapshot과 digest를 하나의 transaction으로 immutable 저장·조회한다.                       |
| `ActionApprovalRepositoryPort`        | Snapshot-bound approval grant와 최종 approval record를 저장·만료·조회한다.                          |
| `ActionExecutionRepositoryPort`       | atomic execution claim, 기존 execution 반환, 상태 전이와 append-only audit을 처리한다.              |
| `ActionVerificationRepositoryPort`    | Connector Receipt와 Verify 결과를 `executionId` 기준으로 저장·조회한다.                             |
| `ActionAuditRepositoryPort`           | preview, approval, claim, preflight, execute, verify, denial을 append-only로 기록한다.              |

Port의 입력에는 언제나 `TrustedSecurityContext` 또는 그 server-derived 값만 전달한다. Port가 HTTP header, cookie, Authorization 원문, raw request body를 받지 않는다.

## 4. DB table 및 constraint 후보

아래는 구현 승인 뒤의 migration 설계 후보이며, 이번 작업에서 생성하거나 변경하지 않는다.

| 테이블 후보                    | 핵심 필드                                                                                                                                                                                   | 제약 후보                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `action.preview_snapshots`     | snapshot ID, project ID, candidate ID/revision/digest, validation ID/digest, evidence set digest, sensitivity, risk/policy, connector/operation, canonical payload, snapshot digest, expiry | snapshot은 update 금지; `(project_id, snapshot_digest)` unique                        |
| `action.approval_grants`       | grant ID, snapshot ID/digest, approver principal ID, role/scope, granted/expired time                                                                                                       | `(snapshot_id, approver_principal_id)` unique                                         |
| `action.approvals`             | approval ID, snapshot ID/digest, approval policy version, required rule/count, final status, expiry                                                                                         | `(snapshot_id)` unique; approval ID는 execute reference                               |
| `action.executions`            | execution ID, approval ID, snapshot ID/digest, claim status, claim owner/time, provider receipt reference, outcome                                                                          | `(approval_id)` unique와 `(snapshot_id)` unique로 동일 Snapshot의 중복 외부 호출 차단 |
| `action.verification_receipts` | execution ID, connector receipt digest, verification result, verified principal/worker, verified time                                                                                       | `(execution_id)` unique                                                               |
| `action.audit_events`          | event ID, project ID, action/snapshot/approval/execution ID, actor/principal, policy version, decision, correlation ID                                                                      | append-only; secret/payload 원문 금지                                                 |

Snapshot과 digest는 하나의 DB transaction에서 저장한다. Snapshot update SQL 권한을 주지 않거나, repository가 update를 제공하지 않고 database trigger 또는 권한 정책으로도 update를 거부한다. PostgreSQL row lock 또는 compare-and-set 상태 전환은 execution claim에 사용한다.

## 5. API 변경 계획

| API                                            | 새 contract                                       | 서버 처리                                                                                            |
| ---------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `POST /actions/preview`                        | `{ candidateId, expectedRevision, operationKey }` | server-side Candidate/Validation/Evidence 재검증 뒤 Snapshot 생성                                    |
| `POST /actions/previews/:snapshotId/approvals` | `{ expectedSnapshotDigest, note? }`               | 현재 principal의 승인 권한·self-approval·required rule을 확인하고 approval grant/final approval 생성 |
| `POST /actions/execute`                        | `{ approvalId }`                                  | Approval -> Snapshot -> payload를 조회하고 atomic claim 뒤 실행                                      |
| public Verify API                              | 제공하지 않음                                     | 브라우저·일반 사용자는 Verify 상태를 직접 제출할 수 없음                                             |
| internal `VerifyActionOutcome` command         | `{ executionId }`                                 | 내부 Worker 또는 허가된 Service Principal이 Connector Receipt를 확인해 수행                          |

Preview 또는 Execute body에 target, recipient, parameter, payload, Connector ID, risk, project, Candidate 본문, Validation/Evidence 본문, Snapshot 본문이 있으면 400 `ACTION_SERVER_BINDING_REQUIRED`로 요청 전체를 거부한다. 기존 full `ValidatedActionCandidate` Preview body는 보안 호환 기간 없이 제거한다.

## 6. Snapshot canonicalization

`action-preview-canonical-v1`은 SHA-256 digest 입력을 다음처럼 고정한다.

1. snapshot schema version과 serializer name을 포함한다.
2. object key는 결정적으로 정렬한다.
3. Candidate ID/revision/digest, Validation ID/digest, Evidence ID/digest 목록과 evidence set digest를 포함한다.
4. Evidence 목록은 `(evidenceId, digest)` 기준으로 결정적으로 정렬한다.
5. source sensitivity, risk/risk policy version, approval policy version과 approver rule을 포함한다.
6. Connector ID, operation key, server-rendered payload와 payload digest를 포함한다.
7. project ID, UTC ISO 8601 생성/만료 시각, expiry policy version을 포함한다.
8. 숫자, `null`, 빈 배열의 표현을 고정한다.

serializer 또는 snapshot schema version이 바뀌면 기존 Snapshot digest를 다시 계산하거나 record를 수정하지 않는다. 새 version의 새 Snapshot만 생성한다.

## 7. Approval 및 Execution transaction

### Approval

1. Snapshot ID와 expected digest를 lock 또는 compare-and-set으로 읽는다.
2. Snapshot expiry와 현재 Candidate/Validation/Evidence/sensitivity invalidation을 확인한다.
3. 서버의 Risk Policy가 approval policy version, required approver rule, self-approval 허용 여부, required approval count, role/scope를 계산한다.
4. v1에서는 `action:approve` 권한을 가진 `user` principal만 grant할 수 있다. Service Principal은 사람 승인자를 대체할 수 없다.
5. 현재 단일 소유자 MVP에서는 policy가 허용한 self-approval을 허용한다. v1 `requiredApprovalCount`는 1이며, count를 충족할 때만 서버가 final `approvalId`를 만든다.
6. `selfApprovalAllowed`, `requiredApproverRule`, `requiredApprovalCount`는 Snapshot에 저장하지만 Risk Policy가 서버에서 결정한다. 다중 사용자 분리 승인과 Four-eyes Approval은 향후 별도 ADR/policy version의 범위다.
7. Connector별 활성화 정책은 위험한 operation을 별도로 차단할 수 있으며, 이를 두 번째 승인자 요구로 해석하지 않는다.
8. approval ID는 snapshot ID와 digest에 결속하며 Snapshot 만료 이후에는 유효하지 않다.

### Execution

1. `{ approvalId }`만 받은 뒤 Approval과 Snapshot을 서버에서 조회한다.
2. approval validity, Snapshot expiry/digest, principal scope/membership, Connector allowlist와 operation을 재검증한다.
3. `action.executions`에서 approval ID 또는 Snapshot ID를 기준으로 atomic claim한다.
4. 기존 claim 또는 execution이 있으면 Connector를 다시 호출하지 않고 기존 Execution Record를 반환한다.
5. claim 성공 후에만 Preflight와 Connector 호출을 수행한다.
6. timeout/응답 유실은 `OUTCOME_UNKNOWN`으로 기록하며 자동 재실행하지 않는다.

## 8. Worker Verify 흐름

```text
Execution claim 성공
  -> Preflight
  -> Connector 호출
  -> Connector Receipt 저장
  -> Internal Verify job
  -> 허가된 Worker 또는 Service Principal이 receipt와 provider 결과 조회
  -> VERIFIED / FAILED / OUTCOME_UNKNOWN 기록
  -> append-only audit
```

Worker는 `executionId`만 받아 저장된 Snapshot과 Connector Receipt를 조회한다. 브라우저와 일반 사용자 principal은 Verify command/API를 호출하거나 Verify 결과를 작성할 수 없다. `OUTCOME_UNKNOWN`은 Verify가 결과를 확인할 때까지 유지한다.

## 9. Acceptance Test

| 시나리오                                                              | 기대 결과                                                                                                              |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Preview body에 target, payload, Connector ID 또는 full Candidate 포함 | 400 `ACTION_SERVER_BINDING_REQUIRED`                                                                                   |
| 존재하지 않는 Candidate/Validation/Evidence                           | Preview 거부, 외부 정보 미노출                                                                                         |
| 다른 project Candidate/Evidence                                       | generic 404, cross-project 실행 불가                                                                                   |
| stale revision 또는 변경된 Validation/Evidence                        | Preview 또는 Execute가 `STALE_ACTION_SNAPSHOT`으로 거부                                                                |
| restricted sensitivity 하향 시도                                      | Preview와 Execute 모두 거부                                                                                            |
| Snapshot canonicalization                                             | 같은 입력은 같은 digest, key/evidence 순서 변경은 같은 digest, 값 변경은 다른 digest                                   |
| serializer/schema version 변경                                        | 기존 Snapshot은 수정되지 않고 새 Snapshot만 생성                                                                       |
| 권한 없는 user principal 승인                                         | 거부                                                                                                                   |
| Service Principal 승인                                                | 거부                                                                                                                   |
| single-owner user principal의 정책상 허용된 self-approval             | 성공                                                                                                                   |
| v1 `requiredApprovalCount=1`                                          | 충족될 때만 final approval 생성; count 증가는 향후 policy version 범위                                                 |
| Snapshot 만료 뒤 승인/실행                                            | 거부, 새 Preview와 새 승인 필요                                                                                        |
| 동시/재전송 Execute                                                   | 하나의 external call, 나머지는 기존 Execution Record 반환                                                              |
| claim 뒤 timeout                                                      | `OUTCOME_UNKNOWN`, 자동 재실행 없음                                                                                    |
| 브라우저 또는 일반 사용자 Verify 제출                                 | 거부                                                                                                                   |
| 허가된 Worker Verify                                                  | receipt와 provider result로만 상태 확정                                                                                |
| 정상 흐름                                                             | server-bound Preview -> policy-allowed user approval -> atomic claim -> Preflight -> Execute -> Worker Verify -> audit |

## 10. 완료 조건과 중단 조건

P0-2 완료는 P0-1 SecurityContext 검증, 이 문서의 모든 Acceptance Test, Connector별 Contract Test와 별도 activation 승인까지 통과한 경우에만 판정한다. 이 문서는 구현 승인 자료다. ADR-094와 별도 구현 승인이 있기 전에는 제품 코드, DB migration, 설정, 테스트 코드를 수정하지 않는다.
