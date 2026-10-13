# VP media boundary, offline fidelity and remaining activation conditions

Baseline: Canonical `aba6ff27f9620ee1a3f408f8df81e8aad21cc584`.
Scope: existing active formats, experimental image adapter and explicit unsupported
media handling. This does not activate a new model, OCR, transcription or media
capability; it does not certify AI image/audio/video meaning.

## Actual contracts and reuse

The existing `PythonDocumentFormatAdapter` already owns image integrity checks,
bounded pixels and full-image `BoundingBoxSelector` geometry through Pillow.
`MultimodalValidationPort.describe` is separately required for meaning. Product
sealed staging and the actual Sources Workspace accept TXT/MD/PDF/HTML/CSV/
DOCX/XLSX/PPTX and reject image/audio/video files. The browser file picker and
submit preflight both enforce that supported-extension list; the server
independently enforces filename/media pairing before immutable storage.

The native `DocumentIR` media union includes PNG/JPEG, but `SourceSelector` is
limited to Page, BoundingBox, Cell, Shape, CSS and Markdown-heading selectors.
There is no audio time range, speaker, frame/timecode or transcript-to-media
alignment selector contract. A metadata parser, duration, screenshot or frame
export cannot substitute for grounded media-content Evidence.

| Candidate                                        | Existing exact pin / license                                        | Decision in this work                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Pillow                                           | `12.3.0`, MIT-CMU, existing `requirements.lock` and OSS registry    | Reuse existing ADOPT image preflight/BBox; AUGMENT adapter output validation only                                      |
| PythonDocumentFormatAdapter and Stage 8 pipeline | existing `shotgun.document-formats@1.12.0`                          | Reuse valid transformation shape/identity and all pixel/size/worker limits                                             |
| lucas HTML cleanup and Beautiful Soup            | `ad626a3d81be1480e35ef4e94234de8dbb27a61e`; Beautiful Soup `4.15.0` | Existing EXTRACT/AUGMENT reused for available page/transcript text; no video binary or link-following runtime          |
| ffmpeg                                           | existing Role Matrix DEFER; no adoption pin for Shotgun runtime     | DEFER remains; duration/frame extraction alone cannot satisfy transcription, alignment or semantic-validation contract |
| Tesseract/OCR or speech/vision model             | not adopted by current media contract                               | Not introduced. OCR is explicitly a separate conditional capability in the existing Pillow recheck trigger             |

Official upstreams recorded in the existing review are
<https://github.com/python-pillow/Pillow> and
<https://github.com/lucasastorian/llmwiki>. License/security/maintenance evidence
comes from the current OSS source registry and Stage 8 review, not a new claim
that upstream has no vulnerabilities today. No new package, shared Python
installation, lockfile, environment or OSS-owned authority was added.

## Minimum defect correction

The optional image provider was typed as returning a string but its response
was not runtime-validated before spreading it for the size check. A malformed
response could cause a raw TypeError or unclassified failure. A whitespace-only
description reached the format worker as if it were meaningful content.

The adapter now rejects non-string, absent, empty or whitespace-only responses
from a configured multimodal provider with safe, non-retryable VALIDATION_ERROR
at `validate-image-description`. It preserves valid response text and the
existing 128,000-code-point bound. An entirely absent provider still returns
MULTIMODAL_VALIDATION_REQUIRED. Corrupt or oversized image preflight still runs
before any descriptor call. This is structural validation, not a new image
meaning oracle, confidence gate or production activation.

## Verification and evidence reuse

- New active-media contract: 14/14 PASS. PNG/JPEG/WebP/GIF, MP3/WAV/M4A and
  MP4/WebM/MOV are rejected before storage; declaring text/plain does not activate
  a PNG/MP3/MP4 filename.
- New image response-boundary tests: 9/9 PASS with the existing pixel worker and
  fake descriptor only. Non-string/empty values are safely rejected; absence
  of a provider remains explicitly unconfigured. No real AI call is made.
- Existing Stage 8 format Golden, TS-1 document-format safety and XLSX pipeline
  contracts were reused: 37/37 PASS. With the new 14 support negatives, that run
  passed 51/51. Existing tests cover corrupt-image no-provider behavior, pixel
  BBox, size/cardinality bounds, selectors, immutable XLSX bytes, translation
  separation and adapter replacement.
- These fixtures are authored structural examples. Their passing does not
  create independent semantic Gold, calibrated confidence, complete document
  recall or actual model image accuracy.

## Coverage map and honest residuals

| Dimension                      | Available concrete evidence                                                                                     | Residual                                                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Location                       | PDF Page/BBox, HTML CSS, DOCX paragraph CSS, XLSX/CSV Cell, PPTX Shape/BBox, experimental image full-pixel BBox | Audio/timecode/frame selectors and alignment are unimplemented                                                             |
| Numeric/table/formula fidelity | Stage 8 table cells and formula text; reviewed PDF geometry tests and prior finance marker reports              | Not independently adjudicated whole-source omission/semantic accuracy; arbitrary scans/complex equations remain unverified |
| Conditions/time/negation       | Active text retains original strings; parent HTML URL fixture includes condition/unit/date and secure cleanup   | There is no approved universal semantic classifier proving all such meanings are preserved                                 |
| Image                          | Validated dimensions/hash, bounded decode and explicit multimodal-required behavior                             | Product image intake and an authorized meaning-provider/provenance path are not activated                                  |
| Audio/video                    | Explicit unsupported product intake; HTML transcript text can be ingested as an ordinary text source            | Binary content interpretation, transcription, speaker/time alignment and frame citations remain unimplemented              |
| Historical model quality       | Prior multi-format live report records 10 fixture answers with exact uploaded-version selectors over two runs   | Candidate examples, variable claim/call counts and unreconciled billing; no automatic Gold/certified quality promotion     |

The prior [multi-format live report](../vp-stage8-multiformat-live-verification-2026-10-02.md)
is preserved as scoped historical evidence. Its former 1 MiB observation does
not replace current migration 127's 10 MiB file limit. It did not certify
image/audio/video product support.

## Exact requirements before broader media activation

1. For images, an explicitly authorized multimodal provider/model and egress path
   must implement the existing meaning gate, with durable response/provenance and
   grounded-answer tests. A fake descriptor or pixel parser is insufficient.
2. For audio/video, a versioned media/transcript/frame selector and immutable
   original-to-derived mapping contract is required. Generated transcript or
   description text must not be silently represented as raw original text or
   objective Fact.
3. Parsing/transcription dependencies require an exact pin, license/security and
   worker-resource review, replacement tests and representative fidelity corpus.
4. The user directive allows active supported formats plus clear unsupported
   handling. This closes that negative boundary, not the plan's later media
   activation requirements. No whole VP-08/VP completion claim follows.

No migration is needed for the response guard. Rollback reverts that guard and
its tests; existing SourceVersions, prior transformation bytes, descriptor
strings, frozen evaluations and production authorities remain untouched.
