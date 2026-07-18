# Stage 12.1 P0-1/P0-2 Security Gate Implementation Record

- 상태: **Implemented and Verified**
- 기록일: 2026-07-18
- 관련 ADR:
  - [ADR-093 — HTTP Identity and Authorization Boundary](../ADR-093-http-identity-and-authorization-boundary.md)
  - [ADR-094 — Action Candidate Server-side Binding and Approval Snapshot](../ADR-094-action-candidate-server-side-binding-and-approval-snapshot.md)
- 승인 소스 SHA: `62d2ef114f172aa0b8bd1903c84b15a215a01db3`
- `main` Merge SHA: `d9e29bc588ff8c2badfd20c87cd3d4c2e695ba28`
- Merge 방식: `--no-ff`, `ort`

## 1. 기록 목적

이 문서는 ADR-093과 ADR-094의 결정을 변경하지 않는다. 두 ADR의 구현과 공격 검증이 완료된 정확한 코드 기준점, 검증 증거, 남은 제한을 기록한다.

Stage 12.1 전체 완료 선언이 아니다. Stage 12.1의 네 Gate 중 Security Gate의 P0-1과 P0-2만 완료됐다.

## 2. P0-1 구현 결과

HTTP 요청이 제공한 actor, project, access scope와 sensitivity를 권위 값으로 사용하지 않는다.

보호 요청은 다음 경계를 통과한다.

```text
HTTP Request
  -> Authentication Adapter
  -> Authenticated Principal
  -> Project Membership
  -> Server-side Authorization
  -> TrustedSecurityContext
  -> Module Command / Query
```

구현 결과:

- Legacy authority header를 차단한다.
- no-header owner/project fallback을 제거했다.
- Browser session과 opaque API token 원문은 DB·Audit·목록·일반 로그에서 복원할 수 없다.
- 실제 scope는 Membership, Token Scope Ceiling과 Route Requirement의 교집합이다.
- 제한 Token이 더 강한 Token을 발급하는 Scope 상승을 HTTP 403으로 차단하며 새 Token Row를 만들지 않는다.
- Password 변경 시 기존 Session을 폐기한다.
- 상태 변경 요청은 CSRF 또는 Origin 검증을 통과해야 한다.

## 3. P0-2 구현 결과

Action Preview와 Execute는 클라이언트가 작성한 Candidate, Validation, Evidence, Target, Payload, Risk 또는 Project 값을 권위 입력으로 사용하지 않는다.

```text
candidateId + expectedRevision + operationKey
  -> Candidate 조회
  -> Validation 조회와 Digest 재계산
  -> Evidence 조회와 Canonical Digest 재계산
  -> SourceVersion과 Original Asset 조회
  -> Transformation Revision 결속 확인
  -> Risk 재계산
  -> Immutable Preview Snapshot
  -> Immutable Approval Record
  -> Atomic Execution Claim
  -> Connector Execute
  -> Verify and Audit
```

구현 결과:

- Execute 요청은 `approvalId`만 받는다.
- Approval JSON, 저장 열, Snapshot JSON, 저장 Digest, Snapshot ID와 만료 시각을 상호 검증한다.
- Execution Projection의 Preview 또는 Approval이 없거나 불변 레코드와 다르면 실행 전에 차단한다.
- Candidate, Validation, Evidence, SourceVersion, Original Asset 또는 Transformation Revision이 승인 후 변하면 `STALE_ACTION_SNAPSHOT`으로 차단한다.
- 동일 Approval의 동시 Execute는 Connector 호출을 최대 1회로 제한한다.
- `ACTION_EXECUTION_CLAIMED` Audit도 하나만 기록한다.

## 4. Evidence와 Source Hash 의미

다음 Hash는 서로 다른 권위 대상을 가진다.

```text
SourceVersion content hash
= SHA-256 of the complete immutable source content

Evidence exact hash
= SHA-256 of Evidence.quote.exact
```

일반 Sentence Evidence에서는 두 Hash가 다른 것이 정상이다.

Evidence는 다음과 같이 검증한다.

- `Evidence.exactHash == SHA-256(Evidence.quote.exact)`
- Evidence의 Project, Source, SourceVersion, Scope와 Sensitivity가 권위 SourceVersion과 일치한다.
- Evidence가 참조하는 Transformation Revision의 Project, Source, SourceVersion과 `sourceContentHash`가 권위 SourceVersion과 일치한다.
- `DocumentIR`, `SourceMap`, Document Hash와 SourceMap Hash가 Canonical Contract를 만족한다.

PostgreSQL Happy Path Fixture는 Unicode code-point 위치 `20..23`의 Sentence `abc`를 사용하며 실제 `buildEvidenceCandidates()` 검증을 통과한다.

## 5. 공격 검증

PostgreSQL Security Gate에서 다음 공격을 차단했다.

- API Token Scope 상승
- CSRF 없는 상태 변경
- Password 변경 뒤 기존 Session 재사용
- Evidence exact hash, quote, position, pointer, selectors, scope와 SourceVersion 변조
- Evidence 삭제
- Validation READY/PASS Dimension, Candidate, Validation ID, Revision과 SourceVersion 결속 변조
- SourceVersion Sensitivity와 Scope 변조
- Original Asset Content Hash 변조
- Transformation Revision Content Hash, SourceVersion 결속과 권위 레코드 누락
- Execution Preview와 Approval Projection 변조 또는 제거
- Immutable Snapshot과 Approval Row 수정
- Approval JSON과 저장 Digest 불일치
- Approval-to-Snapshot Digest 불일치
- 동일 Approval 동시 실행
- Binding Digest의 로그·HTTP 오류 노출

거부된 Execute에서는 Connector 호출이 0회다. 불변 Authority Row나 Projection이 claim 전에 불일치하면 Execution은 `APPROVED` 상태를 유지하고 Claim Audit도 생성하지 않는다. 승인 이후 권위 데이터 변조가 Preflight 재검증에서 확인되면 Connector 호출 없이 실패 상태와 Audit을 남긴다.

## 6. 검증 결과

- 전체 Test: `227 passed, 0 failed, 0 skipped`
- PostgreSQL Security Gate: `38 passed, 0 failed, 0 skipped`
- 집중 Integration Action API: `2 passed, 0 failed, 0 skipped`
- Lint, Format Check, Type Check, Unit, Contract, Integration, Database, Architecture, Stage 12 Package, Secret Scan과 OSS Verify: 모두 Exit 0
- Mandatory Security Test Skip: 없음
- 승인 소스 SHA와 `main` Merge 결과 사이 파일 차이: 없음

Merge SHA에 연결된 GitHub Actions 실행 기록은 없다. 위 Test 수치는 Codex가 로컬 PostgreSQL 환경에서 실행한 결과이며, ChatGPT가 원격 코드와 테스트 구현을 독립 검토해 완료를 승인했다.

## 7. 남은 제한

- 이 기록은 Stage 12.1 전체 완료 또는 Release Readiness 완료를 뜻하지 않는다.
- Durability, Quality, Reuse and Operations Gate는 계속 진행 대상이다.
- Gmail, Calendar, Drive, GitHub 등 실제 외부 Connector는 Connector별 Capability, 권한, Preflight, Verify, Recovery와 활성화 승인을 통과하기 전까지 OFF 상태를 유지한다.
- GitHub Actions 기반 PostgreSQL 검증은 별도 CI 보강 대상이다.
- Stage 13은 이 기록으로 자동 개시되지 않는다.

## 8. 변경 이력 보존

- ADR-093의 초기 Signed Token 제안은 Opaque API Token으로 대체된 이유를 ADR 본문에 유지한다.
- ADR-094는 ADR-091의 클라이언트 전달 Approval Token 표현을 서버 저장 Approval Record와 `approvalId`로 보완한다.
- 이번 구현은 기존 Canonical, Evidence, Approval과 Action 정책을 덮어쓰지 않고 HTTP·Persistence·Runtime 신뢰 경계를 구체화한다.
