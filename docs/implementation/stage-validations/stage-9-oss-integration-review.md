# Stage 9 OSS Integration Review

- 검토일: 2026-07-17
- 대상: Knowledge Model, Typed Graph Impact, Advanced Review, Entity Vault staging
- OSS Gate: **COMPLETE**
- 상세 등록부: [oss-source-registry.json](../oss-source-registry.json)

## 완료 판정

**Stage 9: COMPLETE**

## Integration Decision

| 후보                  | Pin·License                     | 결정                     | 포함 범위                                                      | 제외 범위                                                |
| --------------------- | ------------------------------- | ------------------------ | -------------------------------------------------------------- | -------------------------------------------------------- |
| garrytan/gbrain       | `a25209b`, MIT                  | REFERENCE_ONLY           | 방향·유형·깊이·cycle graph traversal, alias·timeline 실패 패턴 | gbrain runtime·DB·MCP, inferred timeline Canonical write |
| NetworkX              | 3.6.1 / `7530809`, BSD-3-Clause | ADOPT                    | 승인 Typed Edge BFS의 독립 Oracle                              | production request runtime, Canonical write              |
| Inkeep OpenKnowledge  | `f2834c2`, GPL-3.0-or-later     | REFERENCE_ONLY           | GraphView·Burst·Entity Vault staged-review UX                  | 코드 복사, 전체 runtime, 양방향 Canonical sync           |
| lucasastorian/llmwiki | `ad626a3`, Apache-2.0           | REFERENCE_ONLY (Stage 9) | reconcile idempotency·backfill 검토 패턴                       | SQLite·VaultFS·watcher runtime                           |
| Cytoscape.js          | 3.34.0 / `22716bf`, MIT         | DEFER                    | Stage 10 2D renderer 후보                                      | Stage 9 runtime dependency                               |

NetworkX만 새 의존성으로 고정했다. gbrain과 OpenKnowledge는 Shotgun Contract·DB를
대체하면 Evidence·Approval 경계를 약화시키므로 코드가 아닌 검증된 패턴만 사용했다.

## Contract·안전 검증

| 완료 기준                                                  | 결과 |
| ---------------------------------------------------------- | ---- |
| 7개 유형 Schema와 Evidence 결합                            | PASS |
| `POSSIBLY_SAME` 자동 병합 금지                             | PASS |
| Relation·Event·Action 시간 근거 강제                       | PASS |
| 승인 Typed Edge만 결정적 Impact 탐색                       | PASS |
| cycle·depth·node budget                                    | PASS |
| NetworkX Oracle 결과 동등                                  | PASS |
| Atomic Group 일부 승인·dangling reference 차단             | PASS |
| User Edit Phase routing                                    | PASS |
| 모델 출력 전체 보존·불일치 표시                            | PASS |
| Graph 목록·표 fallback                                     | PASS |
| Entity Vault staged import·approval, Canonical write=false | PASS |
| PostgreSQL 재시작·원자 상태 보존                           | PASS |

## Adapter·교체·Rollback

- `KnowledgeModelRepositoryPort`는 in-memory와 PostgreSQL 구현이 같은 Contract Test를
  통과한다.
- NetworkX Oracle을 제거해도 production Impact 계약은 변하지 않는다. 대체 Oracle은
  같은 edge order·depth·node·cycle fixture를 통과해야 한다.
- 2D renderer는 `KnowledgeGraphView`만 소비하며 목록·표 fallback을 제거할 수 없다.
- Entity Vault adapter는 Canonical writer가 아니며 승인 후에도 다음 단계는
  `REVIEW_AND_STAGE_KNOWLEDGE_GROUP`이다.

## 알려진 제한과 재검토 조건

- Cytoscape.js는 Stage 10 interactive graph가 시작될 때 재검토한다.
- 대규모 graph의 measured latency가 budget을 넘을 때 production graph library를 비교한다.
- gbrain import/export가 필요해지면 Shotgun ID·Evidence 변환 Adapter만 별도로 평가한다.
- OpenKnowledge GPL 코드는 별도 라이선스 결정 없이 제품 runtime에 포함하지 않는다.
