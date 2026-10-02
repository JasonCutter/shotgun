# VP-08 external URL freshness in Source and Ask — 2026-10-02

**Status: partial implementation; VP-08 remains open.**

ADR-172 §3 requires external URL and connector sources to carry a last-checked
time and a freshness TTL, and forbids presenting expired or failed refreshes as
current. This change carries the most recent successful URL acquisition time
from its immutable provenance receipt into the Source detail and the Ask
Evidence/citation path.

## Implemented boundary

- A Shotgun policy constant sets the current external text freshness window to
  24 hours. `ExternalSourceFreshnessView` exposes `lastCheckedAt`, `expiresAt`,
  and `CURRENT`/`EXPIRED`; contract decoders reject incomplete or backward
  windows.
- The PostgreSQL Source projection obtains the latest successful
  `url_provenance_receipts.retrieved_at` for each SourceVersion. The Source
  detail displays its check and expiry times and warns when expired.
- Ask resolves freshness for the exact selected Evidence SourceVersion and
  includes it in the durable context digest and attempt Evidence record.
  Expired evidence is explicitly described to the AI provider as historical;
  the saved citation retains the freshness state and the conversation shows
  its checked time and an expired warning.
- The final citation write rechecks the TTL and persists `EXPIRED` if the
  deadline passed while the provider was running.
- Migration 128 adds nullable freshness fields to Ask attempt Evidence and
  citation records. Existing records remain valid and decode without freshness.

## OSS and replacement decisions

| Candidate / boundary                                                                              | Decision          | Rationale and replacement boundary                                                                                                            |
| ------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing `SecureUrlAcquisitionCoordinator` + URL provenance receipt                               | `AUGMENT`         | Reuse the current SSRF-bounded acquisition and Shotgun-owned PostgreSQL receipt. No fetch runtime or provider dependency was added.           |
| PostgreSQL 16 runtime and existing Source/Ask repositories                                        | `AUGMENT`         | Keep SourceVersion, Evidence, freshness policy, and citation meaning in Shotgun; database rows remain behind the existing repositories.       |
| `lucasastorian/llmwiki` `ad626a3d81be1480e35ef4e94234de8dbb27a61e` (Apache-2.0) watcher/reconcile | `REFERENCE_ONLY`  | The existing Role Matrix excludes its Watcher/runtime. It does not own Shotgun's SourceVersion, secure-fetch, and Ask contracts.              |
| `garrytan/gbrain` `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` (MIT) Job patterns                   | `REFERENCE_ONLY`  | Existing durable Job patterns remain a reference; no gbrain runtime/schema is introduced for this read projection.                            |
| Standalone OSS for Shotgun TTL-to-citation semantics                                              | `NO_RELEVANT_OSS` | No independent package supplies this Shotgun-owned provenance and Ask freshness contract. The TTL is product policy, not a parser capability. |

No new dependency or lockfile entry was added. Source and Ask repositories remain
the replacement boundaries. The migration is additive and nullable: code can
be rolled back while retaining the columns; removing them requires restoring a
pre-migration database backup. No in-place destructive down migration is
provided.

## Verification

- Frontend TypeScript check passed.
- Focused contracts and provider unit tests passed: 47/47.
- Ask workspace UI tests passed: 30/30, including the Korean expired-source
  warning.
- Source persistence PostgreSQL tests passed: 5/5.
- Ask write/recovery PostgreSQL tests passed: 2/2 after applying the isolated
  `TEST_DATABASE_URL` migration reset.

## Remaining VP-08 work

There is not yet a scheduled refresh worker. The product marks a URL source
expired and tells Ask to treat it as historical, but does not fetch it again or
persist a refresh-failure receipt. URL revalidation, changed-content
SourceVersion creation, refresh-failure behavior, and installed-product
verification remain open. Image, audio, and video activation also remains out
of scope under the Module Architecture's current Phase 1 policy. These gaps
keep VP-08 unchecked and prevent any Stage/VP completion claim.
