# ADR-088 — Stage 8 Format Adapter and Structural Selectors

- 상태: Accepted
- 날짜: 2026-07-17

## Amendment history

- 2026-09-18 — Phase B amendment: tightened worker cleanup/result-shape,
  image and OOXML preflight, multi-region PDF/HTML selector boundaries, and
  revision-pinned Candidate lineage without changing the original acceptance
  date.
- 2026-09-29 — VP-04 amendment: Markdown ATX headings are separate source ranges;
  following text carries an additive `MarkdownHeadingContext` selector. The
  Shotgun plain-text adapter advances to `1.0.2`; existing revisions remain
  immutable.
- 2026-09-29 — VP-04 amendment: the locked pypdfium2 `5.11.0` build is an
  `AUGMENT` used only to restore uniquely overlapping `<`/`>` glyphs that
  pdfplumber emits as NUL. pdfplumber remains the sole PDF layout and selector
  authority; unmatched damage remains U+FFFD and is rejected by direct-text
  validation. The Python format adapter advances to `1.2.0`.
- 2026-10-01 — VP-04 amendment: the same locked pypdfium2 build may also restore
  a short, single-row equation from glyph geometry only when its compact glyph
  sequence exactly matches pdfplumber output and nearby rows show no stacked
  fraction. Ambiguous equations retain the existing pdfplumber output. The
  Python format adapter advances to `1.3.0`; pdfplumber remains the sole owner
  of paragraph order and SourceMap layout.
- 2026-10-01 — VP-04 amendment: the same locked pypdfium2 build may reconstruct
  a stacked fraction only when numerator and denominator glyph rows overlap
  horizontally around an uppercase equation prefix and every existing
  pdfplumber fragment is contained in the geometry-backed formula. This
  recovers the supplied PDF's PV and NPV formulas; mismatches retain the source
  output. The adapter advances to `1.4.0`; pdfplumber still owns paragraph order
  and SourceMap layout.
- 2026-10-01 — VP-04 amendment: pypdfium2 may also restore a tightly overlapping,
  one-to-one subset of `=`, parentheses, colon, and digits in addition to `<`
  and `>`.
  Letters and other glyphs remain untouched; unmatched markers remain rejected
  by direct-text validation. The supplied PDF's recoverable NUL markers fell
  from 25 to 6 after this augmentation. The Python adapter advances to `1.5.0`.
- 2026-10-01 — VP-04 amendment: stacked-fraction recovery may use a bounded
  uppercase Latin or Korean equation label before `=`. The prefix must still
  align with fraction rows, all existing extracted characters must be present
  in the geometry-backed formula, and the original page/BBox is preserved.
  The Python adapter advances to `1.6.0`.

## 결정

1. Shotgun은 형식별 Adapter를 사용하고 하나의 범용 변환기에 종속되지 않는다.
2. 모든 Adapter는 기존 DocumentIR·SourceMap 상위 계약을 유지한다.
3. binary 원본 hash와 추출 텍스트 위치를 분리하고 Page·BBox·Cell·Shape·CSS
   Selector로 원본 구조 위치를 함께 기록한다.
4. DOCX는 python-docx, XLSX는 openpyxl, PPTX는 python-pptx, PDF는 pdfplumber,
   HTML은 lucas 규칙과 Beautiful Soup을 채택한다.
5. PyMuPDF는 AGPL 라이선스 때문에 기본 Assembly에서 제외한다.
6. 이미지 의미는 MultimodalValidationPort가 있을 때만 추출한다.
7. 오디오·영상 직접 분석, 자동 전사, ffmpeg 활성화는 제외한다.
8. PDF는 단어 단위 Evidence를 만들지 않고 geometry로 결정적인 line/paragraph를
   재구성한다. 각 paragraph는 PageSelector와 여러 physical BoundingBoxSelector를
   보존하며 DocumentIR paragraph 하나와 일대일 대응한다.
9. SourceMap과 sentence Evidence는 paragraph의 physical selector를 상속한다.
10. Python worker는 raw 10 MiB, stdout 8 MiB, stderr 1 MiB, normalized 4 MiB,
    HTML tracked element 512, PDF pages 1000, PDF blocks 8192, selector 16384,
    SourceMap 200000, image description 128000 code point 예산을 적용한다.
    초과는 자르거나 누락하지 않고 non-retryable `VALIDATION_ERROR`로 거부한다.
11. DOCX/XLSX/PPTX/PDF/HTML/image preflight와 corrupt/encrypted/unsupported,
    worker-shape, timeout, OS/process 오류를 구분한다. 명시적 `retryable=false`가
    오류 코드보다 우선한다.
12. Python adapter identity는 1.0.1에서 1.1.0으로 올린다. plain-text identity는
    출력 계약 변경 전까지 올리지 않는다.
13. Markdown ATX headings provide context for following sentence Evidence. The
    SourceMap stores the exact heading path in `MarkdownHeadingContext`; heading
    text, body text, Unicode offsets, SourceVersion hash and Evidence hash stay
    independently verifiable. The plain-text adapter uses version 1.0.2 for
    this additive output behavior.

## 결과

- 원본 bytes는 Stage 2 Asset 계약이 계속 소유한다.
- 형식 라이브러리 교체는 Adapter 내부 변경으로 제한된다.
- Python worker 의존성과 운영 격리가 추가된다.
- 복합 layout 손실이 확인되면 Docling을 Golden 기준으로 재평가한다.
- Stage 3 active authority가 없는 generic `/intake` historical row는 Sources
  current Product의 Evidence/preview/Candidate/Reextract authority가 될 수 없다.
- Candidate AI provider call과 CandidateBatch는 `revision_id`를 relational chain으로
  고정하고, Resume은 원래 Provider record의 pin만 사용한다.
- rollback은 migration 076 적용 전 snapshot/restore와 disposable DB backup/restore
  proof를 사용하며 live DB에서 destructive downgrade를 수행하지 않는다.

## 2026-10-01 — VP-04 PDF physical-line preservation amendment

The pinned `pdfplumber==0.11.10` remains the PDF layout owner. Its worker adapter preserves each physical line break and exact segment offset within a block while retaining the existing invariant `1 Python worker block == 1 DocumentIR paragraph`. This gives Candidate Generation's existing direct-claim splitter visible line boundaries for converter-merged lists. No dependency, PDFium behavior, SourceVersion contract, or selector type changes. `shotgun.document-formats` advances to `1.7.0`; old TransformationRevisions remain immutable. The Stage 8 worker unit test verifies line text/segment offset round-trip. The live DeepSeek ingestion/Ask/replay run and broad list-layout corpus remain open. Rollback restores space normalization and the previous transformation identity.
