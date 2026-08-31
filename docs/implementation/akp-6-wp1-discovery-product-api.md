# AKP-6 WP1 — Discovery Product API and Typed Client

## Boundary

WP1 adds only the server-authoritative, project-scoped read boundary for
durable Discovery Findings. The Product coordinator composes the existing
Finding persistence, authoritative current lifecycle, AKP-5 re-entry
consumption, persistent Review resource, and Evidence repositories. It does
not own lifecycle, validation, re-entry, Review, freshness, Canonical, or
Action state.

The browser supplies only a strict schema version, bounded cursor/filter/page
request, or exact `findingId` + `findingRevision`. Principal, effective
Project, membership/access scope, sensitivity clearance, policy revision,
lifecycle, freshness, and capabilities are server-derived.

Every related-resource and typed-payload reference is re-authorized against
the current resource authority before a Finding is returned. Missing,
revoked, cross-Project, stale-revision, or over-clearance resources fail
closed for the whole Finding. The PostgreSQL adapter reuses the existing
Canonical/Approved/Compiled Truth resolver and SourceVersion security reader;
it does not create a second authorization store.

## Integration decision

No new dependency is introduced. Existing Shotgun repositories and ports are
the authoritative adapters.

| Candidate               | Decision         | Reason and boundary                                                                                                                 |
| ----------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `garrytan/gbrain`       | `REFERENCE_ONLY` | Its Brain/Execution patterns are useful context, but its Runtime/DB is not promoted into the Shotgun Product or Canonical boundary. |
| `lucasastorian/llmwiki` | `REFERENCE_ONLY` | Existing Shotgun Evidence/Source authority is reused; lucas conversion/runtime and SQLite/FTS/VaultFS are not introduced.           |
| `ddsyasas/llm-wiki`     | `REFERENCE_ONLY` | UX/read-model ideas are reference material only; its backend, SQLite, ingest/query/lint, and LLM client are excluded.               |
| Inkeep OpenKnowledge    | `REFERENCE_ONLY` | Graph/source preservation patterns remain UI reference material; its Runtime, Git/MCP engines, and Yjs are excluded.                |

The reviewed pins and gate evidence are inherited from the OSS source registry:

| Candidate     | Official repository                                               | Reviewed pin / license                                                 | Security and maintenance evidence                                                                                                                      |
| ------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| gbrain        | [garrytan/gbrain](https://github.com/garrytan/gbrain)             | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT, verified              | No runtime/DB/provider configuration is embedded; pinned validation baseline and existing lock/idempotency/recovery review remain the recheck trigger. |
| lucas         | [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki) | `ad626a3d81be1480e35ef4e94234de8dbb27a61e`, Apache-2.0, verified       | Existing extracted locator is independently versioned and ambiguity-safe; WP1 does not add the upstream runtime or storage.                            |
| ddsyasas      | [ddsyasas/llm-wiki](https://github.com/ddsyasas/llm-wiki)         | `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`, MIT, verified              | Backend/path and SSRF risks are excluded; only previously reviewed UX patterns are referenced.                                                         |
| OpenKnowledge | [inkeep/open-knowledge](https://github.com/inkeep/open-knowledge) | `f2834c237639e2cff603817ed88182b33f83cf91`, GPL-3.0-or-later, verified | No code/runtime is copied into the MIT-compatible boundary; any future code reuse requires a license review.                                           |

The PostgreSQL adapter is an `ADOPT` of existing Shotgun-owned repositories,
not adoption of an external runtime. It is locked by the repository commit
and the root lockfile; there is no new OSS package version to add. No new
Prototype/Golden corpus or Benchmark is required for a read-only DTO
composition; the focused Contract, security, lineage, and adapter tests are
the WP1 evidence and the existing registry reviews are the OSS evidence.

## Safety and rollback

- Current lifecycle is read from `discovery.finding_lifecycle_current`, never
  from the immutable Finding envelope.
- Review capability is exposed only for a matching persistent
  `ELIGIBLE_AFTER_VALIDATION` resource whose authoritative lifecycle is
  `REVIEW_READY`.
- Evidence is emitted only from an accessible persisted `EvidenceSpan`, with
  its real Evidence, Source, SourceVersion, and revision identities. No
  SourceVersion or Evidence identity is synthesized; the Product field is
  explicitly named `evidenceRevisionId`.
- Pagination remains deterministic keyset pagination, but the client-visible
  continuation is an authenticated AES-GCM envelope. The plaintext cursor
  contains only server-owned Project/Finding keyset state, so Finding IDs are
  not reversible from the browser token and tampering fails closed.
- `canOpenGraph` is true only when an authorized graph-capable resource was
  resolved. Activity and Investigation capabilities remain false in WP1
  because no server-authoritative navigation identity exists yet; a `runId`
  alone is not a capability grant.
- Product provenance is narrowed to safe derivation metadata (kind and, where
  meaningful, deterministic rule/input fields). Provider, model, prompt,
  credential, execution, and private configuration identities are excluded.
- Foreign projects, inaccessible sensitivity/access scopes, malformed
  lineage, disabled/expired principals, and inactive/archived projects fail
  closed or are omitted without disclosure.
- Reads perform no migration, lifecycle transition, validation, re-entry,
  Review, Canonical, Action, scheduler, or worker mutation.
- Rollback is removal/reversion of the focused WP1 commit and route/client
  registration; existing durable tables and prior Stage authorities remain
  unchanged.

## Verification

The focused contract, adapter, route-security, and client tests cover strict
unknown-field rejection, current lifecycle override, revoked/sensitive typed
resource fail-closed behavior, opaque pagination across hidden windows,
non-Canonical classification, exact persistent Review lookup, real Evidence
and SourceVersion lineage, safe signal/capability/provenance filtering,
same-origin CSRF, failure-envelope translation, malformed responses, and
AbortSignal forwarding. The PostgreSQL integration test runs when
`TEST_DATABASE_URL` is available and otherwise skips safely; it exercises a
real lifecycle transition and persisted SourceVersion/Evidence authority.
No WP2 UI, WP3 Graph binding, WP4 Activity/Attention, WP5 actions/E2E, or
AKP-7+ work belongs to this document.
