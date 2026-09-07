# Fresh-project Semantic Embedding Profile Product Boundary

## Finding

The isolated Stage 5 run on `main@879e65ff4755f7ec99c271857cce7a4646da6cb4`
reached `Canonical v1` and `comparison.stage5.rollout=V2_ACTIVE`. The normal
Product request `POST /comparisons/recompare` correctly failed closed with
`SHORTLIST_BLOCKED`; it did not call V1, create a V2 draft, or create a new AI
provider call. Read-only inspection showed no semantic generation or active
generation pointer.

The existing Product route `POST /projection/semantic/refresh` is present, but
the route correctly requires a durable `SemanticEmbeddingProfile` first. A
fresh project had no Product/API capability to create that profile. A direct
refresh probe on the frozen r3 project returned `503 CONFIGURATION_REQUIRED`
(`A configured semantic embedding profile is required for refresh.`). No
profile, generation, pointer, or source data was mutated by the probe.

## Correction boundary

The AI settings Product boundary now exposes:

- `GET /api/v1/settings/ai/semantic-embedding-profile`
- `POST /api/v1/settings/ai/semantic-embedding-profile`

The route reuses the existing browser-session and Project Owner/administrator
authorization boundary. The POST accepts configuration intent only:
`expectedRevision`, `providerId`, `embeddingModelId`, `credentialId`,
`credentialRevision`, and optional `dimension`. Project, actor, profile ID,
profile revision transition, defaults, registry validation, credential
ownership/lifecycle, and `PREPARED` status remain server/service-owned. Unknown
authority fields are rejected.

The route delegates persistence and all validation to
`SemanticEmbeddingProfileService` and its PostgreSQL repository. It does not
activate a profile, mutate Canonical, build a generation, or change the
semantic active pointer. The existing empty-body semantic refresh remains the
only generation build/cutover path. DeepSeek remains generative-only and is
not accepted as an embedding model.

## Focused evidence

`tests/integration/semantic-embedding-profile-product.test.ts` proves:

1. a fresh project safely reports no profile;
2. an existing Product Credential Vault route creates an OpenAI credential;
3. the new Product route creates a `PREPARED` profile bound to the current
   project and exact credential revision;
4. GET round-trip, unknown authority-field rejection, and expected-revision
   CAS conflict;
5. `deepseek/deepseek-v4-flash` is rejected as an embedding profile.

The focused test passed with 2 tests / 2 assertions groups. The frozen r3
refresh probe returned the expected `CONFIGURATION_REQUIRED` without direct
database or service provisioning.

## Next acceptance

After review and merge, create a new isolated r4 database. Provision an
embedding-capable credential through the Product Credential Vault route,
prepare the profile through this boundary, call the existing empty refresh,
verify a READY generation and active pointer, then rerun the complete Stage 4
and Stage 5 flow. The r3 database remains frozen and is not repaired.
