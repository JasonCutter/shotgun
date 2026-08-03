# FE-P3-S2 Shotgun Session Checkpoint (2026-08-03)

> 새 대화창에서 이 파일을 참고하면 됩니다. `scratch/`의 이 파일은 커밋되지 않은
> 로컬 참고용입니다 (원치 않으면 삭제 가능). 아래 내용이 핵심이므로 새 대화의 첫
> 지시에 "scratch/fe-p3-s2-checkpoint-20260803.md 참고"라고 말해도 됩니다.

## 1. 현재 상태 (정확한 값)

- Repository: `JasonCutter/shotgun` (로컬 `c:\dev\shotgun`, Windows, PowerShell 5.1)
- Branch: `codex/frontend-phase-3-section-2-implementation`
- **Current head: `0f6d5c47e3e4b236b5b9ecdcb8584ab52e802969`** (origin과 동일, push 완료)
- Base: `main@587f46caeca53fe479e887ea8c1ddd38ae2dbd52`
- **PR #57: OPEN / DRAFT 유지** — Ready/Merge 금지, head `0f6d5c47`
- CI: **#30814457772 성공** (Frontend / Quality / Required Gates 모두 PASS, head `0f6d5c47`)
- 작업 트리: clean
- Postgres: docker `shotgun-db-1` 실행 중, 마이그레이션 적용 완료 (`npm run db:migrate`)

## 2. 완료된 작업 (커밋 체인, 오래된 것부터)

| commit | 내용 |
|---|---|
| `2c41038` | FE-P3-S2 Product API + Command Gateway 기반 (5개 POST 커맨드) |
| `641c99d` | CHANGES_REQUIRED 블로커 5개 수정 (원자적 완료, replay 안전성, per-command digest, resolve identity, 프로덕션 resolver) |
| `14d8163` | Browser Draft State Machine + typed Draft client (순수 reducer + `useKnowledgeDraft` 훅) |
| `0f6d5c4` | 브라우저 보완: EDIT 보호, isDirty 기반 leave guard, sessionStorage pending identity, digest 교차 검증 테스트 |

## 3. 구현된 범위 (모두 COMPLETE)

1. Contract & Decoder Foundation (`packages/contracts/src/frontend-knowledge-draft.ts`)
2. Domain/Repository Boundary (`modules/frontend-knowledge-draft/src/index.ts`)
3. In-memory/PostgreSQL 어댑터 패리티 (`adapters/frontend-knowledge-draft-{in-memory,postgres}/`)
4. Migration 025 (`db/migrations/025_frontend_knowledge_draft_persistence.sql`)
5. Product API + Command Gateway 기반 (`modules/frontend-knowledge-draft/src/product-api.ts` + routes)
6. Production Target Resolver (`adapters/frontend-knowledge-draft-api-postgres/`)
7. Browser Draft State Machine (`apps/shotgun-web/src/knowledge/`)
8. Pending command identity sessionStorage (`apps/shotgun-web/src/knowledge/pending-draft-command-storage.ts`)
9. Typed Draft client (`packages/shotgun-api-client/src/frontend-knowledge-draft-client.ts`)

## 4. 핵심 파일 맵

- 도메인/coordinator: `modules/frontend-knowledge-draft/src/index.ts`, `src/product-api.ts`
- 라우트: `assemblies/shotgun-app/src/product-api/frontend-knowledge-draft-routes.ts`
- 서버 배선: `assemblies/shotgun-app/src/server.ts` (옵션 `frontendKnowledgeDraftTargetResolver`), `src/main.ts`
- 브라우저: `apps/shotgun-web/src/knowledge/knowledge-draft-state-machine.ts` (순수 reducer),
  `knowledge-draft-controller.ts` (`useKnowledgeDraft(serverDraft, sessionActiveProjectId?, sessionId?)`),
  `pending-draft-command-storage.ts`
- 클라이언트: `packages/shotgun-api-client/src/frontend-knowledge-draft-client.ts`
  (`createFrontendKnowledgeDraftClient`), `src/contracts.ts` (draft 타입 재수출)
- 공유 digest: `packages/contracts/src/frontend-knowledge-draft.ts`
  (`frontendKnowledgeDraftRevisionDigest` + 4개 per-command digest + `FRONTEND_KNOWLEDGE_DRAFT_DOMAIN_VERSION`)
- 로그아웃 정리: `apps/shotgun-web/src/session/logout-button.tsx` (clearAll 호출)
- 테스트: `tests/unit/knowledge-draft-state-machine.test.ts`(13),
  `tests/unit/knowledge-draft-controller.test.ts`(10, jsdom),
  `tests/unit/pending-draft-command-storage.test.ts`(4),
  `tests/unit/frontend-knowledge-draft-client.test.ts`(4),
  `tests/database/frontend-knowledge-draft-product-api-postgres.test.ts`(4, 교차 검증 포함),
  `tests/database/frontend-knowledge-draft-postgres-parity.test.ts`(34),
  `tests/unit/frontend-knowledge-draft-adapter-parity.test.ts`(26),
  `tests/integration/frontend-knowledge-draft-product-api.test.ts`(10),
  `tests/unit/frontend-knowledge-draft-domain.test.ts`(9)

## 5. 핵심 아키텍처 사실 (재사용 필수)

- **원자적 완료 패턴** (Ask와 동일): `boundary.transactionWithHandle(handle => { lockAcceptedForExecution(handle.raw, commandId); actionOnRepositories(handle.repositories); completeInTransaction(handle.raw, ...); })`.
  `handle.raw`는 raw `PoolClient`(in-memory는 `undefined`). 실패 시: 도메인 오류 → `reject`(코드 보존), 불확정/OUTCOME_UNKNOWN → `markOutcomeUnknown`(둘 다 best-effort 후 원본 rethrow).
- **replay 안전성**: replayed `COMPLETED` → `onReplay()`; `REJECTED` → 원본 코드 보존(`fromLedgerCode`); `ACCEPTED`/`OUTCOME_UNKNOWN` → `OUTCOME_INDETERMINATE`(HTTP 503), action 재실행 금지.
- **digest**: identity 필드(clientRequestId/idempotencyKey) 제외. 서버/브라우저 모두 `packages/contracts`의 동일 함수 사용.
- **게이트웨이 포트**: `lockAcceptedForExecution(transaction: unknown, commandId)` / `completeInTransaction(transaction: unknown, input)` — 로컬 구조적 타입으로 product-api에 선언.
- **브라우저 상태 머신**: 서버 Draft가 권위. dirty Draft는 background refetch/EDIT로 덮어쓰기 금지. drift → STALE(자동 병합/최신화 금지). OUTCOME_UNKNOWN은 원본 identity로만 resolve(재전송 금지). leave guard는 `isDirty` 기준.
- **pending identity**: sessionStorage에 `clientRequestId, idempotencyKey, semanticDigest, sessionId, projectId, draftId`만. Draft 내용/operations 저장 금지. Session/Project/Draft 스코프. OUTCOME_UNKNOWN일 때만 저장, COMPLETED/REJECTED/reset/logout 시 삭제.

## 6. 도메인 규칙 (AGENTS.md 핵심)

- 관련 OSS 검토 없이 처음부터 구현한 작업은 완료로 인정 안 됨. 검증된 4개 레퍼런스(gbrain, lucas, ddsyasas, OpenKnowledge) 재사용 우선.
- `ADOPT/EXTRACT/AUGMENT/REFERENCE_ONLY/DEFER/REJECT/NO_RELEVANT_OSS` 결정 기록 필요.
- Module Architecture의 Port·Adapter·데이터 소유권 준수 (domain↔domain import, module→adapter import 금지 — `scripts/architecture-test.ts`가 검증).
- Canonical·Evidence·Approval·Action 안전 경계 위반 시 COMPLETE 불가.
- 완료 보고에 OSS 후보/결정/버전/테스트/마이그레이션 포함 필수.

## 7. 다음 단계 (아직 시작 안 함)

- FE-P3-S2의 남은 항목: **React Editor UI** (다음 작업 대상), Validation/Comparison/Impact orchestration, Review Submission, Approval/Canonical Commit.
- **제외/금지**: `4e47f790` 커밋을 cherry-pick 금지(더 완전한 Product API 구현 포함 — 참고만). PR #57 Ready/Merge 금지. FE-P3-S3 금지. 새 runtime dependency 금지.

## 8. 검증/운영 팁 (이번 세션에서 배운 것)

- `npm run check` = docs gates + lint + format + typecheck + unit + contract + integration + architecture + stage12-package + secret scan + oss:verify. 출력이 20KB+라 백그라운드/파일 리다이렉트 권장, exit code만 확인.
- prettier: 같은 파일을 `npx prettier --write` 두 번 해야 `format:check` 통과하는 경우 있음(버전 차이). lint/format 실패 시 전체 check를 반복하지 말고 해당 단계만 먼저 고정.
- Postgres 테스트: `docker compose up -d` → `npm run db:migrate` 필요. DB 테스트는 `node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run tests/database/... --maxWorkers=1 --fileParallelism=false --testTimeout=20000 --hookTimeout=20000`.
- `canonical.commits.change_set_id`는 uuid 타입. envelope 스프레드 타입 소거 문제 → digest 호출은 `as unknown as RequestType` 캐스팅.
- `gh pr edit 57 --body-file <file>`로 PR 본문 갱신. CI 확인은 `gh run list --commit <head>` + `gh run watch <run> --exit-status`.
- 성능: 대화 턴이 쌓이면 토큰이 커지므로, 지시는 간결하게(브랜치/헤드/범위만), 중간 검증은 포커스 테스트만, 전체 check는 최종 1회.

## 9. 마지막 검증 결과 (0f6d5c4)

- `npm run check`: exit 0
- `git diff --check`: exit 0
- `npm run frontend:typecheck` + `frontend:test`: PASS (12 files / 47 tests)
- CI #30814457772: Frontend/Quality/Required Gates PASS
- PR #57: OPEN/DRAFT, head `0f6d5c47`, 본문 갱신 완료
