<!-- Canonical source: https://app.notion.com/p/39f5181d71ad8160b1bad342d25f7ac0 -->

## 문서 관리
- 범위: Section 20.1\~20.9
- 상태: **확정 설계**
## 20.1 출력 채널·형태
`DeliveryPackage`는 동일한 `ResultArtifact`를 여러 출력 채널에 투영한다.
지원 채널:
- 대화·검색 화면
- 상세 검토 화면과 원문 viewer
- 문서·보고서·슬라이드·표·이미지
- 다운로드 파일·내보내기 묶음
- 알림·개인 피드
- 읽기 전용 API·Webhook 조회 결과
채널별 표현은 달라도 사실 층, Citation, 사용 모드, 접근 범위, 생성 버전과 Conflict·Gap 상태는 동일하게 유지한다. 화면에서 보이던 경고·Citation을 파일 내보내기에서 조용히 제거하지 않는다.
결과 생성과 전달을 분리한다. 파일 생성은 비공개 읽기 결과일 수 있지만 외부 주소 전송·공개 게시·공유 권한 변경은 Step 21 Action이다.
## 20.2 읽기 API 계약
읽기 API는 외부 상태를 바꾸지 않는 명시적 자원 계약을 제공한다.
주요 자원:
- Canonical Fact·Claim·Entity·Relation·Event·Decision·Directive·Conflict
- Compiled Truth snapshot
- SourceVersion·EvidenceSpan·Citation lookup
- HistoryEvent·Canonical revision
- Semantic Graph node·edge·경로
- ResultArtifact·DeliveryPackage·readiness
공통 기능:
- 사용자·프로젝트·시간·상태·유형 필터
- cursor 기반 페이지네이션
- field selection·expand·include
- snapshot·watermark 고정 조회
- ETag·conditional request
- 명시적 오류·부분 결과·readiness 상태
읽기 API는 미승인 후보를 기본 응답에 포함하지 않는다. 후보 조회는 별도 권한·endpoint·명시적 상태 표시를 요구한다. API key와 사용자 토큰의 접근 범위를 결합하고 데이터 존재 여부 자체가 권한 밖으로 유출되지 않도록 한다.
## 20.3 문서·파일 내보내기
지원 후보 형식:
- Markdown·HTML·plain text
- PDF
- DOCX·PPTX·XLSX 등 Office
- JSON·JSONL·CSV·TSV
- Citation·Provenance manifest
내보내기 요청은 출력 목적, 포함 범위, snapshot, 언어, 템플릿, Citation 수준과 민감정보 정책을 가진다. 원본 파일을 그대로 포함하는지, 일부 Evidence만 인용하는지, 파생 결과만 제공하는지 구분한다.
CSV·스프레드시트 내보내기는 수식 주입을 막기 위해 위험한 셀 시작 문자를 중립화하고 원래 값을 별도 메타데이터로 보존할 수 있다. HTML·Office·PDF는 외부 링크·스크립트·매크로·첨부를 기본 비활성화하거나 안전하게 정리한다.
## 20.4 인용·계보 패키징
모든 내보내기는 `ProvenanceManifest`를 포함하거나 안정적으로 참조한다.
필수 정보:
- ResultArtifact·DeliveryPackage ID와 revision
- 사용 모드·질문·생성 시각
- Canonical snapshot·Projection watermark
- 사용한 Fact·Claim·SourceVersion·EvidenceSpan
- 외부 조사 URL·조회 시각·digest
- 번역·VisualAnalysis·모델·프롬프트·정책 버전
- Conflict·Gap·불확실성·모델 불일치
- 접근 범위·마스킹·재배포 제한
PDF·Office처럼 구조화 manifest를 직접 읽기 어려운 형식은 각주·참고문헌·부록과 동반 JSON manifest를 제공할 수 있다. Citation은 원문 위치로 되돌아갈 수 있어야 하며 filename만으로 근거를 표시하지 않는다.
## 20.5 접근 제어·마스킹
출력 권한은 요청자 권한, 포함 Canonical·Source 권한과 대상 채널의 공개 범위를 함께 계산한다.
원칙:
- 가장 제한적인 자원의 정책을 상속한다.
- 권한 없는 항목은 단순 숨김이 아니라 결과의 의미가 달라지는지 판단한다.
- 부분 공개 시 redaction placeholder와 누락 이유를 표시한다.
- 개인식별·비밀·자격 증명·민감 필드는 정책에 따라 마스킹·제외·토큰화한다.
- 모델에게 전달하기 전 최소 필요 범위로 줄인다.
- 내보내기 파일 자체에 분류·소유자·만료·공유 제한 메타데이터를 포함할 수 있다.
권한 변경 후 기존 다운로드 링크·API cache·공유 패키지는 만료 또는 재검증한다. 권한 밖 데이터의 제목·개수·관계 존재 여부도 유출하지 않는다.
## 20.6 버전·재현성
각 결과는 다음 버전에 결속한다.
- 사용자 요청과 QueryPlan revision
- Canonical snapshot·Compiled Truth·검색·Graph watermark
- SourceVersion·Evidence digest
- 모델·프롬프트·도구·템플릿·정책 버전
- 렌더러·내보내기 변환기 버전
`reproduce`는 같은 입력과 버전에서 논리적으로 동일한 결과를 재생성하는 기능이다. 생성형 모델의 byte-identical 출력은 보장하지 않으며 원래 생성물을 불변 보존하고 재생성 결과를 새 revision으로 저장한다.
시간 의존 외부 조사와 최신 API 결과는 당시 snapshot·응답 digest를 보존하지 못하면 완전 재현 불가로 표시한다.
## 20.7 대용량·스트리밍·성능
긴 답변·대형 문서·Graph·내보내기는 점진적으로 제공한다.
- 먼저 메타데이터·계획·readiness를 반환한다.
- 답변과 문서는 안정된 block 단위로 스트리밍한다.
- Citation과 경고가 확정되기 전 사실 진술을 최종 상태로 표시하지 않는다.
- 대형 표·Graph는 페이지네이션·가상화·요약과 상세 drill-down을 사용한다.
- 사용자는 생성·렌더링·내보내기를 취소할 수 있다.
- 취소된 결과는 불완전 상태로 표시하고 완성본처럼 재사용하지 않는다.
- cache key는 접근 범위·snapshot·mode·policy를 포함한다.
시각 결과는 최종 렌더링 완료 후 멀티모달 검증을 수행한다. 스트리밍 중간 화면은 최종 품질 검증을 통과한 결과와 구분한다.
## 20.8 접근성·다국어 표시
한국어를 기본 표시 언어로 사용하되 원문과 번역을 전환할 수 있다. 번역문은 Evidence가 아니며 Citation은 원문에 연결한다.
접근성 원칙:
- 키보드만으로 Citation·Conflict·Graph·승인 정보 탐색
- 색상 외 텍스트·아이콘·패턴으로 상태 구분
- 표·Graph·차트의 목록·텍스트 대안
- 이미지·도표 alt text와 데이터 표
- 화면 확대·고대비·스크린리더 구조
- 긴 결과의 제목 계층·목차·랜드마크
- 시간·수량·단위·날짜의 locale 표시와 원래 값 보존
AI가 만든 alt text·시각 설명은 원본 시각 영역과 결속하고 멀티모달 검증을 거친다.
## 20.9 공유·게시와 쓰기 경계
다음은 읽기 결과 제공이다.
- 사용자 개인 화면 표시
- 권한 내 로컬 다운로드 생성
- 읽기 API 응답
- 사용자에게 비공개 초안 제공
다음은 Step 21 쓰기 Action이다.
- 이메일·메시지·알림 발송
- 공개 사이트·블로그·SNS 게시
- 공유 링크 생성·권한 변경
- 타 사용자·조직 저장소에 파일 업로드
- 기존 외부 문서·파일 수정
- Webhook·API로 외부 시스템 상태 변경
사용자가 “내보내기”라고 표현해도 대상이 외부 서비스이면 Action으로 분류한다. 외부 공개 직전에는 렌더링·Citation·민감정보·대상·권한을 다시 검증한다.
