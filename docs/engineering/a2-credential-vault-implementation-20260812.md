# A2 Credential Vault & Secure Persistence — Implementation Report

Status: `IMPLEMENTED / CI_VERIFIED`

This report records the bounded A2 implementation and its exact-head CI
verification. Local PostgreSQL focus tests were not run because the environment
has `DATABASE_URL` but no `TEST_DATABASE_URL`; the CI test database completed
successfully.

## Evidence base and worktree

- Branch: `codex/a2-credential-vault`
- Base: `main@83f66f712ea039b7d236a1c4fab10233d57e5f13`
- The original `codex/deepseek-v4-flash-provider-switch` worktree and its
  uncommitted changes were left untouched.
- Publication: Draft PR [#98](https://github.com/JasonCutter/shotgun/pull/98)
  is open. No Ready, Merge, or Deploy action is included.

## Implemented scope

- `CredentialVaultPort` and `CredentialVaultService` in
  `modules/credential-vault/src/index.ts`.
- AES-256-GCM authenticated envelope with a fresh 12-byte nonce for every
  encryption, explicit encryption/key versions, associated data binding to
  Project/provider/credential/revision, and zeroing of temporary key/plaintext
  buffers.
- Environment master-key authority for
  `SHOTGUN_CREDENTIAL_MASTER_KEY` (base64url-encoded 32 bytes) with safe
  availability states. Key errors do not occur during service construction;
  credential capability fails closed when used.
- Exact Project/provider/credential/revision resolution, no latest-revision
  substitution, create/replace/revision/revoke/remove lifecycle, and
  bounded callback use. The callback returns only a fixed non-secret status
  result; the Port has no generic plaintext-return method.
- In-memory adapter and PostgreSQL adapter with transactional CAS-style
  replacement.
- Additive migration `036_a2_credential_vault.sql` creating
  `ai.provider_credentials`. Encrypted envelope and identity fields are
  immutable; lifecycle state changes are allowed and revision rows cannot be
  deleted.
- `scripts/database.ts` verification now requires
  `ai.provider_credentials`.

## Explicitly excluded

Settings UI/API, provider/model routing, `EffectiveAIConfigurationResolver`,
provider-specific privacy approval, execution pinning, Test Connection,
OpenAI/DeepSeek runtime integration, private provider egress, automatic
`GEMINI_API_KEY` migration, legacy Gemini fallback changes, and AKP/product
implementation remain outside A2.

## OSS Integration Decision

Decision: `NO_RELEVANT_OSS` for the credential vault encryption and bounded
secret-use boundary. The reviewed Shotgun references are not credential-vault
implementations and are not imported or copied:

| Candidate                                                         | Reviewed pin/license                                         | Decision and reason                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| [garrytan/gbrain](https://github.com/garrytan/gbrain)             | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT              | `REFERENCE_ONLY`; durable jobs/migration patterns do not provide secret-vault semantics               |
| [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki) | `ad626a3d81be1480e35ef4e94234de8dbb27a61e`, Apache-2.0       | `REFERENCE_ONLY` for A2; transformation/evidence code is unrelated to credential encryption           |
| [ddsyasas/llm-wiki](https://github.com/ddsyasas/llm-wiki)         | `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`, MIT              | `REFERENCE_ONLY`; UX/source-intake patterns do not own server secrets                                 |
| [Inkeep OpenKnowledge](https://github.com/inkeep/open-knowledge)  | `f2834c237639e2cff603817ed88182b33f83cf91`, GPL-3.0-or-later | `REFERENCE_ONLY`; Entity Vault is a knowledge UX/persistence pattern, not provider credential storage |

Node's built-in `node:crypto` is used, so no new third-party dependency,
license, lockfile, provider SDK, or external runtime is introduced. The
replacement boundary is `CredentialVaultRepositoryPort`; either adapter can
be replaced without changing the module contract. Rollback is schema-level:
restore a pre-036 backup and remove only the A2 schema on an isolated,
explicitly approved target. No production or general database reset was run.

## Validation

Passed:

- `npm run typecheck`
- `npx vitest run tests/unit/credential-vault.test.ts tests/contract/credential-vault.contract.test.ts` — 6 tests passed
- `npm run test:architecture`
- `npm run lint -- --no-warn-ignored`
- `npm run format:check`
- `npm run docs:validate`
- `npm run test:contract` — 39 files / 470 tests passed
- `npm run secret:scan`
- `npm run oss:verify` — 68 decisions / 45 baseline references passed
- `git diff --check`
- GitHub Actions `CI #835` at head
  `c7b8309e1d1c2d582c883320a32630aeddb39288`: Frontend, Quality, and Required
  Gates passed; Quality database tests passed.

Blocked or not run:

- Local `tests/database/a2-credential-vault.test.ts`: `TEST_DATABASE_URL` is
  not configured. The repository database guard correctly refuses to fall back
  to `DATABASE_URL`; the exact-head CI database tests passed separately.
- `npm run test:database` and `npm run db:test:verify`: require the same
  separate test database and were not substituted with a production/local
  application database.
- `npm run check`: stopped before A2 checks because the existing generated
  Knowledge Flow baseline is stale. It was not regenerated because that would
  widen the A2 file scope.
- `npm run check:core`: lint, format and typecheck passed; the existing full
  unit suite then reported six retry-classification failures in
  `frontend-knowledge-graph-failures.test.ts` and one in
  `frontend-knowledge-query.test.ts`, outside the A2 change set, before the
  120-second command limit.
- Full integration execution through the repository npm script could not use
  the worktree's absent `node_modules`; the equivalent `npx vitest` run passed
  353 tests but reported one unrelated Compiled Truth UI failure and the
  expected database-guard failure for `recovery-harness-isolation.test.ts`.
- `npm run test:stage12-package`: the original run hit npm-cache EPERM; a
  worktree-local cache retry timed out during package packing. No A2 package
  dependency was changed.

The exact-head CI database test passed the migration, encrypted-only
persistence, revision replacement, exact revision rejection after rotation,
ownership isolation, lifecycle blocking, immutable envelope fields, and
repeat-safe migration checks. Local database execution remains intentionally
not run because `TEST_DATABASE_URL` is absent.

## AC-01~AC-12 assessment

| AC    | Assessment                                                                                                       |
| ----- | ---------------------------------------------------------------------------------------------------------------- |
| AC-01 | Implemented Port/service and both persistence boundaries; Product API/runtime wiring remains excluded.           |
| AC-02 | AES-256-GCM envelope and no-plaintext unit evidence passed; exact-head CI PostgreSQL evidence passed.                |
| AC-03 | Missing/malformed master-key availability and fail-closed unit evidence passed.                                  |
| AC-04 | Service construction is non-fatal and capability use is unavailable; application startup wiring is unchanged.    |
| AC-05 | In-memory and exact-head CI PostgreSQL lifecycle evidence passed.                                               |
| AC-06 | In-memory and exact-head CI PostgreSQL exact revision/no-substitution evidence passed.                         |
| AC-07 | In-memory and exact-head CI PostgreSQL project/provider isolation evidence passed.                             |
| AC-08 | Plaintext is available only in the bounded callback, its buffer is zeroed afterward, and metadata has no secret. |
| AC-09 | Migration is additive; exact-head CI applied and verified it, and no local destructive reset was run.             |
| AC-10 | No `GEMINI_API_KEY` migration or DeepSeek change is included.                                                    |
| AC-11 | Explicitly excluded from this A2 implementation.                                                                 |
| AC-12 | Architecture boundary test passed; module has no database/provider SDK dependency.                               |

Remaining authorization gate: Ready, Merge, and Deploy remain separate and
were not requested. Local PostgreSQL checks can be repeated later with a
dedicated `TEST_DATABASE_URL`; the required local `npm run check` attempt was
already made once, while exact-head CI #835 passed its configured gates.
