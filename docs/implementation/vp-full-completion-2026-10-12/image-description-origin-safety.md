# Image description origin safety correction

Date: 2026-10-13. Scope: the existing inactive Python image adapter seam; no
image/audio/video product activation, live provider call or migration.

## Defect and correction

The existing image handler accepted an optional model-generated string,
constructed DocumentIR from that string, and inherited the plain-text
transformer's `origin: source` for document, paragraph and sentence nodes. Its
bounding box correctly returned to the image, but that geometry and a successful
text round-trip did not make the generated wording a literal original quotation.
Direct wiring to the normal Evidence pipeline could therefore issue source
Evidence for an AI description.

`PythonDocumentFormatAdapter` 1.13.0 assigns **every** image SourceMap entry,
including the root, `origin: annotation`. Generated text, positions, exact text
hashes, image hash and pixel bounding box remain intact. The existing SourceMap
hash is recomputed. No new origin, Evidence type, semantic authority or storage
schema is introduced. Non-image converters keep their existing source origin.

The version change isolates new transformations from 1.12.0 cache identity.
Existing TransformationRevision, Evidence and audit records are not rewritten.
It also changes the adapter identity for non-image transformations; their
conversion algorithm is unchanged. No automatic re-extraction is triggered.

## Existing authority boundaries remain restrictive

`buildEvidenceCandidates` accepts only `origin: source`, so annotation-only image
output creates no original Evidence. `ListEvidenceSpans` retains its existing
`NOT_FOUND` behavior when no Evidence exists. The `EvidenceIndexed` success
contract requires a positive count; an annotation-only transformation cannot
publish that success notification. No assertion or schema is relaxed to pretend
that image grounding is ready.

A negative test publishes a schema-valid, positive-count notification against
the empty Evidence repository. The real Candidate Generation module rereads
the exact revision, rejects the absence of sentence Evidence at `load-evidence`,
and creates no provider attempt or Candidate. The test notification is an
adversarial fixture, not a successful grounding record.

The normal Sources staging allowlist and provider usable-capability catalog
continue to exclude images. Raw audio/video analysis remains outside the
Canonical Shotgun Assembly scope. Native image transport preparation does not
authorize egress or certify generated interpretation. Connecting image-derived
observations to Ask still requires explicit provenance, durable authorized
execution, and a user display that distinguishes generated observation from
original quotation; this patch does not claim that integration is complete.

## Reuse and rollback

The correction augments the existing Shotgun-owned Python document adapter and
SourceMap/Evidence boundary. It reuses Pillow **12.3.0**, MIT-CMU, already pinned
in `requirements.lock` and the OSS Source Registry, for complete image decoding
and dimensions. The existing Lucas text locator extraction remains pinned to
`ad626a3d81be1480e35ef4e94234de8dbb27a61e`, Apache-2.0, behind
`EvidenceLocatorPort`. No dependency, lockfile, decoder, worker, model, prompt or
policy changes. License/security/maintenance decisions remain those of the
existing reviewed components; no new OSS runtime is introduced.

Rollback may revert this adapter patch while retaining all revision history,
but must keep image intake inactive. Re-enabling the old string-to-source
Evidence path would restore the defect. There is no operating data migration
or destructive rollback step.

## Verification

Focused tests use a Fake image description with the real locked Python/Pillow
worker. They verify original PNG byte/hash preservation, 320x180 pixel bounds,
all three annotation node kinds, exact position/hash round-trips, no original
Evidence, positive-count notification rejection before provider/Candidate, and
unchanged CSV source origin. Existing format, input safety, malformed model
output, Markdown and active unsupported-media tests are retained. Standard
timeouts and assertion strength remain unchanged.

The first focused run exposed incorrect new test expectations: an empty Evidence
query is `NOT_FOUND` and a zero-count success notification fails its existing
schema. Those guards were preserved; the tests now assert their actual contract.
The initial failed log is retained alongside the corrected verification output.
These are structural safety checks, not independently validated image meaning
or certified Gold accuracy.

Corrected scoped run: **74 PASS, 0 FAIL, 0 SKIP** across the six named unit and
contract files, one worker, unchanged standard timeouts. Focused ESLint passed.
Evidence: `image-annotation-focused-corrected.log` and
`image-annotation-lint.log` in the owned VP full-completion artifact directory.
The pre-correction failed run remains `image-annotation-focused.log`.
