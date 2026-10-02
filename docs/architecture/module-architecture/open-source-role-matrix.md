# Shotgun Open-source Role Matrix

## 1. 목적

이 문서는 Shotgun Module Architecture에서 각 오픈소스와 표준이 관여할 영역과 역할을 정의한다.

이 배정은 **초기 아키텍처 기준선**이지 영구 채택 목록이 아니다. 개발 과정에서 license, security, maintenance, benchmark, API 안정성, Fork 비용과 Shotgun 계약 정합성에 따라 교체·축소·제외할 수 있다.

### VP 활성 경로의 재사용 경계

[ADR-172](../adr/ADR-172-vp-autonomous-knowledge-authority.md)의 VP Knowledge Ledger·Decision·Ask는 Shotgun의 SourceVersion/Evidence/접근 의미를 소유한다. 아래 Canonical·Approval 기준은 기존 승인형 경로에 한정한다. VP에서는 PostgreSQL 저장·Job·검색 Adapter와 기존 형식 변환기를 재사용하고, gbrain의 전체 Runtime/DB를 원장으로 도입하지 않는다. `garrytan/gbrain` Job·Graph, `ddsyasas/llm-wiki` 두 동작 UX, OpenKnowledge 활동·시각화는 `REFERENCE_ONLY`로 유지한다. `lucasastorian/llmwiki`에서 검증된 locator 추출 경계는 유지한다. 각 실제 코드 채택·추출은 Source Registry의 고정 commit·license·security·Contract 결과를 요구한다. DeepSeek는 현재 VP Decision Port의 일반 AI 구현이며, Jev는 API·품질·비용 검증이 가능해질 때까지 `DEFER`다.

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

| 후보                  | 담당 형식·역할                                  | 상태                |
| --------------------- | ----------------------------------------------- | ------------------- |
| lucasastorian/llmwiki | HTML cleaner·XLSX extractor                     | `EXTRACT`           |
| Docling               | PDF·Office 구조와 layout 변환                   | `DEFERRED`          |
| Apache Tika           | 범용 형식 감지·metadata·텍스트 fallback         | `ADAPTER_CANDIDATE` |
| MarkItDown            | 경량 Markdown 변환                              | `ADAPTER_CANDIDATE` |
| PyMuPDF               | PDF text·page·bbox 처리                         | `ADAPTER_CANDIDATE` |
| pypdfium2             | NUL 수식 기호·분수·검증된 번호 목록 접두어 복구 | `AUGMENT`           |
| python-docx           | DOCX 구조 추출                                  | `ADAPTER_CANDIDATE` |
| python-pptx           | PPTX shape·text 추출                            | `ADAPTER_CANDIDATE` |
| openpyxl              | XLSX cell·formula·sheet 추출                    | `ADAPTER_CANDIDATE` |
| ffmpeg                | 오디오·영상 정규화                              | `DEFERRED`          |

하나의 범용 변환기를 강제하지 않는다. Format Adapter가 공통 `DocumentIR`과 `SourceMap`을 출력한다.

VP-04에서 고정된 pypdfium2 `5.11.0`은 pdfplumber가 NUL로 반환한 `<`·`>`, `=`,
괄호·콜론·숫자 중 중심 거리 2.5pt 이하, 상자 겹침 65% 이상인 일대일 기호와
텍스트·좌표가 일치하는 짧은 한 줄 수식, 분자·분모 glyph 행이 방정식 기준선과
정렬되는 분수 수식을 보완한다. 분수 접두어는 짧은 대문자 영문 또는 한글 수식 레이블만
허용한다. 문자는 복원 대상에서 제외한다. 분수는 PDFium에 실제 존재하는 글자와
pdfplumber 조각이 모두 일치할 때만 복원한다. pdfplumber만 문단 순서와
Page/BBox Selector를 만들며, 불확실한 수식은 기존 추출 결과 그대로 둔다. 상세 경계와 Golden
관찰은 [VP-04 수식 검증](../../implementation/vp-finance-pdf-flat-formula-verification-2026-10-01.md)에 기록했다.

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

| 후보                                                                | 역할                                                                  | 상태                   |
| ------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------- |
| spaCy                                                               | 문장 분할·tokenization·기본 NER                                       | `ADAPTER_CANDIDATE`    |
| GLiNER                                                              | zero-shot entity extraction 보조                                      | `ADAPTER_CANDIDATE`    |
| dateparser 또는 Duckling                                            | 시간 표현 파싱                                                        | `ADAPTER_CANDIDATE`    |
| DeepKE                                                              | 관계·속성 추출 연구·benchmark                                         | `REFERENCE`            |
| GPT·Gemini·Claude                                                   | structured candidate extraction                                       | `FOUNDATION_CANDIDATE` |
| Korean complete-claim predicate and whitespace-only Evidence rebind | No matching standalone package; Shotgun Candidate Generation contract | `NO_RELEVANT_OSS`      |

보조 NLP 결과는 후보를 자동 확정하지 않고 LLM 결과와 별도 Provenance를 가진다.

VP-04의 v7/v8 단독 용어·수식·불완전한 한국어 절 제거와 정확한 원문 span 복구 결정은 [Stage 4 OSS Integration Review](../../implementation/stage-validations/stage-4-oss-integration-review.md#vp-04-direct-claim-shape-and-source-span-alignment-2026-10-01)와 [v8 전체 검증](../../implementation/stage-validations/stage-4-oss-integration-review.md#2026-10-02-direct-claim-v8-incomplete-korean-clause-guard)에 기록한다.

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

| 후보                          | 역할                            | 상태                |
| ----------------------------- | ------------------------------- | ------------------- |
| gbrain Graph·Timeline         | Domain pattern과 Query 참고     | `REFERENCE`         |
| NetworkX                      | 결정적 graph test oracle        | `ADOPTED`           |
| PostgreSQL typed review group | MVP typed graph 승인 원장       | `ADOPTED`           |
| Apache AGE                    | PostgreSQL graph extension 후보 | `ADAPTER_CANDIDATE` |
| Neo4j Community 또는 Memgraph | 전용 Graph DB benchmark         | `DEFERRED`          |

실제 영향 edge는 Canonical·Projection이 소유하며 AI가 자유 생성한 edge를 섞지 않는다.

Stage 9의 exact pin, validation-only NetworkX 경계와 gbrain·Cytoscape.js 결정은
[Stage 9 OSS Integration Review](../../implementation/stage-validations/stage-9-oss-integration-review.md)에
고정한다.

### 4.11 ChangeSet·Review·Editor

| 후보                  | 역할                                  | 상태                |
| --------------------- | ------------------------------------- | ------------------- |
| OpenKnowledge UX      | Activity·Burst Diff·Graph·editor 참고 | `REFERENCE`         |
| Tiptap / ProseMirror  | 구조화 editor                         | `ADAPTER_CANDIDATE` |
| Yjs                   | Draft ChangeSet 동시 편집             | `DEFERRED`          |
| diff-match-patch 계열 | text diff 보조                        | `ADAPTER_CANDIDATE` |
| Cytoscape.js          | 2D graph review UI                    | `DEFERRED`          |

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

| 후보                         | 역할                        | 상태        |
| ---------------------------- | --------------------------- | ----------- |
| PostgreSQL FTS·pg_trgm       | 정확·부분 문자열 검색 MVP   | `ADOPTED`   |
| pgvector                     | 단일 DB semantic search MVP | `DEFERRED`  |
| OpenSearch                   | 대규모 hybrid search        | `DEFERRED`  |
| Qdrant                       | 독립 vector store benchmark | `DEFERRED`  |
| Apache AGE                   | graph projection 후보       | `DEFERRED`  |
| gbrain Search·Graph·Timeline | Query·projection 참고       | `REFERENCE` |

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
| Open Policy Agent | 정책 규칙 평가              | `DEFERRED`             |
| Casbin            | RBAC·ABAC 정책 후보         | `DEFERRED`             |
| OpenFGA           | 관계 기반 접근 제어 후보    | `DEFERRED`             |
| JSON Schema       | Action parameter validation | `FOUNDATION_CANDIDATE` |

MVP는 코드 기반 결정적 Policy Engine으로 시작할 수 있으며, 정책 규모가 커질 때 OPA·Casbin·OpenFGA를 비교한다.

### 4.17 Action Execution·Connector

| 후보                 | 역할                                    | 상태                   |
| -------------------- | --------------------------------------- | ---------------------- |
| MCP SDK              | Tool·Resource 상호운용                  | `DEFERRED`             |
| Temporal             | 장기 Action·retry·compensation          | `DEFERRED`             |
| 공급자 공식 SDK      | Gmail·Calendar·Notion·GitHub 등 Adapter | `DEFERRED`             |
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
| Cytoscape.js     | Graph UI                            | `ADOPTED`           |
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

- Compose에 digest로 고정한 PostgreSQL 16.15 runtime을 Canonical transaction, project row
  lock, append-only History와 Transactional Outbox 저장소로 `ADOPTED`한다.
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

| 후보                  | 공식 저장소·규격                                              | Version / Commit baseline                                    | 라이선스 검토                      | 현재 상태              |
| --------------------- | ------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------- | ---------------------- |
| garrytan/gbrain       | https://github.com/garrytan/gbrain                            | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`                   | MIT 확인                           | `REFERENCE`            |
| lucasastorian/llmwiki | https://github.com/lucasastorian/llmwiki                      | `ad626a3d81be1480e35ef4e94234de8dbb27a61e`                   | Apache-2.0 확인                    | `EXTRACT`              |
| ddsyasas/llm-wiki     | https://github.com/ddsyasas/llm-wiki                          | `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`                   | MIT 확인                           | `REFERENCE`            |
| Inkeep OpenKnowledge  | https://github.com/inkeep/open-knowledge                      | `f2834c237639e2cff603817ed88182b33f83cf91`                   | GPL-3.0-or-later 확인, 패턴 참고만 | `REFERENCE`            |
| NetworkX              | https://github.com/networkx/networkx                          | `3.6.1` / `7530809bfa1ea7ed6fdf918a4d1431488953cb1f`         | BSD-3-Clause 확인                  | `ADOPTED`              |
| W3C Web Annotation    | https://www.w3.org/TR/2017/REC-annotation-model-20170223/     | Recommendation `2017-02-23`                                  | W3C-20150513 확인                  | `AUGMENT`              |
| JSON Pointer          | https://www.rfc-editor.org/rfc/rfc6901                        | RFC 6901                                                     | IETF Trust 확인                    | `ADOPTED`              |
| JSON Schema           | https://github.com/json-schema-org/json-schema-spec           | 구현 선택 시 draft와 validator pin                           | 대기                               | `FOUNDATION_CANDIDATE` |
| OpenAPI               | https://github.com/OAI/OpenAPI-Specification                  | 구현 선택 시 spec version pin                                | 대기                               | `FOUNDATION_CANDIDATE` |
| AsyncAPI              | https://github.com/asyncapi/spec                              | 구현 선택 시 spec version pin                                | 대기                               | `ADAPTER_CANDIDATE`    |
| CloudEvents           | https://github.com/cloudevents/spec                           | mapping 검증 시 spec version pin                             | 대기                               | `REFERENCE`            |
| Temporal              | https://github.com/temporalio/temporal                        | benchmark 시 release pin                                     | 대기                               | `ADAPTER_CANDIDATE`    |
| NATS JetStream        | https://github.com/nats-io/nats-server                        | benchmark 시 release pin                                     | 대기                               | `ADAPTER_CANDIDATE`    |
| Redis Streams         | https://github.com/redis/redis                                | benchmark 시 release pin                                     | 대기                               | `ADAPTER_CANDIDATE`    |
| Docling               | https://github.com/docling-project/docling                    | `v2.130.0` / `92fc74c36bbd20db9838d7665d38900e5c958319`; MIT | MIT 확인                           | `DEFERRED`             |
| Apache Tika           | https://github.com/apache/tika                                | golden corpus 평가 시 release pin                            | 대기                               | `ADAPTER_CANDIDATE`    |
| MarkItDown            | https://github.com/microsoft/markitdown                       | golden corpus 평가 시 commit pin                             | 대기                               | `ADAPTER_CANDIDATE`    |
| ffmpeg                | https://github.com/FFmpeg/FFmpeg                              | Shotgun Assembly에서는 pin하지 않음                          | 범위 재결정 전 대기                | `DEFERRED`             |
| LiteLLM               | https://github.com/BerriAI/litellm                            | provider benchmark 시 release pin                            | 대기                               | `ADAPTER_CANDIDATE`    |
| Langfuse              | https://github.com/langfuse/langfuse                          | observability 평가 시 release pin                            | 대기                               | `ADAPTER_CANDIDATE`    |
| OpenTelemetry         | https://github.com/open-telemetry/opentelemetry-specification | SDK 언어 결정 후 pin                                         | 대기                               | `FOUNDATION_CANDIDATE` |
| pgvector              | https://github.com/pgvector/pgvector                          | PostgreSQL version과 함께 pin                                | 대기                               | `ADAPTER_CANDIDATE`    |
| Apache AGE            | https://github.com/apache/age                                 | graph benchmark 시 release pin                               | 대기                               | `ADAPTER_CANDIDATE`    |
| Open Policy Agent     | https://github.com/open-policy-agent/opa                      | `v1.18.2` / `e695c9ef8edb0f8b9f13d014d7bc8a7fbcc57297`       | Apache-2.0 확인                    | `DEFERRED`             |
| Casbin                | https://github.com/apache/casbin-node-casbin                  | `v5.51.1` / `2d90c7d8c3b522415605cf3d25481e763e73381e`       | Apache-2.0 확인                    | `DEFERRED`             |
| OpenFGA               | https://github.com/openfga/openfga                            | `v1.18.1` / `69efbd95b3d44afb2e2567d485dcc792c7d79e3f`       | Apache-2.0 확인                    | `DEFERRED`             |
| MCP SDK·Specification | https://github.com/modelcontextprotocol/typescript-sdk        | `v1.29.0` / `e12cbd7078db388152f6e839abdbe09ba01f3f32`       | Apache-2.0·MIT 확인                | `DEFERRED`             |
| Temporal TypeScript   | https://github.com/temporalio/sdk-typescript                  | `v1.20.3` / `ae823d7f9dd513f3b90aeba8c66854c59c39a359`       | MIT 확인                           | `DEFERRED`             |
| Octokit.js            | https://github.com/octokit/octokit.js                         | `v5.0.5` / `45c56ffaa6d1799dd4ebaf83f06a8fc64fc39c49`        | MIT 확인                           | `DEFERRED`             |
| Tiptap                | https://github.com/ueberdosis/tiptap                          | Review UI prototype 시 release pin                           | 대기                               | `ADAPTER_CANDIDATE`    |
| Yjs                   | https://github.com/yjs/yjs                                    | 협업 기능 승인 후 pin                                        | 대기                               | `DEFERRED`             |
| Cytoscape.js          | https://github.com/cytoscape/cytoscape.js                     | `3.34.0` / `22716bfb75834b56fa6679648b0abb06f4ae691c`        | MIT 확인                           | `ADOPTED`              |
| Apache AGE            | https://github.com/apache/age                                 | `6876abcab0a3281eb65a7e2a91238e0b5abfdea7`                   | Apache-2.0 확인                    | `DEFERRED`             |
| OpenSearch            | https://github.com/opensearch-project/OpenSearch              | `1d71f7b405359d277e9d365bb0d206acce8e559b`                   | Apache-2.0 확인                    | `DEFERRED`             |
| Qdrant                | https://github.com/qdrant/qdrant                              | `44ad62f8cd69642be5afa6441612525e24a0d063`                   | Apache-2.0 확인                    | `DEFERRED`             |

### Stage 10 확정 결정

- `cytoscape@3.34.0`을 Compiled Truth 2D 화면 Adapter로 `ADOPTED`한다. 브라우저에는
  승인된 Projection의 ID·label·시간 상태·Typed Edge만 전달하고 원문이나 비밀값은 전달하지 않는다.
- gbrain Dream Cycle의 순서가 있는 phase, dry-run, bounded drain과 Graph direction filter는
  `REFERENCE`로 사용한다. gbrain runtime·DB·생성 결과를 Shotgun Canonical에 직접 연결하지 않는다.
- PostgreSQL 16의 Shotgun 소유 Projection 표를 MVP 저장소로 유지한다.
- pgvector·Apache AGE·OpenSearch·Qdrant는 대표 데이터의 검색 품질·지연·규모 한계가 측정되기
  전까지 `DEFERRED`다.
- OpenKnowledge의 2D Graph UX는 `REFERENCE`지만 GPL 코드는 포함하지 않는다.

### Stage 11 확정 결정

- gbrain의 contract-first operation 정의, mutating/write scope, remote default-deny와
  side-effect adversarial test를 `REFERENCE_ONLY`로 재사용한다. gbrain MCP runtime·DB·operation을
  Shotgun 실행 권한으로 사용하지 않는다.
- Compose에 digest로 고정한 PostgreSQL 16.15 runtime을 Action 상태, 원자적 실행 claim,
  불변 Approval과 append-only Audit 저장소로 `ADOPTED`한다.
- R0~R4는 다섯 operation mapping과 restricted·compensation 하한만 필요한 MVP이므로
  `stage11.action-risk.v1` 결정적 코드 정책을 사용한다. OPA v1.18.2와 Casbin v5.51.1은
  정책 규모 또는 다중 서비스 요구가 확인될 때까지 `DEFERRED`다.
- OpenFGA v1.18.1은 단일 소유자 MVP에 관계 기반 권한 요구가 없어 `DEFERRED`다.
- MCP TypeScript SDK v1.29.0과 Octokit.js v5.0.5는 실제 Provider·권한 Scope가 승인될 때
  `ActionConnectorPort` Adapter로 재평가한다. 현재는 token·network·외부 write를 활성화하지 않는다.
- Temporal TypeScript SDK v1.20.3은 timer·multi-day wait·saga 요구가 없어 `DEFERRED`다.
- Stage 11 실행 Adapter는 비밀값을 내부 private field로 격리한 Fake Draft Connector다.
  실제 Provider Adapter는 같은 Preflight·idempotency·Verify·`OUTCOME_UNKNOWN` Contract Test를
  통과하기 전 활성화할 수 없다.

### Stage 12 확정 결정

- lucas `ad626a3d`의 Highlight locator 경계를 Apache-2.0 고지와 함께
  `@shotgun/lucas-text-locator@1.0.0`으로 `EXTRACT`한다. SQLite·VaultFS·MCP·Watcher는 제외한다.
- `diff@9.0.0`은 기본 `ADOPTED` Adapter로 유지하되 `SimpleTextDiffAdapter` 교체 시험을
  통과했다. Comparison·Review Domain Module 변경은 없다.
- gbrain은 Document Review의 필수 Capability가 아니므로 Runtime·DB를 설치하지 않는다.
  Research Assistant의 read-only Brain 상호운용 요구가 확인되면 Query/Projection Port 뒤에서
  재평가한다.
- ddsyasas의 action 중심 진입·busy 상태와 OpenKnowledge의 activity·diff·evidence grouping은
  `documentReviewUxMockContract@1.0.0`으로만 사용한다. Backend와 GPL 코드는 포함하지 않는다.
- Package version, 호환 범위, migration, 기능 축소와 rollback은
  [Stage 12 Compatibility Guide](../../implementation/stage-12-module-compatibility-and-migration.md)에
  고정한다.

### Stage 12.1 Durability Recovery 확정 결정

- Compose에 digest로 고정한 PostgreSQL 16.15 image의 `pg_dump`·`pg_restore`를 Backup Database Adapter로 `ADOPT`한다. Shotgun이 Asset·Contract·Integrity Manifest와 clean-restore 정책을 계속 소유한다.
- gbrain의 migration·recovery·idempotency 패턴은 `REFERENCE_ONLY`로 유지하고 gbrain Runtime·DB를 Outbox나 Projection 권위 저장소로 도입하지 않는다.
- pgBackRest 2.58.0, WAL-G 3.0.8, Barman 3.19.1은 PITR·WAL archive·외부 저장소·다중 Server DR 요구가 승인될 때까지 `DEFER`한다.
- Canonical Outbox 복구는 Stage 6 Repository Port를, Search와 Compiled Truth 재생성은 Stage 7·10 Module Contract를 재사용한다. 외부 도구의 ID·Schema·Metadata를 Canonical Contract로 노출하지 않는다.
- Backup Restore는 기존 Database를 덮어쓰지 않고 새 빈 Database와 빈 Asset Root에서만 수행한다. Projection은 권위 Backup이 아니라 Canonical에서 재생성 가능한 파생 상태다.
- 상세 결정과 검증은 [ADR-097](../adr/ADR-097-stage-12-1-outbox-projection-clean-restore.md)과 [Stage 12.1 Durability Recovery OSS Review](../../implementation/stage-validations/stage-12-1-durability-recovery-oss-review.md)에 고정한다.

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

## 10. VP 자동 지식 원장 추가 결정 (2026-09-25)

`vp.knowledge-ledger`의 검증된 직접 주장 기록은 Shotgun의 SourceVersion·EvidenceSpan·Project 접근 범위·T3 초기화 경계에 묶인다. [VP 구현계획](../../implementation/vp-vampire-implementation-plan.md)의 기존 검토를 출발점으로 `garrytan/gbrain` (`a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT)을 `REFERENCE_ONLY`로 둔다. gbrain의 Fact/Graph 저장 의미와 DB를 이 경계의 권위로 채택하면 기존 Evidence·권한·초기화 계약을 그대로 지킬 수 없어 VP 원장은 PostgreSQL Adapter로 직접 구현한다. 현재 재사용하는 PostgreSQL은 기존 채택 인프라이며 새 OSS Runtime은 추가하지 않았다.

첫 Adapter는 `VPKnowledgeLedgerPort` 뒤에서 Stage 4의 `READY` 직접 후보와 정확한 변환 revision을 검증한다. 문자열이 완전히 같은 경우에는 결정적 관계를 만들고 각 Source의 근거를 보존한다. 의미 비교·충돌은 기존 DeepSeek AI Provider Adapter를 `DecisionProviderPort` 뒤에서 임시 재사용하며, Jev는 `DEFER`다. Migration 113–114는 새 원장과 프로젝트 초기화 owner를 추가한다. 롤백은 VP 관계 작업자 중지와 Shadow Ledger 보존으로 시작하며, 프로젝트의 활성 Ask 권위 전환 전까지 기존 Canonical 데이터는 변경하지 않는다.

`DecisionProviderPort`의 Jev PoC는 [TypeSafe 공식 API](https://docs.typesafe.ai/introduction/quickstart) 요청 형식을 `REFERENCE_ONLY`로 사용한다. 후보 SDK [`typesafe-sdk-js@v0.6.0`](https://github.com/typesafe-ai/typesafe-sdk-js/releases/tag/v0.6.0), commit `66880cc`, MIT는 이번 PoC에서 `DEFER`한다. SDK의 provider/runtime 타입을 Shotgun 계약으로 끌어오지 않고 작은 HTTP Adapter로 모델 pin·응답 검증·egress 차단을 먼저 검증한다. SDK 통합 여부는 live API·Golden Corpus·보안/maintenance 평가 후 결정한다. 지금은 자격 증명이 없어 실제 Jev 결과나 비용·지연을 측정하지 않았으며 생산 경로에 연결하지 않는다. 실패/불확실성은 `UNRESOLVED` 또는 일반 AI Port로 넘기는 계약 테스트만 통과했다. PoC 롤백은 Adapter 미구성과 기존 Shadow Ledger 유지다.

2026-09-26 임시 대체 결정은 신규 OSS 채택이 아닌 **기존 DeepSeek 연결 재사용(`AUGMENT`)**이다. 기존 Project AI resolver, Vault, DeepSeek HTTP Adapter와 현재 Project에 고정된 모델을 사용한다. VP Port와 Shadow Ledger 작업자는 제공자 유형·자격 증명을 직접 소유하지 않는다. Jev Adapter는 구성하지 않는다. 합성 문장 5쌍의 실 API 분류와 격리 PostgreSQL의 작업자→결정 영수증·관계 기록은 통과했다. 품질 Golden Corpus·대규모 비용 benchmark·Adapter 교체 검증은 미완료이며 활성 Ask 권위 전환의 Gate로 남긴다. 전환 전 롤백은 VP 관계 작업자 중지, 작업·영수증·관계 이력 보존, 기존 Ask 경로 유지다.

2026-09-29 VP Ask 전환은 기존 PostgreSQL FTS·`pg_trgm` 검색을 `AUGMENT`하고, gbrain Search/Graph는 검증 패턴만 `REFERENCE_ONLY`로 유지한다. `AskKnowledgeEvidenceSearchPort`는 교체 가능한 경계다. `AUTO_PROJECT_KNOWLEDGE`는 VP 현재 주장과 현재 관계에서 얻은 Evidence만 사용하고 raw Evidence 전체 검색으로 대체하지 않는다. Ask는 SourceVersion·Evidence 접근/민감도·활성 버전을 재검증하며, 최신 활성 버전의 Stage 3 인덱싱과 Candidate 검증·원장 기록이 끝나지 않았으면 질문을 대기시킨다. AnswerRun 시도에는 VP epoch, 접근 가능한 최신 SourceVersion 집합의 watermark, 인용 Evidence를 고정한다. 컨텍스트 확인과 답변 게시 직전 스냅샷을 재검증하고, epoch가 바뀌면 답변을 게시하지 않는다. 검증은 PostgreSQL 격리 DB의 VP 검색·원장 테스트와 Ask 소스 버전 대기·고정·오래된 스냅샷 게시 거부 테스트로 수행했다. Migration 121은 기존 AnswerRun 이력을 보존하는 nullable 감사 열만 추가한다. 새 OSS 의존성은 없다. 롤백은 VP Ask 실행 코드 이전으로 복구하는 방식이며, Migration 121 열은 보존한다. 대규모 검색 품질·비용 benchmark와 실제 설치 제품 E2E는 VP 완료 Gate에 남는다.

2026-10-01 stale AnswerRun 복구는 `garrytan/gbrain` Job/Attempt 패턴을 `REFERENCE_ONLY`로 재검토했지만, gbrain Runtime·DB는 Shotgun의 AnswerRun·VP snapshot 계약과 맞지 않아 도입하지 않는다. `ddsyasas/llm-wiki`는 기존과 같이 Ask UX만 `REFERENCE_ONLY`다. Shotgun은 기존 `AskAnswerExecutionRepositoryPort`의 영속 `CURRENT_POLICY` retry를 써서, provider 결과는 알았지만 게시 직전 VP snapshot이 바뀐 최초 시도에 한해 현재 snapshot으로 한 번만 재실행한다. `OUTCOME_UNKNOWN`은 재시도하지 않는다. 이 상호작용에 해당하는 외부 Runtime/Package는 없어 `NO_RELEVANT_OSS`로 결정했다. 추가 egress·DB migration은 없고, unit·PostgreSQL adapter·실제 PDF DeepSeek E2E를 검증한다. 되돌릴 때는 제한된 자동 재시도 분기만 제거하고 awaited completion, typed stale failure, stale 답변 게시 거부는 유지한다.

VP 수정 자료 투입은 이미 채택한 Shotgun `Source`·`SourceVersion`·Stage 3 Adapter를 `AUGMENT`한다. 외부 Runtime을 추가하지 않는다. gbrain의 Fact/Timeline과 lucas의 Evidence 패턴은 위 결정대로 참고·추출 경계에 두며, 프로젝트/보안 범위가 고정된 기존 Source의 버전 번호와 원본 계보는 Shotgun이 계속 소유한다. 새 버전 투입은 현재 Source의 보안 메타데이터 일치를 검사하고, 다른 프로젝트 Source ID는 거부한다. 되돌리기는 새 투입 UI를 비활성화하고 과거 SourceVersion을 보존하는 방식이며, 이미 생성된 버전을 삭제하지 않는다. 격리 PostgreSQL 브라우저 여정에서 파일 투입→인용 답변→수정 파일 투입→새 버전 인용 및 프로젝트 간 갱신 거부를 검증했다. DeepSeek 판단을 포함한 전체 제품 인수와 증분/전체 재생성 동등성은 아직 Gate에 남는다.

2026-09-26 단일 지식 공간 결정은 새 VP에서 Project를 사용자 제품 범위로 노출하지 않는 변경이다. 사용자는 과거 자료·원본·대화·지식·프로젝트 설정의 이관을 요구하지 않으며 빈 공간에서 시작한다. gbrain Search/Graph와 ddsyasas의 단순 Intake/Ask UX는 각각 `REFERENCE_ONLY`이며, PostgreSQL Source/Evidence/Ask Port는 `AUGMENT`한다. OSS 내부 namespace/DB는 공통 지식 권위로 채택하지 않는다. Shotgun이 내부 저장·인가 키 하나를 자동 생성하고, 빈 저장소에서 투입·질문·인용·관계가 작동하는 Golden Corpus·보안 음성 테스트를 통과해야 한다. DeepSeek 자격 증명은 새 공간에 별도로 구성한다. 롤백은 새 실행 대상을 중지하고 이전 실행 설정으로 복귀하는 방식이며, 과거 자료를 새 지식 공간에 혼합하지 않는다.

2026-09-30 방향성 관계 분류는 ADR-172의 Shotgun 소유 `SUPPORTS` 의미를 구현한다. `garrytan/gbrain`의 기존 고정 기준 `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` (MIT)는 Fact/Relation 저장 구조와 Graph 동작 참고에 한정해 `REFERENCE_ONLY`다. gbrain runtime/schema를 반입하면 SourceVersion·Evidence 및 relation orientation의 Shotgun 계약과 결합되므로 채택하지 않는다. PostgreSQL은 기존 `ADOPT` 인프라를 VP relation adapter 뒤에서 사용하고, `pg_trgm`은 후보 순위에만 `AUGMENT`로 남긴다. 이 관계 분류·방향 계약 자체에는 재사용할 외부 OSS 구현이 없어 `NO_RELEVANT_OSS`로 기록한다. 기존 DeepSeek DecisionProvider Adapter를 재사용해 새 의존성·provider egress 범위를 늘리지 않았다. `DecisionProviderPort`와 PostgreSQL Adapter를 교체 경계로 유지하며 migration 125는 방향 불변 조건을 적용한다. 격리 PostgreSQL recovery test는 방향이 있는 SUPPORTS 판단을 재시작 뒤 한 번만 저장하고 Ask가 연결된 사례 Evidence를 찾는 것을 확인한다. 전체 Golden Corpus·adapter replacement·최종 VP-10 Gate는 아직 열려 있다.

## 11. VP-07 로컬 Runtime 재기동

Shotgun 로컬 Runtime은 기존 canonical launcher identity 소유권을 유지하기 위해 Node.js `child_process.fork` IPC를 사용한다. Node core는 추가 OSS package가 아닌 기존 Node runtime 표준 API이며, 프로세스 실행·재기동은 `launch-local.ts`가 독점한다. Node runtime은 로컬 검증 시 `v24.15.0`이었다.

| 후보                                                                | 범위                                                                   | 결정                                                                                                                     |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Node.js `child_process.fork`                                        | Shotgun launcher와 replaceable app child 사이의 IPC/readiness/shutdown | 기존 runtime 표준 API, dependency 없음                                                                                   |
| PM2 `v7.0.4` (`cd6b1b4c592117212d7349d6932288613f336c15`, AGPL-3.0) | 외부 daemon 기반 process supervision                                   | `REJECTED`: 별도 process identity authority와 배포 copyleft 검토를 추가하며 Windows startup hook에 외부 package가 필요함 |
| gbrain Minion (`a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT)     | Job retry/lease 패턴                                                   | `REFERENCE_ONLY`: 앱 프로세스의 로컬 수명 감독은 제공하지 않음                                                           |

선택 근거·보안 범위·회복 계약·교체 및 롤백은 [ADR-167 VP-07 amendment](../adr/ADR-167-canonical-desktop-launcher-repository-and-runtime-identity.md#2026-09-30--vp-07-supervised-application-restart)와 [VP 재기동 시험 보고](../../implementation/vp-runtime-restart-supervision-2026-09-30.md)에 기록한다. 앱 자식 재기동의 unit·실제 Node IPC 시험과 PostgreSQL server container 재기동 후 persisted project API read 시험이 통과했다. Synthetic HTTP 200 직후 isolated test Worker process를 종료하고 새 `startShotgunApplication` 구성으로 재기동한 시험은 `/health` 200, provider-call/Job `OUTCOME_UNKNOWN`, 재호출 0건을 확인했다. 이는 test process와 local HTTP 경계이며 PostgreSQL 장애와 Provider 호출이 겹치는 복구, 배포 cutover/rollback, 설치 Runtime 강제 종료와 Windows 재부팅 검증은 아직 VP-07 완료 Gate로 남는다.

2026-10-01 VP-07 source/job backup recovery extends the existing PostgreSQL backup decision; it does not add another runtime. PostgreSQL `pg_dump`/`pg_restore` remain `ADOPT` behind the Shotgun-owned `shotgun-backup-v1` boundary per [ADR-097](../adr/ADR-097-stage-12-1-outbox-projection-clean-restore.md) and its [Stage 12.1 OSS review](../../implementation/stage-validations/stage-12-1-durability-recovery-oss-review.md). The Windows isolated acceptance ran against the repository-pinned `pg16` Compose image digest `sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b`; `SHOW server_version` returned `16.15` (the earlier Stage 12.1 review recorded 16.14, so both the image digest and observed version are retained as evidence). The acceptance exercised owner `runOwnerCreate` (automatic full verification) and `runOwnerRestoreSafe`, including the existing startup recovery application against the restored database and asset root (all five readiness/readability flags true). It restored Sources, SourceVersions, Evidence, VP assertions, original bytes, and a pending relation Job into a clean disposable target, verified the source remained unchanged with no cutover, and dispatched the restored Job once through Shotgun's existing VP worker/provider-execution ledger. `garrytan/gbrain` remains `REFERENCE_ONLY`; pgBackRest, WAL-G, and Barman remain `DEFER` under ADR-097. No new dependency, migration, OSS-owned schema, or Port was introduced. The deterministic test resolver is not live-provider or installed-owner recovery acceptance; VP-07 remains open. See the [VP-07 backup/restore acceptance report](../../implementation/vp-backup-restore-recovery-2026-10-01.md).

## 2026-10-02 VP-05 PostgreSQL runtime pin reconciliation

Read-only inspection confirmed `compose.yaml` uses the same immutable `pgvector/pgvector:pg16@sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b` image for `db` and `db-test`. The running runtime reports PostgreSQL `16.15`, `pg_trgm` `1.6`, and pgvector `0.8.6`. The PostgreSQL and `pg_trgm` entries in `oss-source-registry.json` now match that image and the official PostgreSQL `REL_16_15` commit `7d3e000c5961a544302072058a1184e9a588837b`; previous Stage 12.1 evidence for `16.14` remains historical. Existing PostgreSQL `ADOPT`, `pg_trgm` `AUGMENT`, and pgvector `ADOPT` decisions and Shotgun adapter ownership are unchanged. No dependency, migration, or production behavior changed; rollback is a documentation/registry revert. The 2026-10-02 data-bearing Provider/PostgreSQL outage test also passed; details are in the [VP Runtime restart report](../../implementation/vp-runtime-restart-supervision-2026-09-30.md).

## VP-04 Decision Evidence context — 2026-10-01

Target: `VPDecisionProviderPort@1.2.0` and `VPRelationJobStorePort`, behind the existing Shotgun relation-job and AI provider adapters.

| Candidate                                                             | Decision          | Boundary                                                                                                                                                                                          |
| --------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL `evidence.spans` and existing VP relation store            | `AUGMENT`         | Read a bounded exact quote only when project, source, SourceVersion, Evidence ID, access scope, and sensitivity match the current assertion. PostgreSQL remains behind the Shotgun-owned adapter. |
| DeepSeek through existing `DecisionProviderPort` adapter              | `AUGMENT`         | Pass the same authorized claim pair plus optional bounded Evidence context; preserve provider resolver, Vault, egress checks, daily attempt cap, and durable request digest.                      |
| `garrytan/gbrain` at `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` / MIT | `REFERENCE_ONLY`  | Relation and evidence patterns only; no runtime, database schema, or identifier is imported.                                                                                                      |
| External relation-context package/runtime                             | `NO_RELEVANT_OSS` | The change is exact-source retrieval and prompt-boundary handling; no standalone package fits the Shotgun provenance and security contract.                                                       |

No dependency, migration, or OSS-owned contract was added. General AI and Jev adapters share the versioned input shape. Contract tests cover hostile source text, over-limit rejection before provider resolution, and distinct durable request digests when Evidence context differs. PostgreSQL integration verifies exact Evidence lineage/security matching and the 2,000-character truncation signal. Rollback reverts the additive request field and the v6 relation policy revision; append-only decisions remain auditable and require no data migration. Finance corpus v1.2 remains `CANDIDATE`; this change does not close VP-04/05.

## VP-04 / Stage 8 Docling finance formula re-evaluation — 2026-10-01

The documented formula-loss trigger was reproduced on the supplied 10-page
finance PDF. Docling `v2.130.0` (`92fc74c36bbd20db9838d7665d38900e5c958319`, MIT)
was evaluated only in a temporary Python 3.12 environment. The default
two-page conversion retained layout but emitted empty formula text and
`formula-not-decoded` placeholders; optional CodeFormulaV2 did not finish
within six CPU minutes at about 1.9 GB memory. The temporary environment
resolved 50 distributions and occupied 854,390,083 bytes. Decision remains
`DEFER`: do not add it to the product until formula text passes an adjudicated
page-image Golden corpus within bounded runtime. Upstream security policy says
only latest versions are supported; no product dependency or production
security scan was introduced. Full methodology, limitations, and rollback are
in the [focused re-evaluation report](../../implementation/vp-docling-finance-formula-reevaluation-2026-10-01.md).

## VP-04 / Stage 8 PDFium equation geometry augmentation — 2026-10-01

The exact locked pypdfium2 `5.11.0` (`0168561b33a3fc32eceb6ae46cc252f6b0e90c19`,
PDFium pin `7913`, Apache-2.0 OR BSD-3-Clause) was augmented behind the existing
Python format adapter. Version `1.4.0` restores short single-row equations and
fractions whose numerator/denominator rows overlap around an uppercase formula
prefix; it replaces extracted words only if their characters are contained in
the geometry-backed expression. Version `1.5.0` additionally recovers only
reciprocal one-to-one matches for `=`, parentheses, colon, digits, `<` and `>`
when centers are within 2.5pt and boxes overlap by at least 65%; other glyphs
are left untouched. PDFium does not own paragraph order or selectors. The
Version `1.6.0` also accepts stacked fractions with a short uppercase Latin or
Korean formula label; it retains the same glyph alignment and text containment
checks. Version `1.8.0` adds one narrow numbered-list repair: PDFium must expose
the contiguous digit-period-space-Hangul sequence, the digit and baseline-aligned
period must match the first two pdfplumber NUL boxes, the PDFium space must align
with the original character boundary, and the following Hangul source character
must match. It preserves pdfplumber's original boxes and reading order. The
enclosing document-format module is now `1.8.0`; the prior `1.7.0` release
preserves physical-line offsets. No dependency or lockfile changed. The official upstream Security page showed no `SECURITY.md`
policy and no published advisory on 2026-10-01. The
[focused verification report](../../implementation/vp-finance-pdf-flat-formula-verification-2026-10-01.md)
records the supplied-PDF formulas, glyph coverage and live DeepSeek browser
runs. Full-PDF quality and independent Golden adjudication remain open.

## VP-04 / Stage 8 PDFium numbered-list glyph repair — 2026-10-01

The same exact pypdfium2 `5.11.0` pin and existing isolated Python adapter
remain the `AUGMENT` boundary; no new package, runtime, or lockfile was added.
Adapter `1.8.0` repairs a list prefix only when PDFium exposes the consecutive
digit-period-space-Hangul text sequence, the first two pdfplumber NUL boxes
match the digit and baseline-aligned period, the PDFium whitespace origin aligns
with the original character boundary, and the following Korean source glyph
matches. pdfplumber still owns reading order, SourceMap offsets, and the original
Page/BBox selectors. Eighteen Python geometry tests cover the positive and
negative match; the supplied PDF recovered all three decision lines, and the
live DeepSeek run matched 23/23 page-grounded markers with 164 assertions,
replay match, six cited Ask checks, and zero pending relation jobs. This is a
single-source result; broad PDF quality and independent Golden adjudication
remain open. Revert only this repair and adapter identity to `1.7.0` to retain
the previous PDFium and physical-line behavior.

## VP-04 / Stage 8 PDF physical-line preservation — 2026-10-01

The pinned `pdfplumber==0.11.10` (`ADOPT`, MIT; package version fixed in the worker lockfile) continues to own PDF reading order, word geometry, page, and bounding-box selectors. Shotgun's `PythonDocumentFormatAdapter` now preserves physical line separators inside the existing one-block/one-paragraph boundary and maintains each line's exact segment offsets. This is an adapter-local `AUGMENT`; no upstream code, parser, or runtime was added. The `direct-claim-v6` Candidate Generation splitter consumes those line breaks so converter-merged list items can become separately evidenced candidates. The replacement boundary remains `PlainTextTransformerPort` plus the Stage 8 Page/BBox and SourceMap contract tests. spaCy Sentencizer `v3.8.16` was reviewed as `REFERENCE_ONLY`: its punctuation-based sentence boundaries do not preserve PDF geometry or resolve wrapped formula/claim boundaries. The updated supplied-PDF live result is recorded in the VP finance PDF report. Rollback removes the PDF-only line preservation and restores the prior adapter identity; existing immutable transformation revisions remain readable.

## VP-03 / Stage 7 PostgreSQL search-statistics refresh — 2026-10-01

After a real finance-PDF ingestion, a DeepSeek Ask search took about 239 seconds while the same SQL completed in about 244 ms once current planner statistics were collected. PostgreSQL's own `ANALYZE` was selected as an existing-runtime `AUGMENT`; no external search package, service, or dependency was added (`NO_RELEVANT_OSS` for a new package). Because the pinned PostgreSQL 16 runtime permits `ANALYZE` only to table owners or a superuser, Migration 126 assigns only the fixed search-statistics tables to the existing non-login `shotgun_schema_owner` and exposes a zero-argument, fixed-table `vp.refresh_search_statistics()` security-definer routine to `shotgun_runtime`. The routine has a pinned safe `search_path`, no caller-provided identifiers, and no `PUBLIC` execute grant. `VPKnowledgeLedgerPort` exposes an optional refresh operation; its PostgreSQL adapter calls the routine only after a bounded worker drain. PostgreSQL autovacuum remains fallback if refresh fails. Rollback restores the pre-migration database backup and prior code because the migration changes table ownership as well as adding the function; an in-place down migration is not provided. The backup/restore rollback path was rehearsed on an isolated PostgreSQL 16 source and restore database; all 11 pre-migration owners were recovered and the Migration 126 function/version were absent after restore. See the [Migration 126 rollback rehearsal](../../implementation/vp-finance-pdf-flat-formula-verification-2026-10-01.md#migration-126-rollback-rehearsal).

The database test checks the refreshed `vp.assertions` statistics after a real worker drain. At the `1.8.0` checkpoint, the latest page-grounded run matched 23/23 curated markers, produced 164 assertions and 164 candidates, replayed successfully, recorded three relations and zero pending relation jobs, and passed six cited Ask checks. The marker labels remained `CANDIDATE`; no independent blind review or billing reconciliation was performed, and the broader VP quality and product gates remained open. The later `1.10.0` evidence is recorded below.

## VP-04 / Stage 8 PDFium numeric stacked-fraction repair — 2026-10-02

The existing `pypdfium2==5.11.0` pin (upstream tag commit
`0168561b33a3fc32eceb6ae46cc252f6b0e90c19`, PDFium 7913,
`Apache-2.0 OR BSD-3-Clause`) remains an adapter-local `AUGMENT` behind
`PythonDocumentFormatAdapter` and the Transformation Port. pdfplumber remains
the `ADOPT` owner of document reading order and Page/BBox selectors. No package,
runtime, lockfile, or upstream source was added. The adapter now groups
top-level arithmetic when it serializes a geometry-backed stacked fraction;
this repairs `100 = 110/1 + r` to `100 = 110/(1 + r)` on the exact finance PDF.
The existing numeric-prefix, glyph alignment, character-containment, and
mismatch fail-closed checks remain. It only reconstructs source geometry; it
does not infer a new Claim or assert the source is factually correct.

The exact PDF was tested through the actual Chromium intake and DeepSeek
extraction flow: 147/147 direct Evidence assertions, 23/23 positive markers,
6/6 non-claim canaries excluded, replay matched, one current relation, and zero
pending relation jobs. The 21 Python and 30 focused Stage 8/SourceMap tests
passed. The extraction-only run reported 16,594 provider tokens. A separate full-Ask
run with the same adapter passed six questions and their citations; actual
invoice reconciliation was not performed. The corpus is still
`CANDIDATE`, and wider precision/recall, independent labels, duplicates and
multi-source relation quality remain open. Rollback reverts this reconstruction
and adapter identity to `1.9.0`; old immutable transformation revisions remain
readable. See the [focused VP-04 report](../../implementation/vp-finance-pdf-flat-formula-verification-2026-10-01.md#2026-10-02-direct-claim-v7-numeric-fraction-repair).

## VP-04 / Stage 8 PDFium CAPM subscript recovery — 2026-10-02

The pinned `pypdfium2==5.11.0` (`0168561b33a3fc32eceb6ae46cc252f6b0e90c19`,
`Apache-2.0 OR BSD-3-Clause`) remains `AUGMENT` behind the existing Python
document-format adapter. The fixed `pdfplumber==0.11.10` `ADOPT` remains the
owner of source reading order and Page/BBox selectors. PDFium's exact geometry
reconstructs the page 9 CAPM expression with its subscripts and brackets;
Shotgun keeps the SourceMap and only allows aligned formula glyphs. No new
dependency, runtime, schema, or upstream code was introduced. Existing
security and maintenance review remains in `oss-source-registry.json`; rollback
returns adapter `1.11.0` to `1.10.0`. See the
[Stage 8 review](../../implementation/stage-validations/stage-8-oss-integration-review.md#vp-04--stage-8-pdfium-capm-subscript-recovery--2026-10-02)
and [full PDF test record](../../implementation/vp-finance-pdf-flat-formula-verification-2026-10-01.md#2026-10-02-capm-subscript-and-direct-claim-v8-recheck).

## VP-08 / Stage 8 external URL freshness propagation — 2026-10-02

The existing Shotgun `SecureUrlAcquisitionCoordinator` and PostgreSQL URL
provenance receipts have Integration Decision `AUGMENT`: the latest successful
`retrieved_at` now flows through Source detail, Ask context digest, attempt Evidence, provider
prompt, and saved citation. A 24-hour Shotgun TTL marks expired external text
historical. No dependency or upstream code was added.
`lucasastorian/llmwiki` at `ad626a3d81be1480e35ef4e94234de8dbb27a61e`
(`Apache-2.0`) remains `REFERENCE_ONLY`; its Watcher/runtime is excluded by the
existing Role Matrix. `garrytan/gbrain` at
`a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` (`MIT`) remains
`REFERENCE_ONLY` for Job patterns. There is no relevant standalone OSS package
for Shotgun's TTL-to-citation meaning (`NO_RELEVANT_OSS`). The PostgreSQL
repositories and `ExternalSourceFreshnessView` are the replacement boundary.
Contract, UI, unit, and focused PostgreSQL tests passed. Migration 128 is
additive and nullable; restoring the pre-migration database is the rollback
path if the columns must be removed. No scheduled refresh worker or refresh
failure receipt exists yet, so this partial slice does not pass the VP-08 OSS
or Product gate. See the [implementation and verification record](../../implementation/vp-url-freshness-ask-projection-2026-10-02.md).

## VP-04 / Stage 8 Korean PDF word-gap recovery — 2026-10-02

The locked `pdfplumber==0.11.10` package remains `ADOPT` behind
`PythonDocumentFormatAdapter`; it owns PDF reading order, word geometry, and
Page/BBox selectors. A visual comparison of the supplied finance PDF showed
that its default horizontal tolerance merged Korean words in a complete
page-9 directional statement. Adapter-local `x_tolerance=2.0` restores those
visually separated words. A bounded post-join correction removes only the
false gap inside numeric thousands groups, preserving values such as `1,000`.
The existing `pypdfium2==5.11.0` geometry adapter remains `AUGMENT`; no new
package, upstream source, runtime, or lockfile is added. License, security,
maintenance, and exact upstream pins remain in the Source Registry. The
replacement boundary is unchanged: `PythonDocumentFormatAdapter` behind the
Transformation Port with Page/BBox and SourceMap contracts. Adapter `1.12.0`
is rollback-compatible with `1.11.0`; existing transformation revisions are
immutable and can be regenerated.

Python PDF tests passed 23/23 and focused Stage 8 Golden/Contract tests passed
30/30. The real 10-page PDF flow with DeepSeek matched 80/80 candidate markers,
excluded 11/11 non-claim canaries, and passed six cited Ask cases plus replay
with no pending relation jobs. The corpus remains `CANDIDATE`; semantic and
relation correctness adjudication, repeated quality runs, and billing
reconciliation remain open. Details are in the
[Stage 8 OSS review](../../implementation/stage-validations/stage-8-oss-integration-review.md#2026-10-02-vp-04-korean-pdf-word-gap-recovery)
and [full PDF test record](../../implementation/vp-finance-pdf-flat-formula-verification-2026-10-01.md#2026-10-02-korean-pdf-word-gap-recovery).

## VP-09 / Ask Evidence page-location propagation — 2026-10-02

**Target:** `AskAnswerProviderPort`, `AskExecutionEvidence`, the existing
PostgreSQL Ask repository, and the Ask citation view. Source locations already
belong to Shotgun's `EvidenceSpan.selectors`; this change carries verified
`PageSelector` and `BoundingBoxSelector.page` values to the provider context and
the citation link label. It does not create a second page-number authority or
infer a page from quote text.

The four previously pinned references were checked against this narrow scope:

| Candidate                                                           | Reviewed pin and license                                     | Decision for selector-to-citation page mapping                                                                                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`garrytan/gbrain`](https://github.com/garrytan/gbrain)             | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT              | `REFERENCE_ONLY`; its citation/search patterns do not supply Shotgun Evidence selectors or SourceVersion binding.                                                           |
| [`lucasastorian/llmwiki`](https://github.com/lucasastorian/llmwiki) | `ad626a3d81be1480e35ef4e94234de8dbb27a61e`, Apache-2.0       | Existing locator/highlight work remains relevant to source viewing, but no upstream code is needed to read Shotgun's persisted selectors. `REFERENCE_ONLY` for this change. |
| [`ddsyasas/llm-wiki`](https://github.com/ddsyasas/llm-wiki)         | `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`, MIT              | `REFERENCE_ONLY`; Ask presentation only, no citation-location contract or backend reuse.                                                                                    |
| [Inkeep OpenKnowledge](https://github.com/inkeep/open-knowledge)    | `f2834c237639e2cff603817ed88182b33f83cf91`, GPL-3.0-or-later | `REFERENCE_ONLY`; visual/source UX only, no GPL code or runtime is introduced.                                                                                              |

**Integration decision:** `NO_RELEVANT_OSS` for the exact SourceMap-selector to
Ask-citation mapping. PostgreSQL and the Evidence/SourceMap contracts are
existing Shotgun-owned dependencies. No new package, dependency, runtime,
schema, or migration is needed. The replaceable boundary remains
`AskAnswerExecutionRepositoryPort` plus the typed Ask contracts; provider
adapters receive only page metadata attached to the already-authorized exact
Evidence. Source text remains untrusted, access and sensitivity checks are
unchanged, and missing page metadata remains absent rather than guessed.
Page-aware retrieval uses new query-plan revisions (`ask-query-plan-vp5`,
`ask-query-plan-v6`, and `ask-query-plan-v7`); historical revisions retain
their prior context digest and retry behavior.

**Prototype result:** the deterministic helper accepts only positive integral
`PageSelector` and `BoundingBoxSelector.page` values. On the MAIN-based branch,
root typecheck passed; Ask execution/provider unit and Ask contract tests passed
37/37; Ask workspace UI passed 30/30; and isolated PostgreSQL tests passed 6/6
for Source selector retrieval, persisted citation readback, and existing query-
plan replay compatibility. Changed-file ESLint, Prettier, full documentation
validation, frontend production build, and `git diff --check` passed.

**Golden status:** an installed-MAIN readback now renders the saved real-
DeepSeek answer and links its Evidence to PDF page 2; details are in the
[installed verification](../../implementation/vp-ask-page-citation-installed-verification-2026-10-02.md).
This single saved answer remains a candidate Golden and does not close VP-09.
**Benchmark:** no extra provider call was added; the prompt-token delta from
page metadata has not been measured. Rollback removes the optional page-number
field and rendering; it requires no data migration and leaves the underlying
Evidence selectors and citations intact.
