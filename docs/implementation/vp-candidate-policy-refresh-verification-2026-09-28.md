# VP 후보 추출 정책 자동 갱신 — 2026-09-28

## 대상과 권위

`direct-claim-v2` 출시 후 기존 SourceVersion을 사용자가 다시 제출하거나 승인하지 않아도 보충 처리한다. `VPCandidatePolicyRefreshStorePort`는 Stage 3 완료·활성 Evidence revision·최신 SourceVersion·owner 접근 범위·지식 초기화 상태를 확인한 다음, 같은 revision에 과거 추출 Batch만 있고 v2 Batch는 없는 자료를 한 건 반환한다. Worker는 분당 한 건 이하를 기존 `ReextractCandidateMaterialization@1.1.0`에 고정된 request ID와 서비스 보안 문맥으로 전달한다. Stage 4의 Evidence 결합, 제공자 정책, Validation과 VP Ledger가 그대로 적용된다.

새 Batch가 있으면 다시 호출하지 않는다. 서버 재시작·동시 명령에도 request ID와 Stage 4 Provider Call의 고유 키가 동일하다. 이 작업은 Review/Canonical 승인을 사용자에게 요구하지 않는다.

## Integration Decision

- 기존 [gbrain](https://github.com/garrytan/gbrain) `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` (MIT)의 Job·Reconcile 패턴은 `REFERENCE_ONLY`다. gbrain Runtime·DB를 가져오면 Shotgun SourceVersion/Evidence/Provider 영수증과 데이터 소유권 경계를 우회하므로 채택하지 않는다.
- 기존 PostgreSQL 16.14와 Stage 4 `ReextractCandidateMaterialization` 경로를 `AUGMENT`한다. 새 OSS 의존성이나 Lockfile 변경은 없다. PostgreSQL 버전·이미지 digest와 License는 저장소 `oss-source-registry.json`의 기존 pin을 사용한다. 새 외부 전송은 기존 DeepSeek 경로의 egress/credential 정책을 거친다. upstream 유지보수·취약점 평가는 기존 PostgreSQL/DeepSeek 경계의 평가를 따른다.
- Migration `120_vp_current_policy_batch.sql`은 완전히 검증·원장 반영된 최신 Batch만 현재 주장으로 선택한다. 이전 Batch의 주장과 영수증은 History에 남고, 신규 Batch가 검증 중이면 기존 현재 조회를 유지한다. 같은 Batch의 결정적 중복 관계와 다른 Source의 현재 주장은 계속 연결한다.
- 교체 경계는 `VPCandidatePolicyRefreshStorePort`; PostgreSQL Adapter만 바꾸면 Worker의 요청 계약은 유지된다. 롤백은 Worker 등록을 제거하고 이전 View 정의를 다시 배포하는 방식이다. 기존 Batch/Provider Call/원장 이력은 보존한다. Open-source Role Matrix의 역할 변경은 없다.

## 검증

- 단위 계약: 오래된 대상만 dispatch하며 SourceVersion·Evidence revision·project·접근 범위·민감도와 안정적인 request ID가 명령에 고정된다.
- 독립 PostgreSQL DB: Stage 3 완료 + 과거 Batch일 때만 대상이 나오고, owner 범위가 아니거나 v2 Batch가 존재하면 대상이 사라진다.
- 원장 PostgreSQL 회귀: 신규 Batch 검증 중에는 과거 주장이 현재로 보이고, 신규 주장이 원장에 반영된 후에는 과거 Batch가 현재 조회에서 빠진다. SourceVersion 변경·현재 관계·권한 필터·T3 초기화도 함께 통과했다.
- 분리된 `shotgun_vp_route` 제품 서버: 구형 v1 Batch만 있는 최신 SourceVersion 3건을 자동으로 v2 재추출했다. `ai.provider_calls`에는 고정된 `vp-policy-refresh:direct-claim-v2` request ID의 실제 `deepseek/deepseek-flash` 호출 3건이 `COMPLETED`로 기록됐다. 사용자 DB `shotgun_vp`는 이 검증으로 변경하지 않았다.

## 남은 Gate

- 이 Worker는 단일 프로세스에서 한 번에 하나의 대상만 처리한다. 다중 Runtime의 동시 작업은 Stage 4 request ID와 Provider Call 고유 키로 중복 기록을 막지만, 동시 호출 시 비용이 완전히 한 번만 청구되는 별도 장애 주입 검증은 아직 없다.
- 제공자 실패 후 안정적인 request ID가 재시도 상한에 도달하면 사용자의 새 승인 없이 미해결로 남는다. 운영 경고·복구 정책과 일일 정책 갱신 비용 예산, 대량 자료 Benchmark는 아직 VP 완료 Gate에 남아 있다.
- 전체 지식 epoch 재생/증분 동등성, 형식별 Golden Corpus, DeepSeek 품질 Gate를 이 검증으로 완료 처리하지 않는다.
- 모든 후보가 거절되어 현재 주장이 0건이 되는 Batch의 epoch 갱신은 별도 검증이 필요하다.
