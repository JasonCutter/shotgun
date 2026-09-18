# ADR-088 — Stage 8 Format Adapter and Structural Selectors

- 상태: Accepted
- 날짜: 2026-07-17

## Amendment history

- 2026-09-18 — Phase B amendment: tightened worker cleanup/result-shape,
  image and OOXML preflight, multi-region PDF/HTML selector boundaries, and
  revision-pinned Candidate lineage without changing the original acceptance
  date.

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
