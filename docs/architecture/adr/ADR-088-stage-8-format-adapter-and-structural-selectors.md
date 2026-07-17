# ADR-088 — Stage 8 Format Adapter and Structural Selectors

- 상태: Accepted
- 날짜: 2026-07-17

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

## 결과

- 원본 bytes는 Stage 2 Asset 계약이 계속 소유한다.
- 형식 라이브러리 교체는 Adapter 내부 변경으로 제한된다.
- Python worker 의존성과 운영 격리가 추가된다.
- 복합 layout 손실이 확인되면 Docling을 Golden 기준으로 재평가한다.
