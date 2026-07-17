# Stage 12 OSS Integration Review

- 검토일: 2026-07-17
- 대상: Module Packaging, Assembly Manifest, Adapter Replacement, UX Mock Contract
- OSS Gate: **COMPLETE**
- 상세 등록부: [oss-source-registry.json](../oss-source-registry.json)

## 완료 판정

**Stage 12: COMPLETE**

## Integration Decision

| 후보                  | Pin·License            | 결정            | 포함 범위                               | 제외 범위                   |
| --------------------- | ---------------------- | --------------- | --------------------------------------- | --------------------------- |
| lucasastorian/llmwiki | `ad626a3d`, Apache-2.0 | EXTRACT         | quote 정규화·문맥 구분·Unicode 위치     | DB·VaultFS·MCP·Watcher      |
| jsdiff                | 9.0.0, BSD-3-Clause    | ADOPT           | 기본 `TextDiffPort` Adapter             | Domain type·Review 권한     |
| garrytan/gbrain       | `a25209b`, MIT         | REFERENCE_ONLY  | Assembly 비교·재평가 기준               | Document Review runtime·DB  |
| ddsyasas/llm-wiki     | `e8dd69e`, MIT         | REFERENCE_ONLY  | action 중심 진입·busy 상태 UX Mock      | backend·SQLite·LLM client   |
| Inkeep OpenKnowledge  | `f2834c2`, GPL-3.0+    | REFERENCE_ONLY  | activity·diff·evidence grouping UX Mock | GPL code·Yjs·Canonical sync |
| SimpleTextDiffAdapter | Shotgun 1.0.0          | NO_RELEVANT_OSS | jsdiff 제거·rollback Contract 검증      | 고급 word diff              |

## 재사용 경계

- `@shotgun/lucas-text-locator@1.0.0`은 Node.js 외 runtime dependency가 없는 Extract Package다.
- `LucasAugmentedPlainTextAdapter`만 Extract Package를 알고 Transformation·Evidence Module은
  기존 Port만 사용한다.
- `shotgun.document-review@1.0.0`은 Stage 2~5의 9개 모듈만 조립한다.
- Canonical Knowledge, PostgreSQL, Gemini, gbrain과 외부 Action은 기본 Assembly에 없다.
- ddsyasas·OpenKnowledge는 versioned Mock Contract의 화면 상태·필드 이름만 제공한다.

## Contract·Package·교체 검증

- Assembly Manifest runtime·Module version·Capability·정책 검증: PASS
- Canonical writer 없는 In-memory Intake→Review E2E: PASS
- In-memory와 In-process Transport 교체: PASS
- In-memory Storage 교체와 hash 검증: PASS
- Fake AI Provider 교체: PASS
- jsdiff → `SimpleTextDiffAdapter` 교체, Domain Module 변경 0: PASS
- lucas Unicode·공백·prefix/suffix·모호성 Contract: PASS
- Stage 3 기존 SourceMap·Evidence Golden 회귀: PASS
- tarball build와 Apache LICENSE·notice 포함: PASS
- 별도 Project 단독 설치·실행, Shotgun App dependency 0: PASS
- ddsyasas·OpenKnowledge UX Mock Contract: PASS

## Migration·Rollback

- 공개 Module Contract는 1.x로 유지되어 데이터 migration이 없다.
- Extract Package upgrade 실패 시 lockfile을 1.0.0으로 되돌린다.
- jsdiff 교체 실패 시 `JsDiffAdapter`를 다시 선택한다.
- upstream은 자동 sync하지 않으며 후보 commit별 Golden·Package·Assembly Test를 통과해야 한다.
- 상세 절차는 [Compatibility, Migration and Rollback](../stage-12-module-compatibility-and-migration.md)을 따른다.

## 알려진 제한과 재검토 조건

- 패키지는 로컬 tarball로 검증했으며 npm Registry에는 공개하지 않았다.
- Document Review가 첫 실제 Assembly다. Research Assistant와 Work Automation은 같은
  Manifest validator를 사용하되 제품별 UI·외부 Provider는 별도 범위다.
- gbrain 상호운용 요구가 생기면 Shotgun Query/Projection Port 뒤의 read-only Adapter부터 검증한다.
- Simple Diff는 rollback용 최소 구현이며 기본 UX 품질은 jsdiff가 더 높다.
