# Frontend Phase 2 Section 1 Migration Candidate Revision 2 — Stage 2 Compatibility Amendment

- Record ID: `frontend-phase-2-section-1-migration-approval-candidate-revision-2-stage2-compatibility-amendment-260730001`
- Date: 2026-07-30
- Parent Candidate:
  `frontend-phase-2-section-1-migration-approval-candidate-revision-2-260730001.md`
- Normative Appendix:
  `frontend-phase-2-section-1-migration-approval-candidate-revision-2-ddl-appendix-260730001.md`
- Status: **NORMATIVE / REVIEWED**
- Migration SQL creation or execution: **NOT YET APPROVED**

This Amendment resolves the remaining compatibility conflict with Migration 002.
It controls when it differs from the Parent Candidate or DDL Appendix.

## 1. Confirmed existing Stage 2 limits

Migration 002 currently permits:

```text
channel:
  direct_text
  file_upload

material_kind:
  plain_text

media_type:
  text/plain
  text/markdown

size_bytes:
  1 through 1,048,576
```

The same two channel values are enforced on `asset.storage_receipts`.
Representing a URL acquisition as `file_upload` would falsify Intake provenance
and is prohibited.

## 2. Exact compatible Channel expansion

Migration 020 broadens only the existing Channel checks:

```text
direct_text
file_upload
url_acquisition
```

The final constraints are exactly equivalent to:

```sql
ALTER TABLE intake.submissions
  DROP CONSTRAINT submissions_channel_check;

ALTER TABLE intake.submissions
  ADD CONSTRAINT submissions_channel_check
  CHECK (channel IN ('direct_text', 'file_upload', 'url_acquisition'));

ALTER TABLE asset.storage_receipts
  DROP CONSTRAINT storage_receipts_channel_check;

ALTER TABLE asset.storage_receipts
  ADD CONSTRAINT storage_receipts_channel_check
  CHECK (channel IN ('direct_text', 'file_upload', 'url_acquisition'));
```

Before dropping either constraint, preflight must verify through `pg_constraint`
that the current relation, name and definition match Migration 002. An unknown or
already modified definition stops Migration 020 instead of being overwritten.

This is a compatibility expansion, not a V1 removal. Existing Direct Text and
File writers continue unchanged.

The shared Stage 2 contract and adapters add the exact value:

```text
url_acquisition
```

No Browser input may directly choose the internal Stage 2 channel. The Sources
Coordinator derives it from the accepted Product Item kind.

## 3. Section 1 supported body boundary

Migration 020 does not broaden Stage 2 material, media-type or size constraints.
Until a separate approved expansion exists, the Server descriptors and all three
Sources input modes advertise and enforce only:

```text
material_kind = plain_text
media_type = text/plain | text/markdown
size_bytes <= 1,048,576
```

Consequences:

- Direct Text above 1 MiB is rejected with typed `TOO_LARGE` validation.
- File input outside Plain Text/Markdown or above 1 MiB is rejected before
  Command acceptance.
- URL acquisition may retrieve only an accepted Plain Text/Markdown response
  whose compressed body and decompressed body each remain within separately
  configured limits not exceeding 1 MiB.
- Unsupported URL content type is recorded as a safe failed provenance Receipt;
  it does not create Stage 2, OriginalAsset or SourceVersion rows.
- Redirect headers do not count as accepted body bytes, but header and total
  limits remain independently enforced.

The DDL Appendix statement that decompressed limit must not be below compressed
limit is removed. These are independent upper bounds. Both must be positive and
must not exceed 1,048,576 for Section 1 activation.

A future larger-file or additional-format capability requires a separate
contract, impact review and Migration approval. It is not silently enabled by
Migration 020.

## 4. URL Stage 2 binding

A successful URL Item is persisted through the existing owners with:

```text
intake.submissions.channel = url_acquisition
asset.storage_receipts.channel = url_acquisition
material_kind = plain_text
media_type = validated text/plain or text/markdown
stage2 submission ID = Product submission_item_id::text
```

A failed or cancelled URL acquisition creates Product Attempt and safe URL
Receipt records only. It does not create a Stage 2 Submission or StorageReceipt.

## 5. Additional required tests

Migration and implementation evidence must include:

- Migration 002 database upgraded to the expanded Channel checks;
- existing `direct_text` and `file_upload` inserts unchanged;
- valid `url_acquisition` insert accepted only through the Sources Coordinator;
- unknown channel still rejected;
- URL response over 1 MiB rejected before Stage 2 persistence;
- unsupported URL media type recorded as safe failure;
- no URL path stored as `file_upload`;
- repeated Migration execution leaves the final constraint definition unchanged;
- preflight stops on a conflicting pre-existing Channel constraint.

## 6. Approval package effect

The complete Revision 2 package is now:

1. Revision 2 Final Candidate;
2. Normative DDL Appendix;
3. this Stage 2 Compatibility Amendment.

Migration SQL creation and execution remain prohibited until explicit user
approval of the complete package.
