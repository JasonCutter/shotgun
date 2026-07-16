# ADR-085: Stage 5 Comparison, Change Set and Human Review

- 상태: Accepted
- 날짜: 2026-07-17

## Context

Stage 4는 원문 Evidence에 직접 연결된 `READY` Claim Candidate를 만든다. 그러나 Candidate는 아직
공식 지식이 아니며, 기존 Canonical 지식과의 중복·충돌을 확인하지 않고 저장해서는 안 된다.

Stage 5에는 다음 경계가 필요하다.

- 비교 대상 Canonical Snapshot을 고정한다.
- Candidate, Evidence, Machine Diff를 같은 검토 단위로 묶는다.
- 승인 화면의 표시 상태와 서버의 승인 기록을 분리한다.
- 승인 직전에 Candidate와 Snapshot이 바뀌지 않았는지 다시 확인한다.
- Stage 6 전에는 Canonical 저장을 수행하지 않는다.

OpenKnowledge의 Activity, changed-item grouping, Burst Diff와 ddsyasas의 Action 중심 진입 구조를
검토했다. OpenKnowledge는 GPL-3.0-or-later이므로 코드나 런타임을 포함하지 않고 UX 패턴만
독립 구현한다.

## Decision

1. Comparison 모듈은 `CanonicalSnapshotPort`, `GetClaimCandidate`, `TextDiffPort`만 사용한다.
2. `diff@9.0.0`을 `TextDiffPort` 뒤의 word diff 구현으로 채택한다.
3. 비교 분류는 Stage 5 MVP에서 `NEW_CLAIM`, `EXACT_DUPLICATE`, `POSSIBLE_CONFLICT`로 제한한다.
4. 완전 중복은 `NO_OP`를 권고하며 새 Canonical Claim을 만들지 않는다.
5. `DraftChangeSet`은 Candidate Digest, Snapshot Version·Digest, Diff Digest, Evidence ID를
   하나의 Content Digest로 고정한다.
6. 승인·보류·거절은 `RecordReviewDecision` 서버 Command만 변경할 수 있다.
7. 승인자는 반드시 `user` Actor여야 하며 이유를 남겨야 한다.
8. 승인 직전에 Comparison Freshness를 다시 검사한다. Candidate 또는 Snapshot이 바뀌면
   Change Set을 `STALE`로 만들고 승인을 거부한다.
9. 승인 시 서버가 24시간 유효한 Approval Token과 `ApprovedChangeSetManifest`를 만든다.
10. Stage 5 모듈의 `canWriteCanonical`은 `false`다. Canonical 반영은 Stage 6만 담당한다.
11. Impact Analysis, rich editing, collaborative editing은 각각 Stage 9 또는 후속 범위로 미룬다.

## Consequences

- 검토 화면을 열거나 버튼 상태를 바꾸는 것만으로 승인되지 않는다.
- 승인된 Manifest는 정확한 Candidate, Diff, Snapshot Version에 묶인다.
- Snapshot이 변경되면 과거 화면에서 승인할 수 없다.
- OpenKnowledge와 ddsyasas의 장점은 UX 패턴으로 활용하지만 라이선스와 데이터 소유권 경계를
  유지한다.
- Tiptap과 Yjs 없이도 단독 운영 MVP의 검토 흐름을 완료할 수 있다.

## Verification

- 두 Transport에서 Comparison·Review Contract Test
- 새 Claim·완전 중복·단순 충돌 분류
- Evidence와 Diff의 단일 Review Bundle
- 승인 전 Manifest 부재와 승인 후 Digest 고정
- Snapshot 변경 후 `STALE_VERSION`
- 승인·보류·거절 이유와 Actor 이력
- Service Actor 승인 거부
- UI GET만으로 상태가 바뀌지 않는 Negative Test
- PostgreSQL 재시작 후 이력·Manifest 복원
- 동시 승인 중 하나만 성공하는 저장소 잠금 테스트
