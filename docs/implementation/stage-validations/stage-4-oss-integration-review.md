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
