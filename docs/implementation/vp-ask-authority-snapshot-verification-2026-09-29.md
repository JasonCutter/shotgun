# VP-01 Ask 권위·스냅샷 검증 (2026-09-29)

## 판정

VP의 `AUTO_PROJECT_KNOWLEDGE` Ask 경로를 VP 현재 주장 원장 하나로 연결했다. 기존 raw Evidence 전체 검색은 더 이상 답변 근거로 보충하지 않는다. VP Adapter가 없거나 질문 시점의 VP snapshot이 바뀌면 답변을 게시하지 않는다.

Ask snapshot은 다음 값을 포함한다.

- `vp.project_epochs.current_epoch`
- 사용자가 접근할 수 있는 각 Source의 최신 `SourceVersion` 집합으로 만든 `sourceWatermark`
- AnswerRun 시도에 저장한 정확한 원문 `Evidence` ID·SourceVersion·인용 구절

최신 SourceVersion의 Stage 3 인덱싱, Candidate 검증, VP 원장 반영이 끝나지 않았으면 Ask worker가 질문을 대기시킨다. 처리 완료 후에도 이전 주장만 남은 경우 이전 버전 근거로 답하지 않고 `NO_SUPPORTED_ANSWER`를 반환한다. 모델 호출 전과 답변 게시 전 snapshot을 재확인한다.

## OSS·통합 결정

| 후보/구성요소 | 결정 | 근거·범위 |
| --- | --- | --- |
| 기존 PostgreSQL FTS·`pg_trgm` | `AUGMENT` | 기존 검색 Port와 저장소를 유지하고, VP 현재 주장 후보를 검색한다. 새 Runtime이나 package는 추가하지 않았다. |
| `garrytan/gbrain` | `REFERENCE_ONLY` | Search·Graph 검증 패턴만 참고한다. Shotgun Evidence·SourceVersion·접근 경계와 다른 Runtime/DB는 도입하지 않는다. |
| Jev | `DEFER` | 이 변경은 기존 DeepSeek 경로나 Jev를 호출하지 않는다. |

`AskKnowledgeEvidenceSearchPort`가 교체 경계다. Migration 121은 과거 AnswerRun에 영향을 주지 않는 nullable epoch/watermark 감사 열을 추가한다. Migration 적용 전 코드 복귀 시 새 열은 보존한다.

## 검증 결과

| 검증 | 결과 |
| --- | --- |
| `frontend-ask-uploaded-source-resolution.database.test.ts` | 통과. VP 주장 부재 시 raw Evidence fallback이 없고, 최신 자료의 Candidate/원장 처리가 끝날 때까지 대기하며, SourceVersion watermark가 바뀌면 기존 결과를 게시하지 않는 것을 확인했다. AnswerRun attempt의 epoch/watermark 저장도 확인했다. |
| `vp-direct-assertion-ledger.database.test.ts` | 통과. 권한 필터·관계 확장·현재 주장 조회 및 epoch/source watermark 유효성 검사를 확인했다. |
| `vp-two-action-ui.spec.ts` Chromium | 통과, 1.6분. 격리 브라우저 fixture에서 실제 Intake→Stage 3→Stage 4 Candidate/Validation→VP 원장→Ask 흐름과 수정본 최신성·인용을 확인했다. Provider는 결정적 fake이므로 DeepSeek 답변 품질 Gate를 대신하지 않는다. |
| ESLint 및 `git diff --check` | 통과. |
| `npm run docs:validate`, `npm run docs:links` | 통과. |
| `npm run typecheck -- --pretty false` | 전체 통과 아님. 이번 변경 파일에서는 오류가 없고, 기존 untracked `tests/contract/ts7-cross-section-acceptance.contract.test.ts`에서 현재 계약과 맞지 않는 타입 오류가 발생했다. 이 파일은 VP-01 수정 범위에 포함하지 않았다. |

브라우저 검증 전 `TEST_DATABASE_URL` 가드로 `shotgun_test`를 확인하고 미적용 Migration 120·121만 적용했다. `DATABASE_URL`은 대상이 아니었다.

## 완료 범위와 남은 Gate

VP-01의 Ask 권위·epoch/watermark/Evidence 고정과 구버전·stale snapshot 음성 검증은 통과했다. 이 결과는 VP 전체 완료를 뜻하지 않는다. 전체 원문 재생·증분 동등성은 VP-02에 남고, 대표 Golden Corpus의 검색·답변 품질은 VP-04에 남는다. 설치된 제품에서 실제 DeepSeek를 쓰는 전체 사용자 여정은 VP-03/VP-11 Gate다.

**Main commit:** 이 보고서 작성 시 검증은 끝났으며, 이 파일과 구현 변경을 포함하는 Main commit은 아직 기록되지 않았다. Commit hash를 확정한 뒤 VP 현황표에 추가한다.
