# AKP-7 WP3 — Ranking, Suppression and Adaptive Presentation

상태: `INTEGRATING` — Draft PR 범위에서 검증 중

## 범위

WP3는 persisted Discovery Finding을 ordinary Discovery Product 목록에서 결정적으로
정렬·억제·페이지네이션한다. 정렬 점수는 presentation priority일 뿐 Truth Probability,
confidence, Evidence strength 또는 Fact/Claim authority가 아니다. utility feedback은
Evidence·Review·Canonical 의미와 분리되고 suppression/snooze는 Finding을 삭제하거나
무효화하지 않는다. WP4 re-entry, Review/Canonical 변경, UI와 click telemetry는 제외한다.

## 기존 권위와 OSS 결정

Product adapter는 AKP-3의 `rankAcceptedDiscoveryCandidatesV1`와
`DISCOVERY_RANKING_POLICY_VERSION_V1`을 그대로 호출한다. 새로운 랭커·수식·ML·feature
store·per-user policy table은 만들지 않았다. WP1의 `DiscoveryFeedbackRepositoryPort`와
기존 PostgreSQL Finding/feedback Adapter를 재사용하고, 아래의 semantic-family lookup은
별도 Canonical/Finding store가 아닌 파생·재생성 가능한 bounded index로만 추가했다.

| 후보                  | 공식 Repository / 검토 pin / License                                                                                   | WP3 결정과 경계                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| garrytan/gbrain       | [repository](https://github.com/garrytan/gbrain) / `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` / MIT                    | `REFERENCE_ONLY`; Job/idempotency/history 패턴만 참고하고 Runtime·DB·Brain identity는 사용하지 않는다. |
| lucasastorian/llmwiki | [repository](https://github.com/lucasastorian/llmwiki) / `ad626a3d81be1480e35ef4e94234de8dbb27a61e` / Apache-2.0       | `REFERENCE_ONLY`; 변환/Evidence 부품이며 Product ranking/suppression Port가 없어 추출하지 않는다.      |
| ddsyasas/llm-wiki     | [repository](https://github.com/ddsyasas/llm-wiki) / `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` / MIT                  | `REFERENCE_ONLY`; UX 패턴만 참고하고 backend·SQLite·LLM client·UI는 범위 밖이다.                       |
| Inkeep OpenKnowledge  | [repository](https://github.com/inkeep/open-knowledge) / `f2834c237639e2cff603817ed88182b33f83cf91` / GPL-3.0-or-later | `REFERENCE_ONLY`; cockpit 표현 패턴만 참고하고 GPL Runtime/DB/Yjs/Graph 엔진은 포함하지 않는다.        |

후보의 검증된 기능 중 WP3에 맞는 교체 가능한 ranking/suppression adapter가 없고,
외부 Runtime을 도입하면 Shotgun의 Canonical·Evidence·Approval 경계를 넓히므로 직접
구현한 부분은 Product Port 뒤의 결정적 정책 조합기와 계약 변환기로 제한했다.

## 결정적 presentation 규칙

- `discovery-ranking-dimensions:v1` 하나의 server-owned mapping이 Finding의 typed
  `signalSummary`, finding type, temporal state와 cost signal을
  `DiscoveryRankingDimensionsV1`로 변환한다. prose, prompt, model identity, browser
  telemetry, truth/confidence 필드는 읽지 않는다. project relevance는 이미 권한이
  확인된 active Project의 값 `1`이다.
- persisted effective policy는 WP1 `resolveEffectiveRankingPolicy(projectId, at)`로
  평가 시각에 묶는다. 없으면 `discovery-ranking-policy:builtin-v1`, revision `1`의
  불변 fallback을 사용한다. fallback weights는 novelty `0.25`, projectRelevance
  `0.20`, evidenceCoverage `0.20`, impactReach `0.15`, temporalUrgency `0.10`,
  redundancyPenalty `0.05`, costRiskPenalty `0.05`이며 같은 AKP-3 benefits-minus-penalties
  알고리즘을 사용한다. 미래 `effectiveFrom`은 선택하지 않는다.
- utility adjustment는 `discovery-utility-adjustment:v1`의 bounded scale을 사용한다:
  `USEFUL +250000`, `NOT_RELEVANT -250000`, `ALREADY_KNOWN -125000`,
  `TOO_FREQUENT -500000` score micros. 네 종류만 적용하며 EPISTEMIC, Dismiss, Review,
  Canonical, snooze와 suppression은 score에 더하지 않는다. 같은 principal과 exact
  Finding revision의 최신 `(createdAt, feedbackId)` 하나가 이전 utility event를
  presentation에 대체한다. `PROJECT` scope도 다른 Finding revision으로 일반화하지
  않는다.

## Suppression과 visibility

- `SUPPRESS_EXACT`는 candidate fingerprint와 fingerprint version이 모두 같을 때만
  적용한다. fingerprint가 바뀐 revision은 억제되지 않는다.
- `SNOOZE`는 `evaluationTime < expiresAt`일 때 source Finding identity 하나만 숨긴다.
  만료 후 다시 보이며 append-only history는 남는다. `PROJECT` scope여도 snooze는
  project 전체로 확장되지 않는다.
- `SUPPRESS_SIMILAR`는 명시적 directive의
  `matcherKind=SEMANTIC_FAMILY`, `matcherVersion=semantic-family:v1`만 허용한다.
  typed payload/resource 구조로 만든 deterministic family key를 비교하며 prose
  similarity, embedding, vector index와 AI matcher는 사용하지 않는다. unsupported
  payload는 `NO MATCH`다. `FINDING`은 source identity의 lineage/revision으로만,
  `PROJECT`는 같은 권한 Project 안에서만 비교한다. source Finding이 권한 밖이면
  match하지 않는다.
- `CONFLICT_HYPOTHESIS`, typed `KNOWN_CONFLICT_QUESTION`, persisted
  `signalSummary.conflictState=KNOWN_CONFLICT`, 또는 typed `CANONICAL_CONFLICT`
  reference를 가진 항목은 mandatory visibility 대상이다.
  일치하는 suppression이 있어도 반환하며 bounded reason code
  `MANDATORY_VISIBILITY_OVERRIDE`를 함께 보낸다. directive를 변경하거나 삭제하지
  않는다.

## Global ranked pagination and storage

후보 권한 확인 → effective policy → suppression/snooze → mandatory override → dimension
mapping → latest utility adjustment → deterministic final sort → page slicing 순서를
사용한다. 따라서 Finding-ID 순서의 첫 page만 먼저 읽고 rank하는 우회가 없다.

기존 immutable Finding persistence를 250건 keyset batch로 스트리밍한다. 각 batch에서 권한
확인·평가시점 lifecycle·필터를 계산한 뒤, 해당 batch의 Finding identity/fingerprint/family
key만 feedback Port에 전달한다. 최신 ordinary utility는 batch identity에 대한
`DISTINCT ON` 조회로 제한하고, exact/snooze와 semantic-family 후보도 batch key와
indexed projection으로 제한한다. Product 메모리에는 현재 요청의 `limit + 1`개 최상위
후보, 현재 batch, 최대 256개의 suppression 후보만 유지한다. source Finding 권한 조회는
순차 처리하여 요청당 동시성을 1로 제한하고, 256개 초과 후보는 fail-closed 한다.

`056_akp_7_wp3_semantic_family_projection.sql`은 `055` 이후에 적용되는 파생 lookup이다.
`suppression_semantic_family_projection`은 `(project_id, suppression_id)`로 원본
`suppression_directives`에 연결되며 typed `semantic-family:v1` key만 저장한다. 이는
Finding·feedback·Canonical authority가 아니고, source Finding + suppression directive의
결정적 resolver로 startup에서 100행 keyset 단위 재생성한다. 신규 similar directive는
동일 transaction에서 projection을 갱신한다. migration preflight와 directive 삭제 시 FK
cascade 정리를 정의하며, 원본 directive가 project 삭제를 `ON DELETE RESTRICT`로 보호하는
기존 권한 경계도 유지한다. backup dump 포함 및 restore 후 startup rebuild를 정의했다.
백업 integrity의 authoritative table 목록에는 파생 테이블을 넣지 않는다. 따라서 rollback은
authority 테이블을 변경하지 않고 projection migration/table만 제거한 뒤 adapter-only
경로로 되돌릴 수 있다. adapter-only 방식은 persisted Finding payload에서 매 요청마다
project 전체 source를 읽어 family를 재계산해야 하므로 bounded/indexed 요구를 충족하지
못해 채택하지 않았다.

ranked cursor는 AES-GCM opaque/tamper-evident envelope이며 project, principal,
access/policy context, evaluation time, effective policy identity/revision,
utility/matcher version, filter digest와 마지막 `(effective priority, findingId,
findingRevision)` sort key 및 마지막 반환 rank를 포함한다. continuation은 cursor evaluation snapshot의
`createdAt` cutoff와 immutable policy/feedback records만 재현하고, lifecycle은
authoritative `finding_lifecycle_history`의 `occurred_at <= evaluationTime` 상태를 읽으며,
FINDING lineage도 `findLatestAsOf(..., evaluationTime)`으로 제한한다. 현재 authorization은
항상 다시 확인하므로 권한 철회는 frozen snapshot으로 되살리지 않는다. 새 data는 새 first
page에서만 평가한다. 일반 cursor나 다른 principal/project/filter/context의 cursor는 거부한다.

## 계약·검증·다음 단계

List 결과는 algorithm/policy identity·revision/source, utility/matcher version,
evaluation time과 Finding별 `rank`/bounded reason codes만 노출한다. score, confidence,
truthProbability, raw feedback/reason과 secret은 노출하지 않는다. migration은 056 파생
lookup 하나이며 Canonical/Finding/feedback authority schema는 변경하지 않는다.

집중 Contract test는 AKP-3 deterministic ranking 회귀, utility latest/monotonicity와
principal isolation, exact/version, snooze, semantic-family scope, mandatory override,
global ranked pagination과 cursor replay rejection, 250+ multi-batch global ranking,
batch-bounded auxiliary lookup, frozen lifecycle/fresh request, lineage cutoff을 검증한다.
WP4 re-entry, feedback UI, UI 변경, deployment와 WP4+ 작업은 시작하지 않았다.
