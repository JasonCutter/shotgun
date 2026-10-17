# VP-05 — Negative Ledger·Ask 격리 제품 연결

**NEGATIVE_LEDGER_ASK_ISOLATED_VERIFIED / PUBLICATION HOLD / PRODUCTION HOLD — 2026-10-17**

기준은 Canonical `c58ea548b0aa4024f8a9243f4bff7cf941be3ec3`, 준비 커밋
`f1a1d2b77406b00565594846ccc285d8493508fc`다. 사용자의
**“Negative Ledger·Ask 격리 구현 승인”**에 따른 로컬 구현이다.
[승인 계약과 변경 이력](../../architecture/add/vp05-evaluation-trust/negative-ledger-product-integration-proposal.md)을 따른다.
운영 적용이나 새 정책의 일반 앱 활성화는 하지 않았다.

## 1. 해결한 제품 경계

기존 실행 전용 negative는 call JSON과 완료 job만 남기므로 과거 SUPPORTS가
current 관계와 Ask 이웃에 남았다. 그 역사적 동작을 재현한 기존 20번째 테스트를
보존한다. 새 product Fake contract와 revision `rN`을 분리하고, 기존
receipt/history/epoch에 NO_RELATION을 기록하여 current 관계만 철회한다.
과거 positive/AnswerRun/citation과 직접 Source/Evidence 검색은 유지한다.

`r1 positive → r2 negative → r3 positive`는 각 revision의 새 판단이다.
옛 output을 자동 승격하거나 replay하여 새 positive로 만드는 방식이 아니다.
0.9 selected-probability gate, RELATED 의미, 정상 v6 구성은 보존했다.
Fake 응답은 기능·실행 계약 증거이며 의미 정답 인증이 아니다.

## 2. 최소 권위·재사용와 구현

**AUGMENT** Shotgun@c58ea548의 Ledger/current view/Ask snapshot, 기존 global
budget·immutable execution context·claim/job/attempt·UNKNOWN·safe transaction·T3
owner다. 새 테이블·별도 graph/approval/budget 서비스나 외부 dependency는 없다.
[기존 OSS 판단](./evaluation-a3-implementation.md#2-oss기존-구현-판단--구현-전에-수행)의
exact upstream pin/license/security·maintenance와 REFERENCE_ONLY 경계를 재사용했다.
gbrain generic graph/job 및 lucas provenance, ddsyasas/OpenKnowledge UI 패턴은
Shotgun의 receipt·SourceVersion·egress 권위를 대신하지 않는다. Role Matrix 채택
상태를 변경하거나 upstream 코드를 복사하지 않았다.

- Migration140: 기존 epoch에 project policy binding, call-linked receipt,
  linked history와 NO_RELATION shape/commit guard를 추가한다. 기존 row backfill은 없다.
- `PostgresIsolatedNegativeKnowledgeJobs`: scoped CAS binding, 새 revision 재사용 거부,
  동일 transaction의 receipt/edge/history/epoch/job 완료와 정확한 readback을 제공한다.
- Source writer와 같은 Source row를 잠근 뒤 최신 Evidence를 재확인한다.
  동시 v2, 옛 policy, exact deterministic 관계와 충돌하면 SUPERSEDED로 보존한다.
- Current view는 epoch 순서로 negative 이후의 semantic edge만 철회한다.
  NULL-bound 기존 프로젝트의 unresolved veto는 유지한다. Product-bound exact는
  AI negative나 unresolved veto로 가리지 않는다. Negative 없는 pair는 history
  array scan을 하지 않으며 negative pair 전용 index를 추가했다.
- 앱 opt-in은 runtime-test·서로 다른 생성 child DB·구체적인 transport 없는 Fake·
  synthetic credential fingerprint를 요구한다. 동일 기존 persistent global budget
  구현을 쓰며 정상 v6 branch와 운영 authority 설정은 유지한다.
- T3는 기존 role/request authorization 뒤 history→edge→receipt를 지운 다음 기존
  owner를 호출한다. FK 순서를 맞추면서 한 transaction의 rollback을 보존한다.
- 기존 read-only projection replay도 receipt/history에서 negative와 binding을
  독립 재구성한다. 정상 v6·빈 batch 검증과 새 앱의 전/후 full replay가 일치한다.

완료 이후 readback은 job와 stored call의 전체 출력·receipt·history 동일성에 대한
조회다. lease token으로 별도 권한을 증명한다고 주장하지 않는다. 복구 lease가 달라도
원래 claim/call/semantic attempt를 유지한다. 프로젝트 한정 복구는 타 프로젝트의
expired job를 변경하지 않는다.

## 3. 실제 앱 인수 증거

정상 `startShotgunApplication`과 실제 Source/ledger/relation/Ask worker를 사용했다.
자료 A/B 투입→SUPPORTS→질문→revision 회전→NO_RELATION→다시 질문→재시작을
격리 PostgreSQL과 Fake로 검증했다. Public-only 조회가 private 자료를 반환하지 않는
검사도 유지했다. 새 질문에서는 B relation 이웃 인용이 사라지고 B 직접 검색은
가능하며, 과거 답변의 statement/citation은 그대로다. 동일 revision 재시작은 추가
Fake 호출이나 receipt를 만들지 않는다.

관측 store `77ac22f9-8912-4073-bdcd-b8785c7b045e`, authority
`c9006947-e0cf-4a44-9228-7ea073854baf`는 **이 테스트의 격리 권위**다.
두 job/claim/call/attempt가 각각 1:1로 연결되고 둘 다 OUTPUT_STORED다.
이는 운영 권위 identity가 아니다. 전체 trace는 아래 외부 증거 packet에 있다.

## 4. 검증과 초기 실패

여러 관련 명령의 고유 test를 합산하고 중복 재실행은 중복 집계하지 않는다.

| 검증                        | 결과                                                                    |
| --------------------------- | ----------------------------------------------------------------------- |
| 관련 unit/contract          | 221/221 PASS                                                            |
| 실제 app/Ask journey        | 1/1 PASS, relation Fake 2회, live 0                                     |
| Product/기존 실행 전용 DB   | 39/39 PASS: 새 product19·과거 execution-only20                          |
| 기존 v6/복구/T3 회귀        | replay2·T3 9·priority12·P0 migration3·기본 app3 PASS, 기존 outage1 SKIP |
| 관련 PostgreSQL 합계        | 68 PASS / 기존 SKIP 1; 새 skip 없음                                     |
| TS6/current v8              | 65/65 PASS, release·재생성 일치 PASS; 추가 owner2·기존 grade 유지       |
| Typecheck/lint/Architecture | PASS                                                                    |
| 문서/format/보존            | 최종 문서 Gate와 보존 증거 packet 참조                                  |

기존 outage SKIP은 `VP_RELATION_POSTGRES_OUTAGE_TEST=1`인 별도 disposable
container 실험이며 이번에는 활성화하지 않았다. 위 68 PASS에 포함하지 않는다.
전체 기존 unit/contract/frontend/CI를 이번에 다시 실행했다고 주장하지 않는다.
Canonical PR392 CI는 baseline 회귀 증거로, 이번 diff는 위 관련 검증으로 구분한다.

초기 실패는 숨기지 않는다.

1. 새 DB fixture가 LEGACY_TEST 모드여서 FRONTIER membership을 생성하지 못했다.
   실제 앱과 같은 FRONTIER composition으로 고쳤다. Exact fixture도 enqueue 전
   exact seed로 EMPTY였으므로 finalizer 직전 exact가 생기는 경합을 검증하도록 수정했다.
2. 앱 fixture는 비동기 assertion 저장을 기다려야 했고, public-only 조회로 private
   Source를 찾을 수 없었다. 실제 owner 범위 조회와 HTTP Ask를 사용하고 public-only
   비노출 assertion을 추가했다. 제품 ACL이나 검색을 완화하지 않았다.
3. Source v2 fixture의 동일 OriginalAsset 재사용은 DB unique 제약에 거부됐다.
   새 합성 asset을 생성했다. Product T3 새 FK 삭제는 통과했다.
4. 로컬 기본 Vitest DB 명령은 5초 test/10초 hook을 사용해 일부 실패했다. 정식
   `test:database`의 기존 60초 test/hook Gate로 재실행해 통과했다. Source test
   timeout·assertion·skip은 변경하지 않았다. TS6의 기존 제한도 확대하지 않았다.
5. `pg_dump ENOENT`와 child worker의 55432 연결 실패는 Windows 도구/transport
   문제였다. Artifact-only preload로 같은 격리 컨테이너의 실제 pg_dump/pg_restore와
   child PostgreSQL socket transport를 사용하여 해당 두 테스트가 통과했다.
6. TS6가 새 owner 2개를 감지해 v8/현재 count 검사에서 실패했다. 기존 owner의
   file/class/method/grade를 대조하고 current 후보147·owner133 및 legacy scoring의
   current owner119로 갱신했다. 동결 v2~v7와 과거 summary는 변경하지 않는다.
7. 독립 AI 리뷰가 full output readback, project-scoped recovery, exact 보호 및
   SourceVersion 경합 공백을 지적했다. 최소 guard/lock과 반례 테스트로 보완했다.
   이 리뷰도 인간 의미 검증으로 기록하지 않는다.
8. Migration139→140 기존 row snapshot 비교가 `SELECT *`의 기존 미노출 direction
   필드 노출을 발견했다. 기존 view column을 명시해 보존했고 rollback과 기존 edge/
   receipt byte-equivalent 값 비교가 통과했다. 같은 test의 assertion을 완화하지 않았다.
9. 기존 replay의 15초 제한은 cold Docker CLI 연결마다 약3.2초를 소비해 실패했다.
   준비를 hook으로 옮기는 시도도 충분하지 않아 그 변경을 폐기했다. 같은 테스트를
   원본 그대로 유지하고 artifact-only Docker Engine API exec transport로 동일
   PostgreSQL protocol을 연결하자 7.76초에 PASS했다. Bash/Perl warm-query 비교는
   유의한 개선이 없어 제외했다. Timeout 확대·assertion 삭제·새 skip은 없다.
10. 기존 P0 migration test의 최신 목록을 140까지 확장했다. 128→129/130과 기존
    이력/UNKNOWN/authority 보존 assertion은 유지하고 최신 누적 수만 11→12로
    갱신했다. 전체3개와 실제 기본 v6 app 여정3개도 통과했다.

테스트 trace 경로는 caller 환경 변수 또는 OS temp를 사용한다. CI에 개발 PC의
Windows 경로를 강제하지 않으며, 이 경로 보정은 검증 assertion을 바꾸지 않는다.

초기 로그와 최종 로그는 `C:/dev/artifacts/vp-full-completion-2026-10-12/negative-ledger-product-20261017`
에 보존한다. 과거 sealed packet을 수정하지 않는다.

## 5. 보존·정리 증거

- 보호 파일79개, 다른 worktree13개의 head/status, config·stash 동일.
- 앞선 PR392/준비/Windows 설치/제품 packet4개와 indexed file153개 hash 동일.
- Canonical 대비 정상 v6 prompt/router·Ask search·global counter/실행 경계5개 source
  파일의 LF Git-byte SHA-256 동일 (`unchanged-policy-and-boundaries.json`).
- 테스트가 만든 DB는 dispose했다. 초기 timeout에서 남은 child DB 한 개는 생성
  시각/정확한 namespace·이름을 확인해 정리했고 이전 test DB15개는 보존했다.
  모든 DB client0을 확인한 뒤 이번에 시작한 격리 컨테이너만 기존 exited 상태로
  돌렸다. 운영 DB 컨테이너 두 개는 계속 exited이며 mount/identity도 동일하다.
- 최종 Git exact head/tree·파일 목록과 clean status는 외부 packet의 Git 기록에 남긴다.

## 6. 제한·rollback·남은 조건

기존 VP 화면에는 pair별 처리 상태 슬롯이 없다. 이번 범위에서는 execution/Ledger의
NO_RELATION·MODEL_ABSTAINED·WITHHELD·INVALID·UNKNOWN 구분과 실제 Ask 효과를
입증한다. 새 UI/API나 사용자 승인 절차를 추가하지 않았으며 UI 구분 완료로 세지 않는다.

운영 DB/migration/authority/Vault/config·환경 변경, 운영 앱·worker, live AI,
v11/SSC/모델 비교, 동결 실험·Gold-B-7은 건드리지 않는다. 기존 72/432/B12,
B 잔여24·stash와 별도 worktree를 보존한다. Push/PR/merge는 아직 승인받지 않았다.

Rollback은 writer OFF와 negative-aware reader/append-only 이력 보존이다.
Negative row 삭제나 old view 복구로 과거 positive를 부활시키지 않는다.
운영 release/backup/quiescence·migration 검토와 별도 승인이 필요하다.
Windows 운영 설치·재부팅 인수, 실제 모델 의미 품질 및 인증 reference 증거는
이 격리 구현으로 완료되지 않는다. 전체 VP 최종 인수 완료를 선언하지 않는다.
