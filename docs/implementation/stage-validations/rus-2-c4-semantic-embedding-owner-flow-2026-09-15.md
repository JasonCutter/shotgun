# RUS-2-C4 Semantic Embedding Owner Setup Flow

## Scope

This correction adds a focused owner setup flow to the existing `Enable semantic
comparison` command. A Project with a separately configured DeepSeek generative AI
credential can now select a server-registered semantic embedding provider/model,
enter a write-only embedding credential, save it through the existing Credential
Vault, and continue with the existing Semantic Comparison V2 preparation authority.

The browser submits only the target Project, the selected registered provider/model,
the write-only secret, and a client request identity. The Product API derives the
authenticated session and Project ownership, validates the provider/model against
`SemanticEmbeddingRegistryPort`, and calls `AISettingsBackendPort.createCredential`.
It never writes or replaces `ProjectAIConfiguration`, standing policy, privacy
approval, semantic profile, generation, watermark, or active cutover state.

The original J4 blocker was two-part: Settings → AI coupled credential creation to
generative configuration, causing an intentional partial save for an embedding-only
credential, and the frontend projected the typed backend `CONFIGURATION_REQUIRED`
condition as a generic 5xx message. C4 supplies the missing owner button/form and a
bounded typed error projection. Existing live J3 data and the blocked J4 live Project
were not mutated or retried.

## OSS integration decision

`NO_RELEVANT_OSS` for the new Product mutation and authority boundary. The existing
Shotgun semantic registry, Credential Vault, PostgreSQL ownership model, and typed
Product contracts are the required reusable boundaries; no new dependency or
lockfile entry is introduced. The reviewed references remain reference material for
interaction, retry, and review patterns only:

| Candidate            | Repository and pinned review                                                                             | Decision for C4  | Reason                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------- |
| gbrain               | https://github.com/garrytan/gbrain · `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` · MIT                    | `REFERENCE_ONLY` | Retry/idempotency patterns are informative; its Runtime, DB, and credential authority are excluded.             |
| llmwiki              | https://github.com/lucasastorian/llmwiki · `ad626a3d81be1480e35ef4e94234de8dbb27a61e` · Apache-2.0       | `REFERENCE_ONLY` | Evidence/reconcile patterns do not own this credential boundary; SQLite, VaultFS, and MCP CRUD remain excluded. |
| llm-wiki             | https://github.com/ddsyasas/llm-wiki · `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` · MIT                  | `REFERENCE_ONLY` | Action-centered UX is informative; its backend, storage, and LLM client are not integrated.                     |
| Inkeep OpenKnowledge | https://github.com/inkeep/open-knowledge · `f2834c237639e2cff603817ed88182b33f83cf91` · GPL-3.0-or-later | `REFERENCE_ONLY` | Review/activity presentation is informative; GPL runtime and Canonical/Yjs model are excluded.                  |

The global OSS source registry retains the verified license and maintenance evidence
for each pin. No OSS Integration Gate exception is requested.

## Contract and authority boundary

- `SemanticComparisonStatusView.embeddingOptions` is a non-secret projection of
  registered provider/model display names and active-credential presence. It does not
  expose secret material, encryption metadata, registry internals, or revisions.
- `POST /api/v1/settings/ai/semantic-comparison/embedding-credentials` accepts only
  `targetProjectId`, `providerId`, `embeddingModelId`, `secret`, and
  `clientRequestId`. The server rejects unknown fields, cross-Project access, an
  inactive/unregistered provider/model, and a duplicate active provider credential.
- The existing prepare route may receive a selected registered embedding provider/model
  as a setup hint. The server validates that hint and remains the sole authority for
  profile, generation, watermark, and READY transitions; omission retains the
  deterministic registered default.
- Credential writes use the existing CSRF-protected browser session, owner access
  check, write-only secret path, vault encryption, and client-request recovery
  semantics. Plaintext is never returned.
- A successful embedding credential write does not call the generative configuration
  mutation. The existing prepare route remains authoritative for profile revision,
  representation version, generation, watermark validation, and READY state.
- `CONFIGURATION_REQUIRED` on the semantic surface maps to an actionable setup
  message. Unknown/internal 5xx responses remain generic. A `POLICY_DENIED` semantic
  refresh remains typed and offers the existing Settings → Privacy route; no privacy
  approval is automatically created.
- DeepSeek remains the generative-only provider. It is not added to the semantic
  embedding registry and is rejected for embedding setup.

## Verification and safety

Focused verification covers:

- owner-safe server option projection and registry ordering;
- fresh Project with canonical DeepSeek generative configuration, separate OpenAI
  embedding credential setup, and READY Semantic Comparison preparation;
- unchanged generative provider/model/configuration revision after embedding save;
- rejection of unregistered DeepSeek embedding model input without storing its secret;
- frontend NOT_CONFIGURED explanation, registered option/model selection, password
  input, successful write, absence of generative save calls, and refresh;
- typed `CONFIGURATION_REQUIRED` projection, generic unknown 5xx fallback, and typed
  privacy-blocked route action;
- existing no-credential, refresh failure, stale watermark, fallback, ambiguity,
  ownership/CAS, execution eligibility, and DeepSeek embedding rejection regressions.

Observed gates on this branch:

- `npm run test:unit -- --maxWorkers=1 --fileParallelism=false`: 147 files, 1,156
  tests passed;
- `npm run test:contract`: 66 files, 686 tests passed;
- focused Product semantic test: 11 tests passed;
- `npm run frontend:test`: 49 files, 374 tests passed;
- `npm run typecheck`, `npm run frontend:typecheck`, `npm run lint`, frontend build,
  architecture, OSS, documentation, secret-scan, and Stage 12 package gates passed;
- the normal integration run passed 64 of 65 files and 500 tests. The single
  database-backed recovery harness was not started because this environment has no
  `TEST_DATABASE_URL`; the repository guard correctly refused to fall back to
  `DATABASE_URL`.

No database migration, dependency, or lockfile change is required. Rollback is a
normal branch/PR rollback; existing Credential Vault metadata and prior semantic
history remain durable and are not rewritten. Any credential created by the new flow
is an explicit owner action and follows the existing Vault recovery/removal controls.

## Limits and handoff

This correction intentionally stops before live J4 continuation, merge, or cutover.
The Product flow must be reviewed against the exact branch head, merged with normal
CI, and then re-run through the real owner journey using a real embedding provider
credential. The contract version handed to the next stage is the existing
`SemanticComparisonStatusView` contract plus the new owner-only semantic credential
route; no Canonical or Semantic Comparison V2 authority is transferred to the
browser.
