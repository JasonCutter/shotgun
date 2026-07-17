# Stage 10 OSS Integration Review

- 검토일: 2026-07-17
- 대상: Compiled Truth, Graph Projection, Knowledge Discovery, 2D Graph UI
- OSS Gate: **COMPLETE**
- 상세 등록부: [oss-source-registry.json](../oss-source-registry.json)

## 완료 판정

**Stage 10: COMPLETE**

## Integration Decision

| 후보                 | Pin·License                   | 결정           | 포함 범위                                        | 제외 범위                    |
| -------------------- | ----------------------------- | -------------- | ------------------------------------------------ | ---------------------------- |
| Cytoscape.js         | 3.34.0 / `22716bf`, MIT       | ADOPT          | local 2D renderer                                | Graph 의미·저장·승인         |
| garrytan/gbrain      | `a25209b`, MIT                | REFERENCE_ONLY | ordered phase·dry-run·bounded drain·Graph filter | runtime·DB·Canonical write   |
| Inkeep OpenKnowledge | `f2834c2`, GPL-3.0-or-later   | REFERENCE_ONLY | 2D interaction·fallback UX                       | GPL 코드·runtime             |
| PostgreSQL           | 16.14 exact image, PostgreSQL | ADOPT          | Shotgun 소유 Projection·suppression              | 외부 Graph·Vector 모델       |
| pgvector             | `159b79a`, PostgreSQL         | DEFER          | 향후 semantic recall 후보                        | Stage 10 extension·embedding |
| Apache AGE           | `6876abc`, Apache-2.0         | DEFER          | 향후 graph benchmark                             | 현재 runtime                 |
| OpenSearch           | `1d71f7b`, Apache-2.0         | DEFER          | 향후 large hybrid search                         | 현재 cluster·index           |
| Qdrant               | `44ad62f`, Apache-2.0         | DEFER          | 향후 vector benchmark                            | 현재 service·embedding       |

## 재사용 경계

- Cytoscape는 `CompiledTruthGraph`의 node·edge만 읽으며 local package로 제공한다.
- gbrain의 운영 패턴만 참고하고 Shotgun projector, fingerprint, budget 계약은 독립 구현한다.
- OpenKnowledge의 GPL 코드는 복사하지 않는다.
- PostgreSQL 외 제품은 대표 데이터에서 한계가 측정된 뒤 Adapter 비교를 시작한다.

## Contract·교체 검증

- Full Rebuild·Incremental logical digest 동등: PASS
- temporal state 4종: PASS
- 승인 Typed Edge 전용 Graph: PASS
- `DERIVED_INFERENCE → VALIDATION`: PASS
- suppression·budget: PASS
- status·lag: PASS
- local renderer·list/table fallback: PASS
- PostgreSQL restart·duplicate suppression: PASS

## 알려진 제한과 재검토 조건

- rebuild 비용이 운영 budget을 넘으면 row 단위 incremental delta를 추가한다.
- semantic recall benchmark가 실패하면 pgvector부터 비교한다.
- PostgreSQL graph 질의가 대표 latency budget을 넘으면 Apache AGE를 비교한다.
- Cytoscape 대형 그래프 렌더링이 느려지면 clustering·virtualization 또는 renderer 교체를 검토한다.
