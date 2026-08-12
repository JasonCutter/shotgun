# A3 Provider Registry, Model Catalog & Project AI Configuration Authority

Status: `IMPLEMENTED / LOCAL_FULL_CHECK_BLOCKED`

Base: `main@5df720603c5c7d4c2cc5df1369cbfdd4b6664493`

Branch: `codex/a3-provider-registry-project-ai-config`

## Scope

This slice implements ADR-133 Sections 3, 4, and 5 only:

- server-owned runtime-immutable Provider Registry for `openai`, `google-gemini`, and `deepseek`;
- versioned Model Catalog descriptors with provider-native and Shotgun-usable capability sets;
- revisioned project-scoped AI configuration authority with append-only history and stale-write CAS;
- additive PostgreSQL persistence for current configuration and configuration revisions;
- exact metadata-only credential ownership and lifecycle validation through an injected port.

Configuration persistence stores only provider/model identifiers, exact credential identity and
credential revision, revision metadata, and audit fields. It never stores plaintext, ciphertext,
or a latest-credential alias.

## Explicit exclusions

Settings UI/API, API key entry, Test Connection, provider adapters, provider routing/factory,
request-time resolution, Ask runtime switching, privacy/egress approval, execution pinning,
retry changes, startup Gemini behavior, AKP, deployment, and production verification remain
out of scope.

## OSS integration decision

`NO_RELEVANT_OSS` for this authority slice. The existing verified OSS references were reviewed
as architecture and UX references, but none owns the Shotgun Provider Registry, Model Catalog,
credential metadata boundary, or revision/CAS persistence contract. No external runtime or
provider SDK was introduced. A3 keeps the replaceable `ProviderRegistryPort`,
`CredentialMetadataReaderPort`, and `ProjectAIConfigurationRepositoryPort` boundaries.

## Implementation locations

- Provider Registry, Model Catalog, and service port: `modules/ai-configuration/src/index.ts`
- Module ownership/security manifest: `modules/ai-configuration/module-manifest.json`
- In-memory repository: `adapters/ai-configuration-in-memory/src/index.ts`
- PostgreSQL repository: `adapters/ai-configuration-postgres/src/index.ts`
- Additive migration: `db/migrations/037_a3_project_ai_configuration.sql`

The A2 Credential Vault was not changed. The A3 service consumes only its metadata-shaped
`getMetadata` contract, pins the requested credential revision, and rejects ownership or
non-active lifecycle mismatches. The A3 tables keep the credential ID and revision as an
exact server-validated reference without a cross-module database FK, so the A2-owned vault
can retain its independent append-only lifecycle and database-test isolation.

## Validation evidence

- Unit focus tests: `tests/unit/ai-configuration.test.ts`
- Contract focus tests: `tests/contract/ai-configuration.contract.test.ts`
- Database focus test: `tests/database/a3-project-ai-configuration.test.ts` (requires
  `TEST_DATABASE_URL`; never falls back to `DATABASE_URL`)
- Focus unit/contract tests: `8 passed`.
- Typecheck, architecture, format, lint, docs, secret, and OSS gates: passed.
- Database focus test: `NOT_RUN`; this Codex environment has no `TEST_DATABASE_URL`, and
  `DATABASE_URL` fallback is forbidden.
- `npm run check`: run once and stopped before code checks because the pre-existing generated
  Knowledge Flow HTML was stale. The generated output was synchronized and its check passed;
  the subsequent `check:core` exposed 11 unrelated existing failures in Knowledge Graph and
  Draft/Settings Controller unit tests. No out-of-scope test or product code was changed.
- Exact-head CI and Draft PR evidence: to be recorded after commit and push.

## Acceptance assessment

AC-01 through AC-11 are implemented by the server-owned registry/catalog, service validation,
exact credential revision reference, append-only history, and CAS repository contracts.
AC-12 is covered by the additive migration design and database focus test. AC-13 and AC-14 are
preserved by the absence of runtime routing, UI, external egress, and other excluded changes.

Database authority remains pending until an isolated `TEST_DATABASE_URL` is available. The
exact-head CI result remains pending until commit and push.
