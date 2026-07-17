# ADR-092 — Stage 12 Module and OSS Reuse Validation

- 상태: Accepted
- 날짜: 2026-07-17

## 결정

1. 첫 재사용 제품은 `shotgun.document-review@1.0.0` Assembly다. Intake부터 Review까지
   필요한 9개 모듈만 등록하며 Canonical Knowledge와 외부 Action 모듈은 포함하지 않는다.
2. Assembly Manifest는 Module version range, 필수 Capability, Adapter 선택과
   Canonical·Action·오디오/영상 정책을 선언한다. 시작 전에 Module SDK가 이를 검증한다.
3. lucas의 Highlight locator를 `@shotgun/lucas-text-locator@1.0.0`으로 `EXTRACT`한다.
   고정점은 `ad626a3d81be1480e35ef4e94234de8dbb27a61e`, 라이선스는 Apache-2.0이다.
4. 추출 패키지는 Shotgun Kernel·DB·AI SDK에 의존하지 않는다. Unicode code-point 위치,
   공백 정규화, prefix/suffix 구분과 모호한 반복 문구 거부만 제공한다.
5. `diff@9.0.0`은 계속 `ADOPT`하지만 `TextDiffPort` 뒤에 둔다. Stage 12의
   `SimpleTextDiffAdapter` 교체 시험은 Comparison·Review Domain 수정 없이 통과해야 한다.
6. ddsyasas의 action 중심 진입·busy 상태와 OpenKnowledge의 activity·diff·evidence grouping은
   `documentReviewUxMockContract@1.0.0`으로만 표현한다. Backend와 GPL 코드는 포함하지 않는다.
7. gbrain은 Document Review의 필수 Capability를 제공하지 않으므로 Runtime과 DB를 설치하지
   않는다. Research Assistant가 실제 Brain 상호운용을 요구할 때 별도 Adapter로 재평가한다.

## 결과

- Shotgun 애플리케이션, PostgreSQL과 Gemini 없이 독립 In-memory Review 흐름을 실행한다.
- Storage·AI·Transport·Diff Adapter를 조립 시점에 교체한다.
- 추출 패키지를 tarball로 만든 뒤 별도 프로젝트에 단독 설치해 실행한다.
- Package 또는 Adapter를 되돌려도 Canonical 데이터 migration은 없다.

## 제외 범위

- npm Registry 공개 배포
- gbrain Runtime·DB와 양방향 동기화
- 실제 외부 AI·Storage·Action Provider
- Research Assistant·Work Automation의 제품 UI
