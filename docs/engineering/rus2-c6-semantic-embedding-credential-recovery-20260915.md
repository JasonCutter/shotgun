# RUS-2 C6 Semantic Embedding Credential Recovery

상태: `IMPLEMENTED_PENDING_REVIEW`

작성일: 2026-09-15 (Asia/Seoul)

## 1. 범위와 기준

- Stage/Flow: RUS-2, C6 — Semantic Embedding Credential Recovery and Rebind
- 기준 merge: `main@47e7f74b606cbbefd50bfd72b3fddf464406ef93`
- 구현 브랜치: `codex/rus2-c6-semantic-embedding-credential-recovery`
- Target Module: `Semantic Comparison` Product surface, `AI Settings` API, `Credential Vault` Port 사용 경계
- 관련 결정: ADR-148; Canonical·Evidence·Approval·Action 경계는 변경하지 않는다.

C6는 live RUS-2 데이터나 Candidate A/B 실행을 변경하지 않는 단일 semantic-only 복구 slice다. generative AI 설정, DeepSeek provider binding, standing policy, privacy policy, rollout 값은 이 slice의 쓰기 대상이 아니다.

## 2. OSS 검토와 Integration Decision

기준 문서의 검증된 4개 레퍼런스와 Module Architecture의 Port/Adapter 원칙을 먼저 검토했다. 이번 기능은 Shotgun Project별 credential identity·revision·secret vault·semantic profile cutover의 조합을 다루므로 외부 OSS runtime을 도입하지 않고 기존 Shotgun Port/Adapter를 보완한다.

| 후보                                                              | 검토 기준                                                    | 결정                    | 이번 slice의 범위                                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------- | --------------------------------------------------------------------------------- |
| [garrytan/gbrain](https://github.com/garrytan/gbrain)             | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT              | `REFERENCE_ONLY`        | Job/idempotency/recovery 사고방식만 참고; Runtime·DB·provider authority 제외      |
| [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki) | `ad626a3d81be1480e35ef4e94234de8dbb27a61e`, Apache-2.0       | `REFERENCE_ONLY` for C6 | 변환·Evidence 부품은 credential recovery와 무관; Package 변경 없음                |
| [ddsyasas/llm-wiki](https://github.com/ddsyasas/llm-wiki)         | `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`, MIT              | `REFERENCE_ONLY`        | action/busy/settings UX만 참고; Backend·SQLite·LLM client 제외                    |
| [Inkeep OpenKnowledge](https://github.com/inkeep/open-knowledge)  | `f2834c237639e2cff603817ed88182b33f83cf91`, GPL-3.0-or-later | `REFERENCE_ONLY`        | activity/recovery UX 관점만 참고; GPL runtime·storage·Yjs 제외                    |
| 외부 semantic credential/rebind runtime                           | 해당 없음                                                    | `NO_RELEVANT_OSS`       | Shotgun이 소유해야 하는 secret·revision·profile authority와 동일한 검증 후보 없음 |

License·security·maintenance 관점에서 새 OSS dependency 또는 runtime을 추가하지 않았다. 따라서 lockfile/third-party notice 변경도 없다. 기존 `packages/credential-vault`, `modules/ai-settings-backend`, semantic profile Port 및 Product API authority를 재사용하고, 교체 가능한 경계는 Shotgun API client와 Product route로 유지한다.

## 3. 구현 범위

### 포함

1. `POST /api/v1/settings/ai/semantic-comparison/embedding-credentials/replace` 추가.
2. 요청 허용 필드는 `targetProjectId`, `providerId`, `embeddingModelId`, `secret`, `clientRequestId`뿐이다.
3. 서버가 현재 semantic profile의 provider/model binding을 먼저 검증한 뒤 해당 provider의 active credential을 조회해 exactly-one을 검증하고 credential ID/revision을 파생한다.
4. active credential 0개는 `CONFIGURATION_REQUIRED`, 2개 이상은 `CONFLICT`로 fail closed한다.
5. 기존 `replaceCredential(projectId, providerId, credentialId, expectedRevision, secret, clientRequestId)` Port를 통해 revision replacement를 수행한다.
6. API client contract/decode에 semantic replacement과 비밀정보가 아닌 active credential identity를 추가한다.
7. READY/V2_ACTIVE에서도 semantic-only `Replace embedding credential` 명령을 노출한다.
8. submit 전에 sessionStorage에는 project/provider/model/request/operation/credential identity와 expected revision만 저장한다. secret은 메모리 입력에만 존재한다.
9. 응답 손실 시 동일 `clientRequestId`의 outcome 조회만 제공하고 secret을 재전송하지 않는다.
10. Source Detail의 `CREDENTIAL_UNAVAILABLE` + `CONFIGURATION_REQUIRED` blocked 상태에 semantic credential recovery 안내를 제공한다.
11. replacement는 기존 credential/profile/generation을 변경하지 않고, Prepare가 새 credential revision으로 profile/generation을 생성·cutover한다.

### 제외

- live RUS-2 Candidate A/B 재실행 또는 데이터 변경
- generative AI/DeepSeek 설정 및 standing policy 변경
- provider read-time probing
- privacy policy 변경
- Canonical/Evidence/Approval/Action 의미 변경
- credential secret 평문 저장·응답·로그 기록
- 새로운 OSS runtime, DB schema migration, lockfile dependency

## 4. 검증 증거

### Contract/UI/semantic tests

- `npm --workspace @shotgun/web run test -- src/commands/semantic-command-surface.test.tsx src/routes/source-detail-recompare.test.tsx`
  - 2 files, 13 tests passed
  - READY/V2_ACTIVE replacement visibility and exact secret-safe request body
  - response-loss recovery, identity-only persistence, no second secret submission
  - Source Detail credential-unavailable message
- `node --env-file-if-exists=.env --env-file-if-exists=.env.test node_modules/vitest/vitest.mjs run tests/integration/semantic-embedding-profile-product.test.ts`
  - 1 file, 13 tests passed
  - 0/1/multiple active credential safety
  - browser-supplied credential identity rejection
  - old credential superseded, new revision active
  - old profile/generation immutable; Prepare creates revision 2 profile/generation
  - DeepSeek current configuration, standing policy, and rollout unchanged
  - no secret in replacement response
- `npm run typecheck` passed.
- `npm run frontend:typecheck` passed.

Golden corpus/search/benchmark 결과에는 영향이 없다. 이 slice는 semantic execution credential control plane만 변경하며, corpus transformation·Evidence span·query ranking을 변경하지 않는다.

### Security and replacement properties

- Server rejects client-selected credential ID/revision.
- Server derives the only active credential and uses expected revision CAS.
- 4xx authoritative rejection clears pending identity; unknown outcome preserves only identity for resolution.
- Resolve path performs outcome lookup only and never resends a secret.
- Existing profile/generation revisions remain readable and immutable after replacement.
- Rollback is a normal PR revert; no data migration is required. If a replacement has already occurred, vault lifecycle/profile history remains append-only and the previous credential revision is not deleted.

## 5. 남은 Gate와 제한

이 문서는 구현·집중 검증 근거이며 아직 `COMPLETE` 보고가 아니다. PR review, branch-head CI의 Quality/Postgres DB/Frontend/Frontend E2E/Required Gates, 그리고 merge 후 main exact-head CI가 남아 있다. live RUS-2 재개에는 실제 provider에서 인증되는 semantic embedding credential이 필요하며, C6는 유효 secret을 발급하거나 live 데이터를 변경하지 않는다.

다음 Contract Version 전달값: semantic embedding credential replacement v1; pending recovery storage schema `v1`; request contract은 위 5개 필드로 고정한다.
