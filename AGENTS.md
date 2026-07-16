# Shotgun Agent Working Rules

이 파일은 Shotgun 저장소 전체에 적용한다.

## 1. 기준 문서와 우선순위

Stage 구현 또는 완료 판정 전에 다음 문서를 확인한다.

1. Canonical ADD와 관련 ADR
2. `docs/architecture/module-architecture/shotgun-module-architecture-add.md`
3. `docs/architecture/module-architecture/open-source-role-matrix.md`
4. `docs/implementation/README.md`
5. `docs/implementation/implementation-roadmap.md`
6. `docs/implementation/oss-integration-roadmap.md`
7. `docs/implementation/oss-evaluation-plan.md`
8. `docs/implementation/definition-of-done.md`
9. `docs/shotgun_reference_architecture_strategy_ko.html`

문서가 충돌하면 다음 순서로 판단한다.

1. Canonical·Evidence·Approval·Claim/Fact·Action 안전 경계
2. Module Architecture의 Port·Adapter·데이터 소유권
3. 검증된 OSS의 재사용 가능성
4. 구현 속도와 코드량 절감
5. 고급 UX와 운영 편의

과거 문서의 “핵심 엔진” 또는 “채택” 표현은 최신 Module Architecture와
Implementation Plan에 맞춰 Module·Adapter·Extract 단위로 해석한다. OSS의 전체
Runtime이나 내부 DB를 Shotgun 공통 경계로 승격하지 않는다.

## 2. 필수 개발 순서

모든 Stage와 Module 작업은 다음 순서를 지킨다.

1. 관련 ADD·ADR, Stage 목표, Target Module·Port와 완료 기준 확인
2. 해당 Stage의 기존 검증 자료와 OSS·레퍼런스 후보 검토
3. 후보별 재사용 방식 결정 및 기록
4. 결정된 경계 안에서 구현
5. Contract·Golden Corpus·보안·교체 검증
6. OSS Integration Gate를 포함한 Definition of Done 판정

즉, 기본 흐름은 다음과 같다.

`관련 OSS 검토 → 재사용 방식 결정 → 구현 → Contract 검증`

OSS 검토 없이 모든 기능을 처음부터 새로 구현한 작업은 완료로 판정하지 않는다.

## 3. 검증된 4개 레퍼런스

다음 레퍼런스는 단순 아이디어 후보가 아니라 기존 검증 자료가 있는 우선 재사용
대상이다. 관련 Stage에서 처음부터 일반 후보 탐색을 반복하지 말고 기존 검증
보고서·채택 매트릭스·PoC를 출발점으로 사용한다.

- `garrytan/gbrain`: Job·Fact·Search·Graph·Timeline·MCP·Discovery·Migration
- `lucasastorian/llmwiki`: HTML/XLSX 변환, Highlight·Annotation, Lint,
  Watcher·Reconcile
- `ddsyasas/llm-wiki`: Source Intake, Ask·Chat, Cost·Model·Settings,
  Action 중심 UX
- Inkeep OpenKnowledge: Visual/Source 보존 원칙, 2D Graph, Agent Activity,
  Burst Diff, Entity Vault

기존 검증 완료는 기술적 가치와 우선순위의 증거다. 실제 코드를 통합할 때 필요한
정확한 upstream commit, license, security, maintenance와 Contract 검증까지
자동으로 면제하는 것은 아니다.

레퍼런스별 기본 경계는 다음과 같다.

- gbrain은 관련 Brain·Execution 기능의 최우선 재사용 대상이지만 전체 Runtime과
  DB 모델을 Shotgun Kernel·Canonical로 사용하지 않는다.
- lucas는 필요한 변환·Evidence·Validation 부품을 독립 Package로 추출하는 방식을
  우선하며 SQLite·FTS·VaultFS·MCP CRUD 전체 Runtime은 제외한다.
- ddsyasas는 UX·View Model만 활용하며 기존 Backend·SQLite·ingest/query/lint·LLM
  client를 다시 도입하지 않는다.
- OpenKnowledge는 UI·검토 패턴을 활용하며 전체 Runtime, Canonical Markdown/Yjs,
  Git·MCP 중복 엔진은 제외한다. Yjs는 별도 결정 전 `DEFER`다.

## 4. Integration Decision

각 관련 후보는 구현 전에 다음 중 하나로 판정한다.

- `ADOPT`: 공식 Package를 Port 뒤에서 사용
- `EXTRACT`: 필요한 코드만 독립 Package로 추출·개작
- `AUGMENT`: 검증된 코드·패턴에 Shotgun 계약과 정책을 보완
- `REFERENCE_ONLY`: 설계·UX·Test 패턴만 참고
- `DEFER`: 현재 Stage에서는 연기하고 재평가 조건 기록
- `REJECT`: 범위·품질·보안·라이선스·결합도 문제로 제외
- `NO_RELEVANT_OSS`: 관련 후보가 없으며 조사 범위와 근거를 기록

결정 기록에는 최소한 다음을 포함한다.

- 공식 Repository URL
- 검토한 Version·Tag·Commit
- Target Stage·Module·Port
- 포함 범위와 제외 범위
- License·Security·Maintenance 상태
- Prototype·Golden Corpus·Benchmark 결과
- Adapter·Extract·Fork 경계
- Migration·Rollback·Replacement 방법
- Open-source Role Matrix 갱신 여부

`ADOPT`, `EXTRACT`, `AUGMENT`는 정확한 Version·Commit과 Lockfile을 고정한다.
`latest`, 고정하지 않은 Branch 또는 자동 Major Upgrade를 Production 기준으로
사용하지 않는다.

## 5. 신규 직접 구현 조건

관련 OSS가 있으면 다음 중 하나 이상의 근거가 확인될 때만 직접 구현한다.

- 관련 기능을 제공하는 후보가 없음
- Canonical·Evidence·Approval·Action 경계를 위반함
- License 또는 Security Gate를 통과하지 못함
- Port·Adapter·Fork Boundary로 격리할 수 없음
- Golden Corpus·Benchmark 필수 기준을 충족하지 못함
- 유지보수·Migration·Rollback 위험이 직접 구현보다 큼

“익숙하지 않다”, “직접 만드는 편이 빠를 것 같다”, “작은 기능이다”는 재사용
검토 생략 근거가 아니다.

신규 구현 Issue·PR에는 검토 후보, 재사용 불가 이유, 교체 가능한 Port, Contract
Test, 향후 교체 조건과 Rollback을 기록한다.

후보가 `BLOCKED` 상태이면 조용히 자체 구현으로 우회하지 않는다. Stage를
`BLOCKED`로 표시하거나 근거와 승인된 `DEFER` 결정을 남긴다.

## 6. Shotgun이 계속 소유하는 경계

OSS를 사용해도 다음 의미와 권한은 Shotgun이 소유한다.

- Stable `Source`·`SourceVersion`·`OriginalAsset`
- `EvidenceSpan`과 Source Map
- Candidate·Provenance·Validation
- User Directive·Fact Priority·Conflict
- Draft ChangeSet·Approval·Canonical Write
- Claim·Fact 분리와 HistoryEvent
- Compiled Truth Projection 의미
- Risk Decision·Action Approval·Audit
- Module Contract와 Connector Runtime의 상위 의미

OSS 내부 Type·Schema·DB ID를 공통 Contract나 Canonical ID로 노출하지 않는다.

## 7. 검증과 완료 판정

채택·추출·교체한 Adapter는 공통 Contract Test를 통과해야 한다. 이 Test는 생략할
수 없다.

변경 범위에 따라 다음을 추가한다.

- Golden Corpus Test: 변환·Evidence·검색 품질 변경
- Replay·Idempotency Test: Event·Job·Side Effect 변경
- Security·Approval Negative Test: 권한·Canonical·Action 경계 변경
- Adapter Replacement Test: OSS 채택·추출·교체 변경
- Migration·Rollback 연습: 데이터·Version·Runtime 변경

Stage는 Module·Flow·Product·Architecture·OSS Integration Gate를 모두 통과해야
`COMPLETE`다. 다음은 `COMPLETE_WITH_LIMITS`로 우회할 수 없다.

- 관련 OSS 검토를 생략한 신규 구현
- Version·License가 불명확한 OSS 채택
- 채택 OSS의 Contract Test 미실행
- Canonical·Approval·Evidence·Action 안전 경계 위반

다음 Stage로 넘어가기 전에 이전 Stage의 Critical Path와 필수 OSS Evaluation이
완료되었거나 명시적인 `DEFER` 상태여야 한다.

Stage 0~2는 OSS Integration Gate 도입 전에 구현되었으므로 Stage 3 착수 전에
현재 기준으로 소급 검토한다. 기존 구현을 무조건 폐기하지 않고, 유지·교체·보완
결정을 증거와 함께 기록한다.

## 8. 완료 보고

Stage 완료 보고에는 최소한 다음을 포함한다.

- 구현 범위와 제외 범위
- 검토한 OSS 후보
- 후보별 Integration Decision
- 채택 Version·Commit·License
- 직접 구현 범위의 OSS 재사용 불가 근거
- 통과한 Contract·Golden Corpus·Security·Replacement Test
- Migration·Rollback
- 알려진 제한과 다음 Stage에 전달할 Contract Version

이 정보가 없으면 “완료”라고 보고하지 않는다.
