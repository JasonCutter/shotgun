# VP-04 — Evidence context for relation decisions (2026-10-01)

**Status: bounded implementation and focused verification complete; VP-04/05 remain open.**

## Problem and contract

The finance source-fidelity review identified that the relation adapter received only the normalized claim text. A relation decision could therefore omit context recorded in the exact EvidenceSpan attached to that claim.

`DecisionProviderPort@1.2.0` now accepts optional `evidenceContext` and `evidenceContextTruncated` fields. The PostgreSQL relation-job adapter reads the quote only when its project, source, SourceVersion, Evidence ID, access scope, and sensitivity match the current assertion. Quotes over 2,000 Unicode characters are cropped around the claim and visibly marked as truncated. Quotes identical to the claim are omitted to avoid duplicate prompt tokens.

The worker passes the bounded context to both provider adapters. Prompts treat claim and quote as untrusted source data, never as instructions, and tell the model not to infer a missing condition from a truncated excerpt. The durable request digest includes both context and truncation state. The exact source Evidence and existing egress policy remain authoritative; a model decision still passes the current Shotgun policy before it can be recorded.

## OSS Integration Decision

- Existing PostgreSQL and `evidence.spans` behind `VPRelationJobStorePort`: `AUGMENT`.
- Existing DeepSeek provider and `DecisionProviderPort`: `AUGMENT`.
- `garrytan/gbrain`, pinned reference commit `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT: `REFERENCE_ONLY`; no runtime/schema is imported.
- No separate OSS package provides the required Shotgun-owned SourceVersion, Evidence, and access-scope checks: `NO_RELEVANT_OSS`.
- No new dependency, migration, provider egress class, or OSS-owned identifier was added. Rollback is a code and policy revision revert; existing append-only ledger records remain auditable.

## Verification

- General AI, Jev, relation worker, and router tests: 24 tests passed.
- PostgreSQL relation-priority suite: all 10 tests passed, including retrieval of the matching EvidenceSpan quote, the 2,000-character bound, and truncation flag. Replay, retry, lease recovery, provider uncertainty, queue prioritization, and candidate recall tests also passed.
- Live browser flow with an isolated PostgreSQL database and DeepSeek: two Markdown sources completed intake, relation processing, cited Ask, and projection replay. The relation was `EQUIVALENT` at 0.95; the answer cited both sources; replay matched; four provider calls used 2,665 total tokens. This is a synthetic two-source product-flow case, not full-PDF quality evidence.
- Actual DeepSeek `deepseek-flash` request for finance v1.2 `finance-discount-rate-present-value`: `EQUIVALENT`, allowed candidate label; HTTP 200; 854 input and 73 output tokens; provider latency 861 ms. The prompt included a short source excerpt transcribed from the user-provided PDF. The corpus remains `CANDIDATE`, not independently adjudicated.
- No provider billing ledger readback was available. The isolated database test confirms the exact authorized Evidence quote reaches the decision port, and the adapter contract test confirms that quote is sent in the model prompt; the live browser flow confirms the real provider completes the relation and Ask path. Together these do not establish full-document extraction fidelity, independent relation quality, or actual billed cost.

## Remaining VP-04/05 work

This change does not establish extraction precision/recall for the whole finance PDF, independent labels for the candidate corpora, broad multi-document agreement/conflict/supersession quality, safe candidate-pair reduction, large-queue retry cost, or actual provider billing reconciliation. Keep the production relation policy conservative and the VP-04/05 tracker entries open.
