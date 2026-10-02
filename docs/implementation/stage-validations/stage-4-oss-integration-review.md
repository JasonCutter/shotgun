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

## 2026-10-02 DeepSeek structured-generation repeatability

Target: the existing Stage 4 Candidate Generation and Validation contracts and
the DeepSeek Decision Port adapter. The current adapter was augmented in
place (`AUGMENT`); no new OSS runtime, package, database, or canonical boundary
was introduced. The official [Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/)
and [parameter guidance](https://api-docs.deepseek.com/quick_start/parameter_settings/)
were reviewed on 2026-10-02. The API defaults `temperature` to 1 and recommends
lower values for more focused, consistent output. Shotgun now defaults the
DeepSeek structured-generation adapter to `temperature=0.2`, permits a
constructor override from 0 through 2, and records the exact setting in the
provider adapter revision (`deepseek-chat-completions-v2-temperature-0.2`).
This makes a configuration change distinguishable in provider history.

Three repeated real-PDF extraction runs using the previous API default produced
142, 149, and 161 ready assertions; pairwise normalized claim-set Jaccard
similarities were 0.912, 0.826, and 0.847 (164-claim union). Three real-PDF
extraction runs at 0.2 produced 151, 152, and 151 ready assertions; similarities
were 0.98, 1.00, and 0.98 (149-claim union). All six runs retained 80/80 page
markers and promoted none of the 11 non-claim canaries. A full Ask run at 0.2
also passed its four fixed answer-and-page-citation cases, projection replay,
and relation settlement (5 settled, 0 pending). The full product flow then
passed once with no test temperature override: 151/151 ready assertions, 80/80
markers, 0/11 non-claim promotions, the balance-sheet and NPV answers with
citations, 4/4 fixed Ask cases with correct PDF page citations, replay matched,
5 relations settled, 0 pending, and 31,046 provider-reported tokens over 11
calls (21,903 input and 9,143 output). The stored provider revision matched
`a8-vault-routed-provider-v1/deepseek-chat-completions-v2-temperature-0.2`.
Using DeepSeek's official [pricing table](https://api-docs.deepseek.com/quick_start/pricing/)
as of 2026-10-02, `deepseek-flash` cache-miss prices estimate this usage at
$0.008771 off-peak or $0.017542 at peak. The estimate does not account for
cached input tokens because the local diagnostic did not retain the cache-hit
breakdown. DeepSeek says returned API token usage is the source of truth for
tokens and bills according to current prices ([token usage](https://api-docs.deepseek.com/quick_start/token_usage/)),
but the account balance/invoice has not been reconciled, so neither estimate
is recorded as the actual charge.
However, the two preceding no-override runs timed out waiting for the first Ask
answer; the answer run stayed `QUEUED` with no attempt while the same-scope
knowledge-pending check was false. A third run passed in 1.5 minutes. The live
test now records a bounded worker-context diagnostic if this recurs. This
intermittency remains a product reliability issue to investigate. These runs
establish improved repeatability for this PDF corpus, not independent claim
correctness or a general quality guarantee. The supplied finance-PDF audit
dump is opt-in and writes candidate/evidence detail only to the local
operating-system temp directory; it is not checked into the repository.

Unit tests cover the 0.2 default, a caller override, and invalid values;
adapter/contract checks verify that the versioned identity reaches persisted
provider diagnostics. The no-override full-flow test passed and asserted that
identity, but its two preceding queue timeouts mean Ask availability is not yet
stable. No migration is required. Rollback can set the adapter override to the
API default 1 or restore the previous adapter revision. Semantic validation
remains `NOT_RUN`, marker labels remain `CANDIDATE` pending independent
adjudication, and actual provider billing is not reconciled. VP-04/05 remain
open.

## 2026-10-02 stable replay, source fidelity, and live audit

The full-flow test now requires three consecutive successful, unchanged replay
observations with the relation queue complete and no pending, failed, or
unknown jobs. This closes the test's prior race where a single zero-pending
snapshot was followed by a newly visible relation job. It changes the test
synchronization only; no production queue behavior changed.

Two additional default-temperature (`0.2`) runs passed the actual PDF intake,
DeepSeek extraction, relation processing, Ask answers, citations, and replay.
The first produced 151 assertions, 80/80 page markers, 0/11 exact non-claim
promotions, 4/4 fixed Ask answers with the expected page citations, 10 current
relations (7 `EQUIVALENT`, 3 `RELATED`), and 0 pending jobs. It used 16 provider
calls and 37,081 reported tokens (27,589 input, 9,492 output); the no-cache
price estimate is $0.009834 off-peak or $0.019667 at peak. The second produced
148 assertions, again 80/80 markers and 0/11 exact non-claim promotions, 4/4
fixed Ask answers with the expected page citations, 8 current relations (5
`EQUIVALENT`, 3 `RELATED`), and 0 pending jobs. It used 13 calls and 33,457
reported tokens (24,168 input, 9,289 output); the no-cache estimate is $0.009199
off-peak or $0.018397 at peak. Both estimates use the official [DeepSeek price
table](https://api-docs.deepseek.com/quick_start/pricing/) and exclude cached
input discounts. They are not reconciled to the provider invoice.

An opt-in audit of the second run found that all 148 stored direct assertions
were exact substrings of their attached Evidence. A separate `pypdf 6.10.0`
read found 73/80 marker phrases verbatim on their expected PDF page; the other
seven are formula/symbol text on pages 5, 6, and 9 and were verified in rendered
page images. This is a source-location check, not a semantic gold review. The
audit also found five normalized duplicate groups across repeated pages. The
11 non-claim examples had zero exact promotions, while semantic validation is
still `NOT_RUN`; the corpus remains `CANDIDATE` and VP-04/05 remain open.

Three default-temperature live runs have now timed out on the first Ask with a
`QUEUED` run and no attempt despite a same-scope `knowledgePending=false` check.
The last failure's test-only context diagnostic used an incomplete workspace
stub and returned `TypeError`; it has been changed to use the real PostgreSQL
Ask workspace projection and to record a bounded claimability diagnostic in
the disposable test database. Two subsequent live runs passed, but neither
exercised that failure diagnostic. Ask queue availability is therefore still
unresolved, and VP-04/05 remain open.

## 2026-10-02 repeated actual-PDF run after stable replay polling

A further full Product run used the supplied finance PDF, the configured
DeepSeek `deepseek-flash` provider, `direct-claim-v10`, temperature `0.2`, and
an isolated PostgreSQL database. It passed in about 1.7 minutes. The run
created 147 direct assertions; all 147 matched their attached Evidence text,
all 80 page markers were found, and none of the 11 exact non-claim canaries
were promoted. All four fixed page-specific Ask cases returned the expected
answer with citations on pages 2, 3, 5, and 9. Replay matched; eight current
relations (six `EQUIVALENT`, two `RELATED`) settled with zero pending jobs.
Fourteen provider responses reported 34,717 tokens (25,331 input and 9,386
output). Using the DeepSeek [official price table](https://api-docs.deepseek.com/quick_start/pricing/)
cache-miss prices, this is an estimated $0.009431 off-peak or $0.018863 at
peak before cache discounts. The account invoice was not reconciled.

This is another successful run of this single candidate corpus, not a gold
semantic review. The assertion count and current relation set differ from
the preceding runs. Labels remain `CANDIDATE`, semantic validation is
`NOT_RUN`, and the prior intermittent queued-Ask failures remain unexplained;
VP-04/05 are still open.

Two serial Chromium/isolated-PostgreSQL repetitions of the same full Product
flow then passed in 3.4 minutes total. The runs created 142 and 147 direct
assertions; both matched all 80/80 page markers, promoted none of the 11
non-claim canaries, answered all four fixed questions with their expected
answers and PDF pages (2, 3, 5, and 9), matched projection replay, and settled
the relation queue with zero pending jobs. Current relation counts differed
(6, then 12). No first-Ask timeout occurred in these two runs, but the earlier
three queued-without-attempt timeouts remain unexplained. The changing claim
and relation counts still need independent adjudication and a documented
quality bound; the corpus is `CANDIDATE`, semantic validation remains
`NOT_RUN`, and VP-04/05 remain open.
