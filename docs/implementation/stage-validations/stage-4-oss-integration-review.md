# Stage 4 OSS Integration Review

- 검토일: 2026-07-17
- 대상: AI Provider, Direct Claim Candidate and Validation
- OSS Gate: **COMPLETE**
- 상세 등록부: [`oss-source-registry.json`](../oss-source-registry.json)

## 완료 판정

**Stage 4: COMPLETE**

원문 Evidence에 직접 쓰인 문장만 `ClaimCandidate`로 만들고, 독립 Validation이 정확한
원문 구간을 확인한 뒤에만 `READY`로 바꾼다. 추론·요약·번역은 기본 프로필에서
비활성화되며, 원문에 없는 문장은 `REJECTED`가 된다.

## OSS 결정

| 후보                                 | 결정             | 적용 범위                                          |
| ------------------------------------ | ---------------- | -------------------------------------------------- |
| Google Gen AI JS SDK 2.12.0          | `ADOPT`          | Gemini Interactions API Adapter                    |
| Gemini JSON Schema Structured Output | `AUGMENT`        | 공급자 제약 후 Ajv로 재검증                        |
| Ajv 8.20.0                           | `ADOPT`          | 공통 계약과 모델 출력의 최종 검증                  |
| LiteLLM 1.83.7                       | `DEFER`          | 두 번째 실제 공급자 또는 중앙 게이트웨이 시 재검토 |
| Zod 4.4.3                            | `REJECT`         | Ajv와 중복되는 두 번째 검증 체계 미도입            |
| Langfuse 4.14.0                      | `DEFER`          | 개인 원문 외부 전송과 별도 운영 서비스 미도입      |
| OpenTelemetry API 1.9.1              | `DEFER`          | 다중 프로세스·외부 관측 백엔드 시 재검토           |
| ddsyasas/llm-wiki                    | `REFERENCE_ONLY` | 모델·비용·Attempt 표시 방식만 참고                 |

## 공급자 경계

```text
Candidate Generation
  -> GenerateStructured(taskProfile, schemaName, evidence)
AI Provider
  -> AIProviderAdapterPort
Gemini Adapter
  -> @google/genai
```

- Candidate Generation은 Gemini 모델명이나 SDK 타입을 알지 못한다.
- 실제 공급자는 `gemini-3.5-flash`로 고정한다.
- Fake Adapter와 Gemini Adapter는 같은 Port를 구현한다.
- 공급자 교체 시 Candidate·Validation 계약은 바꾸지 않는다.

## 데이터 정책

- Gemini 요청은 `store:false`를 사용한다.
- 검색·도구·파일 업로드를 사용하지 않는다.
- 공유 데이터셋과 피드백 제출을 사용하지 않는다.
- `restricted` 원문은 항상 거부한다.
- `private` 원문은 결제 서비스 데이터 조건과 프로젝트 로깅 설정을 확인한 후
  `GEMINI_ALLOW_PRIVATE=true`로 명시적으로 허용할 때만 전송한다.
- 실제 연결 검증은 합성 공개 문장만 사용한다.

## Contract 검증

| 검증                                                      | 결과 |
| --------------------------------------------------------- | ---- |
| Direct-only 추출                                          | PASS |
| 원문에 없는 추론 거부                                     | PASS |
| JSON Schema 불일치 재시도                                 | PASS |
| 429 Provider 오류 매핑                                    | PASS |
| Evidence 정합성                                           | PASS |
| Provider·Model·Prompt·Policy·Token·Cost 상태·Attempt 기록 | PASS |
| 동일 입력 Candidate 중복 방지                             | PASS |
| Fake Adapter 공통 계약                                    | PASS |
| Gemini 실제 Adapter 합성 데이터 계약                      | PASS |
| PostgreSQL 재시작 동일 Candidate·Validation 유지          | PASS |
| Candidate 모듈 Provider SDK 직접 의존 금지                | PASS |

## 알려진 제한

- Gemini API가 실제 금액을 응답하지 않으므로 비용은 `unavailable` 상태로 명시한다.
- Semantic Validation은 기본 프로필에서 `NOT_RUN`이다.
- 두 번째 실제 공급자는 Stage 4 완료에 포함하지 않고 공통 Fake Adapter 계약으로
  교체 가능성을 고정한다.

## VP-04 PDF 물리 줄 경계 Candidate 분할 재검토 (2026-10-01)

| 후보              | 검토 버전                                                         | 결정             | 범위와 근거                                                                                                                                                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| spaCy Sentencizer | `v3.8.16`, commit `26b4d1dc04a812f426e4bef3e8a1b6f159d6f048`, MIT | `REFERENCE_ONLY` | 공식 컴포넌트는 punctuation 기반 규칙 문장 경계를 제공한다. 이번 작업은 PDF의 시각적 줄·페이지·BBox Evidence를 유지하면서 줄 바꿈 문장과 수식 행을 붙이고 독립 항목만 분리해야 하므로, 일반 문장 분할기는 대상 문제를 해결하지 않는다. spaCy runtime과 모델은 도입하지 않는다. |

- 공식 [Sentencizer 문서](https://spacy.io/api/sentencizer/)와 [v3.8.16 release](https://github.com/explosion/spaCy/releases/tag/v3.8.16), [MIT License](https://github.com/explosion/spaCy/blob/v3.8.16/LICENSE)를 확인했다.
- GitHub 보안 페이지에는 `SECURITY.md`가 없고 검토일 기준 게시된 보안 권고가 없다. 최신 release는 2026-08-24다.
- Candidate Generation은 추출된 exact source substring만 분리한다. 물리 줄의 BBox와 offsets는 Stage 8의 고정 `pdfplumber` adapter가 소유한다. 이 구분에 대한 회귀·계약 결과는 [VP finance PDF verification](../vp-finance-pdf-flat-formula-verification-2026-10-01.md)에 기록한다.
- 직접 구현 근거: `Sentencizer`는 punctuation boundary만 제공하며 PDF geometry, 수식 행, 완전한 claim 경계와 한글 조사로 이어지는 줄 바꿈은 판정하지 않는다. 이미 확보한 Candidate Generation Port와 exact Evidence 검증을 사용하고 새로운 NLP runtime은 추가하지 않는다.
- 재평가 조건: 여러 문서 형식에서 공통 문장 분할이 필요한 Golden corpus가 정해지면 한국어·수식·목록 경계를 포함한 정밀도/재현율 benchmark를 실행한다.

## VP-04 Direct claim shape and source-span alignment (2026-10-01)

Target: Stage 4 `CandidateGenerationModule` behind its existing Candidate and Evidence contracts; no Provider SDK or Candidate schema change.

| Candidate                                                                          | Reviewed pin and license                                                | Decision                      | Scope and exclusion                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`garrytan/gbrain`](https://github.com/garrytan/gbrain)                            | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT                         | `REFERENCE_ONLY`              | Fact and Job patterns do not supply Korean claim-shape or exact Evidence-span alignment; no Runtime or DB is imported.                                                                                                                       |
| [`lucasastorian/llmwiki`](https://github.com/lucasastorian/llmwiki)                | `ad626a3d81be1480e35ef4e94234de8dbb27a61e`, Apache-2.0                  | `EXTRACT` (existing decision) | Existing independent conversion and lint extracts remain bounded to their reviewed modules; they do not classify Korean propositions or repair provider whitespace against a unique Evidence span. No new code is extracted for this change. |
| [`ddsyasas/llm-wiki`](https://github.com/ddsyasas/llm-wiki)                        | `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`, MIT                         | `REFERENCE_ONLY`              | Intake/Ask UX only; backend and model client remain excluded.                                                                                                                                                                                |
| [`inkeep/open-knowledge`](https://github.com/inkeep/open-knowledge)                | `f2834c237639e2cff603817ed88182b33f83cf91`, GPL-3.0                     | `REFERENCE_ONLY`              | Review and graph UX only; no compatible Candidate Generation implementation is reused.                                                                                                                                                       |
| [spaCy Sentencizer](https://github.com/explosion/spaCy)                            | `v3.8.16`, commit `26b4d1dc04a812f426e4bef3e8a1b6f159d6f048`, MIT       | `REFERENCE_ONLY`              | Punctuation boundaries do not classify Korean claim completeness or align model text to source geometry.                                                                                                                                     |
| Standalone Korean complete-claim predicate and whitespace-only exact-span recovery | No relevant upstream OSS identified among the pinned Stage 4 candidates | `NO_RELEVANT_OSS`             | Keep the bounded v7/v8 shape guard and unique whitespace-normalized span lookup in Shotgun Candidate Generation; provider text is accepted only as an exact Source Evidence substring after recovery.                                        |

The existing pinned-source security and maintenance reviews remain in [`oss-source-registry.json`](../oss-source-registry.json). No new dependency, model, runtime, or lockfile entry is introduced. The adapter mapping collapses whitespace only for lookup and returns the exact original Evidence slice; it refuses ambiguous matches or any changed non-whitespace character. The v7 shape guard drops isolated lexical/value tokens and bare single-letter sequences; v8 adds one bounded opening-fragment rule for a Korean clause whose preceding condition was omitted. Complete Korean predicate forms and equations remain eligible. The separate Validation module still requires the resulting claim to be an exact contiguous Evidence substring and does not claim semantic truth validation.

Contract and unit coverage checks unique and ambiguous span matches, altered values, isolated terms/values/symbols, Korean propositions, and equations. The supplied-PDF DeepSeek browser run and its corpus result are recorded in the [finance PDF verification report](../vp-finance-pdf-flat-formula-verification-2026-10-01.md). No migration is required. For the original v7 checkpoint, rollback restored v6 and removed the v7-only guard/rebind. The current v8 rollback restores default v7 and removes only the added v8 instruction/guard. Recorded Candidate/Provider revisions remain immutable and can be re-extracted through the existing Candidate materialization command.

## 2026-10-02 direct-claim-v8 incomplete Korean clause guard

The exact finance-PDF candidate audit found a repeated incomplete fragment:
`이 되게 하는 수익률이 IRR 이다 .` It omits the condition that appears in
preceding Evidence. The pinned Stage 4 candidates above were reviewed again;
none provides Korean predicate completeness or safe Evidence rebinding, so the
existing `CandidateGenerationModule` remains the boundary and the decision is
still `NO_RELEVANT_OSS`. The default prompt is versioned as
`direct-claim-v8`; its narrow shape guard drops this opening fragment while
preserving complete clauses and equations. `direct-claim-v7` remains available
for replay. Direct Evidence Validation still rejects any non-exact candidate.

Unit and Stage 4 contract tests passed 61/61, and the already approved
deterministic `quality:gate` passed unchanged (precision 0.636, recall 0.875,
F1 0.737, unsupported-claim rate 0). A real Chromium + isolated PostgreSQL +
DeepSeek run with v8 passed 24/24 positive markers and excluded all six
non-claim canaries. It produced 141 candidate rows and 132 current assertions;
the variation and non-promoted candidate disposition require complete corpus
adjudication and remain open. No dependency, model, Provider SDK, Candidate
schema, or lockfile changed. Rollback restores default v7 and removes the v8
instruction/guard; immutable provider output and candidate revisions remain
available. See the [full finance PDF result](../vp-finance-pdf-flat-formula-verification-2026-10-01.md#2026-10-02-capm-subscript-and-direct-claim-v8-recheck).

## 2026-10-02 structured-generation deadline and durable lease renewal

Target: Stage 4 `GenerateStructured`, the existing `AIProviderAdapterPort`,
DeepSeek adapter, and the PostgreSQL Connector Runtime. A finance-PDF run with
111 Evidence spans received HTTP 200, but its body remained incomplete after
both the prior 60-second and 300-second limits. Each provider attempt was
recorded `OUTCOME_UNKNOWN`; no output was materialized and no automatic provider
recall occurred. A selected one-case relation test also reached its 150-second
test ceiling without a decision. This is evidence of long or stalled responses,
not an answer-quality result.

The official [DeepSeek rate-limit guidance](https://api-docs.deepseek.com/quick_start/rate_limit/)
says non-streaming requests may remain open while the service sends empty lines,
and the server may close a request if inference has not started within 10
minutes. Shotgun's prior five-minute cutoff could therefore cancel before this
documented queue interval elapsed. The generation deadline is now 15 minutes;
connectivity probes retain their 60-second limit. The pending database response
body is parsed only when complete, and timeout/cancellation still becomes a
durable `OUTCOME_UNKNOWN` with no automatic provider recall.

The same test exposed that PostgreSQL Job and partial-order leases were set to
five minutes and never renewed. The existing Job renew Port and a new additive
ordering renew method are now used at a 60-second cadence while their operation
is active. A lost or uncertain lease aborts the handler signal; an expired
lease cannot be renewed back to life. This lets a bounded long-running request
keep its fencing authority while preserving fail-closed behavior after
ownership is lost.

| Candidate                                                         | Reviewed version                                       | Decision             | Scope                                                                                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [garrytan/gbrain](https://github.com/garrytan/gbrain)             | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT        | `REFERENCE_ONLY`     | Its Job/deadline/recovery patterns were reviewed; the Shotgun Connector Runtime and provider ledger keep owning execution and outcome meaning.                     |
| [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki) | `ad626a3d81be1480e35ef4e94234de8dbb27a61e`, Apache-2.0 | `EXTRACT` (existing) | Its independent conversion and lint extracts do not implement provider deadlines or durable lease ownership.                                                       |
| [ddsyasas/llm-wiki](https://github.com/ddsyasas/llm-wiki)         | `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`, MIT        | `REFERENCE_ONLY`     | Its cost/model UX does not supply the Port contract or fenced lease behavior.                                                                                      |
| [Inkeep OpenKnowledge](https://github.com/inkeep/open-knowledge)  | `f2834c237639e2cff603817ed88182b33f83cf91`, GPL-3.0    | `REFERENCE_ONLY`     | Its activity/review UX does not supply provider execution or lease renewal.                                                                                        |
| [LiteLLM](https://github.com/BerriAI/litellm)                     | `1.83.7`                                               | `DEFER` (existing)   | A gateway is unnecessary for this bounded timeout/lease correction; re-evaluate if provider routing or failover becomes a separate requirement.                    |
| Shotgun provider deadline and lease renewal contract              | No relevant OSS                                        | `NO_RELEVANT_OSS`    | No reviewed candidate provides the exact Provider Port, durable `OUTCOME_UNKNOWN`, fenced Job/ordering lease, cancellation, and no-auto-recall semantics together. |

The existing PostgreSQL adapter was augmented without a migration, dependency,
lockfile, or Source/Candidate schema change. The Job runtime now supplies an
`AbortSignal` and renews its durable lease; the ordering Port renews the
current job's ordering fence. Focused PostgreSQL, Stage 4, marker-contract, and
provider deadline tests passed (46 passed; one separate live test was skipped
without live credentials enabled). Targeted ESLint passed. Whole-repository
typecheck and lint report only errors in separate user-owned, untracked TS-7
tests and are not attributed to this change. The updated DeepSeek live run is
recorded in the [finance PDF verification report](../vp-finance-pdf-flat-formula-verification-2026-10-01.md#2026-10-02-deepseek-body-stall-and-generation-deadline-correction).

The Open-source Role Matrix remains unchanged because it already assigns
gbrain's Job/recovery behavior `REFERENCE_ONLY` and PostgreSQL to the existing
Shotgun Adapter boundary. Rollback restores the earlier provider deadline and
removes only the new Job and ordering lease renewal paths/tests. The database
schema is unchanged, so no data migration is needed; existing provider
receipts, immutable Candidate revisions, and `OUTCOME_UNKNOWN` rows remain
untouched.

## 2026-10-02 PDF soft-wrap alignment and direct-claim-v9

Target: the existing Stage 4 Candidate Generation and Validation contracts.
Review of the supplied finance PDF confirmed that its page geometry creates
line breaks inside Korean words. The model often removes that visual break;
the former whitespace matcher treated the newline as a real word boundary and
rejected otherwise exact source claims. The Candidate module now looks up both
ordinary whitespace normalization and a line-break-omitted view, maps a unique
match back to the original Evidence offsets, and persists only that exact
source slice. If more than one source span matches, rebinding still fails
closed. Validation's exact Evidence substring check is unchanged.

The previously pinned Stage 4 candidates were reviewed again: `gbrain` at
`a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` (MIT), `llmwiki` at
`ad626a3d81be1480e35ef4e94234de8dbb27a61e` (Apache-2.0), `ddsyasas/llm-wiki`
at `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` (MIT), Inkeep OpenKnowledge at
`f2834c237639e2cff603817ed88182b33f83cf91` (GPL-3.0), and spaCy Sentencizer
`v3.8.16` at `26b4d1dc04a812f426e4bef3e8a1b6f159d6f048` (MIT). Their recorded
decisions remain `REFERENCE_ONLY`, `EXTRACT` for the existing llmwiki
converter/lint components, or `NO_RELEVANT_OSS` for exact Korean claim-span
rebinding. None supplies a line-wrap-aware unique Evidence-span adapter with
Shotgun's contracts. No new repository, dependency, runtime, lockfile, or
license/security review was introduced. The existing review records each
candidate's source, pin, license, security, maintenance, and boundary.

The default extraction prompt is now versioned `direct-claim-v9`. It retains
the v8 exact-source and incomplete-IRR guard and clarifies that a complete
Korean directional line may itself be a claim even without a final copula. The
durable prompt version lets v8 and v9 runs remain distinguishable. Contract
and unit tests passed 73/73, including exact Evidence restoration, direct
Validation, and ambiguous-match refusal. The default v9 version is also
covered by Stage 4 and quality-baseline contracts. `npm run quality:gate`
passed with precision 0.636, recall 0.875, F1 0.737, unsupported-claim rate
0, and search citation correctness 1.0.

One real DeepSeek PDF run with v8 and the new exact-span lookup produced
150/150 `READY` assertions, 80/80 revised page markers, and zero promotions of
11 non-claim canaries. A v9 full Ask run produced 140/140 exact `READY`
assertions and zero non-claim promotions, but missed one standalone beta
expected-return direction marker (79/80). Its following explanation was
extracted. The v9 prompt explicitly calls out this kind of directional line,
so the live result shows that prompt wording alone does not establish stable
completeness; the combined acceptance test remains failed at this assertion.
All six real Ask scenarios nevertheless answered correctly with the expected
PDF page citations, projection replay matched, and five relations settled with
no pending jobs. The provider reported 31,620 tokens over 12 calls; billing
was not reconciled. Semantic validation remains `NOT_RUN`, and the marker
labels remain `CANDIDATE` pending independent adjudication.

No migration is required. Rollback restores the default v8 prompt and removes
the v9 instruction and unique soft-wrap lookup; already recorded exact Evidence
and immutable Candidate revisions remain available for replay and re-extraction.
VP-04/05 remain open until the golden labels, repeatable completeness, quality
limits, and actual provider cost are resolved.
