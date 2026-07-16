# Stage 5 OSS Integration Review

- 검토일: 2026-07-17
- 대상: Comparison, Change Set, Human Review UI
- OSS Gate: **COMPLETE**
- 상세 등록부: [`oss-source-registry.json`](../oss-source-registry.json)

## 완료 판정

**Stage 5: COMPLETE**

검증된 OSS를 먼저 비교한 뒤, 재사용 경계를 정하고 구현·Contract 검증을 완료했다.

## OSS 결정

| 후보                   | 결정             | 적용 범위                                             |
| ---------------------- | ---------------- | ----------------------------------------------------- |
| jsdiff 9.0.0           | `ADOPT`          | `TextDiffPort` 뒤의 word-level Machine Diff           |
| Inkeep OpenKnowledge   | `REFERENCE_ONLY` | Activity, changed-item grouping, Burst Diff UX 패턴   |
| ddsyasas/llm-wiki      | `REFERENCE_ONLY` | Action 중심 Review 진입 계층                          |
| diff-match-patch 1.0.5 | `REJECT`         | 오래된 npm release이며 jsdiff와 중복                  |
| Tiptap 3.28.0          | `DEFER`          | Stage 5 MVP에 rich editing이 필요하지 않음            |
| Yjs 13.6.31            | `DEFER`          | 단독 운영 MVP에 collaborative editing이 필요하지 않음 |

## 재사용과 제외 경계

### jsdiff

- `adapters/text-diff-jsdiff`에서만 import한다.
- Domain은 `TextDiffSegment` 계약만 사용한다.
- 교체 시 Stage 5 Contract Test를 그대로 통과해야 한다.

### OpenKnowledge

- GPL-3.0-or-later 코드를 복사하거나 Runtime으로 포함하지 않는다.
- Activity와 Burst Diff의 정보 배치 원칙만 독립 구현했다.
- Canonical, Approval, Review 데이터는 Shotgun이 소유한다.

### ddsyasas

- Action 중심 진입과 간결한 Review hierarchy만 참고했다.
- backend, storage, path 처리 코드는 포함하지 않았다.

### Tiptap·Yjs

- UI 편집 상태가 승인 상태를 대신할 위험과 불필요한 운영 복잡성을 피하기 위해 보류했다.
- 후속 multi-user 요구가 확인될 때만 다시 평가한다.

## Contract 검증

| 검증                                       | 결과 |
| ------------------------------------------ | ---- |
| 고정 Snapshot과 Candidate 비교             | PASS |
| 새 Claim·완전 중복·단순 충돌 분류          | PASS |
| 완전 중복 `NO_OP` 권고                     | PASS |
| Candidate·Evidence·Diff 단일 Review Bundle | PASS |
| 승인 전 Canonical Write·Manifest 없음      | PASS |
| 승인 Content Digest·Expected Version 고정  | PASS |
| Snapshot 변경 후 `STALE`                   | PASS |
| 승인·보류·거절 이유와 Actor 이력           | PASS |
| Service Actor 승인 거부                    | PASS |
| UI GET 상태 변경 금지                      | PASS |
| PostgreSQL 재시작 복원                     | PASS |
| 동시 최종 승인 하나만 성공                 | PASS |

## 다음 Stage 전달

Stage 6는 `ApprovedChangeSetManifest`만 입력으로 받아 Canonical Commit을 수행해야 한다.
미승인 Candidate나 Review UI 상태를 직접 Canonical Write 근거로 사용할 수 없다.
