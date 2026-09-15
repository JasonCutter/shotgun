# RUS-2-C3 Existing Source Candidate Re-extraction Product Control

## Scope

This correction adds an owner-only, Source Detail contextual control for rerunning
Candidate extraction against an existing, Evidence-ready SourceVersion. The browser
can submit only `sourceId` and `sourceVersionId`; the server derives the active
Project, Principal, membership, Source security context, current AI resolver, and
standing policy. The accepted Product command dispatches the existing
`ReextractCandidateMaterialization.v1` Stage 4 command with a server-derived request
identity. It does not create a Source or SourceVersion, replay `EvidenceIndexed`,
write Candidate/Comparison/Review rows directly, or write Canonical data.

The control is unavailable while the selected version is still running or has no
usable sentence Evidence. A failed configuration/provider resolution is surfaced as
a safe Product error; it does not fall back to another provider or configuration.

## OSS integration decision

`NO_RELEVANT_OSS` for this Product mutation, authorization boundary, and Source Detail
control. The reviewed references provide no reusable implementation that can own
Shotgun's server-derived Project/Principal/security/policy authority or the existing
Stage 4 command contract. They remain reference material only:

| Candidate     | Repository and pinned review                                                          | Decision for C3  | Reason                                                                                         |
| ------------- | ------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------- |
| gbrain        | https://github.com/garrytan/gbrain · `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`       | `REFERENCE_ONLY` | Retry/idempotency patterns are informative; its Runtime and DB are excluded.                   |
| llmwiki       | https://github.com/lucasastorian/llmwiki · `ad626a3d81be1480e35ef4e94234de8dbb27a61e` | `REFERENCE_ONLY` | Evidence/reconcile patterns are informative; the Source and Stage 4 boundary is Shotgun-owned. |
| llm-wiki      | https://github.com/ddsyasas/llm-wiki · `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`     | `REFERENCE_ONLY` | Action UX is informative; its backend and LLM client are not integrated.                       |
| OpenKnowledge | https://github.com/inkeep/open-knowledge · `f2834c237639e2cff603817ed88182b33f83cf91` | `REFERENCE_ONLY` | Visual review patterns are informative; no runtime or Canonical model is adopted.              |

No new OSS package, lockfile entry, license review, or security exception is
introduced. Existing Stage 4 AI SDK/structured-output decisions remain governed by
`stage-4-oss-integration-review.md`.

## Contract and rollback

- Frontend command: `sources.candidate.reextract.v1`, schema `1.0.0`.
- Product response: `SourceCandidateReextractView`, schema `1.0.0`, status `ACCEPTED`.
- Same `clientRequestId` replays the same command-ledger outcome and Stage 4 request;
  a new explicit retry receives a new command/request identity and extraction epoch.
- No database migration is required. Rollback is the normal branch/PR rollback; the
  existing Source, SourceVersion, Evidence, and prior Candidate lineage remain
  intact.

## Verification

The focused contract, Product API, Stage 4, and Source Detail tests cover:

- owner authorization, cross-Project masking, unknown identity masking, and missing
  sentence Evidence;
- browser rejection of provider/model/credential authority fields;
- unavailable current AI resolver with zero provider calls;
- exact SourceVersion reuse, one logical replay, distinct retry epoch, and no new
  Source/Evidence;
- contextual button visibility, one protected API call, pending double-submit guard,
  success feedback, refresh without resubmission, and hidden technical identifiers.

The full test and CI evidence will be attached to the C3 PR before review.
