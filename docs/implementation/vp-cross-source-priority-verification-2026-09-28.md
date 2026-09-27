# VP 교차 자료 관계 우선순위 검증 — 2026-09-28

## 범위와 근거

- 대상: VP-2 자동 지식 축적의 `VPRelationJobStorePort` PostgreSQL Adapter.
- 실제 자료: `재무제표재무관리__2026-09-27.pdf`와 별도 Markdown 자료. 후자는 자산 1억 원·부채 6천만 원·자본 5천만 원으로 시작해 자본 4천만 원으로 같은 Source를 수정했다.
- 분리된 `shotgun_vp_route` 검증 DB를 현재 Migration까지 올려 사용했다. 사용자 DB `shotgun_vp`는 변경하지 않았다.

## Integration Decision

- 후보: [PostgreSQL](https://github.com/postgres/postgres) 16.14 `pg_trgm` `similarity()`. 저장소의 `oss-source-registry.json`에 고정된 이미지 `postgres:16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777`과 PostgreSQL License를 재사용한다.
- 결정: **AUGMENT**. 기존 PostgreSQL Adapter의 작업 후보 정렬에 이미 Stage 7 Migration 007에서 활성화된 `pg_trgm`을 사용한다. 별도 Runtime, 라이브러리, 원장 DB는 도입하지 않는다. Open-source Role Matrix의 PostgreSQL 역할 변경은 없다.
- 제외: 유사도를 관계 사실로 쓰거나 낮은 유사도의 후보를 버리지 않는다. `similarity`는 작업 **순서**에만 관여한다. SourceVersion, Evidence, 접근 범위, 민감도, DeepSeek의 닫힌 관계 판단, 작업 임대, 일일 호출 예산은 기존 계약을 유지한다.
- 보안·유지보수: 텍스트 유사도 계산은 DB 안에서 수행하며 외부 전송을 늘리지 않는다. PostgreSQL 16 고정 버전 유지보수 정책을 따른다. 교체 시 `VPRelationJobStorePort`의 Adapter 정렬만 교체한다.
- 롤백: 이 정렬 변경을 되돌린 후 작업자를 재시작한다. Schema Migration과 데이터 변환은 없고 기존 작업·결정 영수증·관계 이력은 유지된다.

## 실제 제품 검증

1. UI로 PDF와 상충 Markdown을 투입했다. PDF는 Evidence 128개, 최신 VP 주장 63개로 처리됐다.
2. 첫 교차 질문 1건은 DeepSeek 결과의 구조화 형식 검사를 통과하지 못해 `FAILED`가 됐다. 단순 재질문은 실제 `deepseek/deepseek-flash` 답변으로 두 자료의 4천만 원/5천만 원 충돌을 설명하고 양쪽 SourceVersion을 인용했다.
3. 동일 Markdown Source를 수정해 Version 2를 만들자 최신 답변은 4천만 원을 말하고 PDF와 Markdown Version 2를 인용했다. Version 1은 최신 답변 인용에서 제외됐다.
4. 기존 작업 순서에서 접근 가능한 교차 Source 주장 쌍 257개 중 금융 자료 쌍은 아직 작업으로 생성되지 않았다. 분당 한 쌍 처리와 일일 100회 상한에서 오래된/무관한 쌍이 우선하던 문제를 재현했다.
5. 변경된 Adapter는 PDF의 `자산 = 부채 + 자본`과 Markdown Version 2의 `자산 = 부채 + 자본이다.` 쌍(유사도 0.636)을 먼저 선택했다. 실제 DeepSeek 작업이 `EQUIVALENT` 관계와 모델/토큰 영수증을 기록했다.

## 검증과 남은 한계

- 독립 DB 회귀 테스트 `vp-relation-priority.database.test.ts` 통과: 오래된 무관한 쌍보다 나중에 들어온 관련 교차 Source 쌍을 선택한다.
- 기존 VP Ledger DB 테스트와 Worker 단위 테스트, TypeScript 검사, 변경 파일 ESLint 통과.
- 정렬은 관련 쌍의 지연을 줄일 뿐 후보 수 자체를 줄이지 않는다. 큰 문서의 수백/수천 쌍, 일일 예산, 총 비용의 Golden Corpus/Benchmark Gate는 미완료다.
- 이 PDF의 숫자 예시 `4천만 원`은 Evidence와 Ask에 있으나 현재 추출 VP 주장에는 없다. 따라서 숫자 예시 자체의 주장 관계는 이번에 기록되지 않았다. 공식 관계는 위 회계 등식에 관한 것이다.
- 초기 구조화 답변 실패의 재현성·자동 복구와 전체 지식 epoch 수렴/재생 동등성은 별도 검증이 필요하다. VP Stage 완료로 판정하지 않는다.
