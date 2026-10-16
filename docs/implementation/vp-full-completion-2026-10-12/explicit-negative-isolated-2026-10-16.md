# VP-05 — 명시적 관계 부재 격리 계약과 인수 범위 정비

- 상태: **LOCAL ISOLATED IMPLEMENTATION / NOT DEPLOYED / NOT PUBLISHED**
- 사용자 결정: “두 변경안의 격리 구현·계약 정비 승인” — 2026-10-16
- 선행 로컬 commit: `789a70518ed17346681884e070ff61304dd5b35b`
- 현재 운영 의미 정책: v6/0.9 유지. v11 활성화·SSC·새 모델 채택 없음

## 구현

`modules/vp-decision/src/explicit-negative-isolated.ts`는 별도 revision
`vp-relation-v6-explicit-negative-isolated-v1`의7종 schema·방향/확률 검사와
순수 disposition 함수를 제공한다. NO_RELATION/NONE, 모델의 UNRESOLVED,
확률/usage에 따른 WITHHELD를 구분한다. confidence와 selected probability를
혼동하지 않고 gate0.9를 유지한다.

별도 adapter의 `compareIsolated`는 `ISOLATED_FAKE`와 `isolated-fake` provider만
받는다. production job execution identity, v6 revision, live transport,
restricted/미인가 scope는 Fake 호출 전에 거부한다. 실제 resolver/credential/
global authority는 연결하지 않으며 production provider Port의 `decideRelation`을
구현하지 않는다. 정상 app bootstrap과 worker의 import·선택·default를 바꾸지 않는다.

v6 system instruction을 exact prefix로 재사용하고 negative 규칙을 붙인다.
RELATED의 주제 중첩을 직접 메커니즘 연결로 좁히지 않으며 heliograph 사례를
NO_RELATION으로 재판정하지 않는다. 충분한 입력의 부재와 입력 부족을 구분한다.

claim/context/truncation·권한·identity snapshot과 schema에 요청 digest를 결합한다.
raw response와 disposition을 반환하고 schema failure·잘못된 usage·UNKNOWN을
negative로 위장하지 않는다. 반환 record는 격리 실험 artifact이고 production
job·관계 원장·receipt DB 저장의 검증이 아니다. 유료 호출/budget claim은 없다.

평가에는 별도 `V6_EXPLICIT_NEGATIVE_ISOLATED` target과 exact revision을 요구한다.
V6는 여전히 NO_RELATION을 거부하고 보존 V11과도 합치지 않는다. explicit negative
accuracy와 모델 기권을 구분한다.

## 승인된 인수 범위

[사용자 승인 정책](../../architecture/add/vp05-evaluation-trust/relation-negative-and-acceptance-policy-draft.md)을
A1·DoD·ADR-098/173 후속 note에 기록했다. 인증 Gold는 기존 외부 적격 인간/동등
reference provenance를 요구한다. 모든 내부 관계나 과거72개 전부의 인간 승인을
제품 인수의 일률적 선행 Gate로 확대하지 않는다. 실제 자료/질문 결과·원문 인용·
최신성·충돌/조건·권한·예산/복구와 공개된 결정론적/AI 검토 범위로 제품 인수를
판정한다. 인증 분모0은 N/A이고 PASS/100%가 아니다. 미해결 필수 제품/안전/적용
품질 기준은 계속 blocker이며 일반 사용자 review/reviewer 지정 클릭은 없다.

방향 없는 QUALIFIES3건과 입력 전제 부족2건의 Phase A 기록은 보존한다. 새
validator로 방향/정책 불일치를 거부하며 원래72/432/B12 라벨과 결과를 고치거나
재채점하지 않는다. 새 Gold·모집단 정확도·0.9 calibration을 발행하지 않는다.

## 재사용·검증·교체

기존 contracts JSON Schema/Ajv, stableJson/digest, VP egress assertion, v6
instruction/enum 및 A3 측정을 AUGMENT했다. [기존 A3 OSS 검토](./evaluation-a3-implementation.md)의
정확 upstream commit/license·Port 결정을 재사용한다. 새 dependency/lockfile,
schema/runtime 권위·범용 evaluator/reviewer 시스템은 없다.

초기 isolated protocol28, 기존 router4 및 평가43의 합성 계약을 검증한다.
Fake의 NO_RELATION은 protocol 분기 검증용이며 AI의 실제 의미 정확도 인증이
아니다. 최종 결과와 보존 증거는 후속 절에 추가한다.

Rollback은 이 opt-in module/adapter, offline target 및 후속 문서만 제거한다.
기존 v6 Port와 schema가 그대로이므로 운영 migration/과거 결과 rewrite가 없다.
교체 구현도 동일 격리·identity·negative/abstention/withheld·legacy 거부 계약을
통과해야 한다.

## 미검증 운영 연결

production/job receipt에7종 결과를 저장·복구하는 기존 실행 Port의 호환성,
actual app-worker 선택과 global budget/credential binding은 **새 정책에 대해
아직 검증하지 않았다**. 이 단계는 Fake-only protocol 검증이다. 연결이 필요하면
기존 권위를 재사용하는 격리 PostgreSQL 검증을 먼저 수행해야 하며 app/worker·
운영 DB·실제 AI를 켜지 않는다. v6의 기존 proof를 새 정책의 proof로 재명명하지 않는다.

## 최종 로컬 검증 — 2026-10-16

- 관련 unit **89/89 PASS**: isolated protocol29, 평가46, 기존 router4,
  accounting8, quality ratio2. 기존 provider adapter contract **12/12 PASS**.
- Root typecheck, 변경 소스 ESLint/Prettier, 문서/ADR/Canonical 검증(링크797건),
  TS6 C2 release의 AST/current lineage·v8 재생성·역사 동일성 모두 PASS.
- 세 audited case ID 형태의 합성 import에서 direction 없는 QUALIFIES를 거부한다.
  원래 fixture를 읽고 새 정답을 만든 테스트가 아니며 기존 라벨은 수정하지 않는다.
- Canonical과 기존 활성 router/general-AI adapter/job store/app/ledger5개 파일의
  Git LF bytes가 동일함을 별도 SHA-256 대조했다. 새 정책은 bootstrap에 연결하지 않았다.
- 보호79파일·다른13worktree HEAD/status·configuration·stash 동일. 보호 운영
  PostgreSQL 컨테이너2개 모두 exited, 운영 DB/앱/worker·실제 AI·Gold-B-7·동결
  평가·push/PR/merge 변경0. 신규 DB adapter/migration이 없어 DB 연결/DDL 검증을
  이번에 실행하지 않았고 새 정책의 PostgreSQL proof를 주장하지 않는다.
- 상세 로그와 proof: `C:/dev/artifacts/vp-full-completion-2026-10-12/explicit-negative-isolated-20261016/`.

이번 승인 범위의 Fake-only 계약 구현과 인수 계약 정비를 완료했다. 전체 VP
최종 인수·운영 negative 활성화·실제 모델 성능 인증은 이 결과와 별개다.
