# VP-05 — NO_RELATION 제품 연결 보완안

**ISOLATED IMPLEMENTATION APPROVED / LOCAL IMPLEMENTATION / PRODUCTION HOLD — 2026-10-17**

기준 Canonical은 `c58ea548b0aa4024f8a9243f4bff7cf941be3ec3`다. PR392는
승인 head `5fb78d1ec84f6a0503bb2de79d0bd92a54a964ef`와 같은 tree로 병합됐고
[main CI38942714053](https://github.com/JasonCutter/shotgun/actions/runs/38942714053)의
Quality·Frontend·Required Gates가 SUCCESS다. 앞선 PUBLICATION_PENDING과
MERGE_HOLD는 당시 이력이다. 작성 당시 이 문서는 미채택 후보였으며,
이후 사용자의 **“Negative Ledger·Ask 격리 구현 승인”**으로 아래 격리 구현을
승인받았다. 이 승인은 운영 정책 활성화나 Canonical 게시 승인이 아니다.

## 1. 입증할 제품 공백

[기존 승인](./relation-negative-and-acceptance-policy-draft.md#7-2026-10-16-후속-지시--기준의-수정-가능성과-격리-저장-연결)은
Fake 전용 실행 결과 저장·복구까지다. `ISOLATED_NO_RELATION` 완료는 기존
`relation_provider_calls.output_json`에 남지만, `decision_receipts`는 negative를
허용하지 않는다. migration117의 현재 관계 view는 두 unresolved 코드만 철회에
사용한다. 따라서 같은 pair에 과거 positive가 있으면 새 실험 negative만으로는
그 edge와 Ask의 relation 확장이 철회되지 않는다.

이는 정상 앱의 v6가 잘못된 negative를 발행한 사건이 아니다. 새 정책이 아직
제품 지식에 연결되지 않은 경계다. 합성 과거 SUPPORTS를 seed하고 실제 격리
worker의 negative 완료 전후에 `PostgresVPAskEvidenceSearch`를 읽는 진단을
`tests/database/vp-explicit-negative-isolated.database.test.ts`에 추가한다.
과거 관계와 Ask 이웃이 유지된다는 assertion은 미구현 경계의 재현이며 제품
인수 PASS나 그 합성 관계의 의미 정답 인증이 아니다.

## 2. 제안 결정 — 기존 Ledger 한 곳에 기록

1. 공급 입력과 인가된 Evidence가 충분하고 기존 선택 확률0.9를 통과한
   `NO_RELATION`만 기존 VP Ledger의 명시적 **관계 판단 영수증**으로 기록한다.
   새 positive edge, 원문 Evidence, 객관적 Fact를 만들지 않는다.
2. Pair의 project·assertion·SourceVersion·Evidence·input/policy/schema digest,
   provider/model 및 저장된 call/job/attempt/claim 실행 계보를 검증한다.
   `NO_RELATION`은 이 입력·정책 범위의 판단이며 세상의 모든 연결 부재가 아니다.
3. `MODEL_ABSTAINED`, `WITHHELD`, `INVALID`, `OUTCOME_UNKNOWN`은 negative로
   승격하지 않는다. 기존 unresolved 철회 계약을 조용히 negative로 재해석하지 않는다.
4. 영수증·기존 project epoch/history·job 완료를 하나의 기존 PostgreSQL
   transaction에서 확정한다. 재실행·ACK 유실·저장 결과 재생은 같은 영수증과
   history만 readback하고 provider 호출·claim·attempt·epoch를 중복 생성하지 않는다.
5. 실행 원장 JSON을 current knowledge 조회의 두 번째 권위로 사용하지 않는다.
   Negative의 읽기 모델은 기존 VP Ledger receipt/history에서 재생성한다. 기존
   migration117의 unresolved-job veto는 그대로 유지한다. 그 veto는 현재
   `relation_jobs`의 완료 코드/시각에 있고 receipt/history가 아니므로, 이를
   생략한 receipt-only 재생성으로 철회된 옛 edge를 부활시키지 않는다.

기존 `COMPLETED / ISOLATED_NO_RELATION` 호출은 lease가 이미 해제된 실행 기록이다.
이를 자동 승격하거나 새 호출로 다시 실행하지 않는다. 첫 제품 연결 검증은 새
격리 입력/새 eligible job으로 한다. 과거 negative의 의미 원장 승격은 별도의
승인·멱등성·provenance 계약이 없으면 하지 않는다.

## 3. 최소 schema/Port 범위

승인 뒤 additive migration 한 개를 검토한다. 활성 `db/migrations`에는 아직
추가하지 않는다. 기존 테이블을 재사용하며 별도 negative DB·서비스는 없다.

- `decision_receipts.outcome`에 scoped `NO_RELATION`을 허용하되 semantic pair,
  provider/input/정책 검사와 immutable history 경계를 유지한다.
- 새 negative receipt와 저장된 provider call의 명시적 1:1 연결을 둔다. nullable
  실행 계보 column/FK·unique를 사용하는 경우 기존 v6 receipt는 그대로 읽는다.
  project를 포함한 FK와 T3 소유권/삭제 순서를 함께 검증한다.
- Negative에도 기존 project epoch/history를 남기고 project-scoped receipt 참조를
  **필수**로 연결한다. 기존 positive는 `history.relation_ids`에서 receipt로
  연결되지만 negative에는 edge가 없으므로 명시적인 receipt/history 연결 없이는
  epoch 순서를 비교할 수 없다. 별도 전역 시계나 순번 저장소는 도입하지 않는다.
- 기존 project epoch owner 아래 nullable scoped relation-policy binding을 두는
  최소안을 사용한다. NULL인 legacy 프로젝트는 기존 v6 동작을 유지한다. 새
  격리 profile만 명시 binding을 설정하며, finalizer와 DB write guard는 같은
  프로젝트 binding을 transaction에서 잠그고 job의 policy identity와 대조한다.
  Guard는 **semantic AI 관계 발행**과 기존 unresolved-job veto의 새 발행에만
  적용한다. `DETERMINISTIC / EXACT_TEXT_EQUIVALENCE`의 기존 intake 기록은
  별개 계약이며 AI policy revision으로 차단하지 않는다.
  오래된 worker가 결과를 늦게 쓰는 경우도 허용하지 않는 음성 검증이 필요하다.
  이는 기존 credential/global budget authority 변경이 아니라 새 지식 commit
  자격의 범위이므로 이 후보의 별도 승인 대상에 포함한다. 새 정책 선택 서비스는 없다.
- Binding의 설정/회전도 기존 epoch UPDATE trigger를 우회하지 않는다. 같은
  transaction에서 epoch를 정확히 한 번 증가시키고 전용 typed history event를
  남긴다. 필요하면 이 event에만 nullable assertion 참조를 허용하는 명시 제약을
  추가한다. Metadata-only UPDATE나 trigger 해제는 하지 않는다. Binding 변경만으로
  옛 지식/인용을 삭제하지 않으며, Ask는 기존 query-scoped Evidence/SourceVersion
  재검사로 현재성을 판정한다. epoch 차이만으로 과거 답변을 stale로 만들지 않는다.
- `VPRelationJobStorePort`와 scoped finalizer를 재사용한다. v6 기본 codec/router는
  유지하고, validated stored negative를 현재 pair와 lease에 결합해 기록하는
  경로만 추가한다. caller가 outcome 문자열만 보내 영수증을 만들 수 없어야 한다.

이는 승인 요청의 범위다. 정확한 constraint/index/column과 rollback SQL은 구현
중 관련 기존 계약과 테스트를 대조해 최소화하며 변경 이유를 기록한다.

## 4. Projection·Ask 계약

같은 project와 정확한 pair의 뒤이은 accepted negative는 이전 semantic positive를
현재 graph에서 철회한다. 과거 receipt/edge/citation은 불변이다. 더 최신의 유효한
positive는 **새 eligible policy revision의 새 job**으로만 다시 연결한다. 기존
pair/policy별 receipt/job uniqueness를 유지하므로 예전 v6 결과의 단순 replay나
완료 시각 변경은 새 positive가 아니다. 동일 key의 충돌 readback도 exact
input/outcome/실행 identity를 확인해야 하며 COMPLETED만으로 일치로 간주하지 않는다.

Negative/positive의 동시 완료와 늦은 완료를 구별해야 한다. 기존 project epoch와
history의 확정 순서를 재사용하고, 동률·실행 순서 역전·다른 revision의 늦은 결과를
임의 UUID 정렬이나 벽시계만으로 최신으로 간주하지 않는다. 현재 구현에는
active-policy commit fence가 없고 lease/current pair만 검사한다. 따라서 위 scoped
policy binding의 commit-time fence를 명시적으로 구현·검증해야 한다. Binding
불일치의 늦은 결과는 저장된 호출 outcome을 보존하되 새 지식을 발행하지 않고
설명 가능한 SUPERSEDED 등 기존 실행 상태로 남긴다. mutable credential을 다시
읽어 실행 context를 바꾸지 않는다. 역사적 ordering을 복원할
수 없는 pair는 확인 불가를 명시하고 조용히 current edge를 발행하지 않는다.
기존 deterministic exact-equivalence의 우선순위를 AI negative로 우회하지 않는다.

Ask는 기존 `current_relations` Port를 통해 철회를 반영한다. Negative는 이웃
확장을 제거하며 Source/Evidence 자체를 삭제하거나 직접 검색에서 차단하지 않는다.
현재 접근 권한·민감도·SourceVersion 검사는 그대로다. 같은 질문에서 필요한 근거
집합이 바뀌면 기존 Ask snapshot/freshness 재검사를 따른다. 과거 답변의 원문과
citation을 수정하지 않는다.

원장과 실행 기록에서 관계 없음·판단 불가·확률 보류·실패를 구분한다.
구현 감사 결과 현재 VP 화면에는 pair별 관계 처리 상태를 표시하는 위치가 없다.
이번 연결에서 새 상태 API/화면을 추가하지 않으며, 이 구분을 UI에서도 제공했다는
주장은 하지 않는다. 사용자에게 관계 승인·모델 선택·수동 재시도 동작을 추가하지 않는다.
Fake 답변으로 실제 AI가 negative의 의미를 정확히 이해한다고 인증하지 않는다.

## 5. 실행 범위 — 첫 제품 연결도 격리 Fake로 한정

`runtime-test` + 생성된 child test DB + explicit `ISOLATED_FAKE`인 실제
application/bootstrap/worker/Ask 경로에서만 새 정책을 선택하도록 검증한다.
다른 profile, 일반 DB, live-capable adapter와 profile 누락은 fail closed다.
운영 default v6/0.9, 실제 credential와 global authority는 변경하지 않는다.
기존 budget/immutable execution context/claim·job·attempt/UNKNOWN 경계를 재사용한다.

정상 운영 앱에서 새 정책을 활성화하거나 실제 AI에 새 schema를 보내는 단계는
이 구현 승인에 포함하지 않는다. 새 v11·SSC·모델·대량 평가도 도입하지 않는다.

## 6. 승인 후 필수 검증

- 실제 앱에서 positive→accepted negative→현재 graph/Ask 이웃 철회; 직접 원문
  검색은 유지. 뒤이은 새 revision의 positive, 옛 v6 replay 거부 및 정확한 충돌
  readback, pair/project/SourceVersion 격리도 확인.
- Abstention/보류/INVALID/UNKNOWN의 잘못된 negative 변환과 다른 pair 철회를 거부.
- Deterministic exact-equivalence를 AI negative로 철회하지 못함을 검증한다.
  Binding이 설정된 동안에도 정상 exact ingestion이 기존 정책으로 성공해야 한다.
  Binding 회전의 단일 epoch/history·중복 요청·ACK 유실·Ask 현재성도 확인한다.
  기존 unresolved veto의 negative 전/후 동작과 뒤이은 유효 positive의 동작을
  migration117 계약과 대조하고, 실행 job 정리나 receipt-only 재생으로 철회를
  누락하지 않는다. 이미 완료된 isolated negative의 자동 승격/재호출도 거부한다.
- Raw/입력·실행 계보, 0.9 gate, receipt/epoch/history의 원자성·동시 완료·ACK 유실
  readback·재시작·재생·full/incremental projection 일치와 중복 호출 없음.
- 기존 v6·권한·민감도·historical citation·freshness·T3 삭제·budget/runtime 계약 회귀.
- Migration 전후 기존 이력과 제약 보존; old reader/rollback에서 과거 positive가
  다시 현재로 나타나지 않는지 확인. 실패 시 writer OFF·readback 후 STOP.
- 관련 unit/contract/PostgreSQL·typecheck·lint/format·Architecture/문서·현재 TS6
  Gate. Source delta에 필요한 현재 lineage만 재생성하고 동결 v2~v7는 보존.

## 7. 재사용·대안·운영 경계

**AUGMENT** Shotgun@`c58ea548b0aa4024f8a9243f4bff7cf941be3ec3`의
receipt/history/epoch/current-relations, Ask query/freshness, transaction helper,
worker와 global execution 경계다. 새 외부 dependency/runtime는 없다.
[기존 OSS 검토](../../../implementation/vp-full-completion-2026-10-12/evaluation-a3-implementation.md#2-oss기존-구현-판단--구현-전에-수행)의
exact pin/license/security·maintenance 판단과 REFERENCE_ONLY 경계를 재사용한다.
gbrain의 generic graph/job, lucas의 provenance, ddsyasas/OpenKnowledge의 표시
패턴은 이 Shotgun receipt/egress 계약을 대신하지 않는다. Role Matrix 채택 상태는
변경하지 않으며 upstream code를 복사하지 않는다.

제외: call JSON을 current knowledge로 직접 읽기, negative edge를 positive enum에
끼워 넣기, UNRESOLVED로 위장, 기존 positive/history 삭제, old 결과 재채점,
새로운 graph/approval service. 모두 권위 중복 또는 의미/이력 손실을 만든다.

Rollback은 새 writer를 끄되 negative를 인식하는 읽기와 append-only 이력을 보존하는
방향이다. negative row를 삭제하거나 제약을 무조건 원복해 옛 edge를 부활시키지
않는다. 새 binding을 모르는 old binary가 guard를 우회할 수 있으면 그 binary는
자동 rollback 대상으로 허용하지 않는다. 실제 운영 DB migration·config·worker 시작·live 호출·cutover·push/PR/merge는
각각 별도 승인이다. 이 후보 계약의 승인도 운영 전환 승인이 아니다.

## 8. 보존·미결

기존 ADR-172 Ledger/SourceVersion/Evidence/보안·A1/A2·인증 경계, 72/432/B12,
B 잔여24, Gold-B-7과 stash를 유지한다. 기존 승인 범위를 바꾼 것으로 기록하지 않는다.
실제 판단 영수증과 current projection의 새 의미는 중요한 지식 계약이므로
AGENTS §0 및 전체 실행 지시 §6에 따른 명시 승인 후 구현·채택한다.

Windows 설치본의 격리 Fake 검증은 독립적으로 계속할 수 있다. 운영 shortcut,
schema131–139, credential/config, 정상 app/worker 및 OS reboot의 최종 전환 인수는
기존 운영 HOLD와 exact release/백업/runner quiescence Gate를 유지한다.

## 9. 승인 후 구현 구체화와 검토 보완 — 2026-10-17

- 새 product Fake revision `vp-relation-v6-explicit-negative-product-fake-v1:rN`과
  output contract `vp-explicit-negative-product-fake-v1`을 사용한다. 과거 실행 전용
  `vp-relation-v6-explicit-negative-isolated-v1` 기록은 자동 승격하지 않는다.
- 기존 `vp.project_epochs`에 project별 binding을 추가하고 CAS·재사용 금지·동일
  epoch history로 회전을 기록한다. Receipt/history/edge와 binding은 같은 epoch
  row lock을 사용한다. 늦은 옛 revision은 stored output을 보존하고 SUPERSEDED다.
- Source 최신성은 기존 intake writer가 잠그는 Source row를 ID 순서대로 잠근 뒤
  current assertions/Evidence를 다시 읽어 commit까지 보호한다. 새 freshness 권위는 없다.
- 승인된 negative는 receipt/history만 추가한다. 기존 positive row는 보존하고
  current view에서 epoch 순서로 철회한다. 새 revision의 positive로 복원할 수 있다.
  NULL binding인 기존 프로젝트의 unresolved veto는 그대로다. Product-bound
  프로젝트의 deterministic exact edge는 AI negative와 unresolved veto로 숨기지 않는다.
- 완료 readback은 job와 원래 stored call의 전체 declaration·모델·token·pair·방향·
  receipt/history를 비교한다. 완료 후 lease는 권한 증빙으로 사용하지 않는다.
  복구 lease가 원래 attempt와 달라도 원래 call/claim/attempt를 재사용한다.
- 프로젝트 한정 worker의 expired-execution 복구도 같은 project로 제한한다.
  SQL guard는 변경된 digest/usage/confidence/방향의 발행을 거부한다.
- Migration140은 additive다. 기존 T3 owner의 authorization·원자성을 재사용하며,
  새 provider-call FK에 맞게 history→edge→receipt를 먼저 지운다. 운영에는 미적용이다.

자세한 검증·초기 실패·제한은 [격리 구현 보고](../../../implementation/vp-full-completion-2026-10-12/negative-ledger-product-2026-10-17.md)에 기록한다.
