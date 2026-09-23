# T3 구현 전 설계 확정

> - 상태: **DESIGN FREEZE — 제품 구현 전**
> - 기준: `main@d06170d85001e72be7367281891d2d9de7196305`
> - 연계: [T3 구현계획서](./t3-correction-implementation-plan.md), [ADR-171](../architecture/adr/ADR-171-t3-project-source-knowledge-reset.md), [저장소 분류표](./t3-storage-classification-register.md), [content-column 목록](./t3-content-column-inventory.tsv)
> - 허용 변경: 문서·설계 증거만. 제품 코드, migration, 운영 데이터 변경 없음.

## 1. 설계 결론

T3는 세 작업을 순서대로 구현한다.

1. **감사 권위 정정:** TS-6 v6/v7을 역사 자료로 동결하고, 실제 코드와 관계 검증에서 재생성한 v8을 현재 권위로 삼는다.
2. **프로젝트 Source 지식 초기화:** 현재 Project ID·로그인·AI 설정을 유지하면서 그 Project의 모든 Source와 기록된 파생 콘텐츠를 제거한다. 개별 Source 삭제는 T3에서 제공하지 않는다.
3. **인수 검증 교체:** 테스트가 직접 만든 계약 객체가 아니라 실제 Product API·Assembly·PostgreSQL 경로를 사용한다. 수동 데스크톱 증거는 별도로 표기한다.

기존 Canonical·History append-only 규칙의 일반적 예외는 만들지 않는다. ADR-171의 검증된 reset request에 대해서만 전용 권한과 감사 기록으로 콘텐츠 erasure를 허용한다. 구현 중 이 경계를 우회해야 하는 상황이 발견되면 T3-3을 멈추고 ADR을 수정한다.

## 2. 결정의 근거와 OSS Integration

검토한 기존 권위는 Source/OriginalAsset(ADR-081·122·144), Canonical 승인·History(ADR-086·131), projection 수렴(ADR-168), transaction outcome(ADR-169), CAS GC(ADR-170), Module Architecture와 Definition of Done이다. 기존 Shotgun Port·Postgres adapter·History payload-state·CAS maintenance는 해당 owner 안에서 확장한다. 새 OSS 채택이나 lockfile 변경은 없다.

| 기존 검증 후보                                                                                                                 | T3 결정                                | 근거와 경계                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [garrytan/gbrain](https://github.com/garrytan/gbrain) `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` / MIT                         | `REFERENCE_ONLY`                       | Job·migration·recovery 패턴만 참고. Shotgun Canonical/DB/approval로 승격하지 않음.                |
| [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki) `ad626a3d81be1480e35ef4e94234de8dbb27a61e` / Apache-2.0      | 기존 `EXTRACT` 유지, T3 신규 추출 없음 | Source text locator의 현재 package만 유지. 삭제 권위나 전체 SQLite/Vault Runtime을 도입하지 않음. |
| [ddsyasas/llm-wiki](https://github.com/ddsyasas/llm-wiki) `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` / MIT                     | `REFERENCE_ONLY`                       | Source UI의 Preview·진행 표현만 참고. Backend/ingest/DB는 제외.                                   |
| [Inkeep OpenKnowledge](https://github.com/inkeep/open-knowledge) `f2834c237639e2cff603817ed88182b33f83cf91` / GPL-3.0-or-later | `REFERENCE_ONLY`                       | 영향·Activity UI 패턴만 참고. 코드 복사·Runtime 도입 없음.                                        |

Version·License·Security·Maintenance와 대체 경계는 `docs/implementation/oss-source-registry.json`의 기존 검증 기록을 따른다. T3는 새 OSS 코드를 들이지 않으므로 신규 Prototype/Benchmark는 해당하지 않는다. 구현 PR에서는 사용한 현행 dependency lockfile과 Shotgun Contract/Replacement 테스트를 다시 확인한다.

### 설계상 범위 수정

원래 계획서의 “선택한 Source도 삭제”는 T3-2 조사 결과로 제외한다. PostgreSQL의 Source 직접 FK 외에도 Ask 대화 맥락, Review/Canonical JSON, Discovery·외부 Action 출력은 여러 Source 또는 불명확한 출처를 섞는다. 이 상태에서 개별 Source만 삭제한다는 주장은 증명할 수 없다. T3는 사용자가 요청한 **프로젝트 전체 Source 초기화**를 완결한다. 선택 삭제는 완전한 field-level lineage가 생긴 후 별도 Issue/ADR에서 다룬다.

## 3. T3-0 기준선

- 원격 기준 commit은 위 SHA다. 운영 DB와 현재 미추적 TS-7 번들은 설계 검증 중 수정하지 않는다.
- `shotgun_test` migration 077 적용 상태의 `information_schema`에서 **190개 application base table**을 확인했다. [저장소 분류표](./t3-storage-classification-register.md)에 schema별 소유권·처리 규칙을 고정한다.
- Source 직접 FK는 `asset.source_versions`, `evidence.indexing_results`, `evidence.stage4_continuations`, `frontend_ask.source_selections`, `source_product.*`에 있다. `frontend_ask.citations`는 SourceVersion·Evidence를 RESTRICT로 참조한다. 단순 Source row 삭제는 FK와 불변 트리거 때문에 실행되지 않는다.
- 로컬 미추적 TS-7 테스트 때문에 발생한 타입 오류와 추적 트리의 문제를 구분한다. T3 구현 브랜치는 clean `main`에서 시작한다.

## 4. Project Source 지식 초기화 계약

### 4.1 API와 Port

| 경계                                                                              | 입력/출력과 책임                                                                                                                                                           |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /product-api/frontend/projects/:projectId/source-knowledge-reset/preview`   | Project Owner·CSRF 확인, 서버 권위의 영향 manifest와 blocker 계산. `previewId`, `manifestDigest`, `projectRevision`, `knowledgeEpoch`, `expiresAt`, 집계·보존 범위를 반환. |
| `POST /product-api/frontend/projects/:projectId/source-knowledge-reset/confirm`   | `previewId`, digest, revision/epoch, idempotency key와 명시적 확인을 검증해 durable request를 생성. Source 내용은 명령 payload에 넣지 않음.                                |
| `GET /product-api/frontend/projects/:projectId/source-knowledge-reset/:requestId` | 상태·차단 이유·단계별 집계·CAS/backup 별도 완료 상태만 반환.                                                                                                               |
| `KnowledgeResetImpactPort`                                                        | 각 owner의 Source lineage와 `INDEPENDENT/SOURCE_DERIVED/UNKNOWN` 분류 및 fingerprint 제공.                                                                                 |
| `KnowledgeResetFencePort`                                                         | epoch 전환, 신규 intake/worker/write 차단, lease drain 또는 outcome-unknown 분류.                                                                                          |
| `KnowledgeResetOwnerPort`                                                         | owner schema의 idempotent erasure/redaction 단계와 readback. 범용 SQL/table name을 상위 Contract로 노출하지 않음.                                                          |
| `KnowledgeResetAuditPort`                                                         | 승인·실행·실패·재개·완료의 비민감 감사 identity.                                                                                                                           |

API schema는 기존 Shotgun Error/Envelope 버전을 따른다. 오류 코드는 최소 `NOT_PROJECT_OWNER`, `STALE_PREVIEW`, `UNCLASSIFIED_CONTENT`, `ACTIVE_JOB_OUTCOME_UNKNOWN`, `EXTERNAL_ACTION_DEPENDENCY`, `RESET_IN_PROGRESS`, `ERASURE_UNVERIFIED`로 구분한다. `OUTCOME_UNKNOWN`은 동일 key 재생과 readback만 허용한다.

### 4.2 DB 소유권과 migration

모든 변경은 **새 additive migration**으로 도입하고 기존 migration을 수정하지 않는다.

- Project Administration은 `project_knowledge_epoch`와 `project_knowledge_reset_requests`를 소유한다. request는 Project, actor, preview digest, revision, idempotency key, epoch, 상태·시각, 비민감 집계와 step checkpoint를 기록한다. `(project_id, idempotency_key)`는 유일하다.
- Canonical은 reset 승인/commit identity 및 `CanonicalKnowledgeReset` event/outbox를 소유한다. `canonical.project_state.version`은 단조 증가하고 reset 뒤 digest는 빈 knowledge snapshot을 나타낸다.
- 각 History owner는 ADR-131 payload availability sidecar를 사용하고, 저장된 원문 payload는 전용 erasure path에서 물리적으로 scrub한다. 감사 identity만 남긴다.
- DB role은 `shotgun_schema_owner`(NOLOGIN, table/function owner), `shotgun_runtime`(LOGIN, non-superuser, 일반 Product 권한), `shotgun_erasure_executor`(별도 LOGIN, non-superuser, 전용 routine EXECUTE만), `shotgun_migrator`(migration 전용)로 분리한다. 기존 local superuser `shotgun`은 bootstrap/migration에만 쓰고 runtime URL에는 쓰지 않는다. 역할·권한 전환이 확인되지 않으면 destructive apply를 활성화하지 않는다.
- 기존 Source/Canonical/Review/Action immutable trigger의 일반 동작은 유지한다. 새 erasure 예외는 `session_user`가 전용 executor이고 transaction-local request ID가 DB의 승인된 Project/epoch/digest와 일치할 때만 허용한다. custom GUC 값만으로는 통과할 수 없다. `SECURITY DEFINER` routine은 고정된 `search_path`, 고정 SQL과 최소 권한으로 검증된 대상 칼럼·행만 처리한다. FK trigger나 `session_replication_role`을 전역 비활성화하지 않는다.
- migration은 기존 data를 삭제하지 않는다. Preview→Confirm→maintenance 실행은 migration 이후 별도 사용자 행위다.
- erasure journal root는 필수 설정 `SHOTGUN_ERASURE_JOURNAL_ROOT`로 지정하고 Shotgun backup 대상 경로 밖에 둔다. append-only record는 `schemaVersion/projectId/epoch/requestId/phase/recordedAt/HMAC`만 포함한다. 첫 콘텐츠 변경 전에 `PREPARED`를 원자적 파일 생성·flush로 영속화하고, 최종 DB readback 후 `VERIFIED`를 추가한다. journal 쓰기가 실패하면 변경하지 않는다. HMAC key는 별도 OS secret 또는 안전한 환경 변수에서 받고 DB/backup/로그에 기록하지 않는다. backup manifest의 Project epoch가 `PREPARED` 이상인 journal epoch보다 낮거나 journal/key가 없으면 restore가 런타임 시작 전에 실패한다. `PREPARED`만 있으면 같은 request의 forward recovery와 검증을 마쳐야 한다.

### 4.3 정확한 정리 순서

1. Owner·session·CSRF·현재 설정 fingerprint와 모든 content owner의 분류 결과로 Preview를 생성한다. `UNKNOWN`, 실행된 외부 Action 의존, 미확정 lease가 있으면 실행 불가.
2. Confirm 시 revision/digest 재검증과 durable request insert를 하나의 transaction으로 수행한다.
3. knowledge epoch를 올려 이전 epoch의 Source intake, Candidate, Projection, Ask, Discovery publish 및 browser cache를 차단한다.
4. launcher가 runtime을 정상 중지한다. 별도 maintenance process가 ADR-170 exclusive advisory lock을 획득한다. lock 실패나 runtime 잔존 시 변경하지 않는다. 첫 콘텐츠 변경 전에 erasure journal의 `PREPARED`를 영속화한다.
5. Source 파생 content owner를 의존성 역순으로 정리한다: 외부 Action 의존 판정 → Ask/exports → Discovery/knowledge drafts → Review/Comparison/Validation/Candidate/AI outputs → Projection/History view → Canonical payload와 state → Evidence/Transformation → Source Product/Intake/Asset row와 staging lease. FK와 outbox는 owner별 checkpoint로 검증한다.
6. Canonical reset event와 비민감 감사 기록을 보존하고, 검색·Compiled Truth·Activity/History를 빈 Source 상태에서 재구성한다.
7. 전후 Project/Auth/AI/Settings fingerprint 일치, Source content row·JSON canary 부재, 모든 projection watermark와 새 epoch 일치를 검사한다. 통과하면 journal에 `VERIFIED`를 영속화한다. 불일치면 `ERASURE_UNVERIFIED`로 유지하고 runtime을 정상 서비스로 시작하지 않는다.
8. 참조가 없어진 CAS 객체는 ADR-170 GC의 quarantine→positive safety period→sweep를 따른다. Shotgun-managed backup 재생성·무효화와 erasure epoch journal 확인은 별도 완료 항목이다.

실패 후에는 **같은 request ID로 전진 복구**한다. 첫 콘텐츠 변경 후 “rollback”은 금지한다. `COMPLETE`는 활성 DB/Product의 정리 완료이며, CAS·backup은 각각 `PENDING/COMPLETE` 상태로 정확히 표시한다. 모든 저장 복사본이 제거되지 않았으면 “물리적 완전 삭제”라고 보고하지 않는다.

### 4.4 보존과 차단 규칙

Project/Admin/Auth/AI 설정과 Project를 참조하는 독립 사용자 데이터는 보존한다. `settings.resource_settings`, frontend command payload, Project 설정 proposal 등은 Source ID·내용을 담을 수 있으므로 컬럼/JSON 단위로 분류한다. 독립 origin을 증명하지 못하는 Knowledge Draft나 외부 Action은 `UNKNOWN`이며 Preview를 막는다. 독립 origin이 명시되고 Source·Evidence·Answer·Canonical 참조가 없을 때만 보존한다.

Source-linked Ask 대화는 첫 참조 이후 문맥 전파를 배제할 수 없으므로 **대화 전체**를 정리 대상으로 계산한다. Source-linked 외부 Action이 이미 실행됐다면 로컬 row 삭제만으로 외부 결과를 없앨 수 없어, 별도 승인된 보상·외부 보존 판정 전에는 reset을 시작하지 않는다.

## 5. TS-6 감사 정정 설계

### 5.1 역사와 새 권위

- frozen v2·crosswalk 100/13, 기존 v3~v7 bytes와 SHA를 보존한다. 손상 자체도 감사 이력이다.
- 현재 authority는 **`golden.v8.derived.json`**으로 새로 생성한다. `derivedFrom`은 배열/문자열을 무조건 spread하지 않는 명시적 versioned object(`parentArtifact`, `parentSha256`, `baseCommit`, `authorityVersion`)다.
- v8 생성기는 최신 AST scan과 승인된 regression manifest를 입력으로 삼고, v7의 caller 관계·reason·baseSha·요약을 권위로 복사하지 않는다.
- `regressionEvidence[].covers`와 검증된 resolver 결과를 한 관계 authority로 삼아 boundary·caller 참조를 파생한다. 각 ID는 존재하고 한 번만 연결되며, `covers`는 비어 있지 않고 양방향·caller 경로가 일치해야 한다. 고아 evidence는 현재 authority에서 제외하고 역사 위치를 기록한다.
- 과거 crosswalk는 역사 검증만 한다. 현재 96/17(또는 구현 시 재분류된 실제 수치)은 **독립 current-authority manifest**와 AST-derived 결과로 검사한다. 수치 상수를 서로 비교하는 tautology는 허용하지 않는다.

### 5.2 증거 등급과 음성 검증

`DIRECT_CALLER`, `COMPOSITION_BOUND`, `PORT_INFERRED`, `TEST_ONLY_OR_DEAD`, `REVIEW_REQUIRED`를 구분한다. 단일 Port 구현은 `PORT_INFERRED`일 뿐, 실제 composition root에서 consumer에 주입된 경로가 확인되기 전에는 `PROVEN`으로 표시하지 않는다. `literalPortBindings`는 반환된 객체/실제 등록 인자만 분석한다.

Resolver가 지원하는 coverage kind는 실제 구현된 세 종류(`DIRECT_BOUNDARY`, `PUBLIC_PATH`, `OWNER_ATOMICITY`)로 고정한다. `DELEGATE_PATH`와 `PARTICIPANT_ATOMICITY`는 현재 지원하지 않으므로 해당 입력은 정확한 `REGRESSION_COVERAGE_KIND_UNSUPPORTED`로 거부한다. 다른 오류 코드의 부재만 검사하는 테스트는 제거한다. 향후 지원은 별도 경로 해석기와 음성 테스트가 있을 때만 추가한다.

`scripts/ts6-audit` 37개 테스트를 CI에서 직접 실행한다. 변이 없는 테스트, 무관한 issue로 성공하는 테스트, 하드코딩 `REVIEW_REQUIRED: 0`, 동일 memoized inventory 비교는 게이트에서 제외하거나 독립 증거로 바꾼다. v6 5/4 이동 수치, 낡은 reason, 고아 행, baseSha, manifest와 문서·주석은 v8 정정 기록에서 각각 교정 근거를 남긴다.

## 6. 실제 제품 경로 인수 설계

기존 미추적 TS-7 기록은 수동 실행 자료로 보존한다. 새 자동 인수 suite는 `shotgun_test`를 guard한 뒤 Product route와 실제 Assembly를 호출한다. 외부 AI 응답만 고정된 Port Adapter로 대체할 수 있다. 테스트 안에서 `Source`, `Evidence`, `Canonical`, `Answer`를 직접 만들어 연결했다고 주장하지 않는다.

| 인수 시나리오   | 실제 경로와 단언                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| owner 전체 흐름 | session/CSRF → Source submit → Stage 3 Evidence → Candidate → Compare/Review/Approval → Canonical → Projection → Ask/Citation. 단계 간 동일한 저장 ID를 readback. |
| 장애 행렬       | 실제 document worker timeout/overflow, lease loss, provider cancel, Evidence batch, URL pinning, CAS liveness, PostgreSQL COMMIT ack loss에 failpoint 주입.       |
| 재시작          | runner 종료·재시작 뒤 Source/Claim/Answer identity와 watermark 재조회.                                                                                            |
| reset           | Preview·Confirm·maintenance를 격리 환경에서 실행하고 Source/파생 콘텐츠 부재 및 Project/Auth/AI Settings fingerprint 동일을 검사.                                 |
| 새 사용         | 같은 Project에서 새 Source 등록부터 cited Ask까지 다시 성공.                                                                                                      |

테스트 보고서에는 **실제로 호출한 제품 경로, 대체한 외부 Adapter, DB readback ID, 실패 주입점**을 기록한다. 수동 데스크톱 검증은 별도 표로 남기고 자동 테스트 통과 수에 합산하지 않는다.

## 7. 구현 시작 순서와 중단 조건

1. T3-0: clean 기준선, storage register, frozen artifact hash, OSS 결정 증거를 확정.
2. T3-1: audit v8·resolver·CI 정정. 역사 파일 변경 금지.
3. T3-2: ADR-171과 이 설계, DB role/backup/History 예외의 migration review.
4. T3-3: additive migration과 disabled-by-default reset path, 이후 Product UI·maintenance·projection 재구성.
5. T3-4: 실제 경로 인수 suite와 장애·복원 테스트.
6. T3-5: 다섯 DoD Gate, exact-head CI, desktop와 post-merge readback.

새로운 unclassified table, source-derived payload의 보존, Project/Auth/AI fingerprint 변화, 승인되지 않은 Canonical write, 구분되지 않은 COMMIT 결과, 복원 가능한 백업에서 삭제 자료의 부활 가능성 중 하나라도 확인되면 destructive apply 및 T3 완료 판정을 중단한다.

이 문서와 ADR·storage register가 합쳐져 **실제 구현 전 설계 완료**를 뜻한다. 제품 코드·migration 변경은 별도 T3 구현 PR에서 시작한다.
