# Stage 12.1 - Security, Durability and Release Readiness Hardening

- 상태: **IN_PROGRESS — Security Gate COMPLETE / Durability Gate COMPLETE / Quality Gate COMPLETE / Reuse and Operations Gate IMPLEMENTED CANDIDATE**
- 기준 문서: `Shotgun Stage 12.1 보안·내구성 보정 전략.pdf` (2026-07-17)
- 적용 범위: Stage 12 이후의 보정 작업
- Security Gate 기준 `main` SHA: `d9e29bc588ff8c2badfd20c87cd3d4c2e695ba28`
- Durability Section 1 기준 `main` SHA: `06ce9b48328296856fc2eb70e6ef1a4a329243b6`
- 현재 작업 Section: **Reuse and Operations Gate — IMPLEMENTED CANDIDATE / INDEPENDENT REVIEW READY / USER APPROVAL PENDING**

## 1. 전략적 결정

Stage 12 뒤에는 새 기능 Stage를 바로 시작하지 않는다. 먼저 Stage 12.1을 두어, 지금까지 구현한 MVP를 안전하게 운영·확장할 수 있는 기반으로 보정한다.

Stage 12.1 완료 전에는 다음을 금지한다.

- 실제 Gmail, Calendar, GitHub 등 외부 Action Connector 활성화
- 서버의 외부 네트워크 공개
- Stage 12 또는 Stage 12.1을 production-ready 또는 release-ready라고 표현
- 검증하지 않은 Assembly를 독립 재사용 가능하다고 표현
- Claim 추출 또는 자연어 검색 품질이 확보됐다고 표현

이 전략은 기존 ADD의 Knowledge Flow, Canonical 단일 write, Evidence, Approval, Action 경계를 바꾸지 않는다. 기존 ADR을 조용히 덮어쓰지 않으며, 중요한 구조 변경은 ADR 승인 뒤에만 구현한다.

## 2. 완료 목표

Stage 12.1은 다음 네 Gate가 모두 통과할 때만 완료다.

| Gate                 | 목표                                                                                             | 현재 상태                 |
| -------------------- | ------------------------------------------------------------------------------------------------ | ------------------------- |
| Security             | 인증되지 않은 actor, scope, project, sensitivity 위조 불가. 실제 Action은 서버 저장 근거만 사용. | **P0-1·P0-2 COMPLETE**    |
| Durability           | AI 중간 장애 뒤 후보 완전 복구, Canonical Outbox·Projection 자동 복구, clean restore 성공.       | **COMPLETE**              |
| Quality              | Claim 추출과 자연어 검색을 corpus와 수치로 평가하고 regression suite로 고정.                     | **COMPLETE**              |
| Reuse and Operations | 독립 Package·Adapter 경계와 필수 운영 검사를 통합 Gate로 검증.                                   | **IMPLEMENTED CANDIDATE** |

Security와 Durability Gate 완료만으로 Stage 12.1 전체를 `COMPLETE`로 표시하지 않는다.

## 2.1 Current Stage 12.1 Approval Status

| Scope                                    | Status                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| Stage 12.1                               | **IN_PROGRESS**                                                              |
| Security Gate                            | **COMPLETE**                                                                 |
| Durability Gate                          | **COMPLETE**                                                                 |
| Section 1 — AI Durable Materialization   | **COMPLETE**                                                                 |
| Section 2 — Canonical Outbox Recovery    | **COMPLETE / USER APPROVED**                                                 |
| Section 3 — Projection Recovery          | **COMPLETE / USER APPROVED**                                                 |
| Section 4 — Backup·Restore Drill         | **COMPLETE / USER APPROVED**                                                 |
| Quality Gate                             | **COMPLETE**                                                                 |
| Quality Section 1 — Evaluation Contract  | **COMPLETE / USER APPROVED**                                                 |
| Quality Section 2 — Claim Baseline       | **COMPLETE / USER APPROVED**                                                 |
| Quality Section 3 — Search Baseline      | **COMPLETE / USER APPROVED**                                                 |
| Quality Section 4 — Threshold and CI     | **COMPLETE / USER APPROVED**                                                 |
| Quality Section 5A — Lexical Improvement | **DEFERRED**                                                                 |
| Quality Section 5B — Semantic Retrieval  | **DEFERRED**                                                                 |
| Reuse and Operations Gate                | **IMPLEMENTED CANDIDATE / INDEPENDENT REVIEW READY / USER APPROVAL PENDING** |
| Stage 13                                 | **NOT STARTED**                                                              |

Sections 1–4의 independent review와 explicit user approval이 완료됐다. ADR-097은
`ACCEPTED`이고 Durability Gate는 `COMPLETE`다. PR #14는 2026-07-22 일반 Merge
Commit 방식으로 `main`에 병합됐으며, Merge Commit SHA는
`50a25dfab1458fffc6fecc80bc8c91852b2d7ff6`이다.

## 3. 고정된 전체 순서

| Wave   | 범위                                                                                                                 | Gate 전 제한                                      |
| ------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Wave 0 | localhost 기본 bind, 실제 Action Connector OFF, legacy owner 기본값 제거 준비, Gemini secret pattern, 상태 문구 정정 | 임시 봉쇄일 뿐 최종 해결책이 아님                 |
| Wave 1 | P0-1 인증된 Security Context, P0-2 Action server-side binding, UI trusted session/project context, 위조 테스트       | 외부 공개와 실제 Action Connector 금지            |
| Wave 2 | durable AI state machine, candidate replay, Outbox worker, Compiled Truth 자동 projection, restore drill             | production data 내구성을 보장한다고 표현 금지     |
| Wave 3 | Golden corpus, Claim·검색 benchmark, lexical 개선, 필요 시 semantic retrieval 검토                                   | 지표 없는 검색 기술 채택 금지                     |
| Wave 4 | Assembly package boundary, 외부 consumer 설치, Windows CI, compatibility test, 실제 consumer Assembly                | workspace 내부 테스트를 독립 재사용으로 표현 금지 |

Wave 1의 서버·API Security Gate는 완료됐지만 Dedicated Product Frontend의 최종 Session·Project UX는 별도 Frontend Delivery Roadmap에서 관리한다.

## 4. Security Gate 완료 기록

### P0-1 — Authenticated Security Context

보호 HTTP 요청은 다음 신뢰 경계를 통과한다.

```text
HTTP Request
  -> Authentication Adapter
  -> Authenticated Principal
  -> Project Membership 확인
  -> Server-side Authorization
  -> TrustedSecurityContext
  -> Module Command / Query
```

완료 결과:

- `x-project-id`, `x-actor-id`, `x-access-scope`, `x-sensitivity`를 production trust source로 사용하지 않는다.
- no-header owner/project fallback을 제거했다.
- 브라우저는 서버 관리 Session과 HttpOnly Cookie를 사용하며 상태 변경은 CSRF·Origin 검증을 통과한다.
- API·자동화는 Opaque API Token을 사용하고 원문은 발급 시 한 번만 표시한다.
- 실제 Scope는 Project Membership, Token Scope Ceiling과 Route Requirement의 교집합이다.
- 최초 Owner는 `npm run auth:bootstrap-owner`로 명시적으로 생성한다.
- Development Auth Adapter는 기본 OFF이며 production과 non-loopback 환경에서 활성화할 수 없다.

### P0-2 — Action Candidate Server-side Binding

```text
candidateId + expectedRevision + operationKey
  -> Candidate 조회
  -> Validation 조회와 Digest 재계산
  -> Evidence 조회와 Canonical Digest 재계산
  -> SourceVersion·Original Asset 조회
  -> Transformation Revision 결속 확인
  -> Risk 재계산
  -> Immutable Preview Snapshot
  -> Immutable Approval Record
  -> Atomic Execution Claim
  -> Connector Execute
  -> Verify and Audit
```

완료 결과:

- Preview 요청은 참조 값만 받고 Candidate, Validation, Evidence, Target, Payload, Risk와 Project를 클라이언트 권위 입력으로 사용하지 않는다.
- Execute 요청은 `approvalId`만 받으며 승인된 Snapshot Payload만 실행한다.
- Approval JSON·저장 열, Snapshot JSON·저장 Digest, Snapshot ID와 만료 시각을 상호 검증한다.
- Execution Projection의 Preview·Approval 누락 또는 불일치를 차단한다.
- Candidate·Validation·Evidence·SourceVersion·Original Asset·Transformation Revision이 승인 후 변경되면 실행을 차단한다.
- 동일 Approval의 동시 Execute에서 Connector 호출과 `ACTION_EXECUTION_CLAIMED` Audit은 각각 최대 1회다.

### Evidence Hash 의미

```text
SourceVersion content hash
= SHA-256 of the complete immutable source content

Evidence exact hash
= SHA-256 of Evidence.quote.exact
```

일반 Sentence Evidence에서 두 Hash가 다른 것은 정상이다. Evidence의 Exact Hash는 Quote 자체로 검증하고, Evidence와 전체 Source Content의 관계는 Transformation Revision의 `sourceContentHash`를 통해 결속한다.

## 5. 완료 증거

- 승인 소스 SHA: `62d2ef114f172aa0b8bd1903c84b15a215a01db3`
- `main` Merge SHA: `d9e29bc588ff8c2badfd20c87cd3d4c2e695ba28`
- Merge 방식: `--no-ff`, `ort`
- 전체 Test: `227 passed, 0 failed, 0 skipped`
- PostgreSQL Security Gate: `38 passed, 0 failed, 0 skipped`
- 집중 Integration Action API: `2 passed, 0 failed, 0 skipped`
- Mandatory Security Test Skip: 없음
- 승인 소스와 Merge 결과 사이 파일 차이: 없음

상세 근거:

- [ADR-093 — HTTP Identity and Authorization Boundary](../architecture/adr/ADR-093-http-identity-and-authorization-boundary.md)
- [ADR-094 — Action Candidate Server-side Binding and Approval Snapshot](../architecture/adr/ADR-094-action-candidate-server-side-binding-and-approval-snapshot.md)
- [Stage 12.1 P0-1/P0-2 Security Gate Implementation Record](../architecture/adr/implementation-records/stage-12-1-p0-1-p0-2-security-gate.md)

Merge SHA에 연결된 GitHub Actions 실행 기록은 없다. Test 수치는 Codex의 로컬 PostgreSQL 실행 결과이며, 원격 코드와 Test 구현은 별도로 검토됐다.

## 6. Security Gate Acceptance 결과

다음 공격을 모두 차단했다.

- 임의 Actor ID와 Owner Scope 주입
- 다른 Project 접근
- Sensitivity 하향 조작
- 무인증 요청의 Owner 기본값 획득
- 제한 Token의 Scope 상승 발급
- production의 Development Auth Adapter 활성화
- CSRF 없는 상태 변경
- 승인 뒤 Candidate·Validation·Evidence·SourceVersion·Transformation Revision 변조
- Preview·Approval 불변 레코드와 Execution Projection 변조
- 동일 Approval 동시 실행
- Token·Session 원문 또는 내부 Binding Digest의 로그·HTTP 노출

정상 흐름도 통과했다.

- 로그인 사용자의 허용 Project 조회와 Project 변경
- Token Scope Ceiling을 넘지 않는 API 요청
- 실제 PostgreSQL Repository를 사용한 Preview·Approval·Execute·Verify
- Source Content Hash와 다른 정상 Sentence Evidence Exact Hash
- 동일 Snapshot 기반 Connector 실행과 Audit 기록

## 7. Durability Section 1 완료 기록

ADR-096의 AI Durable Materialization 구현과 독립 검증을 완료하고 별도 승인을 받았다.

- Generation Request·Provider Attempt·불변 Provider Output을 PostgreSQL에 영속화한다.
- 저장 Output 기반 Resume·Replay는 Provider를 재호출하지 않고 기존 Candidate Batch와 Revision 1을 재사용한다.
- `MATERIALIZATION_FAILED`와 기존 Batch의 불완전 완료 상태를 중복 Candidate 없이 복구한다.
- `OUTCOME_UNKNOWN`, Output 누락과 Digest 불일치는 자동 Provider 재호출 없이 fail closed한다.
- `main` Merge SHA: `06ce9b48328296856fc2eb70e6ef1a4a329243b6`

상세 근거:

- [ADR-096 — Stage 12.1 AI Durable Materialization](../architecture/adr/ADR-096-stage-12-1-ai-durable-materialization.md)
- [Stage 12.1 AI Durable Materialization Implementation Record](../architecture/adr/implementation-records/stage-12-1-ai-durable-materialization.md)

이 기록은 2026-07-21 당시 Section 1 완료 근거다. 이후 Canonical Outbox Recovery, Projection Recovery, Backup·Restore도 independent review와 user approval을 완료했다.

## 8. Durability Gate Completion

Historical note: ADR-097의 후보 구현은 독립 검토에서 한때 `HOLD`였고 사용자 Section 승인 전에는 완료로 표시하지 않았다. 이후 교정·검증·독립 재검토와 Sections 1–4 사용자 승인이 완료됐다.

- startup과 비중첩 periodic Worker가 pending·stale Outbox를 bounded batch로 drain한다.
- Outbox가 이미 published여도 Search·Compiled Truth readiness를 독립 검사하고 Canonical에서 Full Rebuild한다.
- PostgreSQL custom dump, 참조 Original Asset, Contract·Module Manifest와 모든 비-Projection 영속 Table digest를 Backup Bundle v1로 검증한다.
- Source와 다른 두 임시 DB를 사용한 실제 clean restore drill에서 복원 후 Projection을 삭제하고 Search `READY`와 Compiled Truth version 1을 재생성했다.
- pgBackRest·WAL-G·Barman은 PITR·WAL·원격 DR 요구가 승인될 때까지 `DEFER`한다.

상세 근거:

- [ADR-097 — Stage 12.1 Canonical Outbox, Projection Recovery and Clean Restore](../architecture/adr/ADR-097-stage-12-1-outbox-projection-clean-restore.md)
- [Implementation Record](../architecture/adr/implementation-records/stage-12-1-outbox-projection-clean-restore.md)
- [Backup and Clean Restore Runbook](stage-12-1-backup-restore-runbook.md)

ADR-097은 `ACCEPTED`이고 Durability Gate는 `COMPLETE`다. ADR-098과 Quality Sections
1–4도 사용자 승인을 완료했으며 Quality Gate는 `COMPLETE`다. Reuse and Operations
Gate는 `IMPLEMENTED CANDIDATE / INDEPENDENT REVIEW READY / USER APPROVAL PENDING`,
Stage 12.1은 `IN_PROGRESS`, Stage 13은 `NOT STARTED`다.

## 9. 후속 Section 경계

| Section                                       | 상태                                                                         | 후속 범위                               |
| --------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------- |
| P0-1 Authenticated Security Context           | **COMPLETE**                                                                 | 운영 Auth Adapter·IdP 확장은 별도 결정  |
| P0-2 Action Candidate server-side binding     | **COMPLETE**                                                                 | Connector별 활성화 Gate는 별도          |
| Dedicated Product Frontend Session·Project UX | 설계 확정, 구현 대기                                                         | Frontend Delivery Roadmap에서 관리      |
| AI durable materialization                    | **COMPLETE**                                                                 | ADR-096·Implementation Record           |
| Canonical Outbox recovery                     | **COMPLETE / USER APPROVED**                                                 | ADR-097·Implementation Record           |
| Projection recovery                           | **COMPLETE / USER APPROVED**                                                 | ADR-097·Implementation Record           |
| Backup·clean restore                          | **COMPLETE / USER APPROVED**                                                 | local isolated drill·운영 Runbook       |
| Quality Evaluation Contract                   | **COMPLETE / USER APPROVED**                                                 | ADR-098                                 |
| Claim Extraction Baseline                     | **COMPLETE / USER APPROVED**                                                 | Quality Section 2                       |
| Natural-language Search Baseline              | **COMPLETE / USER APPROVED**                                                 | Quality Section 3                       |
| Quality Regression Gate                       | **COMPLETE / USER APPROVED**                                                 | Quality Section 4                       |
| Quality Section 5A·5B                         | **DEFERRED**                                                                 | 실제 제품 사용 증거 후 재평가           |
| Reuse and Operations Gate                     | **IMPLEMENTED CANDIDATE / INDEPENDENT REVIEW READY / USER APPROVAL PENDING** | 통합 Gate·운영 기록                     |
| External Consumer·Windows CI                  | 필수 범위 외 미착수                                                          | 후속 플랫폼 호환성 검증                 |
| Stage 9·10 architecture tension               | 별도 Architecture Section                                                    | 기존 ADR-089·090을 조용히 변경하지 않음 |

## 10. 현재 상태 표기

현재 Shotgun은 **Security·Durability·Quality Gate가 완료되고 Reuse and Operations
Gate 후보 검증을 마친 개발·로컬 검증용 MVP**다. Reuse and Operations Gate의 독립 검토와
사용자 승인이 남았으므로 production-ready 또는 release-ready가 아니다.

다음 제한은 유지한다.

- Stage 12.1 전체 상태는 `IN_PROGRESS`다.
- 실제 외부 Action Connector는 Connector별 Capability·권한·Preflight·Verify·복구와 활성화 승인을 통과하기 전까지 OFF다.
- 외부 네트워크 공개와 production-ready·release-ready 표기는 금지한다.
- Reuse and Operations Gate의 독립 검토와 사용자 승인을 완료하기 전 Stage 12.1을 종료하지 않는다.
- Stage 13은 시작하지 않는다.

## 11. Reuse and Operations Gate Candidate

### 11.1 통합 검증

```powershell
npm run stage12:reuse-operations-gate
```

명령은 기존 검증을 fail-fast 순서로 실행하고 마지막에 JSON 요약을 출력한다.

1. `@shotgun/lucas-text-locator`와 `@shotgun/quality-evaluation` tarball을 각각 격리
   consumer에 설치하고 전체 Shotgun Application 없이 실행한다.
2. 기존 Document Review Assembly의 in-memory 실행과 Storage·AI·Transport·Diff Adapter
   교체 Contract를 실행한다.
3. `/health` Application readiness와 loopback-only bind, development auth 제한을 검증하고
   Action API는 실제 외부 서비스가 아닌 `FakeDraftActionConnector`로만 실행한다.
4. 승인된 `quality:gate`, `db:verify`, working-tree Secret Scan과 OSS Gate를 실행한다.

각 하위 명령의 stdout·stderr를 그대로 운영자에게 표시하며 하나라도 실패하면 즉시
중단하고 exit code `1`을 반환한다. CI는 `db:reset` 후 이 명령을 blocking step으로
실행하고, 중복을 피하기 위해 별도 `quality:gate`·`db:verify` 단계 대신 `check:core`와
database test만 이어서 실행한다.

### 11.2 시작·종료와 PostgreSQL 조건

```powershell
docker compose up -d db
npm run db:migrate
npm start
Invoke-RestMethod http://127.0.0.1:3000/health
```

PostgreSQL 16과 `DATABASE_URL`, Asset 저장 경로, Runtime이 요구하는 Provider secret이
준비돼야 한다. `/health`가 HTTP 200과 module·capability 목록을 반환해야 readiness로
간주한다. 기본 `HOST`는 `127.0.0.1`이고 `ALLOW_EXTERNAL_BIND=true` 없이는 외부 bind를
거부한다. 실제 외부 Action Connector는 활성화하지 않는다. Application은 `Ctrl+C`로
종료하고 개발 DB 서비스는 다음으로 중지한다.

```powershell
docker compose stop db
```

### 11.3 Migration·Rollback·Backup·Restore

Migration은 `npm run db:migrate`, 초기 개발 DB 재생성은 destructive한
`npm run db:reset`을 사용한다. down migration은 제공하지 않으므로 운영 변경 전 Backup을
생성·검증하고 실패 시 기존 Runtime·Database를 유지한 채 새 대상 전환을 중단한다.

```powershell
npm run backup:create -- --output C:\backup\shotgun
npm run backup:verify -- --backup C:\backup\shotgun
npm run backup:restore -- --backup C:\backup\shotgun
npm run backup:drill
npm run quality:gate
```

상세 restore 조건과 fail-closed 경계는
[Backup and Clean Restore Runbook](stage-12-1-backup-restore-runbook.md)을 따른다.

### 11.4 장애 확인 순서와 Known Limit

1. 통합 Gate가 출력한 첫 `FAIL` step과 해당 하위 명령 로그를 확인한다.
2. PostgreSQL 연결·version·migration 수를 `npm run db:verify`로 확인한다.
3. `/health`, loopback bind와 Fake Connector 기본값을 확인한다.
4. `quality:gate`의 Corpus·Policy·Run digest와 threshold 실패를 확인한다.
5. Secret·OSS 결과와 Backup Manifest·restore drill 증거를 확인한다.

Known Limit은 다음과 같다.

- Claim No-Claim 처리, 일부 Evidence·구조 추출 약점과 lexical-only 동의어 실패를
  Quality Gate의 공개 Known Limit로 유지한다.
- Section 5A·5B는 Frontend보다 선행하지 않으며 실제 제품 사용 결과가 쌓인 뒤 재평가한다.
- 외부 Action Connector와 외부 network bind는 계속 비활성이다.
- 현재 필수 CI는 Ubuntu에서 실행한다. Windows consumer·운영 호환성은 이번 필수 범위가
  아니며 별도 플랫폼 검증 전에는 지원 완료로 주장하지 않는다.
- Frontend는 `NOT STARTED`, Stage 12.1은 `IN_PROGRESS`, Stage 13은 `NOT STARTED`다.
