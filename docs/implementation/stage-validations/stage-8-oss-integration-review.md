# Stage 8 OSS Integration Review

- 검토일: 2026-07-17
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
