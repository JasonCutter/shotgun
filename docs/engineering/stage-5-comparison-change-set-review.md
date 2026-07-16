# Stage 5 — Comparison, Change Set and Human Review

## 상태

**COMPLETE — 2026-07-17**

## 실행 흐름

```text
CandidateValidated
→ fixed Canonical Snapshot
→ ComparisonResult
→ DraftChangeSet
→ Candidate + Evidence + Machine Diff Review
→ RecordReviewDecision
→ APPROVE | HOLD | REJECT
→ ApprovedChangeSetManifest (APPROVE만)
→ Stage 6 Canonical Commit
```

## 폴더 구조

```text
modules/
  comparison/
  change-set-review/
adapters/
  canonical-snapshot-empty/
  text-diff-jsdiff/
  stage5-in-memory/
  postgres-stage5/
assemblies/shotgun-app/
  src/server.ts
db/migrations/
  005_stage5_comparison_review.sql
tests/
  contract/comparison-review.contract.test.ts
  integration/review-ui.test.ts
  database/stage-5-postgres.test.ts
```

## 데이터 구조

- `ComparisonResult`: 고정 Snapshot과 Candidate의 분류·Diff·Digest
- `DraftChangeSet`: 검토 대상 작업과 고정된 Content Digest
- `ReviewDecisionRecord`: 결정, 이유, User Actor, 결정 시각
- `ApprovalToken`: Change Set Revision, Content Digest, Expected Canonical Version에 결속
- `ApprovedChangeSetManifest`: Stage 6에 전달할 승인 완료 계약

## 핵심 규칙

- Canonical DB를 직접 읽지 않고 `CanonicalSnapshotPort`를 사용한다.
- 완전 중복은 `NO_OP`다.
- Review UI는 읽기 화면이며 승인 권한 자체가 아니다.
- 승인 직전에 Candidate와 Snapshot Freshness를 서버에서 다시 검사한다.
- Service·System Actor는 승인·보류·거절할 수 없다.
- Stage 5에서는 Canonical Write를 하지 않는다.
- Impact Analysis는 Stage 9 범위다.

## API

- `POST /intake`: Candidate와 함께 생성된 Review 목록 반환
- `POST /comparisons/resolve`: ComparisonResult 조회
- `POST /reviews/resolve`: Candidate·Evidence·Diff Review Bundle 조회
- `GET /reviews/:changeSetId`: 최소 Review UI
- `POST /reviews/decision`: 승인·보류·거절 서버 Command

## 실행과 검증

```powershell
$env:DATABASE_URL = 'postgres://shotgun:shotgun@localhost:5432/shotgun'
docker compose up -d --wait
npm run db:reset
npm run check
npm run test:database
```

## 알려진 제한

- Persistent Runtime의 Canonical Snapshot은 Stage 6 전까지 빈 Snapshot Adapter를 사용한다.
- Rich editor와 동시 편집은 구현하지 않았다.
- Semantic similarity 모델은 사용하지 않으며 Stage 5 MVP는 정확 일치와 word diff 기반의
  단순 충돌 후보만 분류한다.
