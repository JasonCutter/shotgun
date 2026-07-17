# Stage 12 Package Compatibility, Migration and Rollback

## Version Compatibility Matrix

| 구성 요소                          | Version           | 호환 범위           | 데이터 소유권              |
| ---------------------------------- | ----------------- | ------------------- | -------------------------- |
| `shotgun.document-review` Assembly | 1.0.0             | Runtime `>=1 <2`    | 없음                       |
| Stage 2~5 선택 Module              | 1.0.0             | Module `>=1 <2`     | 각 Module Manifest 기준    |
| `@shotgun/lucas-text-locator`      | 1.0.0             | Node.js `>=20`      | 없음                       |
| `lucasastorian/llmwiki` upstream   | commit `ad626a3d` | 패키지 1.0.0 기준선 | 포함하지 않음              |
| `diff` / `JsDiffAdapter`           | 9.0.0             | `TextDiffPort` 1.x  | 없음                       |
| `SimpleTextDiffAdapter`            | 1.0.0             | `TextDiffPort` 1.x  | 없음                       |
| `documentReviewUxMockContract`     | 1.0.0             | Review API 1.x      | View 상태만, 승인권한 없음 |

Assembly는 선언하지 않은 Module, 1.x 범위를 벗어난 Module, 필수 Capability 누락,
Canonical writer 또는 외부 Action executor 유입을 시작 전에 거부한다.

## 0.x에서 1.0.0으로 이동

1. `npm ci`로 `@shotgun/lucas-text-locator@1.0.0` workspace package를 고정한다.
2. 기존 `LucasAugmentedPlainTextAdapter` 공개 Port는 유지한다. 호출자 변경은 없다.
3. 새 제품은 `createDocumentReviewAssembly()`를 사용하고 필요한 Adapter만 넘긴다.
4. Assembly 시작 시 Manifest 검증을 통과한 뒤 기존 Command·Event·Query 1.x를 사용한다.

영속 Schema와 Canonical 데이터는 바뀌지 않으므로 데이터 migration은 없다.

## Adapter 교체와 기능 축소

| 제거 대상        | 대체·축소 방법                                         | 유지되는 기능                   |
| ---------------- | ------------------------------------------------------ | ------------------------------- |
| `diff@9.0.0`     | `SimpleTextDiffAdapter` 선택                           | Diff contract·Digest·Review     |
| lucas locator    | 이전 package 1.0.0 pin 또는 다른 `EvidenceLocatorPort` | SourceMap·EvidenceSpan contract |
| 외부 AI Provider | `FakeAIProviderAdapter`                                | 직접 Claim 후보 Contract        |
| 외부 Storage     | `InMemoryAssetStorage`                                 | Hash 검증·Asset Reference       |
| gbrain           | 설치하지 않음                                          | Document Review 전체 기능       |

`SimpleTextDiffAdapter`는 단순 prefix/suffix Diff이므로 문장·단어 단위 품질은 jsdiff보다
낮을 수 있다. 기능은 유지되지만 Review 가독성이 축소된 상태임을 UI에 표시해야 한다.

## Upstream Sync Drill

2026-07-17에 다음 연습을 완료했다.

1. lucas 저장소의 고정 commit `ad626a3d`를 별도 작업 폴더에 fetch했다.
2. `api/html_parser/parser.py`의 정규화·index map·context scoring 경계를 다시 확인했다.
3. Python·SQLite·VaultFS·MCP를 제외하고 TypeScript 패키지를 build·pack했다.
4. Apache-2.0 LICENSE와 Third-party notice가 tarball에 포함됨을 확인했다.
5. 별도 프로젝트에 패키지 하나만 설치해 Unicode 위치 복원을 실행했다.
6. Golden·SourceMap·모호성·Assembly Contract가 실패하면 1.0.0 pin을 유지하는 rollback을
   선택하도록 정했다.

향후 sync는 후보 commit을 먼저 별도 Branch에서 평가하며 `main`이 자동으로 upstream을
따라가지 않는다.

## Rollback

1. 새 Assembly 진입점을 비활성화한다.
2. locator는 직전 tarball과 lockfile로 pin을 되돌린다.
3. diff는 `JsDiffAdapter` 또는 검증된 대체 Adapter로 선택을 되돌린다.
4. `npm run test:stage12-package`와 Stage 3·5·12 Contract Test를 다시 실행한다.
5. 데이터 migration은 없으며 In-memory Assembly 데이터는 폐기한다.
