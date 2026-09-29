# VP 원장 재생·현재 조회 검증 — 2026-09-29

## 범위와 결정

`scripts/verify-vp-projection-replay.ts`는 DB를 변경하지 않고 VP 이력·SourceVersion·Stage 3 revision·Candidate Batch·Validation·주장·관계를 읽어 현재 주장과 관계를 독립적으로 재계산한다. `REPEATABLE READ READ ONLY` 스냅샷 안에서 원장 epoch 연속성, 모든 직접 주장·관계의 HistoryEvent 연결, 최신 처리 완료 Batch와 미해결 판단의 효과를 검사한다. SQL View가 반환한 ID 집합과 재계산한 ID 집합이 다르면 실패한다.

- [gbrain](https://github.com/garrytan/gbrain) `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` (MIT)의 Fact·History·Projection 재생 패턴은 `REFERENCE_ONLY`다. 전체 Runtime/DB를 채택하면 Shotgun의 SourceVersion·Evidence·Ledger ID 소유권과 충돌한다.
- 저장소에 고정된 PostgreSQL 16.14를 `AUGMENT`하여 읽기 전용 검증을 추가한다. 새 OSS 종류나 Schema Migration은 없다. 기존 `oss-source-registry.json`의 version·license·security·maintenance 평가와 Open-source Role Matrix 경계가 유지된다. 교체 경계는 이 검증기의 `Pool` 조회이며, 향후 다른 저장 Adapter를 채택하면 같은 fixture에서 재생 결과를 비교한다.
- CI 의존성 감사에서 기존 `fast-uri` 4.1.3의 고위험 취약점 두 건이 새로 보고됐다. [공식 저장소](https://github.com/fastify/fast-uri)의 BSD-3-Clause 패키지를 `ADOPT` 상태로 유지하면서 override와 lockfile을 수정 버전 `4.1.4` (npm `gitHead` `a34ced25d015d12dfc2b0cf85ce01a4a0d12ecf6`)에 고정했다. [포트 직렬화 권고](https://github.com/advisories/GHSA-qw65-cvwx-89v3)와 [authority bracket 권고](https://github.com/advisories/GHSA-58mr-gqgx-xq4g)는 모두 4.1.4를 패치 버전으로 표시한다. `ajv`, Fastify compiler, `fast-json-stringify`는 동일한 4.1.4를 사용하며 `npm run oss:audit`의 고위험 Gate가 통과했다. 현재 중간 위험 경고는 별도 평가 대상이다. 이 버전 변경은 새로운 Shotgun Port나 데이터 소유권을 만들지 않아 Role Matrix 개정이 필요 없다.
- 검증기 롤백은 스크립트와 테스트 호출을 제거하는 것이다. 사용자 DB 변경이나 데이터 복원은 필요 없다. `fast-uri` 패치에서 호환 문제가 생기면 취약한 4.1.3으로 복귀하지 않고 검증된 후속 패치로 정방향 교체한다.

## 검증 증거

- 독립 PostgreSQL 테스트에서 추출 Batch 교체, 최신 SourceVersion 변경, 의미 관계 정책 재판정, 미해결 관계 철회 후 재생 결과와 현재 View가 일치했다.
- 운영 VP DB: HistoryEvent 47건과 epoch 47, 과거 주장 39건, 과거 관계 12건. 재생 결과와 현재 조회는 주장 16건·관계 2건으로 같았다.
- A/B·수정 버전 검증 DB: HistoryEvent 89건과 epoch 89, 과거 주장 82건, 과거 관계 13건. 재생 결과와 현재 조회는 주장 13건·관계 1건으로 같았다.
- PostgreSQL을 재시작한 뒤 두 DB에서 같은 결과로 다시 통과했다. 원장이나 View 데이터를 수정하지 않았다.

## 남은 Gate

- 이 검증은 **이미 저장된** Source·Candidate·원장을 현재 조회로 재생한다. 원문에서 변환·AI 추출·관계 판단까지 전체 파이프라인을 처음부터 다시 실행해 의미 결과를 비교하는 검증은 아니다.
- DB 재시작 시 전용 maintenance lock 세션이 끊어지면 Runtime은 설계대로 fail-stop한다. 이번 재시작에서 실행 중 샷건은 종료됐고 바탕화면 아이콘으로 다시 시작해 복구했다. 무인 자동 재기동은 아직 구현·검증하지 않았다.
- 모든 형식 Golden Corpus, DeepSeek 품질·비용 Gate와 제품 답변의 epoch 고정은 별도 완료 기준이다. 이 보고서만으로 VP를 `COMPLETE`로 판정하지 않는다.
