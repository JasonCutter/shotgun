# VP-08 freshness and VP-04/09 formats — bounded implementation audit

Baseline: Canonical `aba6ff27f9620ee1a3f408f8df81e8aad21cc584`.
This report records repository implementation and fake verification, not
independent AI semantic certification or operating deployment.

## Existing evidence reused

- [2026-10-02 URL freshness](../vp-url-freshness-ask-projection-2026-10-02.md):
  successful URL receipts supply a 24-hour check/expiry window to Source detail,
  Ask evidence/request digest and saved citations. Focused contract/provider
  47/47, Ask UI 30/30, Source PostgreSQL 5/5 and Ask PostgreSQL 2/2 were historical
  scoped successes. The report explicitly left recollection and failure receipts
  open; no old result is reclassified as a full VP-08 PASS.
- [Historical AnswerRun correction](../vp05-answer-historical-freshness-2026-10-11.md):
  historical citation versions remain immutable while read projections detect
  superseded evidence. This is a different freshness dimension from external URL
  age/recollection; this work does not mutate historical answers/citations.
- `tests/unit/stage-8-format-expansion.test.ts` and
  `tests/contract/stage-8-format-pipeline.contract.test.ts`: format extraction,
  original-byte/source-map boundaries and image-gating evidence are reusable.
- `tests/browser/vp-two-action-ui.spec.ts`: existing Fake Provider format input
  and selector/citation flows are product-path evidence, not actual-model
  semantic accuracy or image/audio/video activation.

## Concrete gaps and selected minimal correction

1. Canonical has no periodic URL recollection worker. Existing Source and Ask
   queries read only successful `url_provenance_receipts`; failure cannot be
   separately journaled/observed.
2. `SourcesProductWriteServicePort.submit` already provides the correct version
   boundary: `requestedSourceId` retains Source identity, unchanged current bytes
   reuse the version, changed current bytes force a new immutable version. Its
   Stage 3 continuation and submission readback preserve durable processing.
3. New `SourceRefreshCoordinator` reuses the existing sealed staging, secure URL
   acquisition and product submit/getSubmission ports. A small additive
   `source_product.url_refresh_jobs` journal owns only scheduling/lease/phases,
   not Source, Evidence, security, AI authority or Canonical knowledge.
4. Source/Ask reads treat a failed/unknown refresh newer than last success as
   historical (`EXPIRED` in the existing wire enum), retaining check/expiry
   timestamps. No new public capability or replacement freshness authority is
   introduced. This enum expresses non-current external evidence; failure detail
   is in the safe refresh journal, not raw exception text.

### Durable boundaries

`READY → ACQUIRING → STAGED → SUBMITTING → SUCCEEDED`.

- Source + immutable acquisition receipt uniquely identifies a refresh job.
  PostgreSQL time, `SKIP LOCKED`, lease tokens and exact phase guards fence
  concurrent workers. Selection alone does not increment acquisition attempts.
- CURRENT membership/source visibility, pinned source version/security,
  standing policy and egress must authorize before acquisition and before
  submission. A historical intake is not continuing consent. Absent authority
  causes zero fetch/submission. The assembly owns the current authority reader.
  A server-owned `expectedSourceVersionId` is compared in the existing product
  transaction after acquiring the Source lock, closing the authorization/submit
  race. A concurrent user revision causes STALE_VERSION before materialization.
  The original intake session ID is retained only as an existing audit FK;
  no interactive session is minted or renewed to authorize the worker.
- Sealed staged reference is persisted before submit. STAGED restart uses the
  same reference without another fetch. Lease-expired ACQUIRING becomes explicit
  OUTCOME_UNKNOWN and blocks automatic recollection of that Source.
- `prepareSubmission` accepts the exact command through the existing command
  gateway. Product submit's accepted-command validation is retained; the refresh
  module does not fabricate command/approval authority.
- SUBMITTING restart uses exact submission readback. It never restages or
  automatically resubmits a possibly committed/provider-bearing attempt. Missing
  authoritative submission becomes OUTCOME_UNKNOWN; pending Stage 3 is PENDING,
  never refresh success. Existing Stage 3 recovery owns processing continuation.
- Acquisition failures use safe codes, retain the prior SourceVersion/receipt,
  and retry at most three times with five-minute spacing. Disabled authority is
  locally rechecked after five minutes without a fetch/attempt; a saved STAGED
  reference survives the pause. UNKNOWN outcomes remain held. No AI-semantic
  attempt is consumed by URL acquisition scheduling.

## OSS reuse decisions

| Candidate                                                                       | Pin / license                                          | Decision                        | Scope / exclusion                                                                                                          |
| ------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Shotgun SecureUrlAcquisitionCoordinator, sealed staging, Source Product service | Canonical baseline above                               | AUGMENT existing implementation | Reuse SSRF, DNS pin, redirect/size/media checks, stable Source/version, command and Stage 3 contracts; no new HTTP runtime |
| PostgreSQL 16 existing runtime                                                  | existing pinned deployment/lock authority              | AUGMENT                         | Add one owner-bounded journal; do not replace Source/Evidence schemas or global AI budget authority                        |
| lucasastorian/llmwiki                                                           | `ad626a3d81be1480e35ef4e94234de8dbb27a61e`, Apache-2.0 | REFERENCE_ONLY                  | Existing Watcher/Reconcile reasoning; exclude SQLite/VaultFS/runtime and source IDs                                        |
| garrytan/gbrain                                                                 | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT        | REFERENCE_ONLY                  | Existing durable Job/recovery patterns; exclude full runtime/DB                                                            |
| Standalone TTL-to-SourceVersion/Ask package                                     | none in existing reviewed candidates                   | NO_RELEVANT_OSS                 | Shotgun owns provenance/permissions/readiness semantics; a generic scheduler cannot substitute those contracts             |

Upstream URLs: <https://github.com/lucasastorian/llmwiki> and
<https://github.com/garrytan/gbrain>. Existing Role Matrix license/security/runtime
exclusion decisions are reused; no upstream code was copied, no new dependency
or lockfile pin was introduced, and no unverified OSS/runtime was activated.
Role Matrix update is not an adoption gate change. Replacement boundaries are
the refresh store/authorization ports and existing staging/product ports.

## Format scope audit

| Input                                    | Current actual entry path                                                   | Limit / gap                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Direct text                              | sealed staging → plain-text pipeline                                        | valid UTF-8, 1 MiB                                                                       |
| TXT/MD/PDF/HTML/CSV/DOCX/XLSX/PPTX files | sealed extension/media/signature checks → existing transformer              | 10 MiB; old VP plan saying 1 MiB predates migration 127                                  |
| URL                                      | existing SecureUrlAcquisitionCoordinator                                    | text/plain and text/markdown only, 1 MiB; ordinary HTML page URLs are rejected           |
| PNG/JPEG                                 | Python adapter has image-preflight/BBox and requires multimodal validation  | product file staging currently rejects extensions; not product-enabled                   |
| Audio/video files                        | current format adapter rejects unsupported modes                            | no active timecode/frame path; cannot claim complete from parser/unit evidence           |
| Video URL text                           | stored HTML can extract accessible title/transcript and ignore video binary | current URL MIME boundary prevents ordinary HTML URL intake; no direct audio/frame fetch |

ADR-172/VP plan explicitly calls for later selector-gated VP audio/video scope,
while older Module Phase-1 prose excludes normal Assembly activation. This audit
does not silently equate the older exclusion with VP full-completion: unsupported
entry paths remain explicit unresolved product scope. MIME permissions or
multimodal activation are not changed in this bounded refresh correction.

## Migration, rollback and verification scope

Migration 131 is additive and changes no existing row, SourceVersion, citation,
credential, policy, authority or budget. Rollback disables the new worker and
returns to prior code while retaining the journal for audit; removing the table
requires an explicit backup/restore or approved migration. A Source refresh
success may create a normal new SourceVersion only through the existing product
contract; historical evidence/answer records remain intact.

No production DB/Vault/configuration/environment was changed, no live URL or AI
transport was used and no protected evaluation/Gold/stash was read or modified.
Fake Provider/transport results do not certify live model semantics. Test counts
and runtime wiring evidence are recorded by the parent completion report; this
document alone does not declare VP-08 or full VP COMPLETE.

### Focused verification

- New coordinator/unit/security regression set: new URL-refresh tests plus
  existing Source-read and secure-acquisition tests pass. TypeScript and scoped
  ESLint passed; no threshold/assertion/validator was weakened.
- Isolated full-migration PostgreSQL suite: 5/5 tests pass for unchanged/changed
  versions, old receipt/body preservation, independent-connection claim fencing,
  uncertain acquisition recovery, bounded acquisition failure, concurrent user
  revision rejection and disabled-policy pause/recovery without acquisition.
- Early verification detected a fixture trying to change immutable acquisition
  receipt timestamps. The immutable trigger rejected it; the fixture was
  corrected to create historical fake receipts initially. No trigger was
  disabled and no immutable provenance rule was relaxed.
- The first isolated runner probe failed because its test worker did not inherit
  the PostgreSQL transport shim. The central sanitized runner forwarded the same
  isolated Docker-socket shim to child workers; no host-network permission,
  production database route or environment configuration was enabled.
