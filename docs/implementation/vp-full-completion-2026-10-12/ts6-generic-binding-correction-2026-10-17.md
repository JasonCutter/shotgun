# VP-05 — TS6 generic Port binding correction

**LOCAL_CORRECTION_VERIFIED / PUBLICATION_PENDING / MERGE_HOLD**

Review subject: PR392 head `dbfdef92743fcffbdaa3017d00e061de9bf3d6b3`, base
`89c14c5e2fee9559e21b6b964098a11f4e8cc0e2`. CI38913890006 really completed
SUCCESS; its logs remain unchanged. Subsequent independent AI code review found
an audit defect, so that success is insufficient for merge readiness. This is
code review, not independent human semantic validation or Gold certification.

## 1. Confirmed defects

The existing receiver resolver treated every `Generic<T>` as its first argument.
PR392's generic execution ledger exposed this pre-existing bug: three ledger
calls were qualified through `Output`, which is a value type, not their Port.
The alias walker also followed generic payloads and method return types as if
they were implemented Ports. This produced unrelated same-name caller links.

The v4 validator compared caller expressions and evidence grades but did not
compare `receiverType`, `bindingPort` or `bindingKind`. Changing the first two
fields back to `Output` while keeping the caller and grade returned no issues.
The prior `file:callNeedle` key also conflated distinct lines in one file.

## 2. Minimal correction

- Preserve the outer identity of an ordinary generic receiver. Unwrap only
  structural views `Pick`, `Omit`, `Readonly`, `Partial`, `Required` and
  `NonNullable`. Parse nested generics and key unions with the existing TS AST.
- Do not promote generic payloads or type-literal member return values into
  alias constituents. Cache type-name parsing by exact annotation bytes; source
  inventory and regression files are still reread under the existing rules.
- For v4, compare each `file:line:callNeedle` site and its actual grade, receiver,
  Port and binding kind. Reject duplicated sites and fabricated lines. Historical
  v2/v3 validation retains its prior path; no rule is disabled.
- Explicitly declare that `PostgresCanonicalKnowledgeRepository` implements the
  existing `FrontendKnowledgeDraftCanonicalCommitPort`. Its methods already
  satisfy that contract and the app already injects this class into Frontend.
  Keep the grade `PORT_INFERRED`; do not call static Port inference runtime proof.

The type import and `implements` are erased. Under the same Git Windows checkout
filters and TypeScript5.9.3 options, emitted JavaScript before/after is identical:
`3819802019403d291699382f5948c11d9e94273f979d04605100202bb314e6e6`.
Source maps are excluded from that comparison. No runtime method body changed.

## 3. Current lineage and history

The candidate inventory remains145 and transaction-boundary inventory131.
Classification stays19 TX_BOUNDARY,93 PORT_INFERRED,14 NON_TX and19
TEST_ONLY_OR_DEAD; REVIEW_REQUIRED remains0. Source coordinates291/537/788
become295/541/792 for the same three Stage6 owners after the type declaration.
Only those existing IDs are remapped in current manifest/approved covers.

Caller records decrease516→232:287 unsupported same-name sites removed, three
previously missed actual repository calls added, and four existing sites receive
correct binding metadata (three generic execution calls plus the Canonical Port).
The added isolated-adapter callers remain static Port evidence; they do not mean
that the experimental policy is selected by normal app startup.

The large generated v8 diff removes false links and their derived metadata.
It is not a large product rewrite. Frozen v2–v7, their source digests, regression
test identities, approved owner coverage and historical decisions are preserved.
Current v8 is regenerated from the corrected analysis and existing approved
relations; it is not manually edited to keep the former caller count.

## 4. Verification and retained failures

- Parser regressions: old3/3 FAIL; corrected3/3 PASS. Include an unrelated generic
  receiver/container collision and nested `Readonly<Pick<Port<T>, key union>>`.
- Binding mutations: old receiver/Port mutations2/2 FAIL to be rejected (validator
  issues were empty). Final tests reject receiver, Port, kind, line and duplicate
  site forgeries, as well as the existing grade and regression forgeries.
- Full standard TS6 command: **64/64 PASS**, no failure/skip; existing timeout and
  worker settings unchanged. This includes all prior54 tests and ten additions.
- Typecheck, changed-source ESLint/format, architecture, documentation/ADR/Canonical
  governance, TS6 release and byte-identical regeneration checks PASS. Publication
  still requires new exact-head remote CI.

The first full run after parser repair was52 PASS/5 FAIL because old current
expectations still described the false analysis. A truthful explicit Port
declaration and three owner-coordinate remaps repaired that mismatch; counts
were not forced by weakening the resolver. Intermediate59/59 PASS is preserved.
The byte reproduction check caught formatting after generation; raw canonical
generator output was regenerated rather than relaxing the byte check. An initial
emission comparison also caught Git LF versus Windows CRLF inside SQL templates;
baseline checkout filters, not post-compilation normalization, resolved it.

## 5. Reuse, impact and rollback

**AUGMENT** existing TS6 resolver/validator and the already-used TypeScript
Compiler API: [microsoft/TypeScript](https://github.com/microsoft/TypeScript),
root lockfile5.9.3, Apache-2.0. No dependency/version/lockfile change or new
analyzer service. Existing Vitest, current-lineage builder, security/negative
tests and architecture gate are reused. No relevant external runtime is adopted;
the existing OSS Role Matrix decisions remain unchanged.

No migration, production DB/Vault/configuration/authority change, normal app or
worker activation, provider call, scoring/regrading, model/policy switch, frozen
experiment execution or Gold-B-7 opening. The existing v6/0.9 behavior is retained.
Prior PostgreSQL767 PASS/2 SKIP is reused for unchanged runtime bodies, not claimed
as a new-head DB execution. New-head CI is still required after authorized push.

Rollback reverts this analyzer/test/current-lineage/type-declaration change as a
unit and restores the reviewed prior evidence, while retaining this defect record.
No operating data rollback is necessary. Local raw logs, before artifacts,
coordinate/binding deltas, JS emission proof, independent AI review and final
checkpoint are under `C:/dev/artifacts/vp-full-completion-2026-10-12/ts6-generic-binding-20261017`.

PR392 merge requires this corrected head to be separately published and verified,
followed by explicit merge authorization. Independent local preparation can
continue. The `NO_RELATION` normal-app/active
projection/Ask integration and Windows final release are still separate unfinished
work; this correction does not certify AI semantic quality or full VP acceptance.
