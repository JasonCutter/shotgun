# 격리 실제 AI 인수 — 실행 경계 보정

기준 Canonical `e02d96ff1dffa8291da969088c763bdca7df73ed`.
사용자 지시: “먼저 2번 까지 구현 진행해.”
범위: 실행 경계 최소 보완 후 별도의 격리 실제 AI 제품 인수. 운영 적용이나
게시·병합 승인이 아니다. 실제 실행 결과는 별도 원본 증거로 기록한다.

## 원인과 최소 결정

추출 handler와 DeepSeek generation의 기본 timeout은 15분인데 PostgreSQL
provider attempt lease는 5분이었다. 유효한 실행 중 시작 복구가 먼저 만료를
선언할 수 있다. lease를 기존 handler deadline + 60초 영속화 여유로 산출한다.
원래 15분 timeout을 늘리거나 새 heartbeat/lease 권위를 도입하지 않는다.
lease가 실제 만료되면 기존 UNKNOWN 및 자동 재호출 금지를 유지한다.

전송 호출 이후 timeout·연결 단절·응답 body stream 손실은 서버 수신·과금의
부재를 증명하지 못한다. DeepSeek generation만 `OUTCOME_UNKNOWN`으로 전달하고
기존 durable 저장소의 UNKNOWN 경로를 사용한다. 모듈이 이를 재시도 가능한
실패로 다시 저장하지 않는다. 전송 전 취소는 fetch 전에 거부한다.
이미 받은 HTTP 오류, 완전한 잘못된 JSON의 검증, connectivity probe 계약은
각각 기존 경로를 유지한다. 서버의 exactly-once 실행을 보장한다고 주장하지 않는다.

## 재사용와 영향

- 기존 AI Provider Port, DeepSeek adapter, PostgreSQL durable repository,
  kernel 취소 signal, 출력 저장·materialization recovery를 AUGMENT한다.
- 기존 [통합 결정](./integration-decisions.md)의 gbrain
  `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` (MIT) REFERENCE_ONLY job/lease
  패턴을 유지한다. 전체 runtime/DB를 추가하면 기존 실행·Evidence 권위를
  대체하므로 도입하지 않는다. 새로운 일반 작업 실행기는 필요하지 않다.
- Node 내장 AbortController/fetch/timer, 기존 lockfile의 pg를 재사용한다.
  패키지·lockfile·OSS Role Matrix의 채택 상태는 변경하지 않는다.
- schema/migration은 없다. 기존 행의 lease를 소급 변경하지 않는다.
  v6·0.9 gate, prompt/schema, Ledger·SourceVersion·Evidence 의미는 유지한다.
- rollback은 worker-OFF 상태에서 보정 코드의 별도 revert다. 기존 UNKNOWN,
  attempt·출력·예산 이력은 삭제하거나 실패/성공으로 재분류하지 않는다.

## 검증 및 실호출 경계

전송 전 취소, 전송 후 timeout/연결·body 손실, 알려진 HTTP·JSON 오류,
모듈의 UNKNOWN 영속화·반복 차단, PostgreSQL lease·시작 복구·출력 저장 실패와
materialization recovery를 대상으로 focused 회귀를 수행한다.
Fake 시험은 실제 AI 의미 품질이나 청구 인증이 아니다.

Focused unit 14/14, 기존 전체 Stage12.1 durable PostgreSQL 11/11,
관련 image transport·source runtime·production-wiring 회귀 44/44가 통과했다.
root typecheck, focused ESLint/format, Architecture 및 문서 검사가 통과했다.
초기 PostgreSQL fixture의 revision pin/자동 실행 간섭 실패는 별도 이력에
기록하며 뒤의 PASS로 덮어쓰지 않는다.

TS6는 기존 144 candidates/130 owners의 분류·순서·qualified reachability와
승인된 시험을 보존하고 이동한 기존 owner 7개의 current v8 좌표만 매핑했다.
원래 builder로 derived v8을 재생성했고 release 검증이 통과했다. Validator,
resolver, timeout, historical v2–v7 및 frozen hash manifest는 변경하지 않았다.

이전 인수의 `OUTCOME_UNKNOWN` 1건과 STOP을 그대로 봉인한다. 새 인수는
다른 synthetic 원문·SourceVersion·질문을 사용하며 이전 요청은 재호출하지 않는다.
기존 승인 상한 총 10회에 이전 가능한 egress 1회를 포함하고 새 최대치는 9회다.
실제 persistent relation authority의 현재 UTC day·store·authority·credential
fingerprint·잔여 한도·미확정 reservation을 확인하고 정상 app/worker 경로를 사용한다.
별도 로컬 transport 상한은 추출/답변/관계를 합산하는 시험 통제이며 새로운
생산 예산 권위가 아니다. 이미지·audio/video 실호출은 이번 제한된 text 인수에
포함하지 않는다.

외부 하네스는 요청 원문·digest와 invocation intent를 fetch 전에 영속화하고,
응답/usage/지연·DB snapshot을 보존한다. intent는 서버 수신 증거가 아니다.
UNKNOWN·새 runtime/identity 결함·예산 소진 시 STOP하고 자동 재시도하지 않는다.
운영 DB/Vault/configuration/환경·앱/worker, 동결 실험·Gold는 변경하지 않는다.
준비·초기 실패·최종 결과는
`C:/dev/artifacts/vp-full-completion-2026-10-12/step1-step2-20261015`에 별도 보존한다.
