# Offline OriginalAsset → frame/duration producer proof

2026-10-13; isolated `codex/vp-media-completion` development under the
[full execution directive](./execution-directive.md). This adds an inactive
offline prototype; ADR-088 and the Role Matrix's production `DEFERRED` decision
remain in force. It does not activate product media intake, a catalog entry,
ASR, a new AI model, a SourceMap, an EvidenceSpan, or a knowledge authority.

## Reuse decision before implementation

The existing [media audit](./media-boundary-audit.md),
[alignment foundation](./media-alignment-foundation.md), Phase 2 ADD, ADR-088,
Module Architecture ADD, Role Matrix and OSS Integration/DoD records were the
starting evidence. The demonstrated missing component was an actual bounded
OriginalAsset-to-frame producer, not another selector definition.

| Candidate                                                                                                                                      | Decision and boundary                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [FFmpeg upstream](https://github.com/FFmpeg/FFmpeg) / [official download suppliers](https://ffmpeg.org/download.html)                          | `AUGMENT` for isolated offline prototype only. Reuse actual FFmpeg/ffprobe CLI decode, PNG encode and PTS reporting behind a replaceable `OfflineMediaRunner`. Production remains `DEFERRED`.                                       |
| [Gyan Windows builds](https://www.gyan.dev/ffmpeg/builds/) / [exact supplier release](https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2) | Exact 9.0.2 essentials binary selected; publisher checksum independently matched downloaded ZIP. This is an official-download-listed third-party supplier, not an FFmpeg-authored binary or a reproducible-build attestation.       |
| Existing Python/Pillow adapter                                                                                                                 | Retain its image meaning/preflight boundaries; no transcriber or frame decoder supplied. No new Python runtime or image meaning substitution.                                                                                       |
| Existing gbrain/lucas/ddsyasas/OpenKnowledge scope                                                                                             | Reuse Shotgun's existing OriginalAsset/SourceVersion boundaries and immutable generated binding contracts. Their reviewed document/UX/runtime parts do not provide this FFmpeg decoder. No duplicated backend or runtime authority. |

Only Shotgun-specific integrity, bounds, generated coverage and transport policy
are directly implemented. The codec, container and PNG implementation is reused
from FFmpeg. The Port is the adapter-local replaceable `OfflineMediaRunner`;
replacement is covered by the deterministic fake CLI contract and real binary
proof. The Role Matrix is not rewritten to imply production adoption.

Exact lock: `adapters/media-frame-ffmpeg-offline/runtime.lock.json`.

- Upstream tag: `n9.0.2`; tag object `ce8f11b9fac4cd7ccfb41ca7c01bc17f5cda8cc3`;
  source commit `946fcce07b6dcd0331c8cc609192aeff5e1924f8`.
- Supplier release published `2026-09-20T06:40:33Z`; dated release selection,
  not an unfixed branch or `latest` URL.
- [Exact ZIP](https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip)
  SHA256 `60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba`.
- `ffmpeg.exe` SHA256 `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec`;
  `ffprobe.exe` SHA256 `f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52`.
- Supplier identifies all these static builds as GPLv3; executed `-version`
  confirmed `--enable-gpl --enable-version3 --enable-static`. Upstream's
  [license explanation](https://ffmpeg.org/legal.html) distinguishes optional
  GPL parts from the LGPL base. No binary is committed or shipped by this change.
- [Upstream security history](https://ffmpeg.org/security.html) and maintained
  release/download records were inspected. This does not assert that all bundled
  libraries have passed a security audit or that no vulnerability remains.
  Production distribution needs exact corresponding-source/license obligations,
  dependency security review and an isolation deployment decision.

## Actual implementation and limits

`FfmpegOfflineMediaAdapter.extract` receives local immutable byte contents plus
the existing caller-authorized project/source/version/OriginalAsset pins. It
copies bindings and bytes before awaiting, compares exact byte length and SHA256,
and checks supported magic/MIME pairs: MP3, WAV, MP4 and WebM. Hash matching proves
integrity; access authorization remains the existing caller's responsibility.

The actual runner checks an absolute local runtime directory, executable
containment/symlinks and the pinned executable hash on each invocation. It copies
the command, permits only the adapter's exact fixed CLI templates and bounded
integer frame selectors, passes an argv array with `shell:false` and
`windowsHide:true`, and sends no inherited provider credentials. Input and output
are pipe-only. `-protocol_whitelist pipe` excludes local files and network
protocols; an exact `-format_whitelist` and `-f` exclude playlists. MOV additionally
sets `-enable_drefs 0 -use_absolute_path 0`. No caller path, URL, CLI flag, filter,
playlist, external source, hardware decoder or unlimited extraction is accepted.

Budgets: input 10 MiB; duration 120 s; decoded frame metadata 4096 entries;
sampled frames 16; stream count 8; dimension 4096; pixels 4,194,304; probe stdout
1 MiB; PNG stdout 8 MiB each/32 MiB aggregate; stderr 64 KiB; each process 15 s;
single decoder/encoder thread; FFmpeg `-max_alloc 16 MiB` per allocation. The
latter is not an OS-enforced total process memory cap. No media temporary files
are created. The owned proof runtime is outside the checkout at
`C:/dev/artifacts/vp-full-completion-2026-10-12/media-frame-runtime/` and does not
alter PATH or install a global package.

Video metadata validates original dimensions before frame decoding. Every
decoded frame's actual `pts`/`pts_time` must agree with `time_base`, original
dimensions, declared duration, and strictly increasing millisecond positions.
No index/FPS timestamp approximation is used. Nonzero starting timestamps,
non-1/N time bases, ambiguous duplicate/submillisecond positions, excessive
decoded counts and unusual stream layouts are explicitly unsupported. PNG
signature/IHDR dimensions and exact generated byte hashes are checked against
the pinned decoder output; this is not an independent PNG semantic oracle.

Audio duration uses available container metadata. For nonseekable WAV without
declared duration it derives duration from bounded decoded sample counts and
contiguous actual audio PTS/sample rate. It does not transcribe, identify speakers
or assert that metadata describes any meaning.

The `offline-media-manifest/1.0.0` result preserves source pins, OriginalAsset
identity, exact generator commit, original size, complete bounded frame count,
sampled PNG bytes/hash/dimensions/actual PTS and explicit unsampled count.
`generated-frames-and-metadata`, `semanticStatus:UNVERIFIED`, `audioTranscribed:false`
and `fullMediaMeaningVerified:false` remain explicit even when all selected frames
decode. Sparse frames can be supplied to the inactive `media-alignment/1.0.0`
contract after selecting its six frame fields; sparse coverage never means complete
media meaning or authoritative original text.

## Executed proof and regression

Run with the existing sanitized, credential-free developer runner:

```powershell
node C:/dev/artifacts/vp-full-completion-2026-10-12/test-runner.cjs vitest run tests/unit/media-frame-ffmpeg-offline.test.ts tests/integration/media-frame-ffmpeg-offline.test.ts --reporter=dot
```

32/32 PASS: 28 deterministic replacement/boundary cases and four actual binary
integration cases. The integration suite uses only the explicit owned runtime;
it skips when that runtime is absent and never downloads or finds PATH binaries.
An absent-runtime skip must not be reported as actual media proof.

- Actual generated 64×48 variable-rate MP4: four frames at actual PTS 0, 100,
  400 and 900 ms. Samples 0,1,3 preserve timestamps, dimensions and PNG hashes;
  repeated extraction is byte/manifest identical, with one unsampled frame.
- Actual generated 440 Hz WAV: decoded duration 1250 ms, zero video frames,
  explicit no-transcription declaration.
- Actual corrupt MP4: safe non-retryable `FORMAT_CORRUPT`.
- Actual process stdout limit: one-byte output budget kills/rejects the pinned
  process with safe non-retryable `VALIDATION_ERROR`.
- Contract negatives: original digest/length/MIME/identity, immutable snapshot,
  CLI injection/remote URL/filter, duplicate/out-of-range sampling, source
  geometry/time/streams, malformed/oversized JSON, empty/oversized decoded count,
  wrong/reversed PTS, wrong PNG signature/dimensions and absent selected frame.

The current media selector/support regression adds 59 passing cases, for 91/91
with zero skips in this owned-runtime run. Persisted machine-readable evidence:
`C:/dev/artifacts/vp-full-completion-2026-10-12/media-frame-proof-tests.json`.
Reviewable synthetic MP4/WAV, PNGs and manifests are in
`C:/dev/artifacts/vp-full-completion-2026-10-12/media-frame-runtime/ffmpeg-9.0.2-essentials_build/proof/`.

These authored synthetic fixtures establish structural/integrity and replacement
behavior. They do not constitute independent semantic Gold, image-description
accuracy, ASR quality or a representative codec/media Golden corpus.

## Rollback and remaining Gate

No schema migration, operating DB/Asset write, provider call or active adapter
registration occurs. Rollback removes this inactive adapter/tests/lock/report;
the owned extracted binary directory may be removed after verifying its exact
artifact path. Existing active formats and media rejection are preserved.

The isolated producer closes the executable frame/duration prototype gap.
Product activation, full-media semantic grounding/transcription, persistent
derived asset authority and egress/provenance, production isolation and GPL
distribution/security acceptance remain open. This report does not declare
VP_FINAL_ACCEPTANCE_COMPLETE or audio/video production support.
