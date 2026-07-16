# ADR-082 — Stage 0~2 OSS-first Retrospective

- 상태: **Accepted**
- 결정일: 2026-07-16
- 관련 문서:
  [OSS Integration Roadmap](../../implementation/oss-integration-roadmap.md),
  [OSS Source Registry](../../implementation/oss-source-registry.json)

## 배경

Stage 0~2의 기능과 Contract Test가 먼저 구현된 뒤 OSS-first 완료 기준이 추가됐다.
따라서 기존 완료 선언만 유지하면 관련 OSS의 검토, 채택 여부, 직접 구현 이유와 교체 계획이
저장소에 남지 않는다.

## 결정

Stage 0~2를 기능적으로 다시 만들지는 않는다. 기존 구현을 다음 순서로 소급 검증한다.

1. 관련 OSS와 표준 후보를 고정 version 또는 commit으로 등록한다.
2. `ADOPT`, `EXTRACT`, `AUGMENT`, `REFERENCE_ONLY`, `DEFER`, `REJECT`,
   `NO_RELEVANT_OSS` 중 하나로 결정한다.
3. 이미 직접 만든 기능은 OSS 대비 더 작은 범위인지, 제품 고유 Contract인지 근거를 남긴다.
4. 교체 가능한 Port는 둘 이상의 Adapter를 동일 Contract Test로 검증한다.
5. Source Registry 누락과 pin 불일치를 CI에서 차단한다.

## Stage별 결정

### Stage 0

- PostgreSQL과 Ajv를 `ADOPT`한다.
- PostgreSQL Docker image를 exact digest로 고정한다.
- gbrain, lucas, ddsyasas, OpenKnowledge를 exact commit과 license로 등록한다.
- OpenTelemetry는 외부 exporter가 필요한 시점까지 `DEFER`한다.

### Stage 1

- gbrain Minion은 영속 Job의 강한 후보지만 현재 Connector Runtime에 직접 포함하지 않는다.
- 현재 Job Runtime은 단일 프로세스 Contract 검증용 참조 구현으로 제한한다.
- persistent Inbox, Outbox, Job을 시작하기 전에 Minion 추출 또는 Adapter PoC를 다시
  평가한다.
- 공개 Transport가 생기기 전까지 OpenAPI, AsyncAPI, 외부 Queue를 `DEFER`한다.

### Stage 2

- ddsyasas의 Intake UX는 `REFERENCE_ONLY`, backend는 `REJECT`한다.
- lucas watcher/reconcile은 directory intake가 생길 때까지 `DEFER`한다.
- Source identity는 file path나 외부 OSS ID에서 분리한다.
- 작은 `AssetStoragePort`와 SHA-256 저장 규칙은 Shotgun이 소유하고 공통 Contract Test로
  교체 가능성을 보장한다.

## 결과

- Stage 0~2 완료 문서는 각 OSS 결정 문서에 연결된다.
- `npm run oss:verify`가 Source Registry, lockfile, Compose, Stage 검토 상태를 검사한다.
- `npm run check`와 CI가 OSS Gate를 포함한다.
- 후속 Stage는 검토하지 않은 직접 구현만으로 완료될 수 없다.

## 제한

이번 결정은 gbrain, lucas, ddsyasas, OpenKnowledge 전체 Runtime을 제품에 포함하지 않는다.
`REFERENCE_ONLY`나 `DEFER`는 거부가 아니라, 실제 필요와 Port 경계가 생기는 Stage에서 작은
PoC로 다시 평가한다는 뜻이다.
