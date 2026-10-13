# Independent measurement review correction

- Reviewed subject: `0c0729c8fa6bc6302c43cc2b6c31408c33812f16`, base `aba6ff27f9620ee1a3f408f8df81e8aad21cc584`.
- Scope: offline relation measurement and supplied provenance structure only. No provider calls, operating database, frozen 72/432/B12 rescoring, Gold-B-7 or new certified reference.

The independent review reproduced one structural validation defect in `externalVerificationErrors`. A supplied JSON record without the mandatory `unresolvedMaterialDisagreement` field passed the truthiness check. A string `verificationScope: "KIND DIRECTION WARRANT INPUT_SUFFICIENCY"` passed the substring `.includes` checks. Using the existing fictional format fixture, each malformed record produced no exclusions, `externallyVerifiedReferences = 1`, and Frontier overall recall `1/1`. These observations concern malformed records being counted as structurally eligible; they do not establish any human review or semantic Gold.

The correction requires a closed, unique array of verification scopes and an explicit boolean disagreement status. Missing/null/string disagreement states, string scopes, unknown/duplicate scope roles, invalid verification methods and unresolved material disagreement are excluded. The shared validator protects both certification reference eligibility and Frontier membership without introducing an authentication service or changing evaluation authority.

Targeted regression tests use only fictional JSON fixtures and assert zero eligible positive/externally verified references plus N/A Frontier recall for malformed records. The review found no additional concrete defect in the inspected direction, allowed tuple, warrant, raw/adopted, UNKNOWN or exact decimal arithmetic paths.

Validation used `C:/dev/artifacts/vp-full-completion-2026-10-12/test-runner.cjs`, which strips provider credentials and does not load operating environment files. Targeted relation unit suite: **32 PASS**, including eight malformed provenance negative cases. ESLint for the changed source/test and package TypeScript compilation: **PASS**. Prettier formatted only the three owned files. These results verify offline structure and calculation contracts; they do not authenticate human records or provider quality.

Rollback: remove this validation correction and its regression tests. No data or runtime migration is required. New certified references remain **0**.
