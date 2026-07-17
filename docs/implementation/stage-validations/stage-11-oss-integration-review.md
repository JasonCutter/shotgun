# Stage 11 OSS Integration Review

- 검토일: 2026-07-17
- 대상: Risk Policy, Action Approval, External Connector, Provider Verification
- OSS Gate: **COMPLETE**
- 상세 등록부: [oss-source-registry.json](../oss-source-registry.json)

## 완료 판정

**Stage 11: COMPLETE**

## Integration Decision

| 후보                    | Pin·License                     | 결정            | 포함 범위                                      | 제외 범위                       |
| ----------------------- | ------------------------------- | --------------- | ---------------------------------------------- | ------------------------------- |
| garrytan/gbrain         | `a25209b`, MIT                  | REFERENCE_ONLY  | operation allowlist·mutating scope·trust tests | runtime·DB·MCP operation        |
| PostgreSQL              | 16.14 exact image, PostgreSQL   | ADOPT           | execution claim·Approval·append-only Audit     | Provider effect 저장            |
| MCP TypeScript SDK      | v1.29.0 / `e12cbd7`, Apache·MIT | DEFER           | 향후 Provider MCP Adapter                      | Stage 11 package·transport      |
| Open Policy Agent       | v1.18.2 / `e695c9e`, Apache-2.0 | DEFER           | 향후 외부 정책 평가                            | 현재 binary·service·Rego        |
| node-casbin             | v5.51.1 / `2d90c7d`, Apache-2.0 | DEFER           | 향후 configurable RBAC·ABAC                    | 현재 package·policy adapter     |
| OpenFGA                 | v1.18.1 / `69efbd9`, Apache-2.0 | DEFER           | 향후 관계 기반 권한                            | 현재 service·tuple store        |
| Temporal TypeScript SDK | v1.20.3 / `ae823d7`, MIT        | DEFER           | 향후 multi-day Action                          | 현재 server·worker·native SDK   |
| Octokit.js              | v5.0.5 / `45c56ff`, MIT         | DEFER           | 향후 GitHub Draft Connector                    | token·network·repository write  |
| Fake Draft Connector    | Shotgun 1.0.0                   | NO_RELEVANT_OSS | 안전 Contract·Product demo                     | 실제 외부 서비스·production use |

## 직접 구현 근거와 재사용 경계

- Shotgun이 소유해야 하는 Risk Decision·Approval Token·Digest 결속·`OUTCOME_UNKNOWN`·Audit는
  OSS 내부 권한이나 Provider SDK 상태로 대체할 수 없다.
- gbrain의 안전한 operation surface와 음성 테스트 패턴은 재사용했지만 gbrain operation을
  승인된 Shotgun Action으로 직접 노출하지 않았다.
- 현재 정책은 고정 mapping 5개와 하한 2개다. OPA·Casbin·OpenFGA를 넣으면 별도 언어·service·
  model·운영이 늘어 MVP 유지보수 비용이 더 크다.
- 실제 Provider와 최소 credential scope가 정해지지 않아 MCP·Octokit을 설치하면 사용하지 않는
  network·auth 표면만 생긴다.
- Fake Connector는 비밀 격리, idempotency, Preflight, Verify와 response-loss를 결정적으로
  재현하기 위한 Test Adapter다. 실제 Adapter는 같은 `ActionConnectorPort`로 교체한다.

## Contract·보안·교체 검증

- R0~R4 결정적 판정과 restricted·compensation 하한: PASS
- Candidate·Approval·Execute Scope 분리와 미권한 403: PASS
- Approval Token의 Revision·Target·Parameter·Preview 결속: PASS
- 승인 후 변경·잘못된 Digest·service 승인·만료 Token 거부: PASS
- Preflight 거부 시 Provider execute 0회: PASS
- 동시 execute 2개에서 Provider side effect 1회: PASS
- response loss 후 `OUTCOME_UNKNOWN`, 자동 재실행 금지, Verify 복구: PASS
- Secret의 record·Audit·HTTP 미노출: PASS
- 보상 Action의 별도 Candidate·Approval·Audit: PASS
- PostgreSQL restart·원자 claim·불변 Approval·append-only Audit: PASS
- Fake Adapter 교체 경계와 실제 Provider 비활성화: PASS

## Rollback·Replacement

- 정책 Rollback: `stage11.action-risk.v1` 코드와 테스트를 이전 revision으로 되돌린다.
- 저장소 Rollback: Action writer를 중지하고 `action` Schema를 백업한다. Stage 0~10 Schema는
  참조하지 않아 영향을 받지 않는다.
- Connector Rollback: 실제 Adapter를 비활성화하고 Fake 또는 read-only Adapter로 교체한다.
- MCP·OPA·Casbin·OpenFGA·Temporal·Octokit은 설치하지 않았으므로 제거 migration이 없다.

## 알려진 제한과 재검토 조건

- 실제 Provider가 승인되면 공식 SDK와 MCP를 기능·권한·유지보수 기준으로 다시 비교한다.
- R3·R4는 Provider Adapter, 최소 권한, 운영 Runbook과 별도 승인 전 실행하지 않는다.
- 정책이 여러 서비스·조직에서 관리되면 OPA·Casbin을 benchmark한다.
- multi-day wait·timer·saga가 필요하면 Temporal을 benchmark한다.
- 공유 프로젝트의 관계 권한이 필요하면 OpenFGA를 benchmark한다.
