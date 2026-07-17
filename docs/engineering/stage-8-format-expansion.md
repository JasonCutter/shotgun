# Stage 8 Format Expansion

## 목적

여러 파일 형식을 같은 DocumentIR로 변환하면서 원본 파일과 근거 위치를 잃지 않는다.

## 처리 흐름

Intake → immutable Asset → format worker → DocumentIR/SourceMap → EvidenceSpan

- 텍스트 위치: TextPositionSelector, TextQuoteSelector
- PDF: PageSelector, BoundingBoxSelector
- 표: CellSelector
- PPTX: ShapeSelector, BoundingBoxSelector
- HTML: CssSelector

텍스트 위치는 어댑터가 추출한 정규화 텍스트 기준이다. 각 Entry의
sourceContentHash는 정규화 텍스트가 아니라 변경 불가능한 원본 bytes를 계속 가리킨다.
PDF·Office 문서의 실제 위치는 Page·Cell·Shape·BBox Selector로 복원한다.

## 실행 준비

Python 3.10 이상에서 다음 고정 의존성을 설치한다.

    python -m pip install -r adapters/document-format-python/requirements.lock

기본 실행 파일은 PYTHON 환경 변수로 바꿀 수 있다.

## 실패 상태

- FORMAT_CORRUPT: 파일 구조가 손상됐거나 접근 가능한 텍스트가 없음
- FORMAT_ENCRYPTED: 비밀번호가 필요한 파일
- FORMAT_UNSUPPORTED: 정책상 지원하지 않는 형식
- MULTIMODAL_VALIDATION_REQUIRED: 이미지 의미가 필요하지만 검증 Provider가 없음

오디오·영상 파일, 자동 음성 전사, 프레임·장면 분석은 지원하지 않는다.
영상 페이지는 HTML에 공개된 제목·설명·자막·스크립트 텍스트만 처리한다.

## 현재 한계

- DOCX 페이지 번호는 OOXML 자체에 고정되지 않으므로 문단·표 셀 위치를 보존한다.
- PDF는 word 단위 읽기 순서를 사용한다. 복합 다단·복합 표는 Docling 재평가 조건이다.
- PPTX 그룹 shape·차트·발표자 노트는 현재 Golden 범위 밖이다.
- URL Fetch의 운영 구현은 redirect별 DNS/IP 재검증과 응답 제한을 추가해야 한다.
