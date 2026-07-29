---
id: FRONTEND-PHASE-4-GOVERNANCE-EXECUTION
classification: CANONICAL
status: design_and_contract_confirmed_implementation_verification_pending
approved_by: user
approved_at: 2026-07-24
legacy_source_id: 3a65181d-71ad-8196-b275-cd9cfe78fa00
---

# Frontend Phase 4 — Governance·Execution

## 상태

- Section 설계·구현 Contract 정규화 완료
- Product 구현·E2E·보안·접근성 완료는 별도 판정
- 관련 ADR: ADR-109, ADR-110

## Section 1 — Review Center

Review Center는 Candidate, DraftChangeSet, UserDirectiveProposal와 Action Manifest의 판단 경험을 제공한다.

확정 경계:

- Item·Operation 단위 승인·거절·수정 요청·보류를 제공한다.
- Candidate, Canonical Snapshot, Evidence, Conflict와 Recursive Impact를 같은 검토 Context에서 보여준다.
- 목적별 Approval Resource를 생성하지만 Canonical Commit, Directive Apply 또는 Connector Execute를 직접 수행하지 않는다.
- Knowledge Approval과 External Action Approval을 분리하고 하나의 Approval을 두 목적에 재사용하지 않는다.
- Approval은 Actor, Reason, Target Revision, Content/Manifest Digest, Policy Context와 Expiry에 결속한다.
- Stale, Evidence, Policy 또는 권한 변경 시 재검증한다.
- 거절·보류 Candidate와 판단 이유를 삭제하지 않는다.

## Section 2 — External Action Governance·Execution

고정 생명주기:

```text
Validation
→ ActionCandidate
→ Risk Decision
→ Preview·Manifest
→ Approval
→ Preflight
→ Execute
→ Verify
→ Result·Audit
```

확정 경계:

- 정보 결과와 외부 Write를 분리한다.
- Approval 이후에도 Target, Policy, Credential, Budget과 External Revision을 Preflight에서 재검증한다.
- Manifest, Target 또는 보호 Payload가 변경되면 재승인을 요구한다.
- Connector 응답만으로 성공을 확정하지 않고 실제 Target State를 Verify한다.
- Timeout과 `OUTCOME_UNKNOWN`에서 자동 재실행하지 않는다.
- Cancel은 실행 중단 요청이고 Rollback은 아니다.
- 외부 복구는 별도 Compensating Action이다.
- Home과 Command Palette에서 고위험 Action을 직접 실행하지 않고 해당 Governance 화면으로 이동한다.

## 공통 Resource 경계

- `UserDirectiveProposal`은 공통 Service가 소유하는 독립 Domain Resource이며 DraftChangeSet Operation과 다르다.
- Graph `ACTION_CANDIDATE`는 Governance Impact·Operational Dependency Overlay 전용이다.
- `EXTERNAL_ACTION`은 Operational Resource Kind의 Aggregate이며 Preflight, Execution, Verification, Compensation은 Concrete Kind다.
- Frontend는 Principal·Capability·Accepted Policy Context를 주장할 수 없고 Server가 확정한다.
- 공통 Write는 Versioned `FrontendCommandRequest`, Typed Preconditions, Correlation과 Causation을 사용한다.

## Phase 4 완료 조건

```text
변경 또는 실행 후보
→ 검토
→ 목적별 승인
→ Commit 또는 Execute
→ 결과 검증
```

현재 판정은 설계·Contract 완료이며 Product 구현 완료가 아니다.
