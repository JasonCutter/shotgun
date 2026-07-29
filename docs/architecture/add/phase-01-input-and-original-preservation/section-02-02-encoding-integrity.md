<!-- Canonical source: https://app.notion.com/p/39f5181d71ad81c092e1fe015ffb683a -->

회의 상태: 완료
결정일: 2026-07-15
### 확정 결정
1. Section 2.2는 직접 텍스트 입력, 일반 텍스트·Markdown·CSV·JSON·XML·YAML 파일, HTML·HTM 파일과 URL에서 받은 HTML 바이트, MHTML의 MIME 헤더·루트 HTML·텍스트 파트에 적용한다. PDF, 이미지, DOCX·XLSX·PPTX의 내부 본문은 이 단계에서 추출하지 않고 NOT_APPLICABLE로 통과시켜 Step 4의 형식별 변환기에 맡긴다.
2. 직접 텍스트는 브라우저와 API가 해석한 Unicode 문자열로 접수하고 서버 저장·전송 표현은 UTF-8을 사용한다. 입력된 Unicode 코드 포인트 순서를 보존하며 짝이 없는 surrogate, 유효하지 않은 Unicode scalar value와 NUL 문자는 거부한다. NFC·NFKC 정규화, 스마트 따옴표 변환과 전각·반각 변환을 입력 단계에서 수행하지 않는다.
3. 초기 지원 문자 인코딩은 UTF-8, UTF-8 BOM, BOM이 있는 UTF-16LE·UTF-16BE, 명시적으로 선언됐거나 근거가 명확한 CP949·EUC-KR로 제한한다. BOM 없는 UTF-16 추정과 Windows-1252·ISO-8859-1·Shift_JIS·GB18030 등 광범위한 레거시 인코딩 자동 추정은 제공하지 않는다.
4. CP949와 EUC-KR 중 하나로만 무손실 해석되거나 신뢰 가능한 선언이 있는 경우에만 레거시 인코딩을 통과시킨다. 둘 다 해석 가능하지만 결과가 다르면 AMBIGUOUS_ENCODING으로 차단한다.
5. 일반 텍스트 파일은 BOM, 엄격한 UTF-8 유효성, 형식 내부의 명시적 charset, CP949·EUC-KR 제한 판정 순으로 검사한다. URL HTML은 BOM, HTTP Content-Type charset, HTML meta charset, 엄격한 UTF-8 순으로 검사한다. XML은 BOM, XML encoding 선언, 엄격한 UTF-8 순으로 검사한다. MHTML 파트는 전송 인코딩 해제 후 BOM, MIME Content-Type charset, HTML·XML 내부 선언, 엄격한 UTF-8 순으로 검사한다. 사용된 선언과 선택 이유를 모두 기록한다.
6. 서로 다른 charset 선언이 있어도 실제 내용이 ASCII 범위로만 구성돼 디코딩 결과가 동일하면 경고와 충돌 기록을 남기고 통과할 수 있다. 비ASCII 바이트가 있고 선언이 충돌하면 CHARSET_CONFLICT로 차단한다.
7. 모든 디코더는 오류 대체가 아닌 strict 모드로 실행한다. 잘못된 바이트 시퀀스가 하나라도 있으면 INVALID_BYTE_SEQUENCE로 차단하며 대체 문자 삽입, 바이트 삭제, 가장 가까운 문자 추정, mojibake 자동 복구와 자동 인코딩 재저장은 하지 않는다. 사용자는 올바른 인코딩의 UTF-8 파일로 다시 저장해 새 항목으로 제출한다.
8. MHTML의 Content-Transfer-Encoding은 base64, quoted-printable, 7bit, 8bit, binary를 식별하고 Base64와 quoted-printable은 엄격한 규칙으로 해제한다. 잘못된 패딩, 이스케이프 또는 잘린 파트는 TRANSFER_DECODE_FAILED로 차단한다. 각 텍스트 파트는 개별 charset 결과를 가지며 이미지 등 바이너리 파트는 문자 디코딩 대상이 아니다.
9. 줄바꿈 형식(LF·CRLF·CR·혼합), BOM 존재, Unicode 정규화 상태, 탭·일반 공백·non-breaking space·zero-width 문자와 방향 제어 문자는 감지·기록만 하고 Section 2.2에서 변경하지 않는다. 실제 줄바꿈·공백·Unicode 정규화는 원문 위치 Source Map과 함께 Step 4에서 수행한다.
10. 탭·CR·LF를 제외한 C0·C1 제어 문자의 존재와 개수를 기록한다. 디코딩 결과에 NUL이 있거나 제어 문자 패턴이 비정상적으로 높으면 BINARY_SUSPECTED로 차단하고 텍스트로 강제 변환하거나 Base64 문자열로 지식화하지 않는다. zero-width·방향 제어 문자의 악용 가능성과 표시 정책은 Section 2.4에서 판단한다.
11. Section 2.2 판정 상태는 NOT_APPLICABLE, ENCODING_CONFIRMED, ENCODING_DECLARED, LEGACY_ENCODING_CONFIRMED, CHARSET_CONFLICT, AMBIGUOUS_ENCODING, INVALID_BYTE_SEQUENCE, TRANSFER_DECODE_FAILED, INVALID_UNICODE, BINARY_SUSPECTED로 구분한다. 사용자 경고·차단·재제출 메시지 연결은 Section 2.7에서 확정한다.
12. 출력에는 적용 여부와 상태, 원본 바이트 참조·해시, 선언된 charset과 선언 위치, BOM 유형, 선택 인코딩·판정 방법·확실성, 디코딩 성공 여부와 오류 위치·개수, 전송 인코딩 결과, 줄바꿈 프로파일, Unicode 정규화 상태, NUL·제어·zero-width·방향 제어 플래그, 디코딩 파생 텍스트 임시 참조·해시, 다음 Section 진행 가능 여부와 사유 코드를 포함한다.
13. 디코딩된 텍스트는 원본을 대체하지 않는 재생성 가능한 파생 표현으로 취급한다. 원본 바이트를 UTF-8로 덮어쓰거나 복구된 문자열을 원본으로 승격하지 않으며 영구 보존·버전·재생성 계약은 Step 3에서 확정한다.
### 결정 근거
Shotgun은 원문 근거를 기반으로 지식 후보를 생성하므로 글자 하나의 잘못된 해석도 이후 Claim과 Entity를 오염시킬 수 있다. 따라서 폭넓은 자동 추정보다 무손실·엄격한 디코딩을 우선하고, 한국어 환경에서 실제 사용 가능성이 있는 CP949·EUC-KR만 제한적으로 지원한다. 원본 바이트와 파생 텍스트를 분리하면 재검증과 파서 버전 변경에도 원문을 유지할 수 있다.
### 제외한 대안
UTF-8만 허용하는 방식, 광범위한 세계 레거시 인코딩 자동 추정, BOM 없는 UTF-16 추정, 충돌한 charset 중 우선순위 하나를 조용히 선택하는 방식, 대체 문자 삽입·바이트 삭제·mojibake 자동 복구, Section 2.2에서 줄바꿈·Unicode를 즉시 정규화하는 방식, 바이너리 의심 자료를 텍스트나 Base64로 강제 지식화하는 방식은 채택하지 않는다.
### 영향 범위와 후속 검토
Section 2.3은 디코딩된 JSON·XML·YAML·CSV·HTML·MHTML의 문법·구조 무결성, 손상·암호화·빈 자료와 처리 가능성을 검토한다. Section 2.4는 zero-width·방향 제어 문자, 스크립트·외부 참조·컨테이너 위험과 격리를 검토한다. Section 2.7은 인코딩 오류와 UTF-8 재제출 안내를 사용자 메시지로 연결한다. Step 3은 원본 바이트와 디코딩 파생 결과의 저장·버전·재생성 계약을 정하고 Step 4는 줄바꿈·Unicode·공백 정규화와 Source Map을 동시에 생성한다.
### 미결사항
Section 2.2의 정책 수준 미결사항은 없다. CP949·EUC-KR 판정 라이브러리와 확실성 기준, 제어 문자 비율 임계값, 오류 바이트 위치 표현, MHTML 필수 텍스트 파트 판정과 내부 상태 코드 구현은 후속 기술 설계에서 확정한다.
