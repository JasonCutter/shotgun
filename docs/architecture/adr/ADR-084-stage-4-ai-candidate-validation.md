# ADR-084: Stage 4 AI Provider, Direct Claim Candidate and Validation

- 상태: Accepted
- 날짜: 2026-07-17

## Context

Stage 3는 SourceVersion과 정확히 연결된 EvidenceSpan을 제공한다. Stage 4는 AI가 원문에
없는 내용을 만들어 Canonical 지식으로 유입시키지 않으면서, 공급자 SDK를 교체 가능한
경계 안에서 사용해야 한다.

공식 Google SDK, LiteLLM, Zod, Langfuse와 기존 Ajv를 비교했다. 현재는 TypeScript
단일 프로세스·단일 실제 공급자 MVP이므로 별도 Python 게이트웨이, 두 번째 검증 DSL,
외부 LLM 관측 서비스를 추가하지 않는다.

## Decision

1. 실제 공급자는 `@google/genai@2.12.0`과 안정 모델 ID `gemini-3.5-flash`를 사용한다.
2. SDK는 `adapters/ai-provider-gemini`에서만 사용하고 Domain 모듈에는 노출하지 않는다.
3. Candidate Generation은 모델명이 아니라 `candidate-extraction` Task Profile,
   `ClaimCandidateBatch.v1` Schema와 `direct-only-v1` Policy를 요청한다.
4. Gemini JSON Schema 출력 뒤에 Ajv 검증을 다시 수행하고, 불일치는 최대 2회
   Attempt로 기록한다.
5. ClaimCandidate Revision 1은 불변이며 처음에는 `PENDING_VALIDATION`이다.
6. Validation이 Evidence ID, SourceVersion, 정확한 연속 원문 문자열과 Policy를 각각
   검증한 뒤 `READY` 또는 `REJECTED` 이벤트를 발행한다.
7. Semantic 추론은 기본 프로필에서 실행하지 않고 Dimension을 `NOT_RUN`으로 기록한다.
8. 공급자·모델·Adapter·Prompt·Policy·데이터 정책·Token·비용 상태·Latency·Attempt를
   로컬 저장소에 기록한다.
9. Gemini는 `store:false`, 도구 없음으로 호출한다. Restricted는 항상 거부하고,
   Private은 결제 데이터 조건 확인 전 기본 거부한다.
10. LiteLLM, Langfuse, OpenTelemetry 외부 Export는 운영 필요가 생길 때까지 보류한다.

## Consequences

- 모델이 출력 형식을 지켜도 원문에 없는 Claim은 READY가 될 수 없다.
- Candidate 모듈은 Provider SDK 교체와 무관하게 유지된다.
- 동일 SourceVersion·Profile·Prompt·Policy는 같은 Batch를 재사용한다.
- 실제 금액을 받지 못할 때 비용을 0으로 오인하지 않고 `unavailable`로 기록한다.
- Private 원문을 Gemini로 보내려면 운영자가 데이터 조건을 확인하고 명시적으로
  허용해야 한다.

## Verification

- Fake·Gemini Adapter 공통 흐름
- Direct-only 및 unsupported inference 테스트
- Structured Output mismatch와 Provider retry 테스트
- Evidence alignment와 Validation Dimension 테스트
- PostgreSQL 재시작 idempotency 테스트
- Architecture SDK dependency boundary 테스트
- 합성 공개 문장을 사용한 Gemini 실제 연결 테스트
