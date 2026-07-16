# Stage 3 — Plain Text Transformation and Evidence

## 상태

**COMPLETE — 2026-07-17**

Stage 2에서 보존한 원본 텍스트를 `DocumentIR`로 변환하고, 원문의 정확한 위치를
`SourceMap`과 `EvidenceSpan`으로 복원할 수 있다.

## 실행 흐름

```text
POST /intake
→ OriginalAssetStored
→ Plain Text Transformation
→ DocumentTransformed
→ Evidence indexing
```

조회 API:

- `POST /documents/resolve` — SourceVersion의 DocumentIR·SourceMap
- `POST /evidence/list` — SourceVersion의 Evidence 목록
- `POST /evidence/resolve` — EvidenceSpan과 정확한 원문

모든 요청은 `x-project-id`, `x-actor-id`, `x-access-scope`, `x-sensitivity` 보안 문맥을
사용하며 기본값은 로컬 owner 개발 흐름이다.

## 폴더 구조

```text
modules/
  transformation/              DocumentIR·SourceMap·Attempt·Revision
  evidence/                    Evidence 검증·저장·원문 복원
adapters/
  plain-text-lucas-augmented/  Plain text 변환·인용 위치 탐색
  stage3-in-memory/            Contract Test 저장소
  postgres-stage3/             영속 저장소
db/migrations/
  003_stage3_transformation_evidence.sql
tests/
  fixtures/stage-3-plain-text-golden.json
```

## 핵심 데이터

- `DocumentIR`: 문단과 문장 순서를 가진 형식 중립 문서
- `SourceMap`: JSON Pointer 노드와 원본 위치·인용문·hash 연결
- `EvidenceSpan`: 검증이 끝난 원문 구간
- `TransformationAttempt`: 변환 실행 기록
- `TransformationRevision`: 같은 SourceVersion·변환기 version에서 재사용되는 결과

위치는 JavaScript UTF-16 index가 아니라 Unicode code point로 계산한다. 따라서 한국어와
emoji가 섞여도 같은 start/end 값을 얻는다.

## 실행 및 검증

```powershell
$env:DATABASE_URL = 'postgres://shotgun:shotgun@localhost:5432/shotgun'
docker compose up -d --wait
npm run db:reset
npm run check
npm run test:database
```

## 제한

- 문장 분리는 MVP 구두점 규칙이며 언어별 NLP 문장 분석기가 아니다.
- Markdown 문법 구조는 아직 DocumentIR heading/list로 변환하지 않는다.
- 번역·요약·주석은 Source origin과 분리되며 EvidenceSpan으로 승격되지 않는다.
