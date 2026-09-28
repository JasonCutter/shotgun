# VP 직접 주장 숫자 예시 추출 — 2026-09-28

## 범위와 결정

실제 `재무제표재무관리__2026-09-27.pdf`의 `1억원 = 6천만원 + 4천만원`은 원문 Evidence에 있었지만 기존 `direct-claim-v1` DeepSeek 출력 63개 주장에는 없었다. Provider 출력은 잘리지 않았고 107개 문장 Evidence에 대해 출력 토큰 3544개를 사용했다. 명시된 수치 예시와 등식도 계산하거나 정정하지 않고 원문에서 그대로 복사하도록 추출 지시문을 `direct-claim-v2`로 개정했다.

`CandidateGeneration`의 기본·재추출 작업 키와 AI Provider의 입력·요청 digest, 호출·출력의 prompt version을 함께 개정했다. 저장된 v1 호출과 출력은 읽을 수 있도록 Contract와 JSON Schema가 v1·v2를 모두 허용한다. 원문 연속 부분 문자열 검증, Evidence ID 결합, Stage 4 Validation, 현재 SourceVersion·접근 범위·민감도 검사는 유지한다.

## OSS Integration Decision

- 기존 [gbrain](https://github.com/garrytan/gbrain) `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` (MIT)의 Fact 추출 패턴은 `REFERENCE_ONLY`를 유지한다. Shotgun의 Evidence ID·SourceVersion·보안 범위·Stage 4 출력 계약을 대체하는 Runtime이나 DB는 도입하지 않는다.
- 이 변경은 기존 `AIProviderAdapterPort`와 DeepSeek 연결을 `AUGMENT`한다. 새 OSS나 Version pin은 없으며, 기존 Role Matrix의 소유권과 교체 경계는 바뀌지 않는다. v2가 품질 기준에 미달하면 추출 지시문과 새 작업 키를 v1로 되돌린다. Schema Migration은 없다. 이미 기록된 원장 이력은 삭제하지 않고 SourceVersion과 정책별 재평가로 처리한다.
- gbrain 코드는 실행·복사하지 않아 해당 upstream의 유지보수·취약점 상태를 제품 의존성으로 승격하지 않는다. 새 외부 전송도 없으며 기존 Project 인가와 DeepSeek 전송 정책을 통과해야 한다. 실제 PDF PoC 결과는 아래와 같고 Golden Corpus·Benchmark는 아직 없다. 이 결정은 Open-source Role Matrix의 `REFERENCE_ONLY` 역할을 바꾸지 않으므로 매트릭스 개정은 필요하지 않다.
- 출력 품질은 아래 단일 실제 PDF에서 확인했다. 형식별 Golden Corpus와 대표 Benchmark 결과가 없으므로 VP-3·OSS Integration 완료로 판단하지 않는다.

## 실제 제품과 계약 검증

분리된 `shotgun_vp_route` DB의 동일 PDF SourceVersion을 실제 브라우저 API에서 재추출했다. DeepSeek의 v2 출력으로 Candidate가 63개에서 75개가 됐고, `1억원 = 6천만원 + 4천만원`이 `READY` 후보와 `READY` Validation으로 기록됐다. 검사 시점의 VP Ledger에는 PDF 주장 72개가 있었다. 사용자 DB `shotgun_vp`는 이 검증으로 변경하지 않았다.

추가된 PDF의 `자산이 1 억 원이고 부채가 6 천만 원이면 자본은 4 천만 원이다`와 다른 Markdown Source의 `자산은 1억 원, 부채는 6천만 원이며 자본은 4천만 원이다.` 사이에 실제 자동 관계 작업이 생성·완료됐다. `deepseek/deepseek-flash`가 `EQUIVALENT` 관계와 입력 460·출력 60 토큰의 결정 영수증을 남겼다. 별도 산술 등식 후보 `1억원 = 6천만원 + 4천만원`과 Markdown의 관계 작업은 검사 시점에 `PENDING`이었다.

Stage 4 in-memory·in-process Contract 테스트는 v2 지시문이 수치 예시를 명시하고, 반환한 등식이 원문 부분 문자열 검증을 거쳐 `READY`가 되는 것을 확인한다. 기존 v1 출력 Fixture와 재생 테스트도 유지한다.

## 남은 Gate

- 기존 SourceVersion에 v2를 자동 적용하는 정책 개정 재처리 작업은 아직 없다. 위 검증에서는 API 재추출을 명시적으로 실행했다. 새 자료는 자동 v2를 사용하지만, 기존 사용자 자료의 무조작 보충은 별도 구현이 필요하다.
- 위 수치 예시의 한 쌍은 실제 관계 결정까지 확인했다. 별도 산술 등식 쌍의 대기, 다른 자료·조건·시점의 대표 관계 품질은 남아 있으므로 한 쌍의 성공만으로 전체 지식 통합과 최신성 완료를 선언하지 않는다.
- 대표 Golden Corpus의 추출 재현율·오탐률, 비용, 재시작·전체 재생 동등성 및 Adapter 교체 검증이 VP 완료 기준에 남아 있다.
