# Existing DeepSeek model native image transport preparation

Date: 2026-10-13. State: **OFFLINE_TRANSPORT_VERIFIED / PRODUCT_ACTIVATION_PENDING**.

The [official DeepSeek Vision documentation](https://api-docs.deepseek.com/guides/vision/), checked on this date, states that the existing `deepseek-flash` model accepts images in user content blocks. The earlier inference that another model would necessarily be needed for images is therefore too broad. Provider-native support and Shotgun's current usable-capability catalog remain separate. This work does not add a model, change that catalog or enable a production image path.

## Implementation and reuse

The existing DeepSeek HTTP adapter, response/status mapping, cancellation/deadline and usage parsing are reused. No new SDK, dependency or alternative runtime is introduced. A separate prepared `generateImageStructured` method accepts only pinned PNG/JPEG inline bytes for `deepseek-flash`. Existing text generation emits exactly the same payload and response shape; relation v6, its schema/prompt and 0.9 gate are untouched.

Image transport verifies canonical base64, byte signature, declared content SHA-256, nonempty batches of at most4 images, per-image10MiB, total20MiB and serialized envelope32MiB. No external image URL or Files API is used. Complete image decoding/pixel bounds remain the existing Python/Pillow preflight's responsibility; a signature check alone does not certify safe decoding, image meaning or the caller's access rights.

The method captures model/signal before execution. Already-cancelled input makes no request; returned model identity must match the captured model even if the caller mutates its object during the call. Missing/mismatching identity or malformed JSON is rejected after one call without an internal retry or text-only model fallback. Missing provider usage remains undefined.

The detached response adds `deepseek-inline-vision-v1`, exact request-body digest and immutable image hashes. These bind the observed transport; they do not authenticate a provider, authorize egress or independently certify generated text. Credentials must still be supplied through the existing captured execution authority, and the future caller must persist durable outcome/provenance rather than replay an uncertain call.

## Focused verification

Fake HTTP only: new native-image21 tests plus existing A6 connectivity/settings19 tests **40 PASS**. The empty/oversized batch fixture was corrected to pass actual arrays to Vitest instead of unpacked array rows; original failure/initial test output remains in local artifacts. Tests cover correct user-only bytes, hash/pin/MIME/model mismatch, no URL/file references, empty/oversized requests, model identity mutation, cancellation, malformed response, missing usage and unchanged text requests. No real key, provider call or operating policy was used.

Independent review then reproduced two failures at the configured per-image boundary:
the nested base64 regex raised `RangeError: Maximum call stack size exceeded` for
both a canonical 10 MiB envelope and one byte above the limit. The allowed image
failed before HTTP; the oversized image bypassed the intended structured validation
error. The original failing run is preserved in
`C:/dev/artifacts/vp-full-completion-2026-10-12/native-image-base64-prefix-failure.log`.
Validation now uses linear alphabet scanning, explicit multiple-of-four and trailing
padding checks, and the unchanged canonical decode/re-encode equality and byte/hash
limits. It accepts the pinned 10 MiB transport fixture through fake HTTP and rejects
the oversized image, internal/extra padding and whitespace with zero egress.
The synthetic envelope test does not replace complete image decoding.

After correction, native-image **26/26** and existing A6 **19/19** tests PASS;
media alignment unit/contract and preparation unit/integration regressions also PASS
in the same isolated run. Targeted ESLint and formatting PASS. The corrected review
log is `C:/dev/artifacts/vp-full-completion-2026-10-12/media-native-base64-corrected-review.log`.

## Remaining product boundary

A subsequent negative test reproduced a sparse-array gap: `Array.map` skipped
missing image slots and allowed a fake HTTP call containing null content blocks.
The adapter now captures the bounded batch length and visits every own slot;
all-sparse and sparse-suffix batches fail before any HTTP request. Existing
content/hash/MIME/envelope limits remain unchanged. Native28 plus preparation26
tests pass (54 total, including the owned real decoder); original two failures
remain `native-image-sparse-failure.log`, correction `native-image-sparse-corrected.log`.

The current usable-capability catalog and intake continue to reject images. Legacy string descriptions must not be silently promoted to literal original text or objective Fact. Media alignment, source/analysis provenance, bounded producer, actual authorized execution persistence, user display and source-grounded image quality still require integration/verification. The inactive transport is a concrete reusable prerequisite, not image/audio/video product acceptance.

Rollback removes the prepared method/types and tests; existing text transport and persisted data remain unchanged. Relevant OSS decision: AUGMENT existing pinned adapter/protocol; no new production adoption. FFmpeg/transcription decisions remain separate.
