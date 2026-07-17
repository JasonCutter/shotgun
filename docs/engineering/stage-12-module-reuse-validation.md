# Stage 12 — Module and OSS Reuse Validation

## 완료 상태

**COMPLETE — 2026-07-17**

## 결과

Shotgun 전체 애플리케이션 대신 필요한 모듈만 조립한 Document Review System을 만들었다.
기본 구성은 메모리에서 실행되며 PostgreSQL, Gemini, Canonical Knowledge와 외부 Action이 필요 없다.

## 주요 산출물

- `assemblies/document-review`: Assembly Manifest와 조립 함수
- `packages/module-sdk/src/assembly.ts`: 시작 전 Module·Capability·정책 검증
- `packages/lucas-text-locator`: 독립 build·pack 가능한 Apache-2.0 Extract Package
- `adapters/text-diff-simple`: jsdiff 제거·교체와 rollback 검증 Adapter
- `examples/lucas-text-locator-consumer`: 별도 최소 설치 Project
- `scripts/stage12-package-test.ts`: tarball build·install·run 자동 검증

## Assembly 흐름

```text
Intake → Original Asset → Transformation → Evidence
→ Fake AI Provider → Candidate → Validation → Comparison → Review
```

Canonical Snapshot Query는 읽기 전용 빈 Adapter가 제공한다. Canonical writer는 등록하지 않는다.

## 실행

```bash
npm run test:contract -- document-review-assembly
npm run test:stage12-package
npm run check
```

`test:stage12-package`는 임시 폴더에서 tarball을 만들고 예제 Project에
`@shotgun/lucas-text-locator` 하나만 설치한 뒤 실제 Node.js 프로세스로 실행한다.

## 완료 기준 검증

| 기준                                 | 증거                                       |
| ------------------------------------ | ------------------------------------------ |
| 필요한 모듈만 등록                   | 9개 Module 목록과 undeclared Module 거부   |
| In-memory 독립 Contract              | Intake→Review E2E                          |
| Canonical Knowledge 없는 구성        | writer·capability 부재 검증                |
| Provider·Storage·Transport 교체      | Fake AI·Recording Storage·In-process 시험  |
| OSS 제거·대체                        | jsdiff를 Simple Diff로 교체, Domain 변경 0 |
| lucas Extract Package                | 1.0.0 build·pack·LICENSE·notice            |
| ddsyasas·OpenKnowledge Mock Contract | UX Contract 1.0.0                          |
| 별도 Project 재사용                  | locator package 단독 설치·실행             |
| Version·Migration·Rollback           | Compatibility 문서와 upstream sync drill   |

## 현재 제한

- 기본 AI는 결정적인 Fake Adapter다. 실제 모델 사용은 별도 data policy와 credential이 필요하다.
- Assembly는 API/UI 서버를 제공하지 않고 재사용 가능한 조립 함수와 Contract를 제공한다.
- npm Registry 공개는 하지 않았다. 로컬 tarball 배포 경계까지만 검증했다.
- Research Assistant와 Work Automation의 실제 제품 Assembly는 향후 제품 요구 시 추가한다.
