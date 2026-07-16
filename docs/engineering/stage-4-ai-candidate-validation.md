# Stage 4 — AI Provider, Direct Claim Candidate and Validation

## 상태

**COMPLETE — 2026-07-17**

## 실행 흐름

```text
EvidenceIndexed
→ Candidate Generation
→ GenerateStructured
→ AI Provider
→ Gemini 또는 Fake Adapter
→ ClaimCandidate(PENDING_VALIDATION)
→ Validation
→ CandidateValidated 또는 CandidateRejected
```

## 폴더 구조

```text
modules/
  ai-provider/
  candidate-generation/
  validation/
adapters/
  ai-provider-gemini/
  ai-provider-fake/
  stage4-in-memory/
  postgres-stage4/
db/migrations/
  004_stage4_ai_candidate_validation.sql
tests/
  contract/ai-candidate-validation.contract.test.ts
  database/stage-4-postgres.test.ts
  live/gemini-provider.live.test.ts
```

## 핵심 규칙

- Candidate Generation은 Provider SDK를 직접 호출하지 않는다.
- EvidenceSpan 없는 Candidate는 생성하지 않는다.
- 원문과 정확히 일치하지 않는 Claim은 `REJECTED`다.
- Candidate Revision은 1로 고정하고 내용은 수정하지 않는다.
- Validation 상태만 Event를 통해 갱신한다.
- 비용 값이 없으면 `unavailable`로 기록한다.
- Private Gemini 전송은 기본 비활성화다.

## 실행과 검증

```powershell
$env:DATABASE_URL = 'postgres://shotgun:shotgun@localhost:5432/shotgun'
docker compose up -d --wait
npm run db:reset
npm run check
npm run test:database
npm run test:live-ai
```

`test:live-ai`는 `GEMINI_API_KEY`가 있을 때만 실행되며 합성 공개 문장만 전송한다.
