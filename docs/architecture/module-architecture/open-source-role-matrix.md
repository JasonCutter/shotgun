# Shotgun Open-source Role Matrix

## 1. 목적

이 문서는 Shotgun Module Architecture에서 각 오픈소스와 표준이 관여할 영역과 역할을 정의한다.

이 배정은 **초기 아키텍처 기준선**이지 영구 채택 목록이 아니다. 개발 과정에서 license, security, maintenance, benchmark, API 안정성, Fork 비용과 Shotgun 계약 정합성에 따라 교체·축소·제외할 수 있다.

## 2. 상태 분류

| 상태                   | 의미                                            |
| ---------------------- | ----------------------------------------------- |
| `REFERENCE`            | 설계·UX·테스트 패턴만 참고하며 런타임 의존 없음 |
| `EXTRACT`              | 일부 코드를 독립 package로 추출·개작 검토       |
| `ADAPTER_CANDIDATE`    | 공통 Port 뒤에 연결할 교체 가능한 구현          |
| `FOUNDATION_CANDIDATE` | 검증 후 기본 구현으로 채택 가능                 |
| `ADOPTED`              | license·security·benchmark Gate 통과            |
| `DEFERRED`             | 필요성이 확인될 때까지 도입 연기                |
| `REJECTED`             | 현재 구조와 중복·충돌이 커서 사용하지 않음      |

Stage 0~2 재검증 결과 PostgreSQL, Ajv, content-addressed storage pattern은 해당 범위에서
`ADOPTED`다. 다른 후보는 Stage별 Source Registry 결정과 Contract 검증을 통과하기 전까지
후보 또는 참고 상태를 유지한다.

## 3. 기존 4개 레퍼런스의 재배치

### 3.1 garrytan/gbrain

**기존 역할:** Shotgun 전체의 핵심 엔진  
**새 역할:** 여러 모듈의 최우선 Reference·Extract Candidate

| 관련 모듈            | 역할                                           | 상태        |
| -------------------- | ---------------------------------------------- | ----------- |
| Orchestration        | Minion Job, retry, timeout, lock recovery 패턴 | `REFERENCE` |
| Canonical Knowledge  | Page·Fact·Relation·Timeline 저장 계약 참고     | `EXTRACT`   |
| Projection           | Search·Graph·Timeline·Gap 읽기 패턴            | `EXTRACT`   |
| Knowledge Discovery  | Dream Cycle과 주기적 탐색 패턴                 | `REFERENCE` |
| Action / Integration | MCP operation contract 참고                    | `REFERENCE` |
| Migration / Recovery | PGLite·PostgreSQL migration과 recovery 패턴    | `REFERENCE` |

**경계**

- gbrain의 전체 Runtime과 데이터 모델을 Shotgun Kernel로 사용하지 않는다.
- gbrain 코드가 사용되더라도 해당 모듈 Adapter 또는 Fork Boundary 안에 둔다.
- Shotgun Claim·Fact 분리, Evidence, 승인, Conflict, History 계약이 우선한다.
- upstream patch를 최소화하고 재사용 가능 package 단위 추출을 우선한다.

### 3.2 lucasastorian/llmwiki

**역할:** 수집·변환·Evidence·검증 부품 공급원

| 관련 모듈        | 역할                                       | 상태        |
| ---------------- | ------------------------------------------ | ----------- |
| Transformation   | HTML cleaner, XLSX extractor               | `EXTRACT`   |
| Evidence         | Highlight·Annotation과 원문 위치 복귀 패턴 | `EXTRACT`   |
| Validation       | deterministic lint 패턴                    | `EXTRACT`   |
| Intake / Runtime | watcher event와 reconcile 패턴             | `REFERENCE` |
| UI               | 원문·사용자 메모·AI 결과 구분              | `REFERENCE` |

**경계**

- SQLite·FTS를 Shotgun Canonical 저장소로 사용하지 않는다.
- VaultFS 전체, MCP CRUD, Routine 등 중복 Runtime은 도입하지 않는다.
- filename 기반 Citation 대신 Stable Source ID와 EvidenceSpan을 사용한다.

### 3.3 ddsyasas/llm-wiki

**역할:** Product Workflow와 운영 UX 참고

| 관련 모듈       | 역할                  | 상태        |
| --------------- | --------------------- | ----------- |
| Intake UI       | Source 등록 흐름      | `REFERENCE` |
| Output UI       | Ask·Chat 흐름         | `REFERENCE` |
| AI Provider UI  | 모델·비용·설정 표시   | `REFERENCE` |
| Home / Activity | Action 중심 정보 계층 | `REFERENCE` |

**경계**

- 기존 backend, ingest/query/lint core, SQLite 저장소, LLM client와 CLI는 사용하지 않는다.
- UI를 가져오더라도 Shotgun typed API와 Module Capability를 기준으로 재구성한다.

### 3.4 Inkeep OpenKnowledge

**역할:** Human Cockpit, Graph, Diff, Editor UX 참고

| 관련 모듈     | 역할                                              | 상태        |
| ------------- | ------------------------------------------------- | ----------- |
| Review UI     | Agent Activity, changed-item grouping, Burst Diff | `REFERENCE` |
| Graph UI      | 2D Graph와 목록 fallback                          | `REFERENCE` |
| Editor        | Visual·Source 전환과 serialization 보존           | `REFERENCE` |
| Canonical UI  | Entity Vault template 개념                        | `REFERENCE` |
| Collaboration | Yjs CRDT 적용 가능성                              | `DEFERRED`  |

**경계**

- 공개 코드와 라이선스가 확인된 범위만 재사용한다.
- 전체 Runtime, Canonical Markdown/Yjs 저장, Git sharing과 중복 MCP는 도입하지 않는다.
- 접근성 있는 목록·표 fallback을 항상 유지한다.

## 4. 모듈별 OSS·표준 후보

### 4.1 Contracts·Connector Runtime

| 후보                                | 역할                                | 상태                   | 교체 경계                |
| ----------------------------------- | ----------------------------------- | ---------------------- | ------------------------ |
| JSON Schema / Ajv 8.20.0            | Payload와 Module Manifest 검증      | `ADOPTED`              | `SchemaRegistry` Adapter |
| OpenAPI                             | 동기 Query·Command HTTP 계약        | `FOUNDATION_CANDIDATE` | Transport Adapter        |
| AsyncAPI                            | Event·Queue 계약 문서화             | `ADAPTER_CANDIDATE`    | Event Transport          |
| CloudEvents                         | Event Envelope 의미와 상호운용 참고 | `REFERENCE`            | Message Envelope mapping |
| Protocol Buffers                    | gRPC·binary contract 후보           | `DEFERRED`             | Serializer Adapter       |
| pluggy 또는 언어별 plugin framework | In-process module registration      | `ADAPTER_CANDIDATE`    | Module Registry          |

### 4.2 Orchestration·Message Bus

| 후보                 | 역할                                 | 상태                   | 비고                                  |
| -------------------- | ------------------------------------ | ---------------------- | ------------------------------------- |
| gbrain Minion        | Job·retry·timeout·lock recovery 패턴 | `REFERENCE`            | Stage 6 전 Extract·Adapter PoC 재평가 |
| Temporal             | durable workflow·retry·timer·saga    | `ADAPTER_CANDIDATE`    | 장기 실행이 실제로 필요할 때          |
| NATS JetStream       | Event Bus·stream·consumer            | `ADAPTER_CANDIDATE`    | 독립 Worker 단계                      |
| Redis Streams        | 경량 Queue·stream                    | `ADAPTER_CANDIDATE`    | MVP 운영 단순성 비교                  |
| PostgreSQL job table | 초기 durable queue                   | `FOUNDATION_CANDIDATE` | 단일 DB MVP 후보                      |

초기 구현은 In-process Bus와 PostgreSQL Job Table을 우선 검토하고, 처리량·복구 요구가 확인되면 Temporal 또는 NATS 계열로 전환한다.

### 4.3 Intake·Original Asset

| 후보                              | 역할                                | 상태                |
| --------------------------------- | ----------------------------------- | ------------------- |
| fsspec                            | 파일·Object Store 추상화            | `REJECTED`          |
| MinIO 또는 S3-compatible API      | 원본 Asset 저장                     | `ADAPTER_CANDIDATE` |
| content-addressed storage pattern | Hash 기반 중복·무결성               | `ADOPTED`           |
| Apache Tika                       | MIME·metadata·범용 텍스트 추출      | `DEFERRED`          |
| Microsoft MarkItDown              | Office·웹 자료의 Markdown 변환 보조 | `ADAPTER_CANDIDATE` |

원본 보존은 변환 도구의 내부 저장 방식에 맡기지 않고 Shotgun Asset 계약이 소유한다.

### 4.4 Transformation

| 후보                  | 담당 형식·역할                          | 상태                |
| --------------------- | --------------------------------------- | ------------------- |
| lucasastorian/llmwiki | HTML cleaner·XLSX extractor             | `EXTRACT`           |
| Docling               | PDF·Office 구조와 layout 변환           | `ADAPTER_CANDIDATE` |
| Apache Tika           | 범용 형식 감지·metadata·텍스트 fallback | `ADAPTER_CANDIDATE` |
| MarkItDown            | 경량 Markdown 변환                      | `ADAPTER_CANDIDATE` |
| PyMuPDF               | PDF text·page·bbox 처리                 | `ADAPTER_CANDIDATE` |
| python-docx           | DOCX 구조 추출                          | `ADAPTER_CANDIDATE` |
| python-pptx           | PPTX shape·text 추출                    | `ADAPTER_CANDIDATE` |
| openpyxl              | XLSX cell·formula·sheet 추출            | `ADAPTER_CANDIDATE` |
| ffmpeg                | 오디오·영상 정규화                      | `DEFERRED`          |

하나의 범용 변환기를 강제하지 않는다. Format Adapter가 공통 `DocumentIR`과 `SourceMap`을 출력한다.

Phase 1 Canonical 정책에 따라 Shotgun Assembly는 오디오·영상 파일 직접 분석, 자동 음성 전사와 영상 프레임·음성·장면 분석을 장기 범위에서도 제외한다. `ffmpeg`는 Shotgun 기본 구현 후보가 아니라 다른 Assembly 또는 향후 별도 정책 결정에 대비한 `DEFERRED` 후보로만 유지한다. 영상 URL은 접근 가능한 제목·설명·자막·스크립트를 텍스트로 확보하는 범위에서만 처리한다.

### 4.5 Evidence·Citation

| 후보                              | 역할                                 | 상태      |
| --------------------------------- | ------------------------------------ | --------- |
| W3C Web Annotation Data Model     | Annotation·Target·Selector 의미 모델 | `AUGMENT` |
| Text Position·Text Quote Selector | 텍스트 Evidence 위치 표현            | `ADOPTED` |
| lucas Highlight·Annotation        | 원문 복귀와 provenance 분리 패턴     | `AUGMENT` |
| JSON Pointer                      | 구조화 DocumentIR field 위치         | `ADOPTED` |

Shotgun은 텍스트 offset뿐 아니라 page, bbox, table cell, slide shape를 포함하는 자체 Evidence Selector 확장을 가진다. `audio time range`는 공통 Contract의 향후 확장 후보일 뿐 Shotgun Assembly에서는 활성화하지 않는다.

Stage 3에서는 W3C Selector의 start-inclusive/end-exclusive와 quote·prefix·suffix 의미를
적용하고, immutable SourceVersion·content hash·exact hash·origin·Unicode code-point unit을
Shotgun 계약으로 추가했다. lucas 전체 Runtime은 포함하지 않고 위치 탐색과 모호한 인용
비추측 동작만 Port 뒤에서 재구현했다.

### 4.6 AI Provider·Evaluation

| 후보              | 역할                                | 상태                   |
| ----------------- | ----------------------------------- | ---------------------- |
| LiteLLM           | GPT·Gemini·Claude 공통 Gateway 후보 | `ADAPTER_CANDIDATE`    |
| 공급자 공식 SDK   | Provider Adapter의 직접 구현        | `ADAPTER_CANDIDATE`    |
| Instructor        | structured output 보조              | `ADAPTER_CANDIDATE`    |
| Pydantic 또는 Zod | AI 결과 Schema 검증                 | `FOUNDATION_CANDIDATE` |
| Langfuse          | prompt·trace·cost·evaluation 관찰   | `ADAPTER_CANDIDATE`    |
| OpenTelemetry     | 공급자 중립 Trace·Metric            | `FOUNDATION_CANDIDATE` |

LiteLLM 사용 여부와 관계없이 Shotgun `AIProviderPort`가 상위 계약이며, 공급자 고유 응답은 Domain에 노출하지 않는다.

### 4.7 Candidate Generation

| 후보                     | 역할                             | 상태                   |
| ------------------------ | -------------------------------- | ---------------------- |
| spaCy                    | 문장 분할·tokenization·기본 NER  | `ADAPTER_CANDIDATE`    |
| GLiNER                   | zero-shot entity extraction 보조 | `ADAPTER_CANDIDATE`    |
| dateparser 또는 Duckling | 시간 표현 파싱                   | `ADAPTER_CANDIDATE`    |
| DeepKE                   | 관계·속성 추출 연구·benchmark    | `REFERENCE`            |
| GPT·Gemini·Claude        | structured candidate extraction  | `FOUNDATION_CANDIDATE` |

보조 NLP 결과는 후보를 자동 확정하지 않고 LLM 결과와 별도 Provenance를 가진다.

### 4.8 Validation

| 후보                            | 역할                        | 상태                   |
| ------------------------------- | --------------------------- | ---------------------- |
| JSON Schema validator           | payload·contract validation | `FOUNDATION_CANDIDATE` |
| Pydantic 또는 Zod               | runtime type validation     | `FOUNDATION_CANDIDATE` |
| lucas deterministic lint        | 구조·원문 정합성 검사 패턴  | `EXTRACT`              |
| Great Expectations 또는 Pandera | 표 데이터 검증 후보         | `ADAPTER_CANDIDATE`    |
| GPT·Gemini·Claude challenger    | 의미 정합성 교차 검토       | `ADAPTER_CANDIDATE`    |

결정적 검사와 AI 의미 검사를 분리하고, 단일 종합 신뢰도 점수로 승인하지 않는다.

### 4.9 Comparison·Conflict

| 후보                   | 역할                     | 상태                   |
| ---------------------- | ------------------------ | ---------------------- |
| RapidFuzz              | 문자열·alias 후보 비교   | `FOUNDATION_CANDIDATE` |
| sentence-transformers  | 의미 후보 검색·cluster   | `ADAPTER_CANDIDATE`    |
| cross-encoder reranker | 정밀 비교 후보           | `ADAPTER_CANDIDATE`    |
| GPT·Gemini·Claude      | 범위·양태·시간·충돌 설명 | `FOUNDATION_CANDIDATE` |

임베딩 유사도나 모델 다수결은 identity·Fact 판단을 자동 확정하지 않는다.

### 4.10 Impact Analysis·Semantic Graph

| 후보                          | 역할                             | 상태                   |
| ----------------------------- | -------------------------------- | ---------------------- |
| gbrain Graph·Timeline         | Domain pattern과 Query 참고      | `EXTRACT`              |
| NetworkX                      | 초기 graph algorithm·test oracle | `FOUNDATION_CANDIDATE` |
| PostgreSQL adjacency tables   | MVP typed graph storage          | `FOUNDATION_CANDIDATE` |
| Apache AGE                    | PostgreSQL graph extension 후보  | `ADAPTER_CANDIDATE`    |
| Neo4j Community 또는 Memgraph | 전용 Graph DB benchmark          | `DEFERRED`             |

실제 영향 edge는 Canonical·Projection이 소유하며 AI가 자유 생성한 edge를 섞지 않는다.

### 4.11 ChangeSet·Review·Editor

| 후보                  | 역할                                  | 상태                |
| --------------------- | ------------------------------------- | ------------------- |
| OpenKnowledge UX      | Activity·Burst Diff·Graph·editor 참고 | `REFERENCE`         |
| Tiptap / ProseMirror  | 구조화 editor                         | `ADAPTER_CANDIDATE` |
| Yjs                   | Draft ChangeSet 동시 편집             | `DEFERRED`          |
| diff-match-patch 계열 | text diff 보조                        | `ADAPTER_CANDIDATE` |
| Cytoscape.js          | 2D graph review UI                    | `ADAPTER_CANDIDATE` |

Review 결과와 Canonical commit은 editor 내부 document state에 종속되지 않는다.

### 4.12 Canonical Knowledge

| 후보                             | 역할                                    | 상태                   |
| -------------------------------- | --------------------------------------- | ---------------------- |
| PostgreSQL                       | Fact·Claim·Entity·Relation·History 원장 | `ADOPTED`              |
| gbrain Fact·Relation·Timeline    | Schema·operation 참고와 코드 추출 후보  | `EXTRACT`              |
| SQLAlchemy 또는 언어별 ORM       | persistence Adapter                     | `ADAPTER_CANDIDATE`    |
| Alembic 또는 동등 migration tool | schema migration                        | `ADAPTER_CANDIDATE`    |
| Transactional Outbox pattern     | commit·event 원자성                     | `FOUNDATION_CANDIDATE` |

Canonical write는 이 모듈만 수행하며 다른 OSS의 내부 DB를 공식 원장으로 사용하지 않는다.

### 4.13 Projection·Search

| 후보                         | 역할                        | 상태                   |
| ---------------------------- | --------------------------- | ---------------------- |
| PostgreSQL FTS·pg_trgm       | 정확·부분 문자열 검색 MVP   | `FOUNDATION_CANDIDATE` |
| pgvector                     | 단일 DB semantic search MVP | `ADAPTER_CANDIDATE`    |
| OpenSearch                   | 대규모 hybrid search        | `DEFERRED`             |
| Qdrant                       | 독립 vector store benchmark | `DEFERRED`             |
| Apache AGE                   | graph projection 후보       | `ADAPTER_CANDIDATE`    |
| gbrain Search·Graph·Timeline | Query·projection 참고       | `EXTRACT`              |

처음에는 PostgreSQL 중심 Projection을 우선하고 규모와 품질 요구가 확인될 때 별도 제품을 도입한다.

### 4.14 Knowledge Discovery

| 후보                   | 역할                      | 상태                   |
| ---------------------- | ------------------------- | ---------------------- |
| gbrain Dream Cycle     | 주기적 Gap·연결 탐색 패턴 | `REFERENCE`            |
| NetworkX               | pattern·neighborhood 탐색 | `FOUNDATION_CANDIDATE` |
| GPT·Gemini·Claude      | Gap·새 관계·추세 후보     | `FOUNDATION_CANDIDATE` |
| Langfuse·OpenTelemetry | 비용·품질·재귀 추적       | `ADAPTER_CANDIDATE`    |

Discovery 결과는 항상 `DERIVED_INFERENCE` 후보로 Phase 3에 재진입한다.

### 4.15 Output Generation

| 후보                             | 역할                     | 상태                |
| -------------------------------- | ------------------------ | ------------------- |
| Jinja2 또는 동등 template engine | 구조화 문서 template     | `ADAPTER_CANDIDATE` |
| Pandoc                           | Markdown·HTML·DOCX 변환  | `ADAPTER_CANDIDATE` |
| WeasyPrint                       | HTML 기반 PDF 생성       | `ADAPTER_CANDIDATE` |
| python-pptx                      | 프레젠테이션 출력        | `ADAPTER_CANDIDATE` |
| openpyxl                         | 스프레드시트 출력        | `ADAPTER_CANDIDATE` |
| Mermaid                          | 아키텍처·흐름 다이어그램 | `ADAPTER_CANDIDATE` |

생성 도구는 표현 계층을 담당하며 Canonical Fact를 수정하지 않는다.

### 4.16 Risk·Policy

| 후보              | 역할                        | 상태                   |
| ----------------- | --------------------------- | ---------------------- |
| Open Policy Agent | 정책 규칙 평가              | `ADAPTER_CANDIDATE`    |
| Casbin            | RBAC·ABAC 정책 후보         | `ADAPTER_CANDIDATE`    |
| OpenFGA           | 관계 기반 접근 제어 후보    | `DEFERRED`             |
| JSON Schema       | Action parameter validation | `FOUNDATION_CANDIDATE` |

MVP는 코드 기반 결정적 Policy Engine으로 시작할 수 있으며, 정책 규모가 커질 때 OPA·Casbin·OpenFGA를 비교한다.

### 4.17 Action Execution·Connector

| 후보                 | 역할                                    | 상태                   |
| -------------------- | --------------------------------------- | ---------------------- |
| MCP SDK              | Tool·Resource 상호운용                  | `ADAPTER_CANDIDATE`    |
| Temporal             | 장기 Action·retry·compensation          | `DEFERRED`             |
| 공급자 공식 SDK      | Gmail·Calendar·Notion·GitHub 등 Adapter | `ADAPTER_CANDIDATE`    |
| Transactional Outbox | 실행 요청·Audit event 일관성            | `FOUNDATION_CANDIDATE` |

각 Connector는 `validate → preview → preflight → execute → verify → compensate` 계약을 구현한다.

### 4.18 Feedback·Reentry

| 후보                   | 역할                     | 상태                   |
| ---------------------- | ------------------------ | ---------------------- |
| Event Sourcing pattern | 수정·피드백 이력         | `REFERENCE`            |
| Transactional Outbox   | 재진입 Event 전달        | `FOUNDATION_CANDIDATE` |
| JSON Schema            | Feedback type validation | `FOUNDATION_CANDIDATE` |

표현 수정, 사실 수정, Directive 의도, 새 자료, Action 결과를 서로 다른 Event로 분리한다.

### 4.19 Observability·Audit

| 후보          | 역할                             | 상태                   |
| ------------- | -------------------------------- | ---------------------- |
| OpenTelemetry | Trace·Metric·Log 공통 Context    | `FOUNDATION_CANDIDATE` |
| Prometheus    | Metric 수집                      | `ADAPTER_CANDIDATE`    |
| Grafana       | Dashboard                        | `ADAPTER_CANDIDATE`    |
| Loki          | Log backend                      | `DEFERRED`             |
| Langfuse      | LLM trace·prompt·cost·evaluation | `ADAPTER_CANDIDATE`    |

Audit 원장은 일반 로그와 분리하고 사용자 승인·Canonical commit·Action 실행을 불변 기록한다.

### 4.20 Web UI

| 후보             | 역할                                | 상태                |
| ---------------- | ----------------------------------- | ------------------- |
| ddsyasas UX      | Intake·Ask·비용·설정·Home hierarchy | `REFERENCE`         |
| OpenKnowledge UX | Cockpit·Graph·Activity·Diff         | `REFERENCE`         |
| React / Next.js  | Web application 후보                | `ADAPTER_CANDIDATE` |
| TanStack Query   | API state·cache                     | `ADAPTER_CANDIDATE` |
| Cytoscape.js     | Graph UI                            | `ADAPTER_CANDIDATE` |
| Tiptap           | Review editor                       | `ADAPTER_CANDIDATE` |

UI framework는 Domain Module 계약에 영향을 주지 않는다.

## 5. OSS Source Registry와 추적성

### Stage 5 확정 결정

- `diff@9.0.0`을 `TextDiffPort` 뒤의 `ADOPTED` Adapter로 사용한다.
- OpenKnowledge는 GPL-3.0-or-later이므로 Activity·changed-item grouping·Burst Diff의 UX
  패턴만 `REFERENCE`로 독립 구현한다.
- ddsyasas는 Action 중심 Review 진입 계층만 `REFERENCE`로 사용한다.
- `diff-match-patch@1.0.5`는 jsdiff와 중복되고 release가 오래되어 `REJECTED`다.
- `Tiptap@3.28.0`과 `Yjs@13.6.31`은 rich·collaborative editing 요구가 없는 MVP에서
  `DEFERRED`다.
- Review UI 상태는 Approval을 대체하지 않으며 Canonical commit은 Stage 6만 수행한다.

### Stage 6 확정 결정

- PostgreSQL 16.14를 Canonical transaction, project row lock, append-only History와
  Transactional Outbox 저장소로 `ADOPTED`한다.
- gbrain의 Page·Fact·Timeline·migration·recovery는 `REFERENCE`로 사용하되 gbrain runtime과
  DB를 Shotgun Canonical 원장으로 사용하지 않는다.
- `Claim`은 `Fact`로 자동 승격하지 않으며 승인 Manifest와 Snapshot precondition을 Shotgun이
  소유한다.
- pg-boss 12.26.0과 Graphile Worker 0.17.3은 범용 worker가 필요한 시점까지 `DEFERRED`한다.
- node-pg-migrate 8.0.4, Drizzle ORM 0.45.2, Kysely 0.29.3은 현재의 작은 명시적 SQL보다
  운영 복잡도가 커서 `DEFERRED`한다.
- 세부 Mapping·Gap과 교체 경계는
  [Stage 6 OSS Integration Review](../../implementation/stage-validations/stage-6-oss-integration-review.md)에
  고정한다.

후보의 실제 채택은 저장소 URL, pin 기준, 라이선스·보안 검토 상태를 기록한 뒤 진행한다. 아래 값은 문서 작성 시점의 탐색 기준이며, `version/commit`은 채택 PR에서 재검증하고 lockfile·SBOM에 고정한다.

Stage 0~3의 재검증된 exact pin과 결정은
[`oss-source-registry.json`](../../implementation/oss-source-registry.json)을 기준으로 한다.

| 후보                  | 공식 저장소·규격                                              | Version / Commit baseline                  | 라이선스 검토                      | 현재 상태              |
| --------------------- | ------------------------------------------------------------- | ------------------------------------------ | ---------------------------------- | ---------------------- |
| garrytan/gbrain       | https://github.com/garrytan/gbrain                            | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` | MIT 확인                           | `REFERENCE`            |
| lucasastorian/llmwiki | https://github.com/lucasastorian/llmwiki                      | `ad626a3d81be1480e35ef4e94234de8dbb27a61e` | Apache-2.0 확인                    | `AUGMENT`              |
| ddsyasas/llm-wiki     | https://github.com/ddsyasas/llm-wiki                          | `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` | MIT 확인                           | `REFERENCE`            |
| Inkeep OpenKnowledge  | https://github.com/inkeep/open-knowledge                      | `f2834c237639e2cff603817ed88182b33f83cf91` | GPL-3.0-or-later 확인, 패턴 참고만 | `REFERENCE`            |
| W3C Web Annotation    | https://www.w3.org/TR/2017/REC-annotation-model-20170223/     | Recommendation `2017-02-23`                | W3C-20150513 확인                  | `AUGMENT`              |
| JSON Pointer          | https://www.rfc-editor.org/rfc/rfc6901                        | RFC 6901                                   | IETF Trust 확인                    | `ADOPTED`              |
| JSON Schema           | https://github.com/json-schema-org/json-schema-spec           | 구현 선택 시 draft와 validator pin         | 대기                               | `FOUNDATION_CANDIDATE` |
| OpenAPI               | https://github.com/OAI/OpenAPI-Specification                  | 구현 선택 시 spec version pin              | 대기                               | `FOUNDATION_CANDIDATE` |
| AsyncAPI              | https://github.com/asyncapi/spec                              | 구현 선택 시 spec version pin              | 대기                               | `ADAPTER_CANDIDATE`    |
| CloudEvents           | https://github.com/cloudevents/spec                           | mapping 검증 시 spec version pin           | 대기                               | `REFERENCE`            |
| Temporal              | https://github.com/temporalio/temporal                        | benchmark 시 release pin                   | 대기                               | `ADAPTER_CANDIDATE`    |
| NATS JetStream        | https://github.com/nats-io/nats-server                        | benchmark 시 release pin                   | 대기                               | `ADAPTER_CANDIDATE`    |
| Redis Streams         | https://github.com/redis/redis                                | benchmark 시 release pin                   | 대기                               | `ADAPTER_CANDIDATE`    |
| Docling               | https://github.com/docling-project/docling                    | golden corpus 평가 시 commit pin           | 대기                               | `ADAPTER_CANDIDATE`    |
| Apache Tika           | https://github.com/apache/tika                                | golden corpus 평가 시 release pin          | 대기                               | `ADAPTER_CANDIDATE`    |
| MarkItDown            | https://github.com/microsoft/markitdown                       | golden corpus 평가 시 commit pin           | 대기                               | `ADAPTER_CANDIDATE`    |
| ffmpeg                | https://github.com/FFmpeg/FFmpeg                              | Shotgun Assembly에서는 pin하지 않음        | 범위 재결정 전 대기                | `DEFERRED`             |
| LiteLLM               | https://github.com/BerriAI/litellm                            | provider benchmark 시 release pin          | 대기                               | `ADAPTER_CANDIDATE`    |
| Langfuse              | https://github.com/langfuse/langfuse                          | observability 평가 시 release pin          | 대기                               | `ADAPTER_CANDIDATE`    |
| OpenTelemetry         | https://github.com/open-telemetry/opentelemetry-specification | SDK 언어 결정 후 pin                       | 대기                               | `FOUNDATION_CANDIDATE` |
| pgvector              | https://github.com/pgvector/pgvector                          | PostgreSQL version과 함께 pin              | 대기                               | `ADAPTER_CANDIDATE`    |
| Apache AGE            | https://github.com/apache/age                                 | graph benchmark 시 release pin             | 대기                               | `ADAPTER_CANDIDATE`    |
| Open Policy Agent     | https://github.com/open-policy-agent/opa                      | policy benchmark 시 release pin            | 대기                               | `ADAPTER_CANDIDATE`    |
| Casbin                | https://github.com/casbin/casbin                              | 언어 구현 선택 후 pin                      | 대기                               | `ADAPTER_CANDIDATE`    |
| OpenFGA               | https://github.com/openfga/openfga                            | 관계 권한 요구 확인 후 pin                 | 대기                               | `DEFERRED`             |
| MCP SDK·Specification | https://github.com/modelcontextprotocol                       | Adapter 구현 시 SDK·spec commit pin        | 대기                               | `ADAPTER_CANDIDATE`    |
| Tiptap                | https://github.com/ueberdosis/tiptap                          | Review UI prototype 시 release pin         | 대기                               | `ADAPTER_CANDIDATE`    |
| Yjs                   | https://github.com/yjs/yjs                                    | 협업 기능 승인 후 pin                      | 대기                               | `DEFERRED`             |
| Cytoscape.js          | https://github.com/cytoscape/cytoscape.js                     | Graph UI prototype 시 release pin          | 대기                               | `ADAPTER_CANDIDATE`    |

### 5.1 채택 시 필수 기록

각 후보를 `ADOPTED` 또는 `FOUNDATION` 구현으로 승격하는 PR에는 다음을 포함한다.

- 공식 repository URL과 upstream owner
- 정확한 package version·tag·commit SHA
- license identifier, LICENSE file과 배포 방식 검토 결과
- 알려진 보안 이슈와 dependency scan 결과
- 마지막 release·commit·maintainer activity
- Shotgun Port와 Adapter 경계
- golden corpus·성능·비용 benchmark
- fork·patch 목록과 upstream 동기화 전략
- 교체·rollback·data migration 계획

## 6. 채택 우선순위

### Tier 1 — 먼저 구현하거나 검증

- JSON Schema
- In-memory Connector Runtime
- PostgreSQL
- Transactional Outbox
- OpenTelemetry
- GPT·Gemini·Claude Provider Adapter
- format별 독립 Transformation Adapter
- EvidenceSpan과 W3C Selector 참고 모델
- NetworkX 기반 Graph test oracle

### Tier 2 — Vertical Slice 이후 benchmark

- LiteLLM
- Docling·Tika·MarkItDown 비교
- pgvector
- Langfuse
- Tiptap·Cytoscape.js
- OPA·Casbin
- Redis Streams·NATS JetStream

### Tier 3 — 실제 확장 필요 시

- Temporal
- OpenSearch
- Qdrant
- Apache AGE 또는 전용 Graph DB
- Yjs
- 독립 서비스 배포

## 7. 교체 규칙

오픈소스 교체는 다음을 유지해야 한다.

- 동일 Port와 Capability
- Message·Payload schema 호환
- Provenance와 Audit
- Idempotency
- Security Context
- Canonical·Evidence 의미
- Golden corpus 품질 기준
- Migration·Rollback 계획

교체 결과가 기존 결과 의미를 바꾸면 단순 dependency update가 아니라 ADR과 Analysis Revision을 만든다.

## 8. 개발 중 변경 절차

1. 새 후보 또는 교체 필요성 기록
2. License·Security·Maintenance Gate
3. 작은 Adapter prototype
4. Golden corpus와 Failure test
5. 비용·지연·품질 benchmark
6. 기존 후보와 비교
7. ADR 상태 변경
8. Migration·Fallback 계획
9. Assembly에서 점진 활성화
10. 운영 결과를 구현 검증 문서에 기록

## 9. 확정하지 않은 사항

- 주 언어·Framework
- Monorepo 도구
- Queue·Workflow 제품
- 검색·Graph 전용 제품 도입 시점
- LiteLLM 사용 여부
- Editor framework
- Policy engine
- Object storage
- 독립 서비스 경계

이 항목들은 Module Port와 Contract를 먼저 구현한 뒤 benchmark로 결정한다.
