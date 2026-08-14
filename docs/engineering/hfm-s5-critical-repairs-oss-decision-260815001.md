# HFM-S5 Critical Repairs — OSS Integration Decision

## Scope

This decision covers the bounded HFM-S5 Product repairs: authoritative Global
Search, persisted owner locale application, Source Detail information hierarchy,
Ask Conversation information hierarchy, and the frozen contextual replacement
access for rare Answer actions.

## Decision

| Area                              | Decision          | Existing boundary reused                                                                                        | Reason                                                                                                                                                                                                 |
| --------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Global Search                     | `AUGMENT`         | `GlobalSearchPort`, `FrontendProductReadCoordinator`, `FrontendSourcesReadCoordinator`, existing Product routes | The defect was the repository-owned always-empty production port. Existing server-resolved Project, access, sensitivity, and Source projection contracts already own the required truth.               |
| Owner localization                | `NO_RELEVANT_OSS` | persisted Principal Preferences and the shared frontend query cache                                             | Two deterministic dictionaries and one provider are smaller and safer than introducing an external runtime. No network translation, browser locale authority, or second persistence model is required. |
| Source Detail hierarchy           | `NO_RELEVANT_OSS` | existing Source/SourceVersion/Evidence read contracts and return-state validation                               | This is an ordering and conditional-presentation repair. An external component cannot replace the pinned-version, citation, Knowledge-return, or Evidence-focus authority.                             |
| Ask hierarchy and Answer commands | `NO_RELEVANT_OSS` | existing owner command registry and protected Ask APIs                                                          | This is a bounded presentation/context migration. Existing command identity, idempotency, recovery, revision, transition-seed, and Canonical/Review boundaries remain authoritative.                   |

No new third-party repository, package, fork, version, license, lockfile entry, or
runtime is introduced. The reviewed implementation candidates were the existing
Shotgun Product-read adapters, Source projection coordinator, Principal
Preferences path, owner command registry, and Ask command APIs. General search,
i18n, and command-palette libraries were not relevant because they would not own
the server-authorized Product projections or the existing write/recovery
contracts.

## Security, replacement, and rollback

- Search intersects requested Project IDs with server-resolved accessible
  Projects and passes per-Project access/sensitivity authority to the existing
  Source coordinator. React does not filter or manufacture results.
- Locale reads and writes the existing Principal Preferences resource. Unsupported
  locales deterministically fall back to `en-US`; user-authored Source, Answer,
  and Canonical content is not translated.
- Answer command metadata carries no live resource IDs. Mounted context is
  transient and execution remains protected by the existing Ask APIs.
- There is no data migration. Rollback is the Product-code commit rollback; stored
  preferences, Source projections, AnswerRun data, and command ledger identities
  are unchanged.
- The open-source role matrix does not require an update because no OSS role or
  dependency changed.

## Contract verification

Focused verification covers authoritative case-insensitive Source Search and
cross-Project masking, locale fallback/live cache update, exact AnswerRun command
target and mode/kind mappings, SourceVersion/Evidence ordering and return
identity, Ask hierarchy, command discovery, and affected browser regression
contracts. Automatic exact-head CI remains the final integration gate.
