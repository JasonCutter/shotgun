# PR384 실행·T3 독립 검토와 최소 보정

검토 기준 `0c0729c8fa6bc6302c43cc2b6c31408c33812f16`, base
`aba6ff27f9620ee1a3f408f8df81e8aad21cc584`. 2026-10-13 KST.
이 기록은 후속 로컬 보정의 좁은 증거이며 새 exact-head CI나 최종 VP 완료를 대신하지 않는다.

## 확인한 회귀와 수정

1. Migration132의 VP status는 `frontiers`/`frontier_members`를 포함한9개 count를
   반환하지만 기존 owner는7개 count만 받아 모든 reset의 fence를 거부했다.
   명시적 owner key를9개로 확장했다. 누락·추가·잘못된 count는 계속 거부하며
   Frontier/header 또는 membership가 남으면 verify는 false다.
2. Migration131/132는 INSERT/UPDATE 전용 `t3_guard_project_knowledge_write`
   (`NEW` 사용)를 DELETE trigger에도 연결했다. DELETE의 `NEW=NULL` 때문에
   정상 journal 삭제가 억제될 수 있었다. 기존080 패턴대로 INSERT/UPDATE만
   fence하며 runtime DELETE 권한은 주지 않는다. 승인 executor의 기존
   owner routine·reset authorization·purge/readback을 사용한다.
3. Source Product의 status는 신규 ACQUIRING/SUBMITTING/OUTCOME_UNKNOWN refresh를
   active로 세지만 SQL purge의 기존 active-work guard는 이를 빠뜨렸다.
   기존 guard에 동일 phase 조건을 추가해 직접 routine 호출도 불명 journal 및
   provenance를 삭제하지 못하게 한다. 정상 owner fence도 유지한다.
4. Impact inspector의 고정203개 table fingerprint가 신규3개 journal과 맞지 않아
   빈 프로젝트도 UNCLASSIFIED_CONTENT였다. 검토한
   `source_product.url_refresh_jobs`, `vp.candidate_frontiers`,
   `vp.candidate_frontier_members`만 반영한206개 exact fingerprint로 갱신했다.
   신규 refresh active count를 기존 source asset snapshot·blocker·blocked count·
   manifest에 넣었다. 예상하지 못한 추가 table은 계속 거부한다.
5. Coordinator는 staging/storage ACK가 불명일 때 ACQUIRING→OUTCOME_UNKNOWN을
   요청하지만 실제 PostgreSQL store의 허용 transition에 이 경로가 없었다.
   상위 에이전트가 해당 transition을 추가했다. 기존 lease 만료를 기다리지 않고
   즉시 UNKNOWN을 기록하며 자동 재취득은 하지 않는다.

## 좁은 검증

모든 실행은 `C:/dev/artifacts/vp-full-completion-2026-10-12/test-runner.cjs`의
환경 allowlist를 사용했다. 운영 `.env`, provider credential, 운영 DB/권위,
동결 Gold/432/B12를 읽거나 호출하지 않았다. 실제 provider 호출0이며 URL
transport는 fake다. PG 검증마다 기존 helper가 새 disposable DB에 전체
migration chain을 적용하므로 이전에 적용된131/132를 재사용하지 않는다.

| 명령/검증                                                                                                                                                             | 결과                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `vitest run tests/unit/vp-ledger-reset-owner.test.ts tests/database/source-refresh.database.test.ts -t "VP reset owner\|T3 refuses direct purge" --maxWorkers=1` 최초 | unit6 PASS; 신규 PG3은 기본5초 timeout. assertion failure가 아닌 runner 시간 제한. 최초 결과를 PASS로 바꾸지 않음 |
| `vitest run tests/database/source-refresh.database.test.ts -t "T3 refuses direct purge" --maxWorkers=1`                                                               | 신규 PG3 PASS. 기존6 case는 선택하지 않음. 새 case만60초 제한; 실제 각각19–23초, 기존 timeout 불변                |
| `vitest run tests/database/source-refresh.database.test.ts -t "T3 preview accepts" --maxWorkers=1`                                                                    | 신규 PG1 PASS. 빈 알려진 schema 허용, UNKNOWN의 blocked/derived count 각각+1, 추가 table 거부. 실제 case2.5초     |
| owned TypeScript4개 파일 ESLint·Prettier                                                                                                                              | PASS                                                                                                              |

추가 `vitest run tests/database/source-refresh.database.test.ts -t "holds ambiguous staging storage" --maxWorkers=1`
신규 PG1 PASS. 실제 coordinator/store/staging에 fake storage exception을 넣어
즉시 UNKNOWN·lease 해제·restart IDLE·SourceVersion1개 보존·URL fake 취득2회
(원본1+refresh1)를 검사했다. 기존5초 case timeout 안에 통과했다.
총 focused unit6 + PG5 PASS이며 추가 test 뒤 owned test ESLint도 PASS다.

PG3은 각 불명 phase의 직접 purge 거부·원본 receipt/job 보존을 확인한 뒤,
소유한 fake fixture만 terminal로 설정하고 전용 executor로 Source/VP journal을
삭제했다. refresh/header/member count0, 두 owner verify=true, runtime DELETE
42501, reset 중 runtime UPDATE fence 거부를 모두 검사한다. unit6은9개
count 허용·journal 잔여·누락·추가·잘못된 count를 검사한다.

별도 fresh isolated schema metadata 재현:
`tsx C:/dev/artifacts/vp-full-completion-2026-10-12/t3-schema-digest.mts`.
측정 table count206, SHA-256
`b5408d14f5400ba945a2c1486cb0e0d9779f4789f24998dcb211300a93cde2c8`.
원본 테이블 행·자료·credential은 출력하지 않는다. 기존168개 json/jsonb/bytea
content-column fingerprint는 바꾸지 않았으며 알려진 schema preview가 통과했다.

## 경계·재사용·잔여

기존 Shotgun PostgreSQL adapter, 전용 T3 executor, owner Port, write fence,
isolated test helper를 AUGMENT했다. 새로운 OSS/runtime/dependency/transaction
owner나 권위는 없다. 기존 pin/license·replacement 경계와
[통합 결정](./integration-decisions.md)을 재사용한다. 080의 공유 fence를
재작성하거나 권한·UNKNOWN 조건을 완화하지 않는다.

이번 수정은 아직 Canonical main에 적용되지 않은 동일 PR의131/132를 보정한다.
운영 migration·데이터 변경·push/merge는 이 검토에서 수행하지 않았다. 실제
기동·운영 reset·release rollback은 인증하지 않으며, 설치/배포 전 exact-head
Gate와 승인된 migration 절차가 필요하다. 상위 에이전트의 TS6 대조 결과,
기존129개 owner의 함수·분류·좌표가 동일했고 byte reproducibility도 PASS였다.
이번 보정은 추가 TS6 artifact 변경이나 transaction owner를 만들지 않았다.
