# Stage 8 OSS Integration Review

- 검토일: 2026-09-18 (Phase B revalidation)
- 대상: HTML, PDF, DOCX, CSV, XLSX, PPTX, 이미지, 공개 HTTPS 페이지
- OSS Gate: **COMPLETE**
- 상세 등록부: [oss-source-registry.json](../oss-source-registry.json)

## 완료 판정

**Stage 8: COMPLETE**

## 형식별 결정

| 형식     | 채택                                       | 비교 기준과 결정                                                       |
| -------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| HTML·URL | lucas ad626a3 규칙 + Beautiful Soup 4.15.0 | 직접 textContent 기준은 탐색·스크립트·미디어 노이즈를 남기므로 AUGMENT |
| PDF      | pdfplumber 0.11.10                         | PyMuPDF 1.28.0은 AGPL 때문에 REJECT, Docling·Tika는 MVP 규모에서 DEFER |
| DOCX     | python-docx 1.2.0                          | Docling은 모델·의존성 비용 때문에 DEFER                                |
| CSV·XLSX | Python CSV + openpyxl 3.1.5                | 범용 Markdown 변환보다 Sheet·Cell·formula 복원이 우수                  |
| PPTX     | python-pptx 1.0.2                          | Docling보다 작은 런타임으로 Shape·BBox를 직접 보존                     |
| 이미지   | Pillow 12.3.0 + MultimodalValidationPort   | OCR을 자동 활성화하지 않고 이미지 의미가 필요하면 명시적으로 검증 요구 |

하나의 범용 변환기가 모든 형식을 독점하지 않는다. 각 구현은
PythonDocumentFormatAdapter 뒤에서 같은 DocumentIR·SourceMap을 출력한다.

## Golden 및 benchmark

Windows, Python 3.12, 각 형식 3회 cold worker 실행의 중앙값이다. 직접 기준 구현은
원문 파일을 보존하지만 구조 Selector를 0개 생성하므로 완료 기준을 충족하지 못했다.

| 형식 | 중앙값 | 보존 결과                              | 직접 기준 대비              |
| ---- | -----: | -------------------------------------- | --------------------------- |
| HTML | 360 ms | 의미 블록 6개, 실행·미디어 노이즈 제거 | CSS 위치와 정제 텍스트 추가 |
| PDF  | 452 ms | word 6개, Page·BBox                    | 페이지·좌표 추가            |
| DOCX | 383 ms | 문단 2개, 표 셀 4개                    | 문단 순서·표 셀 추가        |
| CSV  | 958 ms | 셀 6개                                 | 행·열 주소 추가             |
| XLSX | 893 ms | 셀 6개, =1+1 보존                      | Sheet·Cell·formula 추가     |
| PPTX | 491 ms | text shape 2개, Shape·BBox             | slide·shape·좌표 추가       |

fixture는 PDF·DOCX·XLSX·PPTX가 실제 열리는지 구조 검사와 이미지 미리보기로 확인했다.
번들에 artifact-tool과 LibreOffice가 없어 해당 렌더러는 사용할 수 없었고,
PDFium·각 OOXML 공식 라이브러리로 대체 검증했다.

## Contract·정책 검증

| 완료 기준                                              | 결과 |
| ------------------------------------------------------ | ---- |
| 형식별 Golden Corpus                                   | PASS |
| Page·Cell·Shape·BBox 복원                              | PASS |
| fixture 표 셀 손실 0개                                 | PASS |
| 이미지 의미에 Multimodal Validation 요구               | PASS |
| 번역 origin은 원문 Evidence에서 제외                   | PASS |
| 손상·암호화·미지원 상태 분리                           | PASS |
| Adapter 교체 시 상위 출력 shape 유지                   | PASS |
| Intake → Asset → DocumentIR → Evidence E2E             | PASS |
| URL은 공개 HTTPS만, 영상은 접근 가능한 페이지 텍스트만 | PASS |
| 오디오·영상·자동 전사·ffmpeg 제외                      | PASS |

## 운영 경계

- 입력은 10 MiB로 제한한다.
- Python worker는 원본 저장소와 DB에 직접 접근하지 않는다.
- 파싱 실패는 FORMAT_CORRUPT, FORMAT_ENCRYPTED, FORMAT_UNSUPPORTED,
  MULTIMODAL_VALIDATION_REQUIRED로 구분한다.
- URL adapter는 공개 HTTPS만 허용하며 localhost·사설 IPv4·.local을 거부한다.
- 운영 Fetch 구현은 redirect마다 DNS/IP를 재검증하고 응답 크기·시간을 제한해야 한다.

## 다음 재검토 조건

- 스캔 PDF, 복합 표, 수식, 차트 손실이 Golden 허용치를 넘을 때 Docling 재평가
- 레거시 Office·광범위 MIME 감지가 필요할 때 Tika 재평가
- OCR은 별도 승인과 개인정보·정확도 정책이 생긴 뒤에만 평가

## Phase B revalidation

Phase B는 기존 결정을 바꾸지 않고 Adapter 뒤의 경계를 보완했다.

| 후보/부품             | 결정                            | 고정 버전·범위                                                                                               | 제외·교체 경계                                                               |
| --------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| pdfplumber            | `ADOPT` behind Python adapter   | `0.11.10`, lockfile                                                                                          | PyMuPDF 1.28.0은 AGPL로 `REJECT`; Docling은 `DEFER`                          |
| pypdfium2             | `AUGMENT` behind Python adapter | `5.11.0`, tag commit `0168561b33a3fc32eceb6ae46cc252f6b0e90c19`; only strict `<`/`>` glyph geometry recovery | pdfplumber remains layout owner; ambiguous/unmatched glyphs stay undecodable |
| python-docx           | `ADOPT` behind Python adapter   | `1.2.0`, lockfile                                                                                            | 전체 Office runtime·DB는 제외                                                |
| openpyxl              | `ADOPT` behind Python adapter   | `3.1.5`, lockfile                                                                                            | workbook 외부 상태·watcher는 제외                                            |
| python-pptx           | `ADOPT` behind Python adapter   | `1.0.2`, lockfile                                                                                            | 전체 presentation runtime은 제외                                             |
| Beautiful Soup        | `AUGMENT`                       | `4.15.0`, lockfile                                                                                           | HTML semantic cleanup과 selector round-trip만 사용                           |
| lucasastorian/llmwiki | `EXTRACT/AUGMENT`               | `ad626a3d81be1480e35ef4e94234de8dbb27a61e`                                                                   | SQLite·VaultFS·MCP·전체 runtime 제외                                         |

Phase B Golden 재검증은 Page·여러 physical BBox·Cell·Shape·CSS selector와
sentence selector 상속을 확인한다. PDF는 word 단위 block을 폐기하고 geometry 기반
paragraph로 재구성한다. worker는 raw 10 MiB, stdout 8 MiB, stderr 1 MiB,
normalized 4 MiB, HTML 512 tracked element, PDF 1000 pages/8192 blocks,
selector 16384, SourceMap 200000, image description 128000 code point 한도를
적용하며 overflow는 자르지 않고 non-retryable `VALIDATION_ERROR`로 거부한다.
Migration·Contract·Golden·Replacement 검증은 Stage 8 Adapter 경계에서 수행하고,
active revision authority·Candidate lineage는 TS-1 Phase B 보고서의 별도 계약으로
검증한다.

## 2026-09-29 VP-04 targeted PDF glyph augmentation

The pinned-stack prototype found 25 pdfminer NUL glyphs in the supplied finance
PDF. On page 6, pypdfium2's PDFium 7913 text layer reports `>` and `<` boxes
whose centers are each 1.57 pt from a unique NUL box and whose intersection
covers the smaller box. The other 23 NUL glyphs do not qualify. The
implementation decision is `AUGMENT`: use those two libraries only behind the
existing Python Document Format Adapter; keep pdfplumber as the sole source for
paragraph order, PageSelector, and BoundingBoxSelector.

The exact pypdfium2 pin and license are recorded in the OSS source registry.
Its upstream repository showed no published security advisory on this review
date. PDFium stays inside the isolated worker and existing input limits. The
strict geometry cases, selector contracts, supplied-finance-PDF result,
downstream direct-text validation, and actual DeepSeek PDF-to-Ask flow are now
recorded in
[`vp-finance-pdf-glyph-recovery-design-2026-09-29.md`](../vp-finance-pdf-glyph-recovery-design-2026-09-29.md).
The wider Stage 8 replacement gate still includes corrupt/encrypted input and
adapter replacement verification; this scoped VP-04 change does not claim
those broader tests or close VP-04.

## 2026-10-01 VP-08 CSV row and spreadsheet formula Ask context

The existing CSV/XLSX decision remains Python's standard-library CSV parser
and `openpyxl` `3.1.5` (`MIT`, exact package pin in
[`oss-source-registry.json`](../oss-source-registry.json)). This change is an
`AUGMENT` behind `PythonDocumentFormatAdapter`; it adds no package or runtime.
The adapter identity is now `shotgun.document-formats@1.9.0`, and the prior
`1.8.0` transformation remains an available rollback target.

- CSV always emits every original non-empty cell with its own `CellSelector`.
  For inputs with at most 256 non-empty cells, it also emits header/value facts
  with selectors for both cells; the common two-column Key/Value form is
  rendered as a single `key: value` fact. Larger CSV inputs retain their raw
  cell Evidence without derived facts, preserving the established 1,600-cell
  output contract and avoiding unbounded duplication.
- XLSX formula cells retain the exact formula string and cell selector while
  adding a `Formula:` label so a question asking about a formula can retrieve
  the cell as evidence. The adapter does not calculate formulas or claim that
  cached workbook results are current.
- Derived facts are limited to CSV inputs with at most 256 non-empty cells, so
  the combined cell/fact output remains bounded; larger inputs return cells
  only. Python unit/format Contract tests pass 37/37; Python
  worker tests pass 18/18; the browser two-action upload/revision/Ask journey
  passes for HTML, CSV, DOCX and XLSX using the deterministic test provider.

The official Python CSV implementation has no new third-party dependency;
the existing `openpyxl` pin, license, security and maintenance record is
unchanged. `CSV` row semantics and formula labeling remain Shotgun-owned
DocumentIR augmentation, isolated behind the adapter and source selectors.
Rollback restores adapter identity `1.8.0` and its prior transform behavior;
no database migration is needed. This product-flow evidence does not by itself
close VP-08: format-specific real-AI corpus coverage, freshness behavior and
the complete input-format acceptance gate remain open.

## 2026-10-01 VP-04 finance formula re-evaluation

The documented Docling re-evaluation trigger was reached by the supplied
finance PDF's formula loss on pages 5–6. Docling `v2.130.0` / commit
`92fc74c36bbd20db9838d7665d38900e5c958319` (MIT) was tested in a temporary
Python 3.12 environment. Default conversion retained layout but emitted empty
formula items and `formula-not-decoded` placeholders; optional CodeFormulaV2
did not finish in over six CPU minutes at approximately 1.9 GB memory. Its
temporary environment occupied 854,390,083 bytes. The production decision
remains `DEFER`; no dependency or product adapter changed. Re-evaluate when
bounded hardware can pass an adjudicated formula Golden corpus. See the
[focused Docling report](../vp-docling-finance-formula-reevaluation-2026-10-01.md)
for package, source, quality and rollback details.

## 2026-10-01 — VP-04 PDF line-boundary augmentation

The pinned pdfplumber `0.11.10` `ADOPT` decision remains unchanged. Its existing physical word lines, PageSelector and BBox selectors are preserved inside each single DocumentIR paragraph using explicit newline separators and exact segment offsets. This is an adapter-local `AUGMENT`; no new library or upstream code was introduced. Stage 8 Python tests cover line/offset preservation, and Stage 4 Contract tests cover splitting newline-separated independent claims. Rollback returns to whitespace-collapsed PDF text under the earlier immutable transformation identity. The actual supplied-PDF DeepSeek browser flow with document-format adapter `1.7.0` passed after the page-grounded gate was added: all 20/20 marker Evidence selectors matched their printed pages; four Ask cases cited expected pages; replay matched; no relation jobs remained. The older adapter `1.6.0` 18/20 run remains historical evidence only.

## 2026-10-02 VP-04 PDFium numeric stacked-fraction repair

Integration decision: `AUGMENT` the already reviewed PDFium 7913 through the
existing `PythonDocumentFormatAdapter` / Transformation Port. The official
upstream repository is <https://github.com/pypdfium2-team/pypdfium2>; the exact
package is `pypdfium2==5.11.0`, tag commit
`0168561b33a3fc32eceb6ae46cc252f6b0e90c19`, licensed `Apache-2.0 OR BSD-3-Clause`.
The pinned `pdfplumber==0.11.10` `ADOPT` remains the owner of reading order,
paragraph segmentation, and Page/BBox selectors. PDFium supplies bounded text
geometry only. Its existing upstream review found no published `SECURITY.md`
policy or advisory on 2026-10-01; the pin, bundled PDFium 7913 license notices,
and upgrade review gate are unchanged.

The supplied PDF exposed an unsafe inline rendering: PDFium geometry placed
`110` above `1 + r` under the numeric prefix `100 =`, but flattening omitted the
denominator grouping and yielded `100 = 110/1 + r`. The adapter now writes a
parenthesized inline denominator when its top-level arithmetic would otherwise
change the fraction's meaning. The existing strict containment and numeric
prefix checks remain; an observed numeric mismatch does not get replaced. No
new upstream code, package, Python runtime, lockfile, database, or Canonical
contract was added. This change does not adopt Docling or another PDF parser.

Evidence: 21/21 PDF glyph Python tests, 30/30 focused Stage 8/SourceMap
contracts, direct conversion of the supplied source, and the actual Chromium +
isolated PostgreSQL + DeepSeek Product extraction flow passed. The live run
matched 23/23 positive markers, excluded 6/6 non-claim canaries, produced 147
direct-evidence assertions from 147 candidates, preserved exact Evidence text,
and replayed with one current relation and no pending jobs. The extraction-only run reported 16,594 DeepSeek tokens. A second full-Ask run
with the same adapter passed six queries with expected answers and citations
on pages 2, 3, 5, and 9; it produced 139 candidates, replayed successfully,
and left seven current relations with no pending jobs. Ask usage and invoice
reconciliation were not recorded. The finance corpus remains
`CANDIDATE`, so this evidence does not close VP-04 or VP-05.

Migration/rollback is data-neutral: revert the denominator reconstruction and
adapter identity from `1.10.0` to `1.9.0`; retain immutable prior transformation
revisions. Replacing pypdfium2 still requires the Page/BBox, formula Golden,
corrupt/encrypted input, and adapter replacement tests. Full details and source
hash are in the [VP finance PDF report](../vp-finance-pdf-flat-formula-verification-2026-10-01.md#2026-10-02-direct-claim-v7-numeric-fraction-repair).
