# Frontend Phase 2 Section 2 — Slices 4–5 Remediation Implementation Request

- Date: 2026-08-01
- Status: **AUTHORIZED / CONTRACT FROZEN / EXECUTION MAY PROCEED**
- Branch: `codex/frontend-phase-2-section-2-write`
- Base: `main@e24725eac8c44722c7937eca5cb6a28122a4fef3`
- Reviewed candidate Head: `8c8cdc542e3c598d10fd62aaa2e10f2ed28a01b1`
- Draft PR: `#48`
- Governing ADR: ADR-123
- Frozen Contract: `frontend-phase-2-section-2-slices-4-5-frozen-implementation-contract-260801001.md`

## 1. 목표

현재 In-memory Submit 후보를 ADR-123과 Frozen Contract에 맞게 재구성하여, Frontend Command Ledger를 사용하는 보호된 Submit Question Command와 PostgreSQL 기반 Conversation Aggregate 영속화를 완성한다.

## 2. 기준 상태

- Slices 1–3 Read Foundation은 `main`에 병합됨.
- 현재 Branch는 Submit UI, Write contract, In-memory mutation, outcome lookup route, migration 021 후보를 포함함.
- 현재 후보는 Frozen Contract 기준 `BLOCKED — ARCHITECTURE REMEDIATION REQUIRED`.
- 기존 구현은 삭제보다 경계 분리와 재사용을 우선하되, Frozen Contract와 충돌하는 구조는 유지하지 않는다.

## 3. 구현 범위

1. `AskCommandCoordinator` 또는 동등 책임 추가.
2. 모든 Submit Question write를 기존 `FrontendCommandGateway`에 연결.
3. read projection에서 command ledger와 domain mutation 제거.
4. `AskConversationRepositoryPort`와 In-memory/PostgreSQL adapter 구현.
5. new question aggregate create transaction 구현.
6. follow-up revision-checked append transaction 구현.
7. full semantic digest, durable replay, conflict, clientRequestId recovery 구현.
8. Principal/Resource Project scoped outcome resolution 구현.
9. SourceSelection의 Source/SourceVersion/Evidence 관계와 접근 권한 검증.
10. migration 021을 ADR-123의 managed schema, global ID, revision, constraint, reset/verify 기준에 맞게 수정.
11. production application assembly에 PostgreSQL Ask repository 연결.
12. Browser outcome-unknown recovery와 Draft 보존 구현.
13. exact read-after-write projection과 제한된 cache update/invalidation 구현.

## 4. 핵심 계약

- 새 질문은 Server Active Project에 결속한다.
- 후속 질문은 Conversation Resource Project에 결속하며 Active Project를 변경하지 않는다.
- Browser는 Principal, Project, capability, sensitivity, access 또는 policy authority를 제공하지 않는다.
- durable protocol은 `ACCEPTED → aggregate write + COMPLETED`, 또는 zero-write `REJECTED`이다.
- follow-up은 expected Conversation/Branch revisions 없이는 실행하지 않는다.
- same key/same digest는 원래 결과를 replay한다.
- same key/different digest와 clientRequestId rebinding은 conflict이며 zero-write이다.
- `OUTCOME_UNKNOWN`은 자동 재제출하지 않고 기존 clientRequestId로 resolve한다.
- SourceSelection은 pinned SourceVersion과 Evidence 관계를 Server에서 검증한다.
- initial AnswerRun은 provider 미구성 시 `ACTION_REQUIRED / MODEL_EXECUTION_NOT_CONFIGURED`일 수 있다.
- Ask 결과는 Canonical을 자동 변경하지 않는다.

## 5. 제외 범위

- Streaming
- Cancel
- Domain Retry
- External AI provider 및 API key
- Model routing과 final answer generation
- Model/cost disclosure 완성
- Export
- Feedback
- `IntakeDraftSeed`
- `DraftChangeSetSeed`
- `UserDirectiveProposalSeed`
- 자동 Canonical commit
- PR Ready
- Merge
- Section 2 완료
- Section 3 시작

## 6. 필수 테스트

Frozen Contract의 S45-G01–S45-G18 전체를 검증한다. 최소 필수 묶음:

- strict decoder와 Browser authority-field rejection;
- Command Gateway accept/replay/conflict/clientRequestId rebinding;
- Principal/Project scoped outcome lookup;
- atomic new aggregate transaction;
- follow-up stale revision과 concurrent ordinal;
- rollback/no-orphan guarantees;
- global identity uniqueness;
- SourceVersion/Evidence relationship validation;
- PostgreSQL adapter와 production wiring;
- migration reset/verify/restart durability;
- Browser outcome recovery, Draft retention/clear, Active Project non-mutation;
- Contract, unit, integration, database, frontend build와 Chromium E2E.

## 7. 검증 명령

Repository의 기존 required gates를 사용하고, 최소 다음 범주를 포함한다.

```text
npm run docs:adr-index
npm run docs:validate
npm run format:check
npm run lint
npm run typecheck
npm test
npm run db:reset
npm run db:verify
npm run frontend:typecheck
npm run frontend:test
npm run frontend:build
npm run frontend:e2e
```

실제 package script 이름이 다르면 동일한 Repository 표준 명령을 사용하고 제출 문서에 정확한 명령과 결과를 기록한다.

## 8. 제출 조건

제출 시 다음을 한 번에 제공한다.

1. Exact Base SHA와 Exact Head SHA.
2. 변경 파일 목록.
3. ADR-123 conformance matrix.
4. S45-G01–S45-G18 evidence matrix.
5. migration과 production runtime wiring 증거.
6. exact CI Run ID와 URL.
7. 테스트 수와 결과.
8. 남은 제외 범위와 Known Limitations.
9. blocker 결함이 없는지 판정.
10. PR은 Draft 유지.

Frozen Contract 변경이 필요하면 구현으로 우회하지 말고 별도 Contract Revision 후보와 변경 이유를 먼저 제출한다.
