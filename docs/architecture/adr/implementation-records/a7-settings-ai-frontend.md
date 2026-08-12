# A7 Implementation Record — Settings → AI Frontend Product

## Scope

This implementation adds the canonical `/settings/ai` Product workspace on top
of the A6 server control plane. It keeps provider/model authority server-owned,
holds a draft API key only in component state, supports stored and draft Test
Connection, performs the two-step credential/configuration save flow, and
surfaces privacy/deployment and conflict/partial outcomes.

The implementation does not add the A8 resolver/router, change Ask routing,
mutate execution pins, change A4 approval authority, persist browser secrets,
or deploy the application.

## Boundary correction

The merged A6 read model exposed provider status but not the A3 model
descriptors needed for a server-derived A7 model selector. This branch adds a
minimal non-secret projection of the A3 model descriptor fields
(`providerId`, `modelId`, `displayName`, Shotgun capabilities and capability
revision) to the A6 read model. No new authority or catalog is introduced.

## OSS integration decisions

| Candidate                                                    | Decision          | Boundary                                                                                                                                              |
| ------------------------------------------------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ddsyasas/llm-wiki`                                          | `REFERENCE_ONLY`  | Settings/AI workflow and action-oriented status presentation only; no backend, SQLite or provider client reused.                                      |
| Inkeep OpenKnowledge                                         | `REFERENCE_ONLY`  | Review/status presentation patterns only; no runtime, canonical store or browser authority reused.                                                    |
| `garrytan/gbrain`                                            | `NO_RELEVANT_OSS` | Job/runtime persistence is outside A7.                                                                                                                |
| `lucasastorian/llmwiki`                                      | `NO_RELEVANT_OSS` | Conversion/evidence tooling is outside A7.                                                                                                            |
| Existing React, React Router and TanStack Query dependencies | `AUGMENT`         | Existing repository dependencies are used behind the current AppRuntime/API-client boundary; no new dependency or external settings runtime is added. |

The UI keeps a replaceable `ShotgunApiClient` contract and does not promote any
OSS type, schema or storage model into Shotgun authority.

## Security and product invariants

- API keys are write-only and are not placed in URL parameters, browser
  storage, query data, generic settings payloads or logs.
- The key field is cleared after credential-save success and never populated
  from a server response.
- Test Connection sends either a transient draft key or an exact stored
  credential revision, never Project Source/Evidence/Conversation data.
- A credential-success/configuration-conflict result is shown as partial; the
  client does not blindly repeat credential creation.
- Provider/model options are decoded from the server descriptor set.
- `REVIEW_REQUIRED` and deployment ceilings are presented as read-only state
  with a link to the owner review flow.
- The page explicitly states that A8 Ask runtime cutover has not occurred.

## Migration and rollback

No database migration is required. The additive A6 read-model projection is
backward-compatible at the server authority layer and can be reverted with
the branch commit without changing credential/configuration data.

## Verification plan

Focused frontend tests cover fresh-project DeepSeek selection, all provider and
model descriptors, secret non-persistence, draft/stored Test Connection,
credential/configuration partial outcome, privacy review presentation and
duplicate-submission prevention. Repository typecheck, frontend tests/build,
contract/architecture checks and exact-head CI remain separate evidence.
