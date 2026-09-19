# TS-1 Phase B0 — Design Freeze

- Issue: `#346 — TS-1 Document Format Boundary Hardening`
- Status: `DESIGN_ONLY / AUTHORIZED`
- Effective base: `main@cc6a01b4c7182340cc561c54823b1e35456663ec`
- Design branch: `codex/ts1-document-format-boundary-hardening`
- Design revision: `shotgun.document-formats@1.1.0` (implementation target)
- Date: 2026-09-18

This document is the implementation contract for Phase B. It is not Product
implementation. B0 makes no database, public-contract, launcher, or worker
runtime change. The implementation may start only after GPT review of this
design.

## 1. Scope and non-goals

Phase B owns only the confirmed TS-1 boundary:

```text
immutable asset bytes
  -> bounded Python worker
  -> format extraction and PDF segmentation
  -> private selector enrichment
  -> DocumentIR/SourceMap mapping
  -> direct transformation cardinality guard
  -> Evidence-compatible revision
```

It does not change Canonical, Review, Discovery, AI semantics, approval,
Stage 4 candidate generation, URL acquisition, CAS lifecycle, or transaction
outcome handling. Stage 4 N+1 reads and AI-context batching remain TS-3.

The existing invariant remains mandatory:

```text
one Python worker block == one DocumentIR paragraph
```

The correction changes what a PDF worker block represents; it does not move
paragraph ownership into `DocumentIR`, `Evidence`, or a second runtime.

## 2. Boundary and OSS decisions

The existing Stage 8 OSS review remains the authority. No new production OSS
is introduced in B0 or required by the implementation contract.

| Candidate / component                    | Decision                          | Pinned basis and boundary                                                                                                                                                 |
| ---------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pdfplumber`                             | `ADOPT` / adapter-local `AUGMENT` | `0.11.10`, already pinned in `adapters/document-format-python/requirements.lock`; retain word geometry and add deterministic line/region grouping in the Shotgun adapter. |
| `python-docx`                            | `ADOPT`                           | `1.2.0`, already pinned; retain paragraph/table-cell extraction and add preflight before parser entry.                                                                    |
| `openpyxl`                               | `ADOPT`                           | `3.1.5`, already pinned; retain cell/formula/sheet extraction and add preflight before parser entry.                                                                      |
| `python-pptx`                            | `ADOPT`                           | `1.0.2`, already pinned; retain shape/BBox extraction and add preflight before parser entry.                                                                              |
| Beautiful Soup / Pillow / Python CSV     | `ADOPT`                           | Existing locked versions and existing adapter boundaries remain unchanged except for shared caps.                                                                         |
| `lucasastorian/llmwiki` locator patterns | `EXTRACT` / existing `AUGMENT`    | Existing `@shotgun/lucas-text-locator` and plain-text adapter remain behind the Port; no SQLite, VaultFS, MCP, or runtime DB is introduced.                               |
| `PyMuPDF`                                | `REJECT` for this boundary        | ADR-088 excludes its AGPL license from the default Assembly.                                                                                                              |
| Docling / Tika / MarkItDown              | `DEFER`                           | Existing Stage 8 review keeps them as re-evaluation candidates only. Re-evaluation requires a Golden Corpus decision; it is not a silent fallback.                        |

The custom PDF grouping is direct adapter code because the current proof
requires page-local, multi-region selectors and a stable private segment
contract. `pdfplumber.extract_text_lines()` is retained as a comparison/oracle
option in the implementation tests, but it does not by itself define the
required column, paragraph, and selector contract. This is not a new public
schema or a replacement runtime.

## 3. Fixed safety and scale constants

These are defaults, not hidden library settings. Tests inject smaller values to
exercise every failure path. A future increase requires a new benchmark and
design review; it must not be an automatic upgrade.

| Constant                              |             Default | Purpose and rationale                                                                                                                      |
| ------------------------------------- | ------------------: | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `WORKER_DEADLINE_MS`                  |            `30_000` | Gives a valid 10 MiB personal-knowledge document a bounded parse window; the Phase A external 4 s harness remains the fast test injection. |
| `WORKER_STDOUT_MAX_BYTES`             |  `16 * 1024 * 1024` | Bounds JSON result and normalized source duplication while allowing more than the 10 MiB raw intake limit for selector-bearing JSON.       |
| `WORKER_STDERR_MAX_BYTES`             |   `1 * 1024 * 1024` | Diagnostics must be useful but cannot become a second unbounded output channel.                                                            |
| `WORKER_CLEANUP_GRACE_MS`             |               `250` | Allows normal process-tree termination before forceful escalation.                                                                         |
| `WORKER_CLEANUP_DEADLINE_MS`          |             `2_000` | The runner does not settle a failed attempt until tree termination and child close have been observed or cleanup is reported terminal.     |
| `WORKER_MAX_ADDRESS_SPACE_BYTES`      | `768 * 1024 * 1024` | OS-level secondary containment for parser object graphs; large enough for the locked libraries and 128 MiB OOXML expansion, still finite.  |
| `WORKER_MAX_CPU_SECONDS`              |                `25` | POSIX CPU limit leaves room inside the 30 s wall deadline for cleanup.                                                                     |
| `ZIP_MAX_ENTRIES`                     |             `4_096` | Prevents central-directory and member-count amplification while covering ordinary Office packages.                                         |
| `ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES`    | `128 * 1024 * 1024` | Caps actual expanded bytes before a heavy Office parser sees the archive.                                                                  |
| `ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES`    |  `32 * 1024 * 1024` | Prevents one XML/media member from dominating the parser.                                                                                  |
| `ZIP_MAX_COMPRESSION_RATIO`           |               `100` | Rejects zip-bomb-like members; stored entries have ratio 1.                                                                                |
| `OFFICE_MAX_WORKSHEETS`               |               `100` | Bounds sheet object and iteration fan-out for personal knowledge use.                                                                      |
| `OFFICE_MAX_LOGICAL_ITEMS`            |            `50_000` | Maximum combined non-empty paragraphs, table cells, spreadsheet cells, or shapes before worker emission.                                   |
| `PDF_MAX_PAGES`                       |             `1_000` | Page geometry and parser object bound independent of raw bytes.                                                                            |
| `HTML_MAX_TRACKED_BLOCKS`             |            `50_000` | Bounds CSS path construction and round-trip validation.                                                                                    |
| `WORKER_MAX_BLOCKS`                   |            `50_000` | Shared output cardinality guard for all eight formats.                                                                                     |
| `WORKER_MAX_SELECTORS_PER_BLOCK`      |                `16` | Supports page+region and several physical segments without allowing selector fan-out to dominate JSON.                                     |
| `WORKER_MAX_TOTAL_SELECTORS`          |           `100_000` | Bounds SourceMap selector materialization.                                                                                                 |
| `TRANSFORM_MAX_NORMALIZED_UTF8_BYTES` |  `32 * 1024 * 1024` | Bounds the joined text before Lucas normalization and DocumentIR duplication.                                                              |
| `TRANSFORM_MAX_SOURCEMAP_ENTRIES`     |           `200_000` | Bounds root + paragraph + sentence Evidence amplification; the Phase A large PDF is 2,305 entries.                                         |
| `IMAGE_MAX_DESCRIPTION_CODE_POINTS`   |           `200_000` | Prevents an external multimodal description from bypassing worker text limits.                                                             |

Limits are applied before parser use where possible, while worker output and
post-normalization limits remain secondary guards. A valid but over-limit input
fails deterministically with `FORMAT_CORRUPT`, `retryable=false`; dropping
Evidence or silently truncating text is forbidden.

## 4. Shared worker runner contract

`adapters/document-format-python/src/index.ts` will replace the current
`runWorker()` with an injected `BoundedWorkerRunner` implementation. The public
`DocumentTransformerPort`, `DocumentIR`, `SourceMap`, and Evidence contracts do
not change.

### 4.1 Request and output handling

1. Validate the request object and content-base64 length before spawn. The
   immutable asset byte/hash checks remain owned by Intake/Original Asset.
2. Spawn Python directly, with `stdio: ['pipe', 'pipe', 'pipe']` and
   `windowsHide: true`; do not invoke a shell.
3. Start one wall timer before writing stdin. Write the JSON request once and
   close stdin. An `EPIPE` is recorded as a worker failure, not retried inside
   the runner.
4. Count stdout and stderr as bytes from `Buffer` chunks. Never concatenate an
   unbounded string. Once either ceiling is exceeded, stop accepting more
   output, mark the terminal cause, and begin process-tree cleanup.
5. Parse JSON only after a clean close and only from the bounded stdout buffer.
   The parser accepts the exact private discriminated result shape:
   `status: OK, blocks[]` or one of the existing typed error statuses with a
   string message.
6. Validate every `OK` block: non-empty string `text`, selectors array,
   selector shapes, optional segment ranges, selector and block limits, and
   exact integer/code-point range invariants. Unknown fields are ignored only
   inside the private result; unknown status or missing required fields fails
   closed.
7. Validate typed worker errors before mapping them to `ShotgunError`. A
   worker result is never trusted merely because `JSON.parse()` succeeded.

### 4.2 Single settlement and cancellation race

The runner has one `settled` flag and a single `settle(outcome)` function. The
function clears the wall timer, detaches data listeners, closes stdin if still
open, and resolves/rejects exactly once. `error`, `close`, timeout, output
overflow, abort, and cleanup callbacks all call this function; late events are
ignored. The `close` event, not `exit`, is the final child-stream boundary.

An injected `AbortSignal` enters the same cleanup path. Explicit cancellation
returns `TIMEOUT` with `retryable=false`; a deadline expiry returns `TIMEOUT`
with `retryable=true` so the durable job policy may make one bounded retry.
No retry is performed inside the runner.

### 4.3 Process-tree termination

`child.kill()` alone is not accepted.

- Windows: keep the direct child PID and invoke the built-in
  `taskkill.exe /PID <pid> /T /F` on timeout, overflow, abort, or malformed
  output. The runner awaits both the taskkill result and the child `close`.
  Where the host permits a Windows Job Object, the worker bootstrap also joins
  the current process to a Job Object with
  `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`; the Job Object is defense in depth,
  not a reason to skip `taskkill /T`.
- POSIX: spawn detached, send `SIGTERM` to the process group (`kill(-pid,
'SIGTERM')`), wait `WORKER_CLEANUP_GRACE_MS`, then send `SIGKILL` to the
  group if it still exists. The direct child is also signalled as a race
  fallback. `kill(-pid, 0)` and the `close` event are used for reaping
  confirmation.
- All platforms: if tree termination cannot be confirmed by
  `WORKER_CLEANUP_DEADLINE_MS`, reject with `TERMINAL_FAILURE`, record the PID
  and cleanup diagnostic, and do not report a successful transformation. The
  integration test must prove the failure is visible rather than leaving a
  silent orphan.

Normal successful close does not kill a process that has already exited. A
failed path always follows: mark cause → stop stdin/output listeners → request
tree termination → wait for child close → verify no process group/tree remains
→ settle.

### 4.4 Constructor and test injection

The runner constructor accepts:

- executable, worker path, and limits;
- `spawn` implementation;
- clock/timer functions;
- platform process-tree terminator;
- optional `AbortSignal`.

Production defaults are the constants in §3. Tests inject a short deadline,
small output ceilings, fake terminator, and fixture workers. No test uses an
unbounded real child as its only proof. The process-tree integration test runs
on Windows and POSIX with platform-appropriate assertions.

## 5. Child resource and memory exhaustion

Timeout and output ceilings are secondary containment only. They do not protect
against a parser that allocates a large object graph before producing output.

The implementation uses three layers:

1. **OS/process layer.** The Python worker attempts `resource.setrlimit()` for
   `RLIMIT_AS=768 MiB` and `RLIMIT_CPU=25 s` on POSIX. On Windows, a small
   stdlib `ctypes` bootstrap creates a Job Object with process-memory limit
   `768 MiB` and kill-on-close. If a host forbids Job Object assignment (for
   example, a nested job policy), the worker records the capability as
   unavailable and continues only with the parser preflight/caps below; it
   does not claim that timeout is an equivalent memory limit.
2. **Archive/parser layer.** OOXML central-directory validation and bounded
   member scans occur before `python-docx`, `openpyxl`, or `python-pptx` is
   imported or given the archive. PDF pages/words, HTML tracked tags, CSV
   cells, and Office logical items are capped before output is emitted.
3. **Parent runner layer.** The Node runner enforces wall time, byte ceilings,
   shape validation, and process-tree termination. It catches a worker killed
   by an OS resource limit and maps that outcome to a non-retryable
   `FORMAT_CORRUPT` resource-boundary failure when the cause is known.

Residual risk is native-library allocation before a parser can observe a
logical cap, and hosts where Windows Job Objects or POSIX rlimits are denied.
The archive scan and logical caps close the known Office expansion path; the
residual host risk is surfaced as `TERMINAL_FAILURE`/operational evidence, not
silently treated as a successful parse. No large process-management dependency
is required.

## 6. OOXML preflight

For DOCX, XLSX, and PPTX, `worker.py` runs `safe_ooxml_preflight(data,
media_type)` before importing the heavy parser.

1. Open the archive with Python stdlib `zipfile.ZipFile` and inspect the central
   directory. Reject invalid metadata, unsupported compression methods, a
   directory with duplicate names, duplicate member paths, NUL bytes, absolute
   paths, drive-qualified paths, or any path containing a `..` component after
   slash normalization.
2. Reject encrypted members (`flag_bits & 0x1`). Reject more than 4,096 total
   entries, more than 128 MiB declared total uncompressed bytes, more than 32
   MiB for one member, or a member compression ratio over 100:1. A zero-byte
   compressed member is checked without division by zero.
3. Stream every non-directory member through `ZipFile.open()` in 64 KiB chunks
   before the heavy parser. Count actual bytes and fail as soon as per-member
   or total actual expansion crosses the same caps. This catches misleading
   headers and validates CRC/decompression errors. The scan does not retain
   decompressed members in memory; the parser reopens the original bounded
   archive after the scan.
4. Inspect XML members with a bounded streaming counter. Enforce the common
   `OFFICE_MAX_LOGICAL_ITEMS` and format-specific limits: DOCX paragraphs plus
   table cells, XLSX worksheets and non-empty cells, and PPTX slides plus text
   shapes. Reject as soon as a count crosses its limit; never materialize a
   giant list just to count it.
5. Only after all checks pass import and call the existing format library.
   Preflight failure returns `FORMAT_CORRUPT`, `retryable=false`, with a safe
   message that identifies the violated boundary but never exposes archive
   contents.

The scan is deterministic and uses no temporary Product DB or Canonical data.
The double-read cost is intentional: a valid archive is safer to reject before
the object-graph parser than to rely on declared ZIP sizes or library defaults.

## 7. PDF segmentation

`pdf_blocks()` will emit semantic paragraph blocks, not words. It uses the
locked `pdfplumber` word geometry as the source of truth and preserves page
local physical regions without a giant union rectangle.

### 7.1 Word and line reconstruction

For each page, reject pages over `PDF_MAX_PAGES` and call
`page.extract_words(use_text_flow=False, keep_blank_chars=False)`. Normalize
each word to text, `x0/x1/top/bottom`, and page number. Sort with the stable
key `(top, x0, bottom, originalIndex)`.

Use median word height `h` for the page. Assign a word to the existing line
with the smallest vertical-center distance when both conditions hold:

- vertical overlap is at least 50 percent of the smaller word/line height; and
- center distance is at most `max(2 pt, 0.5 * h)`.

Otherwise start a new line. Ties use the earlier line index. Within a line,
sort by `(x0, x1, originalIndex)` and join words with a deterministic spacing
rule: no inserted space before `,.;:!?)]}` or after `([{`; one space otherwise.
Each line has its own `PageSelector` and `BoundingBoxSelector` from the exact
word extents. No line BBoxes are unioned into a paragraph selector.

### 7.2 Reading-order regions and paragraphs

Build a vertical projection from line boxes. A candidate column gap is a
horizontal gap of at least `max(18 pt, 4 * median line height)` that persists
across at least two line bands and has no line crossing the gap. Split regions
at those gaps; if no candidate persists, the page is one region. A line that
crosses a candidate gap stays in the containing region and prevents a split.
Regions are ordered left-to-right by `(x0, x1)`.

Within each region, lines are ordered top-to-bottom. Consecutive lines form
one paragraph when their vertical gap is no greater than
`max(1.75 * median line height, 2 * median positive inter-line gap)` and their
horizontal overlap/indentation is compatible. A larger gap, a clear first-line
indent change, or a new region starts a new paragraph. Paragraphs never cross
regions or pages. Page order is always ascending, then region order, then
line order.

Each paragraph emits one `WorkerBlock` whose `text` is the normalized line
texts joined by one space and whose private segments contain one entry per
source line:

```text
segment.start/end = Unicode code-point offsets in the normalized block text
segment.selectors = [PageSelector, line BoundingBoxSelector]
```

Thus a multiline paragraph has several exact physical selectors, a two-column
page is read column-by-column without crossing the gap, and a page boundary is
visible as separate blocks. A one-word PDF paragraph is emitted as one genuine
one-word block; word-per-paragraph is not a fallback for normal content.

The implementation tests the existing Golden PDF, multiline, two-paragraph,
multicolumn, multipage, large-valid, corrupt, and encrypted fixtures. A line
or region that cannot be placed deterministically fails `FORMAT_CORRUPT`
instead of silently inventing a giant BBox.

## 8. Private worker result and provenance mapping

The private result extends the current internal `WorkerBlock` only:

```ts
type WorkerSegment = {
  readonly start: number;
  readonly end: number;
  readonly selectors: readonly SourceSelector[];
};

type WorkerBlock = {
  readonly text: string;
  readonly selectors: readonly SourceSelector[];
  readonly segments?: readonly WorkerSegment[];
};
```

`start` is inclusive and `end` exclusive in Unicode code points, relative to
the normalized block text. Non-PDF units emit one segment `[0, textLength]`
with the block selectors: DOCX paragraph/cell, XLSX/CSV cell, PPTX shape,
HTML element, and image description. This preserves sentence provenance as
far as the native physical unit permits without changing the public contract.

The Node adapter builds block offsets while joining blocks with `\n\n`:

```text
blockStart[0] = 0
blockStart[n+1] = blockStart[n] + unicodeLength(block.text) + 2
```

For each paragraph or sentence SourceMap entry, convert its global position to
the containing block-relative range. Select every segment satisfying
`segment.end > localStart && segment.start < localEnd`. Preserve segment order,
then selector order; remove duplicates by `stableJson(selector)`. A sentence
spanning multiple PDF lines receives all overlapping line selectors. A
sentence spanning a page/region boundary receives selectors from each
boundary segment; it never receives a union BBox.

The paragraph entry receives all distinct selectors from all segments in its
block. A sentence with no matching segment is a `FORMAT_CORRUPT` mapping
failure for PDF; for non-PDF legacy output without `segments`, it falls back
to the one whole-block segment. The root document entry remains selector-less.

This keeps the current public `SourceSelector[]` contract. No new public
selector type, `packages/contracts/src/document-evidence.ts` change, or
Evidence module change is required. Exact text positions, quote/hash, and
SourceVersion ownership remain generated by the existing Lucas adapter and
validated by Evidence.

## 9. Cardinality and amplification guards

The guard order is:

1. Worker input/archive/parser preflight.
2. Worker result byte and shape validation.
3. `WORKER_MAX_BLOCKS`, selectors-per-block, and total-selector checks.
4. UTF-8 byte check on the normalized `blocks.join("\\n\\n")` text.
5. Existing Lucas transformation.
6. `TRANSFORM_MAX_SOURCEMAP_ENTRIES` and final mapping validation before a
   revision is handed to the transformation repository.

The exact failure is `FORMAT_CORRUPT`, `retryable=false`, with one of the
stable internal reasons `WORKER_RESULT_LIMIT`, `NORMALIZED_TEXT_LIMIT`, or
`SOURCEMAP_LIMIT`. The reason is diagnostic only; it is not a new public
ErrorCode. Evidence is never dropped to make a limit pass. The same limits
apply to replay of the same transformer version, so a retry cannot change the
result.

HTML keeps its existing tracked-element/CSS `nth-of-type` extraction. Phase A
proved cardinality cost, not a semantic CSS defect. TS-1 therefore adds the
shared block/selector/text bounds and validates each CSS round trip, but does
not rewrite selectors or duplicate nested HTML semantics. A future HTML
selector algorithm requires its own Golden Corpus decision.

## 10. Error contract

| Failure                                 | ErrorCode                        | Retryable                          | Contract decision                                                             |
| --------------------------------------- | -------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------- |
| Wall deadline                           | `TIMEOUT`                        | `true` for a bounded durable retry | A transient resource contention may succeed; the runner itself never retries. |
| Explicit abort                          | `TIMEOUT`                        | `false`                            | Caller cancellation must not restart work.                                    |
| Stdout overflow                         | `FORMAT_CORRUPT`                 | `false`                            | Result cannot fit the bounded extraction contract.                            |
| Stderr overflow                         | `FORMAT_CORRUPT`                 | `false`                            | Diagnostic channel is unsafe/unbounded; input is not silently accepted.       |
| Invalid JSON                            | `FORMAT_CORRUPT`                 | `false`                            | Worker result is untrusted.                                                   |
| Invalid result shape/ranges             | `FORMAT_CORRUPT`                 | `false`                            | Closed-schema failure; no partial blocks are used.                            |
| Unexpected non-zero exit                | `TERMINAL_FAILURE`               | `false`                            | Indicates a worker/runtime defect rather than a user-correctable format.      |
| Known OS resource-limit kill            | `FORMAT_CORRUPT`                 | `false`                            | The bounded input exceeded the parser resource profile.                       |
| Process-tree cleanup not confirmed      | `TERMINAL_FAILURE`               | `false`                            | Never claim successful cleanup or transformation.                             |
| Missing Python executable/configuration | `CONFIGURATION_REQUIRED`         | `false`                            | Operator configuration must be repaired.                                      |
| Unsafe OOXML expansion/cardinality      | `FORMAT_CORRUPT`                 | `false`                            | Deterministic safety rejection before heavy parsing.                          |
| PDF parse/segmentation failure          | `FORMAT_CORRUPT`                 | `false`                            | Existing format failure semantics retained.                                   |
| Encrypted/password-protected file       | `FORMAT_ENCRYPTED`               | `false`                            | Existing format failure semantics retained.                                   |
| Unsupported media type                  | `FORMAT_UNSUPPORTED`             | `false`                            | Existing format allow-list retained.                                          |
| Missing image semantic validation       | `MULTIMODAL_VALIDATION_REQUIRED` | `false`                            | Existing explicit-validation policy retained.                                 |

No new public ErrorCode is justified. `ShotgunError` carries the stable code;
safe messages do not expose archive paths, source content, or process command
arguments.

## 11. Exact implementation file plan

### Product adapter files expected in Phase B

1. `adapters/document-format-python/src/index.ts`
   - bounded runner, injected limits/terminator, typed worker-result validation,
     process-tree cleanup, private segment-to-SourceMap mapping, final guards,
     transformer identity `1.1.0`.
2. `adapters/document-format-python/worker.py`
   - early OS resource bootstrap, OOXML preflight, format logical caps, PDF
     line/region/paragraph reconstruction, private segments, bounded image
     description handling.

### Test files expected in Phase B

3. `tests/unit/stage-8-format-expansion.test.ts`
   - existing Golden regression plus green assertions for paragraph and
     sentence selector fidelity.
4. `tests/unit/ts1-document-format-boundary.test.ts` (new)
   - focused runner, process-tree, OOXML preflight, PDF segmentation,
     provenance, cardinality, and error-contract tests.
5. `tests/proofs/ts1-phase-a-red-proof.test.ts`
   - retain Phase A evidence; amend only the expected post-fix assertions when
     Phase B implementation is authorized.
6. `tests/proofs/ts1-phase-a5-boundary-investigation.test.ts`
   - retain the Phase A.5 boundary measurements; add only replacement-proof
     assertions if the implementation changes the measured contract.

No fixture needs to be committed for generated PDFs; the existing temporary
fixture builders remain bounded by an external harness timeout. A new fixed
fixture is allowed only if it improves the Golden Corpus and is documented in
the test file.

### Files explicitly not planned for Phase B

- `adapters/plain-text-lucas-augmented/src/index.ts`: unchanged; its
  deterministic paragraph/sentence and Unicode-code-point contract remains the
  normalization authority.
- `packages/contracts/src/document-evidence.ts`: unchanged; existing
  `SourceSelector[]` already supports multiple physical regions.
- `modules/transformation/src/index.ts`: unchanged; adapter guards execute
  before `repository.save`, and the Port/module/event shape remains compatible.
- `modules/evidence/src/index.ts`: unchanged; it continues to validate and
  copy selector arrays and must not become a late amplification filter.
- `db/migrations/`: unchanged.
- `requirements.lock`: unchanged; no new dependency is required.

## 12. Test matrix and gates

The Phase B implementation is not complete until the following RED→GREEN
matrix passes with Contract, Golden, Security, and Adapter Replacement gates:

| Area               | Required cases                                                                                                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker containment | hang; stdout overflow; stderr overflow; invalid JSON; malformed shape; non-zero exit; stdin error; timeout/close race; explicit abort; cleanup race; process-tree cleanup on Windows and POSIX.                         |
| OOXML safety       | excessive entries; declared total; actual total; per-entry size; compression ratio; duplicate/path traversal/encrypted/invalid metadata; valid DOCX/XLSX/PPTX regressions.                                              |
| PDF                | Golden; multiline single-column; two paragraphs; multicolumn order; multipage page-locality; large valid; corrupt; encrypted; no column-gap union over-coverage.                                                        |
| Provenance         | paragraph selector fidelity; sentence selector fidelity; sentence across multiple lines; multiple selector deterministic ordering/deduplication; page/region boundary; non-PDF whole-unit fallback; root selector-less. |
| Scale              | HTML; DOCX; XLSX; CSV; PPTX; PDF; PNG/JPEG; block/text/SourceMap/selector ceilings.                                                                                                                                     |
| Regression         | all existing Stage 8 Golden Corpus tests; Stage 3 plain-text Golden/Contract tests; adapter replacement test; Evidence round-trip and negative tests.                                                                   |

Risky parser and child-process tests always use a harness timeout and assert no
residual Python process. No test writes Product DB data except an explicitly
disposable isolated test database if a later integration test proves it is
needed.

## 13. DB, contract, and transformer version impact

- DB migration: **NO**. Existing JSON `document_ir` and `source_map` columns
  already store selector arrays.
- Public contract version: **NO**. `DocumentIR`, `SourceMap`, `EvidenceSpan`,
  and `DocumentTransformed` remain at their existing versions.
- Transformer identity: **YES**, bump
  `shotgun.document-formats` from `1.0.1` to `1.1.0` because PDF segmentation,
  selector propagation, and safety boundaries change deterministic output.
- Plain-text identity: **NO**, remains `shotgun.plain-text@1.0.1`.
- Old revisions: remain readable and queryable by their stored identity. They
  are not rewritten in place.
- Reprocessing: `1.1.0` does not reuse a `1.0.1` revision. The same
  SourceVersion and `1.1.0` identity is idempotently reused if its stored
  hashes match; otherwise the repository rejects a conflicting result under
  the existing transformation integrity rule.
- Event compatibility: `DocumentTransformed@1.0.0` continues to carry the
  transformer id/version and hashes; no event migration is required.

## 14. Rollback

The rollback unit is the adapter/worker implementation change plus its focused
tests and transformer identity bump. Reverting it requires no DB migration,
Canonical repair, Asset repair, or approval-state repair.

Revisions created under `shotgun.document-formats@1.1.0` remain valid after
rollback because they use the existing public SourceMap selector types. The
rolled-back `1.0.1` adapter ignores the private worker segments (which are not
persisted) and can continue reading old and new stored revisions. A later
reprocess under `1.0.1` creates or reuses the old identity; it never overwrites
the `1.1.0` revision. If a defect is found, quarantine the new transformer
version operationally and reprocess only after a corrected version is reviewed.

## 15. TS-3 cross-reference and residual risks

TS-1 supplies bounded sentence cardinality and more faithful physical
selectors. TS-3 remains responsible for replacing Stage 4's per-sentence
`GetEvidenceSpan` fan-out, batching AI context, and bounding candidate-generation
durable work. TS-1 must not modify those modules.

Residual risks after this design:

- OS memory/process limits may be unavailable in restricted hosts; parser and
  archive caps then become the known containment boundary and cleanup failures
  remain terminal.
- PDFs with unusual reading orders, tables, scans, or semantic layout not
  represented by geometry may remain lossy; Golden Corpus expansion is required
  before adopting another parser.
- Valid Office files above the safety profile are rejected rather than
  truncated. Raising limits requires benchmark evidence.
- HTML nested tracked elements can still produce overlapping text by the
  existing semantic policy; TS-1 bounds it but does not redesign it.

## 16. B0 safety confirmation

- Product source change: **none**
- DB/schema change: **none**
- Commit: **none**
- Push: **none**
- PR: **none**
- Launcher/release/tag change: **none**
- Four user-owned verification documents: preserved
- Launcher quarantine file: preserved
- Current branch: `codex/ts1-document-format-boundary-hardening`
- Current HEAD: `cc6a01b4c7182340cc561c54823b1e35456663ec`

STOP for GPT review. Do not implement Phase B from this document until GPT
authorizes the next formal step.

---

# TS-1 Phase B0.1 — Design Correction

**Date:** 2026-09-18

**Issue:** #346 — TS-1 Document Format Boundary Hardening

**Status:** DESIGN/EVIDENCE ONLY — `B0 NOT APPROVED / CORRECTION REQUIRED`

**Effective base:** `cc6a01b4c7182340cc561c54823b1e35456663ec`

**Branch:** `codex/ts1-document-format-boundary-hardening`

This addendum supersedes any conflicting B0 statement below it. It records the
corrections required by the GPT B0 review. It does not authorize Product
implementation, commit, push, PR, DB migration, or release work.

## 17. Revision-scoped Evidence authority

### 17.1 Evidence found in the connected boundary

The coexistence concern is confirmed, not hypothetical:

- `transformation.revisions` has a unique key on
  `(project_id, source_version_id, transformer_id, transformer_version)`, so
  transformer `1.0.1` and `1.1.0` revisions for one SourceVersion are valid
  simultaneous rows.
- `evidence.spans` is already keyed for reuse by
  `(project_id, revision_id, pointer)`, and each row stores `revision_id`.
- `PostgresEvidenceRepository.listBySourceVersion()` currently filters only
  `project_id + source_version_id`. `InMemoryEvidenceRepository` has the same
  source-only filter. Both can therefore return both revision sets.
- `ListEvidenceSpans@1.0.0` accepts only `sourceVersionId`.
- `EvidenceIndexed@1.0.0` already carries the authoritative `revisionId` and
  `sourceVersionId`.
- `modules/candidate-generation/src/index.ts` currently reduces the event to
  `{ sourceVersionId }`, calls source-level `ListEvidenceSpans`, and therefore
  discards the available revision authority before candidate generation.
- The complete production caller set for `ListEvidenceSpans` is currently
  `modules/candidate-generation/src/index.ts`; the Evidence module itself is
  the provider. The other inspected production consumers use `GetEvidenceSpan`
  by explicit `evidenceId`, not the list query.
- The current source-level query is useful for an explicit historical/general
  read, but it is not safe as the continuation input for a specific
  `EvidenceIndexed` revision.

### 17.2 Minimum safe design

Choose **B: add a revision-scoped query and preserve the source-level query**.
The new query is:

`ListEvidenceSpansByRevision@1.0.0`

with input:

```json
{
  "revisionId": "<uuid>",
  "sourceVersionId": "<uuid>"
}
```

Both fields are required. `revisionId` is the authority; `sourceVersionId`
is a consistency guard. The Evidence module must reject or return NOT_FOUND if
the stored revision does not belong to the supplied SourceVersion. The
repository port becomes:

```ts
listByRevision(
  projectId: string,
  revisionId: string,
  sourceVersionId: string,
): Promise<readonly EvidenceSpan[]>;
```

The PostgreSQL query must include all three predicates:

```sql
WHERE project_id = $1
  AND revision_id = $2
  AND source_version_id = $3
ORDER BY (position ->> 'start')::integer, pointer
```

The in-memory adapter must apply the same three predicates and ordering. The
existing source-level `ListEvidenceSpans` remains available for an explicit
source-level read and historical inspection, but its manifest documentation
and tests must state that it is not an authority-preserving continuation
query.

Candidate Generation must:

1. retain `revisionId` from `EvidenceIndexed`;
2. query `ListEvidenceSpansByRevision` with both IDs;
3. assert every returned Evidence item has the exact requested revision and
   SourceVersion before any sentence filtering or `GetEvidenceSpan` calls;
4. include `revisionId` in the candidate-materialization idempotency key and
   any internal batch identity, so a `1.0.1` batch cannot suppress a `1.1.0`
   batch for the same SourceVersion;
5. preserve each returned Evidence item's `revisionId` in the existing
   `GenerateStructured` evidence items. No new AI authority is invented.

The existing `GetEvidenceSpan` by ID remains an explicit historical read. It
must continue to return a `1.0.1` Evidence span when the caller supplies its
historical ID; no latest-revision selection, `created_at` ordering, or
transformer-version ordering is allowed.

### 17.3 Public contract consequence

The previous B0 conclusion of “public contract version NO” is corrected. An
**additive public query contract is required**:

- add `packages/contracts/schemas/list-evidence-spans-by-revision.v1.schema.json`;
- add the corresponding module contract and query name in the Evidence module;
- add the same dependency contract to Candidate Generation;
- retain `list-evidence-spans.v1.schema.json` unchanged for the legacy/general
  source-level read.

This does not require a DB migration because `revision_id` is already a
primary key in `evidence.spans`; the existing row data is sufficient. A
revision-specific index may be considered only after a bounded query plan
measurement; correctness does not depend on a new index.

### 17.4 Cross-version RED proof

The mandatory proof is a disposable in-memory or isolated PostgreSQL contract
test, not a Product database write:

1. save one SourceVersion through transformer `1.0.1` and index its Evidence;
2. save the same SourceVersion through transformer `1.1.0` and index a second
   Evidence set;
3. prove both revisions and both Evidence sets coexist;
4. publish `EvidenceIndexed` for only the `1.1.0` revision;
5. prove Candidate Generation receives only `1.1.0` sentence Evidence and that
   no `1.0.1` ID is sent to `GetEvidenceSpan` or `GenerateStructured`;
6. query the old revision explicitly and prove its Evidence remains readable;
7. prove a source-level list cannot be used by the Candidate Generation route.

This test must cover both `PostgresEvidenceRepository` and
`InMemoryEvidenceRepository` parity, with PostgreSQL guarded by the existing
isolated database target rule.

## 18. Coherent resource and amplification budget

The B0 limits `stdout=16 MiB` and `normalized text=32 MiB` were inconsistent.
The corrected budget has one authoritative transport ceiling and derives the
downstream ceilings from the current Stage 4 sentence fan-out. Until TS-3
replaces that fan-out, the budget is intentionally conservative and rejects
large valid inputs instead of truncating text or dropping Evidence.

| Boundary                              |           Corrected default | Authority and rationale                                                                        |
| ------------------------------------- | --------------------------: | ---------------------------------------------------------------------------------------------- |
| Raw immutable input                   |                      10 MiB | Existing Intake contract; unchanged.                                                           |
| Maximum worker stdout / JSON result   |                       8 MiB | First hard worker result boundary; includes JSON, text, selectors, and segment metadata.       |
| Maximum worker stderr                 |                       1 MiB | Diagnostic bound; overflow is terminal and never returned verbatim.                            |
| Normalized UTF-8 text                 |                       4 MiB | Must fit inside the 8 MiB result budget with structural overhead; replaces unreachable 32 MiB. |
| Worker blocks / DocumentIR paragraphs |                         512 | Bounds paragraph and downstream Evidence fan-out before normalization is persisted.            |
| Sentence SourceMap nodes              |                         512 | Direct bound for the current Stage 4 per-sentence work.                                        |
| SourceMap entries                     |                       1,025 | Derived, not independent: `1 document + 512 paragraphs + 512 sentences`.                       |
| Total deduplicated selectors          |                      16,384 | Bounds selector storage while allowing multi-region PDF provenance.                            |
| Image description                     | 128,000 Unicode code points | Prevents a provider response from consuming the complete text budget.                          |

The authoritative rejection order is:

1. image preflight or OOXML central-directory/parser-object preflight;
2. worker result byte ceiling (8 MiB) and strict JSON shape validation;
3. block count and total selector budget;
4. normalized UTF-8 text budget;
5. Lucas paragraph/sentence construction;
6. sentence-node and derived SourceMap-entry budget;
7. only then `repository.save` / Evidence indexing.

The relationship is deliberately explicit:

```text
P <= 512
S <= 512
E = 1 + P + S <= 1,025
Stage-4 sentence reads <= 512 before TS-3
```

The guard fails with `FORMAT_CORRUPT`, `retryable=false`. It never truncates
text, drops a selector, or indexes a partial Evidence set. The 512 sentence
budget is a temporary safety envelope, not a promise that Stage 4 is scalable;
TS-3 must remove the current N+1 read/context coupling before this envelope is
raised.

The 8 MiB worker ceiling and 4 MiB normalized-text ceiling are now coherent:
the latter is reachable, and the former still leaves room for JSON and
selector metadata. Base64 input expansion remains separate from worker result
budget: a 10 MiB raw input is at most approximately 13.34 MiB of Base64 before
request-envelope overhead and is never copied into the worker result.

## 19. Corrected PDF selector budget

`MAX_SELECTORS_PER_BLOCK=16` is removed. The budgets are separated:

| PDF provenance unit                   | Default |
| ------------------------------------- | ------: |
| Physical segments per paragraph block |     128 |
| Selectors per segment                 |       4 |
| Deduplicated selectors per paragraph  |     256 |
| Deduplicated selectors per document   |  16,384 |

The usual line segment contains a `PageSelector` and one exact line
`BoundingBoxSelector`; the four-selector allowance permits a region marker or
future compatible structural selector without changing the public schema.
Paragraphs with 17–128 physical line/region segments are valid. A paragraph
that exceeds 128 segments or a document that exceeds the total budget is
rejected as `FORMAT_CORRUPT`; it is not collapsed into a giant union box and
is not silently reduced to word-per-block output.

Selectors are ordered by page, region/column reading order, top, x, and stable
source index, then deduplicated by stable JSON. A sentence receives every
segment that overlaps its normalized code-point range. Page and region
boundaries remain explicit; a sentence crossing a boundary receives multiple
selectors and never a union rectangle covering the gap.

## 20. HTML scale correction

The current implementation has three per-element costs:

- `find_previous_siblings(current.name)` scans prior same-name siblings;
- `css_path()` repeats that scan for every ancestor of every tracked tag;
- `soup.select_one(selector)` re-queries the complete document for every
  tracked tag.

A bounded benchmark against the unchanged worker, with an external 15-second
harness timeout, measured:

| Tracked `<p>` elements | Worker wall time | Result           |
| ---------------------: | ---------------: | ---------------- |
|                     50 |           347 ms | completed        |
|                    120 |           782 ms | completed        |
|                    300 |         5,691 ms | completed        |
|                    600 |       >15,000 ms | external timeout |

The timed-out harness left no Python process. This confirms that
`HTML_TRACKED_BLOCKS=50,000` cannot be retained with the current algorithm.

Choose **A: deterministic selector construction without redundant whole-
document lookup**:

1. perform one deterministic tree walk after the existing removal policy;
2. keep a per-parent/per-tag sibling ordinal while walking;
3. cache each tag's path segment and parent path in a `WeakMap`/equivalent
   internal map;
4. construct the same `tag:nth-of-type(n) > ...` CssSelector from cached
   ordinals in O(nodes + tracked-elements × path-depth), without calling
   `find_previous_siblings` for every element;
5. remove production `soup.select_one` verification for every element;
6. keep independent Golden tests that call `select_one` on every small Golden
   element and on a bounded representative sample of the scale fixture.

The public `CssSelector` shape and existing nested-element extraction policy
remain unchanged. The post-redesign cap is `HTML_TRACKED_BLOCKS=512`, shared
with the coherent paragraph budget, and it is accepted only after a bounded
benchmark proves completion under the 8 MiB/512-block contract. Before that
implementation lands, the current 600-element path is evidence only and no
production cap is claimed to be safe.

## 21. Image pre-multimodal safety

The current ordering is confirmed as unsafe for decompression-bomb scale:

```text
contentBase64 → MultimodalValidationPort.describe() → Python worker
```

The corrected ordering uses the same `document-format-python` worker boundary
as a metadata-only preflight; it does not create a second image authority:

```text
contentBase64 + expected immutable hash
  → bounded image-preflight worker mode
  → MultimodalValidationPort.describe()
  → bounded final image worker mode
```

Before `describe()` the preflight must:

- validate PNG/JPEG signature and actual decoded format;
- compute and compare the immutable `sha256:` content hash;
- read dimensions with Pillow verification;
- reject width or height above 8,192 pixels;
- reject total pixels above 25,000,000;
- treat Pillow decompression-bomb warnings/errors as deterministic
  `FORMAT_CORRUPT`;
- return only `{format,width,height,pixels,contentHash}` and never an image
  description or pixel buffer.

The 25 MP limit keeps a worst-case RGBA working surface near 100 MiB before
library/provider overhead, remains above the 8.3 MP 4K class, and is well below
the 768 MiB child memory budget. The 8,192 dimension cap catches extreme
single-axis images even when the pixel product is below the cap. The existing
320×180 Golden PNG remains comfortably inside the bound.

The final worker revalidates the same bytes and expected hash, but it does not
replace the preflight authority. A rejected image causes zero calls to
`MultimodalValidationPort.describe()`.

## 22. Expanded OOXML parser-object preflight

Central-directory checks remain before importing `python-docx`, `openpyxl`, or
`python-pptx`. The corrected package limits are:

| Package/parser object                               |             DOCX |                         XLSX |                    PPTX |
| --------------------------------------------------- | ---------------: | ---------------------------: | ----------------------: |
| ZIP members                                         |            2,048 |                        2,048 |                   2,048 |
| Declared and actual decompressed package bytes      |           64 MiB |                       64 MiB |                  64 MiB |
| One member decompressed bytes                       |           16 MiB |                       16 MiB |                  16 MiB |
| Compression ratio                                   |            100:1 |                        100:1 |                   100:1 |
| Relevant XML elements                               |          250,000 |                      500,000 |                 500,000 |
| Paragraphs / actual worksheet rows / slides         | 8,192 paragraphs |                  50,000 rows |              128 slides |
| Table cells / actual `<c>` cells / shape-tree nodes |     16,384 cells | 50,000 actual `<c>` elements | 20,000 shape-tree nodes |
| Relationships/media members                         |            1,024 |                        1,024 |                   1,024 |
| Emitted logical text blocks                         |              512 |                          512 | 512 text-bearing shapes |

The current Golden package measurements are DOCX 22 members/24,331 XML bytes/
354 XML elements, XLSX 9 members/16,795 XML bytes/359 elements, and PPTX 39
members/40,773 XML bytes/983 elements. The limits are therefore materially
above the verified corpus while remaining far below unrestricted parser
allocation.

The preflight must stream member bytes in bounded chunks, reject duplicate,
NUL, absolute, drive-qualified, traversal, encrypted, invalid, or unsupported
entries, and count actual XML elements before the heavy library is imported.
For XLSX, declared worksheet dimensions are informational only: actual
`<row>`, `<c>`, shared-string, and relationship counts are authoritative. For
DOCX, count paragraphs, table cells, relationships, and media. For PPTX, count
slides, all shape-tree nodes (not only text shapes), relationships, and media.
Exceeding any package or parser-object limit is `FORMAT_CORRUPT`,
`retryable=false`, before parser construction.

## 23. Timeout and retry authority

The retry investigation found two different authorities:

- `packages/job-runtime/src/index.ts` and `PostgresJobRuntime` default to a
  bounded three-attempt retry policy for a `ShotgunError` whose `retryable` is
  true. The connector runtime persists the attempt and terminal state.
- The Sources Stage 3 progress recovery in
  `adapters/postgres-stage3/src/runtime-data-integrity.ts` persists exponential
  backoff but has no equivalent finite attempt ceiling. Its
  `classifySourcesStage3Failure()` currently maps every `TIMEOUT` to
  `retryable=true`.

The corrected mapping is:

| Cause                                                                                     | Code                                                    | Retryability and authority                                                                                                                                   |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Preflight, archive, logical, selector, or normalized-text limit                           | `FORMAT_CORRUPT`                                        | false; deterministic bad input, reconciliation/repair required.                                                                                              |
| Child killed by known CPU/memory/resource budget                                          | `FORMAT_CORRUPT`                                        | false; do not retry a deterministic resource failure.                                                                                                        |
| Explicit caller abort                                                                     | `TIMEOUT`                                               | false; caller cancellation is not a durable retry signal.                                                                                                    |
| Worker wall deadline with no deterministic parser/resource diagnosis in connector-runtime | `TIMEOUT`                                               | true, but bounded by the existing three-attempt JobRuntime policy.                                                                                           |
| Worker wall deadline entering Sources Stage 3 recovery                                    | `TIMEOUT` with explicit non-retry disposition           | false until the classifier honors the explicit disposition; the unbounded Stage 3 recovery loop must never receive a pathological-file timeout as retryable. |
| Database/transport transient outside the worker                                           | existing `RETRYABLE_DEPENDENCY` / `STAGE3_DB_TRANSIENT` | true under the owning existing recovery authority.                                                                                                           |
| Cleanup/reap or malformed internal runtime state                                          | `TERMINAL_FAILURE`                                      | false; no automatic retry or false success.                                                                                                                  |

Phase B must update the Stage 3 classifier/test seam to honor an explicit
`retryable=false` on a `ShotgunError` before its legacy `TIMEOUT` mapping, or
route the document-format operation through the bounded connector JobRuntime.
It must not create a second retry authority in the adapter. The connector
three-attempt policy remains the only automatic retry for transient worker
timeouts; the Sources progress loop remains the authority for its own durable
SourceVersion state and must receive deterministic failures as terminal.

## 24. ADR governance correction

Phase B's exact document plan must include a dated history amendment to:

`docs/architecture/adr/ADR-088-stage-8-format-adapter-and-structural-selectors.md`

The amendment must preserve the original **Accepted — 2026-07-17** text and
record, with date `2026-09-18`, the following additions:

- semantic PDF paragraph extraction and deterministic reading order;
- multi-region Page/BBox selector provenance without union over-coverage;
- sentence physical-selector propagation using existing `SourceSelector[]`;
- bounded worker execution, process-tree cleanup, and resource budgets;
- OOXML central-directory and parser-object preflight;
- image pre-multimodal validation;
- transformer version/revision-scoped Evidence compatibility rule.

The ADR amendment is a Phase B governance prerequisite. It is not modified in
this B0.1 design-only step.

## 25. Corrected exact Phase B file plan

### Product and adapter files

1. `adapters/document-format-python/src/index.ts` — bounded runner, image
   preflight ordering, strict result/segment validation, revision-independent
   adapter output, cleanup, and identity `1.1.0`.
2. `adapters/document-format-python/worker.py` — OS bootstrap, image metadata
   mode, OOXML preflight/object counters, PDF segmentation, private segments,
   and logical guards.
3. `adapters/plain-text-lucas-augmented/src/index.ts` — only if the adapter
   boundary needs a documented range hook; default is unchanged.
4. `modules/frontend-sources-write/src/stage3-pipeline.ts` — honor explicit
   non-retryable deterministic timeout/resource dispositions in the existing
   Sources recovery classifier; do not add a retry system.
5. `modules/evidence/src/index.ts` — add the revision-scoped repository port,
   query handler, authority checks, and additive query contract.
6. `modules/candidate-generation/src/index.ts` — retain EvidenceIndexed
   `revisionId`, call the revision-scoped query, assert exact revision, and
   revision-scope materialization identity. This is the correctness fix, not
   the TS-3 N+1 optimization.
7. `adapters/postgres-stage3/src/index.ts` — revision-scoped SQL query.
8. `adapters/stage3-in-memory/src/index.ts` — revision-scoped parity query.
9. `packages/contracts/schemas/list-evidence-spans-by-revision.v1.schema.json`
   — additive query input schema.
10. `modules/evidence/module-manifest.json` and
    `modules/candidate-generation/module-manifest.json` — declare the
    additive query dependency/provider.
11. `docs/architecture/adr/ADR-088-stage-8-format-adapter-and-structural-selectors.md`
    — dated amendment/history entry described above.

### Test files

12. `tests/unit/stage-8-format-expansion.test.ts` — image preflight ordering,
    image negative/Golden tests, PDF and sentence selector fidelity.
13. `tests/unit/ts1-document-format-boundary.test.ts` — runner, process tree,
    coherent limits, OOXML parser-object caps, PDF, HTML benchmark, image
    preflight, and error/retry contracts.
14. `tests/contract/transformation-evidence.contract.test.ts` — additive
    revision-scoped list and historical explicit-read coverage.
15. `tests/contract/ts1-cross-revision-evidence.contract.test.ts` — new RED→GREEN
    cross-version proof for both in-memory and isolated PostgreSQL adapters.
16. `tests/unit/sources-stage3-continuation.test.ts` — deterministic timeout
    disposition is not retried by the unbounded Sources recovery loop.
17. `tests/proofs/ts1-phase-a-red-proof.test.ts` and
    `tests/proofs/ts1-phase-a5-boundary-investigation.test.ts` — preserve
    unchanged in B0.1; amend only after explicit Product implementation
    authorization.

### Files not required by the corrected design

- `packages/contracts/src/document-evidence.ts`: existing `SourceSelector[]`
  already carries multiple physical selectors.
- `modules/transformation/src/index.ts`: the stored revision identity and
  `DocumentTransformed` event already carry `revisionId`; no new public
  transformation shape is required.
- `modules/evidence/src/index.ts` is required for the additive query, but not
  as a late Evidence-dropping filter.
- `db/migrations/`: no correctness migration is required; existing
  `evidence.spans.revision_id` is authoritative and indexed as a primary key.
- `requirements.lock`: no new OSS dependency is proposed.
- `modules/candidate-generation/src/index.ts` is required only for revision
  authority and idempotency identity; its N+1 query count and AI batching stay
  in TS-3.

## 26. Corrected RED→GREEN test matrix

| Boundary           | Required proof                                                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Revision authority | 1.0.1 and 1.1.0 revisions/evidence coexist; 1.1.0 EvidenceIndexed selects only 1.1.0; explicit historical query reads 1.0.1; source-level query is not used for continuation.                                                                                |
| Worker containment | hang; stdout/stderr overflow; invalid JSON; malformed shape; non-zero exit; cleanup race; descendant/process-tree termination; single settlement.                                                                                                            |
| Coherent budget    | output 8 MiB; normalized text 4 MiB; 512 blocks; 512 sentences; 1,025 derived SourceMap entries; 16,384 selector total; no truncation or partial Evidence.                                                                                                   |
| OOXML              | entry count; declared/actual total; per-entry; ratio; duplicate/traversal/encrypted/invalid metadata; actual DOCX paragraphs/cells; XLSX worksheets/rows/cells/shared strings/relationships; PPTX slides/shape-tree/relationships; valid Golden regressions. |
| PDF                | Golden; multiline paragraph with >16 line selectors; two paragraphs; multicolumn order; multipage locality; large valid; corrupt/encrypted; no column-gap union.                                                                                             |
| HTML               | current regression; cached ordinal path; independent `select_one` Golden round-trip; bounded 512-element benchmark; external timeout and no residual child.                                                                                                  |
| Images             | oversized dimension; excessive pixels; malformed PNG/JPEG; valid high-resolution image within bound; hash mismatch; preflight before provider; zero provider calls on rejection.                                                                             |
| Retry authority    | deterministic format/resource failure is non-retryable; explicit abort is non-retryable; transient connector timeout is bounded to three attempts; Sources recovery does not hot-loop pathological files.                                                    |
| Regression         | all Stage 8 Golden Corpus, Stage 3 Contract, Evidence round-trip/negative, adapter replacement, security/approval negative, and migration/rollback rehearsal gates.                                                                                          |

## 27. Version, compatibility, and rollback correction

- DB migration remains **NO** for revision-scoped Evidence correctness.
- `ListEvidenceSpansByRevision@1.0.0` is an additive public query; the legacy
  source-level query remains readable but is not a continuation authority.
- `shotgun.document-formats@1.1.0` remains the proposed transformer identity,
  but it is **blocked** until revision-scoped Evidence and the cross-version
  proof are complete. A version bump alone is never an authority decision.
- `DocumentTransformed@1.0.0` and `EvidenceIndexed@1.0.0` need no schema bump;
  `EvidenceIndexed.revisionId` is reused as the authority already present.
- Old `1.0.1` revisions and Evidence remain readable by explicit revision ID.
  New `1.1.0` Evidence is never merged into an old revision's list or
  candidate batch.
- Candidate materialization identity includes revision ID. Existing candidate
  rows remain readable by their Evidence IDs; no silent rewrite or delete is
  permitted.
- Rollback first stops new `1.1.0` transformations and preserves the additive
  revision-scoped query. Reverting the adapter does not delete either revision
  set. A full rollback that removes the query is allowed only after no
  cross-version continuation is active; otherwise the query and authority
  fix remain in place while the adapter version is quarantined.
- No DB, Canonical, Asset, approval-state, or historical Evidence repair is
  required by rollback. Reprocessing under `1.0.1` or a later corrected
  identity creates/reuses only its own transformer-scoped revision.

## 28. Residual risks and B0.1 safety confirmation

Residual risks remain explicit:

- The current source-level Evidence list is still unsafe for a revision-aware
  continuation until Phase B implements the additive query and Candidate
  Generation change; this is a release blocker for `1.1.0`.
- The current HTML implementation remains expensive; the measured timeout is
  evidence for the planned algorithm change, not a claim that the change is
  already implemented.
- Restricted hosts may lack Windows Job Objects or POSIX resource limits; the
  parser/archive/object caps are the known boundary and cleanup failure stays
  terminal.
- Valid large documents and high-resolution images above the safety profile
  are rejected rather than truncated. Raising a limit requires a new bounded
  benchmark and GPT review.
- Stage 4 N+1 Evidence reads, AI context batching, and candidate-generation
  durable scaling remain TS-3. TS-1 only bounds the input and preserves
  authority/provenance.

B0.1 changed only this design document. At the time of this correction:

- Product source change: **none**
- DB/schema change: **none**
- Commit: **none**
- Push: **none**
- PR: **none**
- ADR amendment applied: **not yet; planned for Phase B**
- Four user-owned verification documents: **preserved**
- Launcher quarantine file: **preserved**
- Residual Python worker processes after bounded benchmark: **none**

STOP for GPT review. Do not implement Phase B until GPT gives a new formal
authorization.

## 29. TS-1 Phase B0.2 — Authority and cutover design freeze

This addendum is the response to the formal `TS-1 Phase B0.2 — AUTHORITY &
CUTOVER DESIGN FREEZE` instruction received on 2026-09-18. It is design and
evidence only. Product source, database migrations, ADR files, tests, commits,
pushes, and PRs remain prohibited in this phase.

The effective base remains:

```text
main@cc6a01b4c7182340cc561c54823b1e35456663ec
codex/ts1-document-format-boundary-hardening
```

The investigation found that the B0.1 revision-scoped Evidence correction was
necessary but not sufficient. The active revision must be carried through the
Source Product, initial Candidate materialization, durable resume, re-extract,
Candidate persistence, and current-versus-historical reads. The design below
freezes that complete lineage without treating a browser field, a timestamp,
or transformer-version ordering as authority.

## 30. Active revision authority

### 30.1 Authority chain proven from the current schema

The current durable chain is:

```text
source_product.source_stage3_progress
  (project_id, source_version_id, indexing_result_id)
        |
        +--> evidence.indexing_results
                (indexing_result_id, revision_id, source_version_id,
                 transformer_id, transformer_version, status)
                        |
                        +--> transformation.revisions.revision_id
                        +--> evidence.spans.revision_id
```

The database evidence is material migration 062 and the current Stage 3
runtime adapter. `source_stage3_progress` is one row per
`(project_id, source_version_id)`, has a foreign key to
`evidence.indexing_results`, and requires `indexing_result_id` for
`STAGE3_COMPLETED` and `NO_EVIDENCE`. The Stage 3 claim path reads the stored
indexing result and returns its `revision_id`; it does not select by created
time or transformer version. `evidence.indexing_results.revision_id` has a
foreign key to `transformation.revisions`, while every Evidence span stores
the same revision identity.

Therefore the current revision rule is frozen as:

1. Read the single SourceVersion progress row in the authorized project.
2. Read its `indexing_result_id` and join exactly to
   `evidence.indexing_results`.
3. Require the result's `project_id`, `source_version_id`, `source_id`, and
   `revision_id` to match the requested SourceVersion and its transformation
   revision.
4. Use that `revision_id` for all current Evidence and Candidate reads.
5. If the progress row is terminal but the chain is missing or mismatched,
   fail closed with reconciliation/terminal handling. Never fall back to
   `listBySourceVersion`, `latest created_at`, or a greatest transformer
   version.

`NO_EVIDENCE` is a valid terminal active authority with a zero-Evidence
indexing result. It is not permission to search historical revisions for a
usable sentence.

### 30.2 Internal read port and browser boundary

The minimum internal Product read port is:

```ts
type SourcesActiveEvidenceRevision = {
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly indexingResultId: string;
  readonly revisionId: string;
  readonly transformerId: string;
  readonly transformerVersion: string;
  readonly status: 'INDEXED' | 'NO_EVIDENCE';
};

type SourcesActiveEvidenceRevisionReaderPort = {
  resolveActiveEvidenceRevision(
    projectId: string,
    sourceId: string,
    sourceVersionId: string,
  ): Promise<SourcesActiveEvidenceRevision | undefined>;
};
```

This is an internal server-side port. `revisionId` and `indexingResultId` do
not enter `SourceDetailView`, `SourceLibraryPageView`, browser commands, or
the HTTP response unless a later, separately approved history view explicitly
needs an opaque historical reference. The server retains the IDs to enforce
exact reads. A browser-supplied revision ID is never accepted as current
authority.

The port is implemented by the existing Source projection/asset repository
boundary, not by a second resolver:

- `PostgresOriginalAssetRepository` adds a transactionally consistent query
  joining `source_stage3_progress` to `evidence.indexing_results`, then
  validates the SourceVersion and revision relationships before returning the
  internal record.
- `InMemoryOriginalAssetRepository` stores the same progress-to-indexing
  result relationship in its test fixture and returns the same shape. A test
  fixture that lacks an active authority must return `undefined`, not infer a
  revision.
- `SourcesProjectionRecord` may carry only an internal optional
  `activeEvidenceRevision` reference if the implementation chooses to load it
  with the projection. The preferred design is the explicit port above so
  ordinary library projection rows do not need to expose technical IDs or
  perform one indexing join per source.
- `FrontendSourcesReadCoordinator` calls this port once per active operation
  and passes the returned revision to the Evidence/Candidate read ports. It
  omits all technical IDs from existing frontend view schemas.

The projection's existing `stage3State` remains display state only. It is not
an Evidence authority by itself.

### 30.3 Evidence repository boundary

`SourcesEvidenceReaderPort` and `EvidenceRepositoryPort` retain the old
source-level method only for explicit general or historical reads. They add
the exact method:

```ts
listByRevision(
  projectId: string,
  sourceVersionId: string,
  revisionId: string,
): Promise<readonly EvidenceSpan[]>;
```

`PostgresEvidenceRepository.listByRevision` filters all three values and
orders by position and pointer. `InMemoryEvidenceRepository` applies the same
three predicates and ordering. Both implementations assert that every mapped
row has the requested project, SourceVersion, and revision before returning.
The method must return an empty list for a valid `NO_EVIDENCE` revision and
must not substitute another revision.

`listBySourceVersion` remains available to migration tools and an explicitly
historical/general read surface, but no active Product path, EvidenceIndexed
continuation, Candidate materialization, resume, or re-extract path may call
it.

## 31. Revision-scoped Evidence contract

### 31.1 Additive query

The minimum safe contract is additive:

```text
ListEvidenceSpansByRevision@1.0.0
```

Input (project identity remains envelope-scoped):

```json
{
  "sourceVersionId": "uuid",
  "revisionId": "uuid"
}
```

Output uses option A from the formal instruction: every summary item carries
the immutable identity, in addition to the query envelope identity:

```json
{
  "sourceVersionId": "uuid",
  "revisionId": "uuid",
  "items": [
    {
      "evidenceId": "uuid",
      "sourceVersionId": "uuid",
      "revisionId": "uuid",
      "pointer": "/sentence-0-12",
      "nodeKind": "sentence",
      "position": {
        "type": "TextPositionSelector",
        "start": 0,
        "end": 12,
        "unit": "unicode-code-point"
      },
      "exactHash": "sha256:..."
    }
  ]
}
```

The schema is `additionalProperties: false`; the query handler rejects an
empty/mismatched source/revision pair and filters by all three database keys.
The handler checks the access scope on every returned span. Candidate
Generation then verifies both the envelope identity and each item identity
before any `GetEvidenceSpan` call. Each full span returned by
`GetEvidenceSpan` is checked again against the requested revision and
SourceVersion. A mismatch is a terminal protocol/correctness failure, never a
filter-and-continue operation.

The legacy `ListEvidenceSpans@1.0.0` contract remains readable for explicit
history/general APIs and existing generic `/evidence/list` compatibility, but
its source-level result is not an active continuation authority. The direct
`/intake` response path must obtain the authoritative revision from the
stored Stage 3 result and use the new query when it reports current Evidence;
the generic legacy endpoint may remain an explicit source-level history
endpoint only until a separately approved public history contract replaces it.

`EvidenceIndexed@1.0.0` already contains `revisionId` and therefore requires
no schema bump. The new list query is the only Evidence public contract added
by this design.

## 32. Source Product current/history semantics

### 32.1 Current Source Detail

The following current Product paths must resolve the active revision from the
single internal port before reading Evidence or Candidates:

- `FrontendSourcesReadCoordinator.evidenceList`;
- `FrontendSourcesReadCoordinator.reextractTarget`;
- transformed `preview`;
- `candidatesList`;
- any current Source Detail aggregate that reports Evidence/Candidate counts.

Current Evidence means exactly `listByRevision(projectId, sourceVersionId,
activeRevisionId)`. If the active progress is not terminal, the Product
returns its existing not-ready state. If it is terminal with `NO_EVIDENCE`, the
Product returns no usable Evidence and re-extract is rejected. If the
authority chain is missing or mismatched, the Product returns a masked
reconciliation/terminal error and never searches all revisions.

### 32.2 Historical Source Detail

SourceVersion history remains version-oriented, but evidence from a version
with multiple transformation revisions is not implicitly current. Historical
Evidence must be read by an explicit server-side historical identity:

```text
(projectId, sourceVersionId, revisionId)
```

The first Phase B implementation may keep the existing browser history view
at version granularity and report the active revision's count only. It must
not display a sum across revisions. If a historical revision detail is
exposed, the server obtains the revision from an authorized history record or
opaque server-issued handle; the browser cannot turn an arbitrary revision ID
into current authority. The historical read calls `listByRevision` directly.

### 32.3 Re-extract eligibility

`reextractTarget` checks sentence Evidence from the active revision only. The
following case is mandatory: historical R1 has sentences and active R2 has no
sentences; re-extract is rejected. Historical R1 must not make the current
SourceVersion appear eligible. The browser continues to send only
`sourceId`/`sourceVersionId`; the server derives R2 from the active Stage 3
authority and passes it internally.

### 32.4 Candidate current/history semantics

`SourcesCandidateReaderPort` gains a revision-scoped method. Current Source
Detail uses the active revision only. Historical candidates remain immutable
and readable only through an explicit revision identity. The current view
never concatenates candidate rows from multiple revisions.

The existing Stage 5 CandidateValidated/Comparison contracts are not changed
for convenience. Once a Candidate ID and its Evidence ID are selected, those
downstream records are already identity-specific. The Product read boundary
is corrected before Stage 5 and does not rewrite existing review state.

## 33. Candidate materialization lineage

### 33.1 Initial EvidenceIndexed path

The current `EvidenceIndexed` event already carries `revisionId`. Phase B
must retain it in `EvidenceIndexedPayload`, derive the materialization key from
`projectId + sourceVersionId + revisionId`, and call
`ListEvidenceSpansByRevision` with the exact pair. The generated AI input is
checked so every `revisionId` in its Evidence is the event revision.

No event consumer may reconstruct authority from `sourceVersionId` alone.

### 33.2 Resume path

The current durable recovery code reads an AI provider record by
`projectId + requestId` and sends a resume command containing only
`sourceVersionId + requestId`. The AI provider record contains
`input_evidence_ids`; that is enough to prove a non-empty Evidence input only
if all IDs resolve to one `(sourceVersionId, revisionId)` pair. It is not
enough for zero-candidate output because a batch can have no candidate row.

The safe design is therefore:

1. Phase B adds `revisionId` to the internal persisted Candidate Batch and to
   the durable materialization lookup result.
2. Resume still accepts the existing browser-independent command shape for
   compatibility, but Candidate Generation resolves the exact revision from
   the persisted AI/materialization/batch record by `requestId` and verifies
   `sourceVersionId`.
3. If the persisted record has no unambiguous revision (legacy zero-candidate
   or mixed-evidence row), resume fails closed with reconciliation required;
   it never guesses from current/latest revision.
4. The resolved revision becomes the internal materialization input and the
   idempotency key includes it.

The durable recovery service is therefore a resolver of an existing material
identity, not a new current-revision authority.

### 33.3 Re-extract path

The browser remains limited to Source identity. `sources-routes.ts` calls
`reextractTarget`, which resolves the active revision from the same Stage 3
authority and checks active sentence Evidence. The internal command gateway
passes the derived revision to Candidate Generation. A browser-supplied
revision field is rejected as an unknown/invalid command field; parsing a
revision out of an opaque request ID is forbidden.

Re-extract idempotency is:

```text
projectId : sourceVersionId : activeRevisionId : reextract : requestId
```

Changing the active revision requires a new server-derived command identity;
it cannot reuse an R1 re-extract batch for R2.

### 33.4 Candidate output and read validation

The internal Candidate Batch has `revisionId`. Each candidate's Evidence ID
must resolve to the same revision. Candidate list-by-revision queries filter
by the batch revision and, as a defensive check, join
`candidate.claim_candidates.evidence_id` to `evidence.spans.revision_id`.
Mixed rows are a terminal data-integrity failure, not a partial list.

`ListClaimCandidatesByRevision@1.0.0` is an additive internal/module query
for current and explicit historical reads. Its output envelope includes
`sourceVersionId` and `revisionId`; each returned candidate is validated
against the same batch/evidence revision. The old source-level query remains
for explicit historical/general compatibility only.

## 34. Candidate persistence and migration decision

### 34.1 No-migration hypothesis rejected

The proposed no-migration design

```text
candidate.claim_candidates.evidence_id
  -> evidence.spans.revision_id
```

is sufficient only for a non-empty candidate row after the fact. It is not
sufficient for the complete boundary:

- `candidate.batches` currently stores only SourceVersion and source-version
  idempotency, so an R1 EvidenceIndexed event and an R2 event collide;
- a valid AI result may produce zero candidates, leaving no claim row from
  which to infer a revision;
- resume must reload a batch before it can use a candidate Evidence ID;
- current Candidate reads cannot prove the revision of a zero-candidate batch;
- source-level list queries return R1 and R2 candidates together;
- a provider input Evidence ID list is an audit check, not durable batch
  authority for every materialization state.

Therefore claiming `DB migration NO` would not prove the required invariant.

### 34.2 Minimum additive migration

Phase B requires the next migration slot after the current repository head,
planned as:

```text
db/migrations/076_stage4_candidate_revision_lineage.sql
```

The migration is additive and must:

1. add nullable `revision_id` to `candidate.batches` with a foreign key to
   `transformation.revisions(revision_id)` and an index on
   `(project_id, source_version_id, revision_id, created_at)`;
2. add a check/trigger for new writes so a new batch cannot be saved without
   a revision ID matching its SourceVersion and project;
3. backfill legacy batches only when all linked candidate Evidence rows prove
   exactly one revision; no timestamp/version inference is allowed;
4. leave zero-candidate or mixed legacy batches explicitly unpinned and mark
   them for reconciliation rather than guessing or deleting them;
5. permit existing legacy rows to remain readable by batch/candidate ID, but
   exclude unpinned rows from the current revision view and from resume until
   an authority-backed reconciliation exists;
6. add indexes/constraints needed for revision-scoped Candidate list queries;
7. preserve the existing candidate Evidence foreign key and Stage 5 relations.

The application phase must write `revision_id` as non-null for every new
batch, including zero-candidate batches. `candidate.claim_candidates` does
not need a duplicated revision column if its Evidence join and the pinned
batch column are both checked; duplicating it would create another mutable
authority. The in-memory repository mirrors the pinned field and rejects
mixed/zero-identity violations in the same way.

This is a correctness migration caused by transformer revision coexistence,
not a TS-3 scaling migration. It does not change Canonical data or Stage 5
contracts.

### 34.3 Persistence proofs

The no-mix proof after migration is:

```text
CandidateBatch.revisionId = R
  AND every candidate.evidenceId -> EvidenceSpan.revisionId = R
  AND sourceVersionId = requested SourceVersion
```

This proves saving, reloading, current reads, and non-empty batches. The
explicit batch column proves zero-candidate batches. Resume reloads the batch
by durable request/materialization identity and obtains R without querying
current state. Re-extract creates a new key with the server-derived active R.

## 35. Transformer 1.1.0 cutover policy

### 35.1 Current behavior proven

The current Stage 3 Sources progress table is one row per SourceVersion.
`STAGE3_COMPLETED` and `NO_EVIDENCE` are terminal states, both require a
stored `indexing_result_id`, and the claim path returns the stored revision
without executing the current transformer again. The current Sources durable
pipeline therefore does not automatically re-transform all completed
SourceVersions when a transformer identity changes.

The generic `/intake` path can execute the transformer for a new command and
publish a new revision, but this does not mutate an old SourceVersion's
completed Sources progress row.

### 35.2 Frozen rollout rule

The default accepted cutover policy is:

- historical `shotgun.document-formats@1.0.1` revisions remain immutable;
- there is no silent bulk reprocessing and no access-time reprocessing;
- newly executed generic transformations use `shotgun.document-formats@1.1.0`
  only after the Evidence/Candidate authority gates pass;
- existing completed SourceVersions continue to use the stored
  `indexing_result_id -> revision_id` authority;
- re-transforming a completed SourceVersion requires an explicit,
  already-authorized Stage 3 operation with a new idempotency identity,
  persisted progress/lease, and a new indexing result. It must not silently
  reopen `STAGE3_COMPLETED`;
- until that explicit operation is separately approved and implemented, a
  completed SourceVersion is not eligible for implicit 1.1.0 reprocessing.

The transformer identity bump is blocked until the additive Evidence query,
active Product resolution, Candidate batch migration, and cross-version tests
are complete. Transformer version ordering is never used to decide current.

## 36. Production reachability matrix

The current code proves that the Sources Product byte-staging contract accepts
only `text/plain` and `text/markdown`. The shared Python adapter supports the
wider worker-backed formats, but that does not mean all eight formats are
reachable through the current Sources Product durable pipeline.

| Boundary                         | Media types / formats                                                                              | Reachable today                                                         | Path and durability                                                                                   | TS-1 effect                                                                                          | Acceptance proof                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Current Sources Product staging  | `text/plain`, `text/markdown`                                                                      | Yes                                                                     | `/product-api/frontend/sources/staging/bytes` → Sources Stage 3 progress; durable SourceVersion state | Active revision authority and current read correction; plain-text adapter remains unchanged          | staging contract, Stage 3 completion, current Evidence isolation |
| Current Sources Product staging  | PDF, DOCX, XLSX, CSV, PPTX, PNG, JPEG                                                              | No, rejected by the route/contract                                      | No durable Sources Product path today                                                                 | Must not be claimed as Product reachability; generic adapter tests still protect the shared boundary | negative staging tests plus generic format tests                 |
| Legacy/general `/intake`         | generic declared media types, including wider document formats where accepted by Intake validation | Yes through generic Intake when the media type passes Intake validation | command/event connector path; not the Sources Product progress path                                   | Python adapter hardening and revision-scoped Evidence continuation                                   | `/intake` format matrix and full Stage 8 pipeline                |
| Stage 2 Intake                   | stored Source/SourceVersion originals                                                              | Yes for accepted Intake media types                                     | asset/original-asset authority before transformation                                                  | preserves immutable content hash and raw 10 MiB boundary                                             | Stage 2 persistence and hash tests                               |
| Stage 3 Transformation module    | adapter-selected input                                                                             | Yes for generic transformation events                                   | transformation repository + DocumentTransformed; revision is explicit                                 | 1.1.0 identity/cutover and adapter boundary                                                          | transformation revision coexistence                              |
| Sources durable Stage 3 pipeline | currently typed only for text/plain/markdown                                                       | Yes only for those two types                                            | `source_stage3_progress`, indexing result, Evidence continuation                                      | no claim that Python formats are routed here unless a future explicit contract extends it            | type/route reachability test                                     |
| `PythonDocumentFormatAdapter`    | HTML, PDF, DOCX, XLSX, CSV, PPTX, PNG, JPEG                                                        | Adapter-level yes                                                       | shared worker-backed transformation boundary                                                          | runner, preflight, PDF, provenance, limits                                                           | eight-format Stage 8/adapter replacement matrix                  |
| `SafeUrlTextAdapter`             | fetched `text/html` only                                                                           | Yes when public HTTPS fetch passes SSRF/content limits                  | URL acquisition → Python HTML adapter; generic transformation path                                    | HTML cache selector and bounded fetch/worker proof                                                   | Safe URL redirect/content-type tests                             |
| tests only                       | all locked fixtures and adversarial cases                                                          | Yes as test fixtures                                                    | in-memory/isolated adapter or generic pipeline                                                        | RED→GREEN evidence, not Product reachability                                                         | all listed unit/contract/integration tests                       |

`Source Product` and `legacy/general Intake` are intentionally separate rows.
The eight-format adapter is protected regardless of route, but a Product UI
claim that all eight formats are currently uploadable would be false.

## 37. Format-safety budget versus TS-3 scale

B0.2 withdraws the universal 512 block limit as a format-safety limit. The
previous B0.1 value would reject verified normal cases (DOCX 600 blocks, XLSX
1600 cells, CSV 1600 cells) and would hide TS-3 fan-out behind a parser error.

### 37.1 Safety limits frozen for Phase B design

The authoritative limit for a worker-backed format is the first limit reached
in this order:

```text
raw input / archive preflight
→ parser object counters
→ worker JSON bytes
→ normalized UTF-8 text bytes
→ selector bytes/count
→ DocumentIR/SourceMap structural count
```

Proposed defaults are format-specific and are safety limits, not Stage 4
admission limits:

| Resource                     |                                                    HTML/PDF/CSV |                                      DOCX |                XLSX |                       PPTX |                        PNG/JPEG |
| ---------------------------- | --------------------------------------------------------------: | ----------------------------------------: | ------------------: | -------------------------: | ------------------------------: |
| raw input                    |                                                          10 MiB |                                    10 MiB |              10 MiB |                     10 MiB |                          10 MiB |
| worker stdout/result         |                                                           8 MiB |                                     8 MiB |               8 MiB |                      8 MiB |                           8 MiB |
| stderr                       |                                                           1 MiB |                                     1 MiB |               1 MiB |                      1 MiB |                           1 MiB |
| normalized UTF-8 text        |                                                           4 MiB |                                     4 MiB |               4 MiB |                      4 MiB | 128,000 code points description |
| emitted logical blocks       |                                                           8,192 | 8,192 paragraphs/cells/rows as applicable | 65,536 actual cells | 16,384 text-bearing shapes |                   1 image block |
| HTML tracked elements        |                              512 after cached selector redesign |                                         — |                   — |                          — |                               — |
| PDF pages / semantic blocks  |                                       1,000 pages; 8,192 blocks |                                         — |                   — |                          — |                               — |
| total deduplicated selectors |                                                          16,384 |                                    16,384 |              16,384 |                     16,384 |           native image selector |
| SourceMap entries            | derived from real blocks/sentences; hard 200,000 safety ceiling |                                      same |                same |                       same |                            same |

The values are bounded by the 8 MiB worker result, 4 MiB normalized text,
parser-object limits, selector budget, and the measured corpus. They do not
truncate text or drop Evidence. A normal DOCX 600-block, XLSX/CSV 1600-cell,
or PPTX 160-shape fixture remains below its format-specific safety ceiling.

The current Stage 4 N+1 reads and AI context size remain TS-3. If a temporary
downstream admission guard is required before TS-3, it must be separately
named, observable, and reject the whole Candidate materialization without
discarding Evidence; it is not a TS-1 parser limit and has removal criteria
based on the TS-3 batching/scale Contract test.

### 37.2 Error taxonomy

The exact mapping is:

| Failure                                                                  | Code                                                     |                                             Retryable | Reason                                                 |
| ------------------------------------------------------------------------ | -------------------------------------------------------- | ----------------------------------------------------: | ------------------------------------------------------ |
| malformed/actually corrupt file or PDF parse failure                     | `FORMAT_CORRUPT`                                         |                                                 false | user input is deterministic                            |
| encrypted package/PDF                                                    | `FORMAT_ENCRYPTED`                                       |                                                 false | user input/security property                           |
| unsupported media/codec/ZIP method                                       | `FORMAT_UNSUPPORTED`                                     |                                                 false | capability mismatch                                    |
| valid file over configured safety profile                                | `VALIDATION_ERROR` with a stable profile reason          |                                                 false | not corrupt; deterministic supported-profile rejection |
| malformed worker JSON                                                    | `TERMINAL_FAILURE`                                       |                                                 false | internal worker protocol failure, not file corruption  |
| malformed worker result shape/segment range                              | `TERMINAL_FAILURE`                                       |                                                 false | adapter contract defect                                |
| configured OS/job CPU or memory limit                                    | `VALIDATION_ERROR` with stable resource-profile reason   |                                                 false | deterministic profile trip; preserve evidence none     |
| unexplained child crash/non-zero exit                                    | `TERMINAL_FAILURE`                                       |                                                 false | internal/runtime fault                                 |
| child cleanup/reap cannot be proven                                      | `TERMINAL_FAILURE`                                       |                                                 false | never report false success                             |
| transient host/process execution timeout with no deterministic diagnosis | `TIMEOUT`                                                | true only under existing bounded connector JobRuntime | infrastructure transient                               |
| explicit caller abort                                                    | `TIMEOUT`                                                |                                                 false | cancellation is not retry authority                    |
| database/transport transient outside worker                              | existing `RETRYABLE_DEPENDENCY` or `STAGE3_DB_TRANSIENT` |                           true under owning authority | preserve current recovery owner                        |

`FORMAT_CORRUPT` is not used for internal JSON/protocol bugs or an ordinary
valid file that exceeds the supported safety profile. `classifySourcesStage3Failure`
must test an explicit `ShotgunError.retryable === false` disposition before its
legacy `TIMEOUT`-means-retryable branch. Existing database transient codes and
their recovery behavior remain unchanged. No new retry authority is created
inside the adapter.

## 38. Corrected exact Phase B file plan

### 38.1 Product/adapter/module files

1. `adapters/document-format-python/src/index.ts` — bounded worker, image
   preflight ordering, result validation, identity 1.1.0.
2. `adapters/document-format-python/worker.py` — OS/resource bootstrap,
   OOXML counters, PDF/HTML algorithms, private segments and guards.
3. `adapters/plain-text-lucas-augmented/src/index.ts` — unchanged by default;
   change only if the adapter needs a documented range hook for the new
   worker segments.
4. `modules/frontend-sources-write/src/stage3-pipeline.ts` — explicit
   non-retryable disposition precedence, no new retry system.
5. `modules/evidence/src/index.ts` — `listByRevision`, additive query,
   revision identity in summary output, and exact checks.
6. `modules/evidence/module-manifest.json` — additive query provider.
7. `modules/candidate-generation/src/index.ts` — revision from EvidenceIndexed,
   revision-pinned initial/resume/re-extract, new list query, exact assertions.
8. `modules/candidate-generation/module-manifest.json` — new Evidence and
   Candidate revision-scoped dependencies/queries.
9. `adapters/postgres-stage3/src/index.ts` — exact revision SQL.
10. `adapters/stage3-in-memory/src/index.ts` — exact revision parity.
11. `modules/frontend-sources-product/src/index.ts` — active revision read
    port, current/history semantics, revision-scoped Evidence/Candidate reads.
12. `adapters/postgres/src/index.ts` — `PostgresOriginalAssetRepository`
    active-revision projection reader.
13. `adapters/stage2-in-memory/src/index.ts` — in-memory active authority
    fixture/projection reader.
14. `assemblies/shotgun-app/src/product-api/sources-routes.ts` — retain
    browser Source identity only and use server-derived revision internally.
15. `assemblies/shotgun-app/src/server.ts` — durable resume resolver and
    generic `/intake` current Evidence query wiring.
16. `adapters/postgres-stage4/src/index.ts` — pinned Candidate Batch load/save,
    revision-scoped Candidate query, legacy-unpinned handling.
17. `adapters/stage4-in-memory/src/index.ts` — pinned batch parity and exact
    current/history filtering.
18. `db/migrations/076_stage4_candidate_revision_lineage.sql` — additive
    Candidate Batch revision lineage migration described in section 34.

### 38.2 Contract/schema files

19. `packages/contracts/schemas/list-evidence-spans-by-revision.v1.schema.json`
    — additive Evidence input.
20. `packages/contracts/schemas/list-evidence-spans-by-revision-output.v1.schema.json`
    — identity-bearing output.
21. `packages/contracts/schemas/list-claim-candidates-by-revision.v1.schema.json`
    — additive Candidate current/history input if the module query is exposed.
22. `packages/contracts/schemas/list-claim-candidates-by-revision-output.v1.schema.json`
    — identity-bearing Candidate output.
23. Resume/re-extract schemas remain source-only at the browser boundary unless
    an internal command version is required; any internal revision field must
    be server-derived and must not be accepted from the browser.
24. `packages/contracts/src/document-evidence.ts` — no change expected;
    existing `SourceSelector[]` is sufficient.
25. `modules/transformation/src/index.ts` — no change expected;
    `revisionId` is already in the stored revision/event.

### 38.3 Governance and tests

26. `docs/architecture/adr/ADR-088-stage-8-format-adapter-and-structural-selectors.md`
    — dated amendment preserving the 2026-07-17 accepted text.
27. `tests/unit/stage-8-format-expansion.test.ts` — format, PDF, provenance,
    image preflight and existing Golden regressions.
28. `tests/unit/ts1-document-format-boundary.test.ts` — worker, process-tree,
    limits, OOXML, HTML, PDF, image and error taxonomy.
29. `tests/contract/transformation-evidence.contract.test.ts` — additive
    revision query and historical explicit read.
30. `tests/contract/ts1-cross-revision-evidence.contract.test.ts` — R1/R2
    Evidence isolation in PostgreSQL and in-memory adapters.
31. `tests/contract/ts1-candidate-revision-isolation.contract.test.ts` —
    initial/resume/re-extract and current/history Candidate isolation.
32. `tests/unit/frontend-sources-read-coordinator.test.ts` — active revision,
    current detail, historical count, and re-extract eligibility.
33. `tests/unit/sources-stage3-continuation.test.ts` — deterministic timeout
    disposition does not enter the unbounded retry loop.
34. `tests/integration/frontend-sources-product-api.test.ts` — current versus
    historical Product behavior and browser non-authority.
35. `tests/database/stage-3-postgres.test.ts` and
    `tests/database/stage-4-postgres.test.ts` — durable authority/cutover and
    Candidate Batch migration proofs.
36. `tests/browser/` reachability coverage — current Sources text-only staging,
    generic `/intake` document path, and rejection of unsupported Product
    staging media types.
37. `tests/proofs/ts1-phase-a-red-proof.test.ts` and
    `tests/proofs/ts1-phase-a5-boundary-investigation.test.ts` — remain
    unmodified during design; amend only after Product authorization.

TS-3 files for N+1 Evidence reads, AI batching, and durable Candidate scaling
are deliberately absent. The only Stage 4 changes here are authority,
lineage, and correctness boundaries.

## 39. Required RED -> GREEN proofs

| Proof                     | RED condition and GREEN invariant                                                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Two transformations    | R1/1.0.1 and R2/1.1.0 for one SourceVersion coexist; current Product reads only the progress-indexed R2; explicit R1 history remains readable.                                           |
| B. Re-extract eligibility | R1 has sentence Evidence and active R2 has none; re-extract rejects, with no historical fallback.                                                                                        |
| C. Initial Candidate      | EvidenceIndexed(R2) causes only R2 Evidence query, full span checks reject R1, and batch pins R2.                                                                                        |
| D. Resume R1/R2           | durable resume for R1 reloads R1; R2 reloads R2; zero-candidate and unpinned legacy rows fail closed rather than guess.                                                                  |
| E. Re-extract pin         | browser sends only Source identity; server derives active R2; browser cannot select R1.                                                                                                  |
| F. Candidate Product view | historical R1 and current R2 remain separate; current Source Detail never merges them.                                                                                                   |
| G. Cutover                | completed 1.0.1 SourceVersion is not silently reprocessed; newly executed transformation uses 1.1.0; any explicit reprocess is durable/idempotent and rollback-safe.                     |
| H. Reachability           | Product text path, generic `/intake` document path, shared Python eight-format adapter path, and Safe URL HTML path are tested separately.                                               |
| I. Format limits          | DOCX >=600 logical blocks, XLSX/CSV >=1600 cells, PPTX >=160 shapes and semantic PDF fixtures remain green; unsafe archive/parser expansion is rejected before heavy parsing.            |
| J. Failure mapping        | user format/profile failure, internal protocol failure, resource trip, transient timeout, and explicit abort map to the frozen taxonomy; explicit retryable=false beats generic TIMEOUT. |
| K. Candidate persistence  | non-empty and zero-candidate batches pin a revision; mixed Evidence rows cannot be saved or listed as current; legacy unpinned rows are never guessed into current.                      |

The test matrix must include PostgreSQL and in-memory parity where both
adapters exist. Risky child/parser tests use an external test timeout and
assert no residual worker process.

## 40. ADR amendment scope

The Phase B implementation must add a dated history section to
`ADR-088-stage-8-format-adapter-and-structural-selectors.md` without rewriting
the original Accepted — 2026-07-17 decision. The 2026-09-18 amendment scope
records:

- semantic PDF paragraph reconstruction and deterministic reading order;
- multi-region Page/BBox selector provenance without giant union coverage;
- sentence physical-selector propagation using existing `SourceSelector[]`;
- bounded worker execution and process-tree cleanup;
- OOXML central-directory and parser-object preflight;
- image validation before multimodal provider invocation;
- transformer version coexistence and the
  `source_stage3_progress.indexing_result_id -> revision_id` compatibility
  rule;
- Candidate Batch revision pinning and current/history separation.

The ADR change is a Phase B governance prerequisite and is not applied in this
B0.2 design-only step.

## 41. Rollback and cross-version compatibility

The rollback unit is the adapter/worker implementation plus its revision-aware
query and Candidate lineage code. Rollback must first stop new 1.1.0
execution, preserve the revision-scoped Evidence query and the active
authority/candidate pin, and then revert the worker if required. It must not
delete either revision set or downgrade a stored active pointer.

Old 1.0.1 revisions, Evidence, Candidate batches, and review records remain
immutable/readable by their explicit identities. New 1.1.0 transformations
create or reuse only the `(project, sourceVersion, transformerId,
transformerVersion)` revision allowed by the existing unique key. A rollback
to 1.0.1 does not overwrite 1.1.0 rows. Unpinned legacy Candidate batches are
not repaired by guessing; they remain available by direct immutable ID and
outside the current view until reconciled by an explicit authority-backed
operation.

No DB rollback, Canonical repair, Asset repair, approval-state repair, or
historical Evidence deletion is required. The one required forward migration
is additive and must itself have a migration/rollback rehearsal before
Production acceptance.

## 42. Residual risks and B0.2 safety confirmation

Residual risks are:

- existing source-level Evidence/Candidate queries are unsafe for current
  continuation until the additive exact queries and Product read changes are
  implemented;
- current Sources Product does not route the wider eight-format set, so
  generic and Product acceptance must stay separate;
- restricted hosts may lack OS memory caps, leaving parser/object guards as
  the known boundary;
- normal documents above the chosen safety profile are rejected as profile
  limits, not mislabeled as corrupt and not truncated;
- Stage 4 N+1, AI context batching, and Candidate scaling remain TS-3;
- legacy zero-candidate/unpinned batches require explicit reconciliation and
  cannot be made current by an implicit rule.

B0.2 changed only this design document. At the end of this phase:

- Product source change: **none**
- DB migration applied: **none**; migration 076 is design-only
- ADR amendment applied: **none**; amendment is planned for Phase B
- Tests added or modified: **none**
- Commit: **none**
- Push: **none**
- PR: **none**
- Four user-owned verification documents: **preserved**
- Launcher quarantine: **preserved**
- Python worker processes: **none**

This B0.2 design is complete for GPT review. STOP. Do not implement Phase B
until GPT provides a new formal Product authorization.

## 43. B0.3 scope and non-negotiable durable pin

This section records the final correction requested by GPT after the B0.2
review. It is still a design/evidence-only change. It does not authorize
Product source changes, a database migration, test changes, an ADR amendment,
a commit, a push, or a PR.

The B0.3 invariant is stronger than `CandidateBatch.revisionId` alone:

```text
candidate-extraction Evidence
  -> one immutable (project, sourceVersion, revision) tuple
  -> ai.provider_calls.revision_id at the durable INSERT
  -> provider output / accepted output
  -> candidate.materializations (batch_id may still be NULL)
  -> candidate.batches.revision_id, when a batch exists
```

`ai.provider_calls.revision_id` is the first durable Stage-4 input pin. It is
the recovery authority when materialization fails before a Candidate Batch is
created. `candidate.batches.revision_id` is a copied, consistency-checked
projection of that provider-call pin; it is not an independent authority.

The following are explicitly not revision authorities:

- the current `source_stage3_progress` row after the provider call started;
- the newest or highest-created transformation revision;
- `requestId` syntax or a request-id-to-revision convention;
- reversing `input_snapshot_digest` or `request_digest`;
- a source-wide Evidence or Candidate query;
- a provider output's `input_evidence_ids` without resolving immutable Evidence
  rows and validating their single revision.

## 44. Resume-before-Batch proof and lifecycle contract

The existing durable recovery window is real and must be designed explicitly.
The current flow can reach all of the following states:

1. `ai.provider_calls` is inserted with the durable request identity and
   candidate-extraction input.
2. The provider attempt and output are persisted; the accepted output is
   associated with the call.
3. Candidate parsing or persistence starts. Candidate materialization can fail
   before `candidate.batches` is inserted.
4. `candidate.materializations` records the failure with `batch_id = NULL`.
5. Recovery discovers the call because the existing durable recovery query
   includes `OUTPUT_MATERIALIZED` and `MATERIALIZATION_FAILED` rows with an
   accepted output.

Therefore a recovery operation whose only durable revision source is
`candidate.batches.revision_id` is not safe: in step 4 that row does not exist.
The recovery contract is instead:

```text
Resume(projectId, requestId)
  -> load ai.provider_calls by projectId/requestId
  -> require schema_name = ClaimCandidateBatch.v1
  -> require provider_call.revision_id is non-NULL
  -> validate (projectId, sourceVersionId, revisionId)
  -> use that exact revision for Evidence and materialization
  -> never resolve current/latest or rerun provider execution implicitly
```

If the provider call is legacy and unpinned, revision-sensitive resume fails
closed with the existing reconciliation-required/error disposition. It may be
reconciled only by an explicit authority-backed operation. A successful later
batch must copy the same provider-call revision pin; it may not acquire a new
active revision.

`AIProviderExecutionRecord` therefore needs a first-class optional
`revisionId` field during the compatibility period. It is optional only for
legacy/non-candidate records. For a new candidate-extraction record it is
required before durable INSERT and is returned by `findByRequestId()` and the
recovery listing. The serialized `call_json`, request payload, and snapshot
metadata may repeat the revision for consistency/audit, but none of those
values is used to reverse-resolve the pin.

## 45. Final migration 076 design

The Phase B migration remains additive and is named
`db/migrations/076_stage4_candidate_revision_lineage.sql`.

### 45.1 Revision identity key

Before adding composite foreign keys, migration 076 adds a unique constraint
or unique index equivalent to:

```sql
UNIQUE (project_id, source_version_id, revision_id)
```

on `transformation.revisions`. This does not replace the existing
`revision_id` primary key or the existing transformer/version uniqueness. It
only makes the project/source/revision relationship referentially checkable.

### 45.2 Durable columns and indexes

The migration adds nullable `revision_id uuid` columns to both:

```text
ai.provider_calls
candidate.batches
```

The columns are indexed together with their existing identity fields and have
composite foreign keys:

```sql
FOREIGN KEY (project_id, source_version_id, revision_id)
  REFERENCES transformation.revisions(project_id, source_version_id, revision_id)
```

The provider-call FK is nullable for the compatibility period and is only
valid when `source_version_id` is present. A candidate-extraction INSERT is
required to supply all three values. The Candidate Batch FK is also nullable
for legacy rows, but every new batch INSERT supplies all three values.

The migration must also add the matching repository-level consistency checks:

- the provider-call `project_id` and `source_version_id` equal the revision
  row's values;
- the batch `project_id` and `source_version_id` equal the revision row's
  values;
- a batch's revision equals its originating provider call's revision before
  any candidate rows are written;
- candidate rows cannot be used to repair or silently change either pin.

The global `revision_id` foreign key alone is insufficient and must not be the
only constraint. The composite relationship is the required invariant.

### 45.3 New-write guards and legacy compatibility

The migration must not use a `NOT VALID` check that makes ordinary updates to
legacy NULL rows fail. Legacy data remains readable and state-transitionable
for non-revision-sensitive maintenance.

The exact guard is a small database trigger plus application validation:

- On `ai.provider_calls` INSERT, when `schema_name =
'ClaimCandidateBatch.v1'`, reject a NULL `revision_id`, NULL
  `source_version_id`, or an FK-inconsistent tuple. Non-candidate calls retain
  their existing nullable compatibility behavior.
- On provider-call UPDATE, a legacy candidate row with both old and new
  `revision_id IS NULL` may receive ordinary state updates. A NULL-to-non-NULL
  transition is allowed only after the composite FK and backfill algorithm
  validate it. A pinned row may not change its revision. Changing a pinned
  row back to NULL is rejected.
- On `candidate.batches` INSERT, reject a NULL `revision_id`; on UPDATE,
  preserve legacy NULL rows for ordinary maintenance but reject NULL-to-new
  rows that are not validated and reject changes to an existing pin.
- Application repositories perform the same checks before the SQL write so a
  contract violation produces a stable Shotgun error rather than a raw
  constraint error. The database remains the final authority.

This preserves ordinary updates to existing legacy NULL records while making
all new candidate-extraction calls and batches pinned. No silent conversion of
legacy records into “current” records is allowed.

## 46. Legacy provider-call backfill and reconciliation

The backfill is a bounded, idempotent reconciliation operation, not a
`latest-revision` migration. It scans only legacy candidate-extraction
provider calls where `revision_id IS NULL`.

For each call:

1. Load every `input_evidence_id` from immutable `evidence.spans`.
2. Require every Evidence row to exist, to match the call's project and
   source version, and to resolve to the same non-NULL `revision_id`.
3. Resolve that revision through the composite
   `(project_id, source_version_id, revision_id)` relationship.
4. In a transaction, set `ai.provider_calls.revision_id` only when the
   complete set is exactly one consistent tuple. Re-running the operation
   produces no further change.
5. If an Evidence row is missing, the rows are mixed, the project/source
   differs, the revision relationship is inconsistent, or the call has no
   usable input Evidence, leave the column NULL and emit a durable
   reconciliation-required finding.

`input_evidence_ids` is used only to inspect immutable historical lineage. It
does not select the active Product revision. `input_snapshot_digest` and
`request_digest` are checked for integrity but are never treated as reversible
identifiers. Mixed and cross-project calls remain unpinned and cannot enter a
revision-sensitive Resume path.

Legacy `candidate.batches.revision_id IS NULL` rows are not guessed from
source-wide Candidate data. If a later Phase B reconciliation has a direct,
immutable provider-call relation and validates the same single tuple, it may
backfill the batch; otherwise it remains legacy/unpinned and outside the
current Product view.

## 47. Generate, zero-candidate, and failed-materialization semantics

Before a new durable provider execution, `GenerateStructured` must:

1. require candidate-extraction Evidence items to carry `revisionId`;
2. require at least the resolved project and source version identity;
3. reject an empty, mixed, cross-project, or cross-source revision set;
4. persist the one validated revision in `ai.provider_calls.revision_id` in
   the same durable create/idempotency operation; and
5. include the revision in the canonical request/snapshot material used for
   consistency checking, without making a digest the identity source.

The zero-candidate case is not an exception to the pin:

```text
provider call(revision R2) -> accepted output(candidates = [])
  -> materialization/batch outcome still carries R2
```

There must be no special zero-row path that falls back to current authority.
If materialization fails while `batch_id` is NULL, Resume reads R2 from the
provider call and uses R2. If materialization later succeeds, the created
batch's `revision_id` must equal R2. If a proposed batch/provider pair
disagrees, the operation fails closed and records reconciliation required; it
does not rewrite historical Evidence, provider output, or an existing batch.

`candidate.materializations.batch_id NULL` is therefore an expected recovery
state, not evidence that the original revision can be recomputed.

## 48. Generic `/intake` and Sources Product authority

The generic `/intake` route can create a Transformation revision and Evidence
without creating the Sources Product chain
`source_stage3_progress.indexing_result_id -> evidence.indexing_results.revision_id`.
That path is valid historical intake but is not a Sources Product current
authority.

The Phase B resolver is single and explicit:

```text
SourcesActiveEvidenceRevisionReaderPort
  -> Source Product progress row
  -> terminal/indexing result identity
  -> exact transformation revision
```

It must not have a generic fallback resolver. For a SourceVersion without this
authority:

- current Evidence returns the existing safe not-ready/
  reconciliation-required disposition and performs no source-wide read;
- current Candidate returns the same safe disposition and performs no
  source-wide read;
- reextract is rejected before provider execution;
- transformed/current preview does not choose an implicit latest revision;
- history is allowed only when the caller supplies an explicit immutable
  historical identity and uses the historical-read contract.

The normal Sources UI remains independent of generic `/intake`: its staging
path is the existing text/plain/markdown Product path, it creates and advances
the Source Product progress/indexing authority, and it derives the current
revision through that authority. The wider generic document path is tested as
an explicit historical/non-Product path, not silently promoted to current.

No revision IDs are exposed in ordinary browser current-view contracts. IDs
are present only in internal ports or an explicit history contract.

## 49. Exact Phase B implementation file plan

The following is the complete planned file boundary after a later formal
Product authorization. It is not an instruction to edit these files now.

### Required implementation and migration files

1. `db/migrations/076_stage4_candidate_revision_lineage.sql` — composite
   revision key, nullable columns, indexes, FKs, and new-write/immutability
   triggers.
2. `modules/ai-provider/src/index.ts` — `revisionId` in the durable execution
   record, candidate GenerateStructured validation, request/snapshot
   consistency, and resume pin semantics.
3. `adapters/postgres-stage4/src/index.ts` — read/write the provider-call pin,
   enforce provider/batch consistency, and expose it to recovery.
4. `modules/candidate-generation/src/index.ts` — revision-pinned Evidence
   input, CandidateBatch revision identity, zero-candidate behavior, and
   revision-sensitive resume/reextract flow.
5. `adapters/postgres-stage4/src/index.ts` and the corresponding in-memory
   Stage-4 adapter — parity for provider-call and Candidate Batch pins.
6. `modules/frontend-sources-product/src/index.ts` plus its read/projection
   ports — current/history/reextract authority behavior and fail-closed
   absent-authority behavior.
7. `packages/contracts/schemas/` — only additive contract versions for the
   revision-scoped Evidence/Candidate internal queries and any explicit
   reconciliation result; ordinary current browser contracts remain ID-free.

### Verification-only or conditional files

8. `scripts/backup-restore.ts` — no weakening and no new authority. The
   existing authoritative table set already includes `ai.provider_calls`,
   `candidate.batches`, and `candidate.materializations`; change this file
   only if the migration catalog needs an explicit dependency assertion for 076.
9. `docs/architecture/adr/ADR-088-stage-8-format-adapter-and-structural-selectors.md`
   — dated amendment only after Product authorization.
10. Existing Stage-3/Stage-4 database, contract, integration, browser, and
    proof test locations — RED/GREEN coverage described below; no test file is
    changed in B0.3.

## 50. Backup/restore Phase B verification plan

`baseAuthoritativeTables` already includes the two new pin-bearing tables and
`candidate.materializations`. `snapshotAuthoritativeIntegrity()` serializes
each complete row with `to_jsonb`, so the new nullable columns are covered by
the existing manifest digest without weakening the backup format. The custom
`pg_dump` contains the schema/data and `pg_restore --exit-on-error` restores
the dependency graph; the composite FK requires transformation revisions to
be present before provider calls and Candidate batches. The backup design must
retain this ordering and must not omit the columns from the dump or manifest.

The Phase B isolated round-trip fixture contains all of the following:

- one pinned provider call and one matching pinned Candidate Batch;
- one legacy provider call with `revision_id NULL` that is explicitly marked
  reconciliation-required;
- one legacy Candidate Batch with `revision_id NULL`;
- one accepted provider output and `candidate.materializations` row with
  `batch_id NULL` for the resume-before-batch case;
- one zero-candidate pinned provider call/batch outcome;
- the exact transformation revision rows and Evidence rows referenced by all
  pinned inputs.

The verification sequence is:

1. create the fixture on PostgreSQL 16 and record the full authoritative
   integrity snapshot and the migration identity containing 076;
2. run `createBackup`, then `verifyBackup`, and assert the manifest includes
   the complete `ai.provider_calls`, `candidate.batches`, and
   `candidate.materializations` row digests;
3. restore into an empty isolated database using the existing
   `pg_restore --exit-on-error` path;
4. assert the restored full-row snapshot equals the manifest, including the
   pinned IDs, legacy NULLs, and `batch_id NULL`;
5. query the restored composite FKs and trigger behavior: pinned rows remain
   immutable, new unpinned candidate writes fail, legacy NULL maintenance is
   allowed, and wrong project/source tuples fail;
6. invoke the recovery/read proof against the restored data and verify that
   the NULL-batch materialization resumes from the provider-call pin rather
   than current/latest resolution; and
7. truncate only the documented projections and re-run the same integrity
   comparison, proving backup/restore did not change authoritative data.

The manifest migration identity and table-set assertion remain mandatory. A
failure in the backup/restore round trip blocks Phase B completion; it is not
converted into `COMPLETE_WITH_LIMITS`.

## 51. Final B0.3 RED -> GREEN matrix

| ID  | RED case                                                     | Required GREEN invariant                                                              |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| R1  | Resume before CandidateBatch exists                          | `batch_id NULL` recovery reads the exact non-NULL `ai.provider_calls.revision_id`.    |
| R2  | `MATERIALIZATION_FAILED` with `batch_id NULL`                | Recovery uses the provider-call pin and never current/latest lookup.                  |
| R3  | Provider output contains zero Candidates                     | Call, materialization outcome, and eventual batch all retain one exact revision.      |
| R4  | Legacy call has one consistent Evidence revision             | Backfill sets the pin idempotently after project/source/revision validation.          |
| R5  | Legacy call has mixed/missing/cross-project Evidence         | Pin remains NULL; reconciliation is required; revision-sensitive Resume fails closed. |
| R6  | New candidate provider call has no revision pin              | Repository/trigger rejects the durable INSERT.                                        |
| R7  | New Candidate Batch has no revision pin                      | Repository/trigger rejects the durable INSERT.                                        |
| R8  | Batch/provider revision disagreement                         | Transaction fails closed; no historical rewrite or current promotion.                 |
| R9  | Wrong project/sourceVersion/revision tuple                   | Composite FK and repository validation reject it.                                     |
| R10 | Generic `/intake` creates revision without Sources authority | Sources current Evidence/Candidate/reextract/preview cannot masquerade it as current. |
| R11 | Backup/restore with pinned and legacy rows                   | Full row digests, pins, NULLs, FKs, and recovery semantics survive the round trip.    |

The PostgreSQL and in-memory adapters must agree on R1-R9. Product/API and
browser tests cover R10. The backup integration test covers R11. Provider
attempt/output records are checked for consistency with the provider-call pin;
their digests remain integrity evidence, not identity resolvers.

## 52. B0.3 residual risks and explicit stop condition

Residual risks after this design correction are limited to later implementation
and migration verification:

- the existing Product and Candidate source-level queries remain unsafe until
  the authorized Phase B cutover lands;
- existing legacy calls/batches without a pin require explicit reconciliation
  and cannot be made current by inference;
- trigger behavior must be proven against ordinary legacy state updates and
  migration ordering in PostgreSQL;
- backup restoration depends on applying the recorded migration identity and
  preserving PostgreSQL dependency ordering;
- Stage-4 batching/scaling remains TS-3 and is not part of this correction.

B0.3 changed only this design document. The exact status at the end of this
design-only correction is:

- Product source change: **none**
- DB migration created or applied: **none**; migration 076 is design-only
- Tests added or modified: **none**
- ADR amendment applied: **none**
- Commit: **none**
- Push: **none**
- PR: **none**
- Four user-owned verification documents: **preserved**
- Launcher quarantine: **preserved**
- Python worker processes: **none**

This B0.3 design reports the final durable revision-pin correction to GPT.
STOP. Do not implement, migrate, test, amend ADR, commit, push, or open a PR
until GPT provides a new formal Product authorization.
