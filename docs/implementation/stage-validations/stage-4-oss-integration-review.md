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
