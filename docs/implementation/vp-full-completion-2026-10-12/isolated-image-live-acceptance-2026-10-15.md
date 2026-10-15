# Isolated image live product acceptance — 2026-10-15

**Local verdict: `ISOLATED_LIVE_IMAGE_PRODUCT_PASS`.**

This completes the two bounded work packages requested by “먼저 2번 까지 구현
진행해”: execution-boundary correction and isolated real-provider text/image
product acceptance. It does not complete the numbered phases of the full VP
plan, certify AI semantic quality, publish the local implementation, or activate
the operating application.

## Authorization and preserved history

The user approved “격리 이미지 계약 보완·최대 2회 실호출 승인” and, after the
reported blockers and local correction, instructed “계속하세요”. The original
possible UNKNOWN egress counts as one, the completed text responses as seven,
and this resume permits one image request followed by one Ask request. The
aggregate ceiling remains ten. The earlier image attempts made zero provider
calls. Their 403/503 results, SQL/JSON discrepancy, UNKNOWN and STOP are preserved.
The [image contract](./image-product-contract.md) describes their earlier state;
its statement that live acceptance was incomplete is history at that point.

This resume used fresh Source/SourceVersion/execution identities. It did not
replay the earlier UNKNOWN. Original evidence and old STOP files were unchanged.

## Exact executed implementation

- Local runtime commit: `6276186929055bbb3bc2e3a2a57a9e6560885396`.
- Runtime tree: `8e09c7b425552c5a4d9f8192fd831a8179590513`.
- Provider/model: existing `deepseek` / `deepseek-flash`.
- Explicit endpoint: `https://api.deepseek.com/v1/chat/completions`.
- Runtime: `runtime-test`, generated isolated PostgreSQL database, existing
  application bootstrap, Source pipeline, worker, Vault/configuration and Ask.
- SQL `execution_mode` and JSON `transportKind`: `ISOLATED_LIVE_ACCEPTANCE`.
  Migration139 was applied only to the isolated workload.
- Acceptance: `vp-image-live-resume-20261015-two-remaining`.

The external acceptance client now gives synchronous Source submission the
existing provider timeout plus completion grace (960,000 ms), while normal reads
retain 30,000 ms. Product generation timeout, semantic retry policy, prompt,
schema, v6 and the 0.9 gate are unchanged. This corrects a client observer
deadline; no CI timeout was increased to pass a test.

## Observed product flow

| Boundary                | Observed result                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| Original image          | Authored 320×180 PNG, hash `sha256:90ac8bcc64b78ac7f24b64ebcbb507cbb323fb14ab2d4c6686d04e2c743064ca`     |
| SourceVersion           | `d6b274fb-f4a3-47d5-af22-2507cc23e507`                                                                   |
| Source completion       | `IMAGE_OBSERVATION_COMPLETED`; no Evidence indexing result                                               |
| Image execution         | `COMPLETED`, call `a5691167-24c4-4cdf-a910-d9ddc9c2df41`, attempt `8c5e204a-71b2-4806-a42f-f06b11b0c1f0` |
| Image provider response | HTTP200, `a17ed10b-54f0-47a0-b3c2-d1965cd22f9f`                                                          |
| Stored observation      | One `GENERATED_UNVERIFIED` observation; exact call/attempt/SourceVersion/hash/transformation binding     |
| Ask                     | `SUCCEEDED`, AnswerRun `run-e073d64f-d48a-4487-8e74-8cf2c51a8159`                                        |
| Ask provider response   | HTTP200, `56b2b1c4-9a1a-41f6-8739-284a879f08f0`                                                          |
| Answer references       | One UNVERIFIED O reference, zero original Evidence citations                                             |
| Knowledge promotion     | Zero assertions and relation jobs; answer capabilities `EXPORT` only                                     |
| Current read            | `stale=false`; original bytes returned through authenticated image endpoint with `private, no-store`     |
| User flow               | One image submission, one question, HTTP12; project/Source selection and individual review clicks zero   |

The image observation described a uniform blue field without text or shapes.
The Korean Ask answer attributed this to O1 and retained its unverified status
and uncertainty. This is a narrow authored diagnostic, with a color cue in the
predetermined question, not an independent visual benchmark or relation Gold.

The raw HTTP bodies, IDs, usage and hashes are preserved. The image's stored
wire digest equals its captured request body digest. The Ask wire context carries
the same SourceVersion/hash and generated observation. Both response IDs are
distinct from the seven earlier text responses.

## Verification and reuse

- New acceptance-harness tests: 10 PASS, including ordered two-call ceiling,
  exact image hash, duplicate/UNKNOWN STOP, split-secret redaction and slow HTTP
  submission with normal read deadlines preserved.
- Fresh executed-source typecheck: PASS.
- Reused exact runtime-code evidence: 78 unit, 8 contract and 12 PostgreSQL
  tests PASS; legacy Fake migration/rollback preservation and TS6 release PASS.
- The earlier standard TS6 five-second host timeouts remain unresolved. They
  are not converted to PASS; the unchanged Canonical control showed the same
  R3-V16 timeout. No assertion, validator or required test was weakened.
- New real responses: image one and Ask one, both HTTP200. Provider-declared
  token totals are 636 and 1,154; these are usage observations, not billing
  reconciliation or a performance comparison.

The existing native DeepSeek adapter, Vault, AI execution owner, Python/Pillow,
VP Ledger and PostgreSQL/Ask paths are `AUGMENT` reuse. Node HTTP deadline and
capture helpers are bounded acceptance code; no new runtime or dependency was
adopted. Existing pg8.22.0, Pillow12.3.0, lockfile and license/security decisions
remain unchanged. The OSS role matrix requires no new adoption row.

## Authority, cleanup and limits

The same persistent authority store
`eac263d9-b96c-4a6f-aa95-ef0be89d01e0` and authority
`5773b389-e122-4003-9505-2cf361c07ecc` reported UTC day 2026-10-15, daily limit
100, relation count **1 → 1**, unresolved reservations zero. Image/Ask were not
misclassified as VP_RELATION claims. Their two-call ceiling is the approved
isolated acceptance control.

The aggregate is now **10/10**: nine confirmed responses and one earlier
possible UNKNOWN egress. Remaining authorization is **zero**; a durable STOP
prevents further calls. All earlier UNKNOWN and STOP records remain unchanged.

The owned isolated application closed and its database was dropped only after
fsynced snapshots/disposition were saved. Cleanup errors were zero. Operating
migration130, configuration2, standing4(disabled), existing data counts and
credential/configuration bytes are unchanged. The operating app/worker were
never started. Protected files79, other worktrees13 and stash remain preserved;
Gold-B-7, 72/432 and B remaining24 were not opened or resumed.

Evidence root:
`C:\dev\artifacts\vp-full-completion-2026-10-12\image-live-resume-20261015`.
It includes the raw run snapshot, transport receipts, post-run authority/operating
observations and final index. Historical source bytes have immutable archive
locators so later development does not erase the executed-code evidence; old
indexes themselves are not rewritten.

No push/PR/merge or operating cutover was performed. Local product acceptance
does not resolve evaluation-reference trust, full VP DoD, Windows reboot
acceptance, actual operating rollout or billing. No independent semantic Gold
was created, and no subsequent phase or additional real experiment is started
under this consumed authorization.
