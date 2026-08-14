---
id: HFM-S0-INVENTORY-260814001
classification: ACCEPTED
status: BASELINE_FROZEN
created_at: 2026-08-14
accepted_at: 2026-08-14
subject_base: 5c3cebc9d08ec50edec3fa7bd2f69568387c7a78
repository: JasonCutter/shotgun
canonical_branch: main
governing_adr: ADR-145
implementation_plan: docs/implementation/human-facing-minimalism-slash-command-product-implementation-plan-260814001.md
section: HFM-S0
---

# HFM-S0 — Human-Facing Surface Inventory and Baseline Freeze

## 0. Status and authority

This document is the **accepted and frozen HFM-S0 baseline** for the complete owner-facing surface disposition required by ADR-145 and `HFM-SLASH-PLAN-260814001`.

Owner acceptance was recorded on 2026-08-14. The HFM-S0 classification and disposition decisions below are now frozen for implementation planning. Any later change must be explicit, reasoned, and recorded as a change to this baseline; no downstream section may silently reinterpret the inventory.

Current section state:

```text
HFM-S0: COMPLETE / BASELINE_FROZEN
HFM-S1: AUTHORIZED / NOT_STARTED
```

This freeze does **not** authorize Product implementation beyond HFM-S1. It authorizes HFM-S1 to translate the frozen inventory into the persistent-shell and slash-surface implementation contract.

## 1. Decision model

Every owner-facing Product surface is classified into exactly one of four dispositions:

- `KEEP` — remains directly visible in the normal Product surface because it is part of the primary owner workflow or safety context.
- `SLASH` — capability remains, but persistent navigation/control chrome is removed. The owner reaches it intentionally through a slash command or a context-equivalent command surface.
- `REMOVE` — removed from the current owner Product surface. This does not imply deletion of Canonical data, protected APIs, governance, audit lineage, or future architecture contracts unless explicitly stated.
- `CONDITIONAL` — surfaced only when current context, state, safety, or recovery requires owner attention. It must not become permanent chrome merely because the capability exists.

The human-facing baseline is deliberately smaller than the backend capability map. Server authority, security, Project binding, expected revisions, idempotency, approvals, outcome recovery, and audit semantics remain authoritative regardless of UI disposition.

## 2. Frozen persistent Product surface

The permanent owner-facing Product surface is frozen to the following minimum:

```text
Shotgun
Current Project context

Home
Sources
Ask
```

No other domain receives permanent primary navigation by default.

The active Project label is `KEEP` because it prevents accidental work in the wrong Project. Project switching itself is `SLASH` because switching is an intentional state-changing action, not a navigation destination.

When no Project exists, first-Project onboarding is `CONDITIONAL`: the Product may directly present the creation path because no normal Project-bound workflow can proceed.

## 3. Global shell inventory

| Surface | Current form | Disposition | Frozen rule |
| --- | --- | --- | --- |
| Product identity `Shotgun` | Top bar | KEEP | Compact product identity remains. |
| Current Project label | Top bar / selector | KEEP | Show one compact, unambiguous active Project context. |
| Project selector control | Top bar and Settings | SLASH | Replace persistent selector with `/project switch`; first-run creation stays conditional. |
| Primary navigation: Home | Sidebar | KEEP | Primary persistent destination. |
| Primary navigation: Sources | Sidebar | KEEP | Primary persistent destination. |
| Primary navigation: Ask | Sidebar | KEEP | Primary persistent destination. |
| Primary navigation: Knowledge | Sidebar | SLASH | Capability retained; permanent nav removed. |
| Primary navigation: Review | Sidebar | CONDITIONAL + SLASH | Surface when review attention exists; manual inspection through slash. |
| Primary navigation: External Action | Sidebar | CONDITIONAL + SLASH | Surface only when action attention exists; manual inspection through slash. |
| Primary navigation: Activity | Sidebar | SLASH | Operational inspection is intentional, not primary chrome. |
| Primary navigation: History | Sidebar | SLASH | Audit/history inspection is intentional, not primary chrome. |
| Primary navigation: Settings | Sidebar | REMOVE | Permanent Settings IA is removed; real controls are decomposed into focused slash/conditional flows. |
| Top `Search` button/modal | Top bar | REMOVE after replacement | Remove only after accepted `/search` replacement is verified. Search capability is retained. |
| Top `Commands` button/palette | Top bar | REMOVE after replacement | Replace with the unified slash entry. Do not delete protected commands. |
| Offline / critical safety banner | Global shell | CONDITIONAL | Remains visible only when the server-authoritative state requires it. |
| Leading warning banner | Global shell | CONDITIONAL | Keep only for real current warning states. |

## 4. Home inventory

Home remains `KEEP`, but it is not a second control plane. It is a compact owner orientation surface.

| Home element | Disposition | Frozen rule |
| --- | --- | --- |
| Active Project state | KEEP | Compact status only. Do not expose internal architecture prose. |
| Primary owner actions for Sources / Ask | KEEP | Direct path to the two primary workspaces. |
| Attention requiring Review / External Action | CONDITIONAL | Appear only when server-reported attention exists. |
| Continue-working resources | CONDITIONAL | Show only when a real resumable resource/draft exists. |
| Recent/Pinned resources | CONDITIONAL | May appear when meaningful; never reserve large empty cards. |
| Operational summary | SLASH or compact conditional cue | Detailed counts belong to Activity; Home may show a small cue only when it changes owner action. |
| Empty-state implementation wording | REMOVE | Never show phrases such as “server reported”, “authoritative”, or internal projection wording to the owner. |
| Coming-later disabled actions | REMOVE | Features without an active owner path are not shown as dead primary controls. |

Home does not execute high-risk Review or External Action commands. It may only route the owner to the authoritative owning workspace/flow.

## 5. Sources inventory

Sources remains a primary `KEEP` workspace because ingestion and source inspection are core owner workflows.

### 5.1 KEEP

- Add Source from Direct Text, File, or URL.
- Human-readable Source label.
- Requested sensitivity/classification control where it materially affects intake.
- Draft queue only while a draft actually exists.
- Submit/discard flow.
- Exact-duplicate owner decision when required.
- Source Library.
- Source search within the active Project.
- Source detail: version choice, preview, evidence.
- Clear processing/failure/retry state only when actionable.
- Citation return links when the owner arrived from Ask/Knowledge.

### 5.2 SLASH / secondary

- Advanced intake/retry recovery options that are not required in the normal successful path.
- Raw identifiers and revisions through `technical.current`.
- Rare version/evidence diagnostic inspection.

### 5.3 REMOVE from default owner presentation

- “server-authoritative”, “Command Ledger”, “typed contract”, “staging immutable bytes”, and equivalent implementation wording.
- Permanent empty Draft Queue explanation when no draft exists.
- Redundant status prose that repeats the same state.
- Raw Source ID / SourceVersion ID in the ordinary reading flow.

## 6. Ask inventory

Ask remains a primary `KEEP` workspace.

The visible hierarchy is frozen as:

```text
Question
↓
Answer
↓
Citations / Evidence
↓
Actionable state or warning
↓
Secondary actions
```

The current implementation ordering in which AnswerRun controls can precede answer statements is not the accepted owner hierarchy and must be corrected downstream.

### 6.1 KEEP

| Ask surface | Disposition | Rule |
| --- | --- | --- |
| Question composer | KEEP | Dominant input. |
| Current answer | KEEP | Dominant output immediately after the question. |
| Citations / pinned Evidence | KEEP | Attached to answer statements; owner can inspect exact evidence. |
| Ask mode | KEEP, context-bounded | Show only the small human-meaningful distinction needed to choose knowledge scope. |
| Source selection | KEEP, context-bounded | Shown only when a source-using mode requires it. |
| Conversation continuity | KEEP | Current conversation and useful prior conversations remain accessible without exposing internal branch machinery. |
| Provider/privacy block | CONDITIONAL | Show only when it blocks submission or requires owner action. |
| Submission outcome recovery | CONDITIONAL | Show only for unknown/rejected outcomes. |
| Cancel active answer | CONDITIONAL | Only while a cancel-capable run exists. |
| Failure retry | CONDITIONAL | Only after a retryable failure. |

### 6.2 SLASH

- Advanced retry with same context.
- Retry under current policy when not the obvious failure recovery action.
- Export answer.
- Propose Intake Draft from an answer.
- Propose Draft ChangeSet from an answer.
- Propose User Directive from an answer.
- Raw AnswerRun / attempt / revision / failure metadata through `technical.current`.

### 6.3 REMOVE

- Persistent `Helpful / Not helpful` feedback controls from the minimal owner surface.
- Internal “protected command boundary”, “Canonical knowledge”, “original Evidence” explanatory prose in the normal composer.
- Persistent AnswerRun action rows ahead of the answer.
- Raw technical IDs in the default answer flow.

The removal of feedback controls is a Product-surface decision only; telemetry or a future bounded feedback mechanism may be reintroduced only through an explicit baseline change.

## 7. Knowledge inventory

Knowledge is **not treated as unimplemented**. The repository contains a real Knowledge workspace, PostgreSQL projection wiring, search, detail, compare, graph, correction/draft paths, and readiness semantics. The HFM decision concerns exposure, not capability deletion.

| Knowledge surface | Disposition | Frozen rule |
| --- | --- | --- |
| Persistent sidebar item | SLASH | Remove permanent nav. |
| Open/search Knowledge | SLASH | `/knowledge` or `/search` routes intentionally into the workspace/result. |
| Knowledge detail | SLASH/context | Reached from search, citations, graph, or explicit command. |
| Compare | SLASH/context | Intentional analysis action. |
| Graph | SLASH/context | Intentional relationship exploration action. |
| Draft/correction editor | CONDITIONAL/SLASH | Appears when the owner explicitly starts or is routed into a correction/change flow. |
| Projection/readiness warnings | CONDITIONAL | Only when degraded/stale/partial state changes interpretation. |
| Raw authority/projection/internal IDs | REMOVE from default | Technical inspection via slash. |

No Canonical write semantics are weakened by this classification. Draft changes remain proposals until the existing protected review/commit boundaries accept them.

## 8. Review inventory

Review is a real governed capability and is retained. Its permanent navigation is not.

| Review surface | Disposition | Frozen rule |
| --- | --- | --- |
| Review sidebar destination | CONDITIONAL + SLASH | Show attention cue when review is required; `/review` for manual inspection. |
| Queue | CONDITIONAL | Mount when owner enters Review or is routed because action is required. |
| Item detail / evidence / impact | KEEP within Review context | Required for an informed decision. |
| Approve / Reject / Request Revision / Hold | KEEP within Review context | Human decision controls are central once Review is open. |
| Reason/comment input | KEEP when decision context requires it | Do not show outside Review. |
| Outcome-unknown recovery | CONDITIONAL | Only after ambiguous command outcome. |
| Internal context IDs/revisions/digests | REMOVE from default | Available through `technical.current`. |

Review remains the authoritative human approval boundary. HFM may reduce chrome but must not bypass, auto-approve, or move approval authority into Home or Ask.

## 9. External Action inventory

External Action is retained as a governed, high-risk capability, but it is not permanent navigation.

| External Action surface | Disposition | Frozen rule |
| --- | --- | --- |
| Persistent sidebar destination | CONDITIONAL + SLASH | Attention cue only when needed; explicit `/external action` for inspection. |
| Candidate/action queue | CONDITIONAL | Open when an actionable candidate exists or owner explicitly asks. |
| Risk / manifest / preflight | KEEP within action context | Required decision and safety information. |
| Approval / execution controls | KEEP within action context | Only where current server authority exposes them. |
| Cancel / rollback / compensation / verify | CONDITIONAL | Show only when the current action state permits and requires them. |
| Outcome-unknown recovery | CONDITIONAL | Must reuse original command identity; never become “execute again”. |
| Attempts/audit/raw IDs | SLASH/technical | Secondary diagnostic inspection. |

HFM does not create any new execution path. Existing approval, preflight, idempotency, verification, rollback/compensation, and outcome-recovery boundaries remain mandatory.

## 10. Activity inventory

Activity is a real Product workspace but not a primary owner destination.

| Activity surface | Disposition | Frozen rule |
| --- | --- | --- |
| Sidebar item | SLASH | `/activity`. |
| Active/recent queue | SLASH | Open intentionally or from a relevant failure/status cue. |
| Filters | KEEP within Activity context | Human-readable, compact. |
| Detail state/timing/attention | KEEP within Activity context | Operationally useful. |
| Retry/Cancel delegated commands | CONDITIONAL | Only when owning-domain authority reports the action is available. |
| Attempts/stages/events/projection metadata | SLASH technical | Hide from default detail; available when troubleshooting. |
| Empty two-pane shell | REMOVE | Empty state should be compact and singular. |

Activity never becomes an independent authority for retry/cancel; delegated commands continue to use the owning Domain command path.

## 11. History inventory

History is retained as the unified audit/history reader but becomes intentional access.

| History surface | Disposition | Frozen rule |
| --- | --- | --- |
| Sidebar item | SLASH | `/history`. |
| History list and domain filter | KEEP within History context | Compact audit browse. |
| Event detail | KEEP within History context | Human-readable event summary first. |
| Payload availability status | KEEP within History context | Needed to understand retention/redaction. |
| Raw audit payload | SLASH technical | Not default reading flow. |
| Owning-domain links | KEEP within context | Route to the authoritative domain. |
| Reversal initiation | CONDITIONAL | Only on eligible Canonical entries. |
| Technical event/resource IDs | SLASH technical | Hidden from normal display. |

History remains read/audit oriented; owning-domain write boundaries remain authoritative.

## 12. Settings IA inventory

The permanent multi-tab Settings information architecture is `REMOVE`.

This is not a decision to delete all settings capabilities. It is a decision to stop presenting a large administrative product inside the owner-facing Product.

### 12.1 Category-level disposition

| Current Settings category | Disposition | Capability decision |
| --- | --- | --- |
| Category Index | REMOVE | No replacement page. Slash registry is the index. |
| Preferences | SLASH | Retain real user preference writes behind focused commands. |
| Project Administration | SLASH | Retain create/rename/archive/restore/delete behind focused commands and safety confirmation. |
| Models | REMOVE | Current PostgreSQL backend reports the feature `UNAVAILABLE`; do not expose dead owner UI. |
| AI | SLASH | Retain provider/model/credential/configuration controls in focused flow. |
| Costs & Budgets | REMOVE | Current PostgreSQL backend reports the feature `UNAVAILABLE`. |
| Privacy & Sensitivity | SLASH + CONDITIONAL | Explicit configuration through slash; surface conditionally when a privacy decision blocks AI/action behavior. |
| Connectors | REMOVE | Current PostgreSQL backend reports the feature `UNAVAILABLE`. |
| Directives & Priority Settings | REMOVE | Current PostgreSQL backend reports this Settings feature `UNAVAILABLE`; Ask/Review directive proposal capability remains separately governed. |
| Schema Packs | REMOVE | Current PostgreSQL backend reports the feature `UNAVAILABLE`. |
| Diagnostics | REMOVE | Current PostgreSQL backend reports the feature `UNAVAILABLE`. |
| Advanced | REMOVE | Remove generic owner-facing page. Retain protected settings machinery for specific current/future commands. |

### 12.2 Unavailable feature rule

A feature that the canonical Product backend currently returns as unconditionally `UNAVAILABLE` is not represented by a dead red Settings page and does not receive a fake slash command merely to preserve parity with the removed page.

When such a capability becomes a real Product capability later, it must be introduced through a new explicit Human-Facing decision rather than silently resurrecting the old Settings IA.

## 13. Preferences disposition

The current preference backend supports real principal preference writes, so the capability is retained through slash commands.

Frozen command family:

```text
/language
/timezone
/date format
/density
/reduce motion
```

A compact `/preferences` hub may be used as an alias if needed, but it must not recreate the removed Settings tab grid.

Preference persistence, revision checks, Project binding, and server confirmation remain unchanged.

## 14. Project Administration disposition

Project Administration capabilities are real and remain protected.

Frozen command family:

```text
/project switch
/project create
/project rename
/project archive
/project restore
/project delete
```

Rules:

- Active Project label stays visible globally.
- Switching is intentional through slash.
- First Project creation is conditional onboarding.
- Archive/delete are destructive and require risk-appropriate confirmation.
- Project deletion must never be introduced as a low-friction generic command.
- Raw Project UUID/revision is technical output, not normal owner copy.

## 15. AI disposition

AI configuration is real and remains available through an intentional configuration flow.

Frozen command entry:

```text
/ai
```

The flow may expose, as needed:

- provider selection;
- model selection from the registered provider catalog;
- write-only credential create/replace;
- connection test;
- save configuration;
- provider-scoped privacy review/approval;
- credential revoke/remove with confirmation.

The separate `Models` Settings page is not retained because the current Product backend reports model-profile/routing settings unavailable while the AI workspace already owns the real provider/model selection path.

Internal execution identity, catalog revision, credential revision, policy identity, and compatibility prose belong behind technical or advanced context, not the default owner form.

## 16. Privacy disposition

Privacy is a real server-backed control, not a dead Settings placeholder.

Frozen entry:

```text
/privacy
```

It is also `CONDITIONAL` when an Ask/AI/external-transfer action is blocked pending owner privacy review.

The owner surface must distinguish at least:

- Project-level privacy/external-transfer decision;
- provider-scoped privacy approval when relevant;
- deployment ceiling/effective eligibility.

These distinct authorities must not be flattened into one ambiguous “Approved” badge.

Restricted Project context remains blocked from external AI transfer according to the existing server authority.

## 17. Generic Advanced disposition

The `/settings/advanced` owner page is `REMOVE`.

Reason: a generic “policy overrides” page exposes implementation concepts and invites broad editing without a human task model. The underlying versioned settings draft/validate/preview/apply machinery is retained for specific commands that genuinely require it.

Future advanced settings must be introduced as named owner tasks, not by restoring a miscellaneous Advanced bucket.

## 18. Technical Details disposition

The common Technical Details pattern is removed from the default owner reading flow.

Frozen command:

```text
/technical
```

Semantic behavior:

```text
normal Product view
→ technical identifiers hidden

/technical
→ show technical.current for the current route/resource/context
```

Possible technical content includes IDs, revisions, projections, event identities, attempt identities, policy versions, and low-level failure codes.

Rules:

- Technical data is not deleted from contracts or the server merely because it is hidden from default UI.
- Long identifiers render horizontally with adequate width/monospace/copy affordance when technical mode is open.
- `technical.current` is context-bound; do not create a permanent diagnostics dashboard to replace the removed details blocks.

## 19. Empty, loading, status, and warning surfaces

### 19.1 Empty states

`KEEP` only when the absence itself helps the owner decide the next step.

Remove:

- duplicated empty states across two panes;
- oversized empty cards;
- internal wording such as “server reported no…”;
- red error styling for planned/unimplemented capabilities.

### 19.2 Loading states

`CONDITIONAL`, compact, and task-specific. Internal nouns such as projection, command boundary, or adapter are not shown unless technical inspection is active.

### 19.3 Warnings/errors

`CONDITIONAL` and actionable. A warning stays visible only while the relevant condition is current.

### 19.4 Success messages

Transient `CONDITIONAL` feedback. Persistent green status blocks are not used merely to restate already-visible state.

## 20. Button/control hierarchy

Human-facing controls are frozen into these visible roles:

- `Primary`: the single obvious next step for the current task.
- `Secondary`: useful but not dominant actions.
- `Conditional`: appears only when the state makes the action relevant.
- `Destructive`: isolated, risk-signaled, and confirmation-bound where required.
- `Slash-only`: not permanently rendered.

`Coming Soon`, unavailable-tier placeholders, and visually active controls for unavailable paths are not part of the final owner surface.

## 21. Frozen slash command registry

HFM-S0 freezes the command **intent registry**, not final parser syntax details. HFM-S1/S2 may normalize aliases, but must preserve the following owner tasks.

| Command intent | Primary disposition | Existing authority / target |
| --- | --- | --- |
| `/search` | SLASH | Existing global/server search capability; replacement must be verified before old modal removal. |
| `/project switch` | SLASH | Existing protected Project switch. |
| `/project create` | SLASH / first-run CONDITIONAL | Existing Project create/bootstrap API. |
| `/project rename` | SLASH | Existing Project update API. |
| `/project archive` | SLASH destructive | Existing Project lifecycle API. |
| `/project restore` | SLASH | Existing Project lifecycle API. |
| `/project delete` | SLASH destructive | Existing delete-request API and confirmation. |
| `/language` | SLASH | Existing principal preferences write. |
| `/timezone` | SLASH | Existing principal preferences write. |
| `/date format` | SLASH | Existing principal preferences write. |
| `/density` | SLASH | Existing principal preferences write. |
| `/reduce motion` | SLASH | Existing principal preferences write. |
| `/ai` | SLASH | Existing AI Settings protected APIs. |
| `/privacy` | SLASH / CONDITIONAL | Existing Settings privacy review + provider approval/deployment authorities. |
| `/knowledge` | SLASH | Existing Knowledge workspace/read/search/detail/compare/graph capabilities. |
| `/review` | SLASH / CONDITIONAL | Existing Review queue/decision/recovery APIs. |
| `/external action` | SLASH / CONDITIONAL | Existing External Action read/governed command paths. |
| `/activity` | SLASH | Existing Activity read and owning-domain delegated actions. |
| `/history` | SLASH | Existing History read, owning-domain links, eligible reversal initiation. |
| `/technical` | SLASH | Context-bound presentation of existing technical metadata. |
| `/export` | SLASH | Existing Ask export capability in answer context. |
| `/retry` | SLASH / CONDITIONAL | Existing owning-domain retry authority; context determines allowed mode. |
| `/propose intake` | SLASH | Existing Ask transition-seed capability. |
| `/propose change` | SLASH | Existing Ask transition-seed / Knowledge draft flow. |
| `/propose directive` | SLASH | Existing Ask directive proposal flow; Review remains authoritative. |

Slash execution is a presentation/orchestration layer only. It must not duplicate domain logic or invent a parallel write API.

## 22. Write-control authority mapping

HFM implementation must route writes through the existing protected boundaries.

| Human intent | Required existing protection |
| --- | --- |
| Switch Project | session/leave guard + protected Project switch + cache purge/revalidation |
| Create/update/lifecycle Project | active/target/resource Project binding + idempotency/client request identity + expected revision where defined |
| Save Preferences | active/target/resource Project binding + expected preference revision + server confirmation |
| AI credential/configuration | credential write-only handling + Project binding + revision + provider registry + vault authority |
| AI privacy approval | proposal/Owner approval + provider-scoped authority + deployment ceiling |
| Source intake | staged input + protected intake command + Project binding + exact duplicate decision + idempotency |
| Ask submission | protected Ask command + pinned context + provider/privacy eligibility + outcome lookup without duplicate resubmit |
| Ask answer commands | original command identity + capability-gated cancel/retry/export/transition + outcome recovery |
| Review decisions | Review context/target revisions/digest + idempotency + Owner decision authority + outcome recovery |
| External Action commands | manifest/risk/approval/preflight/execution/verification authority + idempotency + outcome recovery |
| Activity delegated actions | owning-domain command authority, never an independent Activity mutation authority |
| History reversal | eligible Canonical identity resolved by server + Review/draft path, never direct Canonical mutation |
| Settings-specific protected writes | existing settings draft validation/preview/apply machinery where the named command requires it |

## 23. REMOVE depth classification

`REMOVE` is frozen at one of three depths.

### 23.1 Presentation relocation only

Remove persistent chrome but retain full capability:

- Knowledge navigation;
- Review navigation;
- External Action navigation;
- Activity navigation;
- History navigation;
- Preferences tab;
- Project Administration tab;
- AI tab;
- Privacy tab;
- legacy Search button/modal after replacement;
- legacy Commands button/palette after replacement;
- default Technical Details blocks.

### 23.2 Current owner UI implementation removable

The existing page/component may be deleted from the current Product after migration because no current active owner capability depends on presenting that page:

- Settings Category Index;
- Models Settings page;
- Costs & Budgets Settings page;
- Connectors Settings page;
- Directives & Priority Settings page;
- Schema Packs Settings page;
- Diagnostics Settings page;
- generic Advanced Settings page.

Backend contracts or future architecture placeholders are not automatically deleted with these pages.

### 23.3 Never implied by HFM REMOVE

HFM does **not** authorize deletion or weakening of:

- Original Asset / Source / Evidence data;
- Candidate vs Canonical distinctions;
- Claim vs Fact distinctions;
- Canonical history;
- Compiled Truth derivation semantics;
- Project binding and access control;
- privacy/sensitivity classifications;
- Review authority;
- External Action governance;
- expected revisions;
- command idempotency and original request identity;
- outcome-unknown recovery;
- audit/history data;
- server route guards;
- future-compatible contracts merely because their current owner page is removed.

## 24. Known current functional defects and HFM dependency

HFM does not reinterpret an observed functional failure as a design decision.

### Global Search

Manual Product smoke testing observed that the existing Global Search modal accepted queries but produced no visible response for the tested terms. The component contains a real search mutation and result rendering path, so HFM treats Search as a capability to retain and replace, **not** as a feature to delete.

HFM-S implementation must verify the accepted `/search` path end-to-end before deleting the legacy search surface. The replacement needs explicit loading, results, no-results, and error states.

## 25. Language and product-copy baseline

- Korean is the default owner-facing Product language for the current target Product experience.
- Internal architecture vocabulary is not default UI copy.
- Terms such as `server-authoritative`, `command boundary`, `payload`, `UNAVAILABLE`, `projection revision`, `AnswerRun`, and raw policy identities are technical mode content unless no human equivalent can preserve safety.
- Human-facing labels describe task, consequence, and next action.
- Backend/error codes remain available through technical inspection where useful.

This does not change machine contracts or English source-code identifiers.

## 26. Safety exceptions to minimalism

Minimalism must yield when hiding information would make an owner action unsafe or misleading.

The following may surface conditionally even if not normally visible:

- active Project mismatch or Project-switch block;
- unsaved draft / blocking dialog / outcome-unknown state;
- provider/privacy eligibility block;
- stale/revision conflict requiring reload/review;
- Review action required;
- External Action approval/preflight/verification/recovery required;
- destructive Project lifecycle confirmation;
- offline/server-unavailable state;
- partial/stale Knowledge state when it changes truth interpretation;
- access restriction or sensitivity masking required by policy.

These exceptions are state-bound; they do not justify permanent administrative chrome.

## 27. Implementation impact boundary

HFM-S0 freezes the expected implementation impact without authorizing code edits yet.

Primary frontend areas expected to change downstream include:

```text
apps/shotgun-web/src/app/router.tsx
apps/shotgun-web/src/shell/application-shell.tsx
apps/shotgun-web/src/shell/top-bar.tsx
apps/shotgun-web/src/shell/primary-navigation.tsx
apps/shotgun-web/src/section3/global-tools.tsx
apps/shotgun-web/src/session/project-selector.tsx
apps/shotgun-web/src/routes/home-page.tsx
apps/shotgun-web/src/routes/sources-workspace.tsx
apps/shotgun-web/src/routes/source-detail-workspace.tsx
apps/shotgun-web/src/routes/ask-workspace.tsx
apps/shotgun-web/src/routes/knowledge-*.tsx
apps/shotgun-web/src/routes/review-workspace.tsx
apps/shotgun-web/src/routes/external-action-workspace.tsx
apps/shotgun-web/src/routes/activity-workspace.tsx
apps/shotgun-web/src/routes/history-workspace.tsx
apps/shotgun-web/src/routes/settings/*
apps/shotgun-web/src/components/technical-details.tsx
```

Likely supporting work:

- slash parser/registry and command launcher;
- context-bound command availability resolver;
- compact conditional attention cues;
- focused overlays/sheets/dialogs for retained settings capabilities;
- presentation label/copy normalization;
- route/deep-link compatibility while old persistent nav is removed;
- browser/contract tests updated to the frozen Human-Facing baseline.

Existing backend domain services should be reused rather than duplicated into a new HFM backend.

## 28. Frozen acceptance criteria for downstream sections

HFM-S1 and later implementation sections must satisfy all of the following before HFM can be considered complete:

1. Normal owner chrome contains only the frozen persistent Product surface.
2. Every retained non-persistent capability has an intentional slash or conditional path.
3. No write command bypasses its existing protected domain authority.
4. Review and External Action safety boundaries remain at least as strict as before HFM.
5. Search replacement works before legacy Search removal.
6. Project switching replacement works before persistent selector removal.
7. Retained Settings capabilities work through focused flows before the Settings IA is removed.
8. Unconditionally unavailable Settings pages are not represented as red owner-facing errors.
9. Technical metadata remains available when explicitly requested but is absent from default task flow.
10. Ask renders Question → Answer → Citations/Evidence → actionable state → secondary actions.
11. Empty states are compact and singular.
12. Korean-default product copy does not expose implementation architecture by default.
13. Deep links from citations/history/activity/review/external actions continue to resolve through existing route guards.
14. Existing expected-revision, idempotency, approval, Project binding, privacy, and outcome-recovery invariants remain test-covered.
15. Removed owner UI does not delete Canonical/audit/governance data or silently change domain semantics.

## 29. HFM-S0 completion record

Owner decision:

```text
ACCEPTED
```

Baseline authority:

```text
HFM-S0-INVENTORY-260814001
classification: ACCEPTED
status: BASELINE_FROZEN
subject_base: main@5c3cebc9d08ec50edec3fa7bd2f69568387c7a78
```

Section transition:

```text
HFM-S0: COMPLETE / BASELINE_FROZEN
HFM-S1: AUTHORIZED / NOT_STARTED
```

HFM-S1 may now begin only as a new explicitly initiated section. This document remains the frozen disposition baseline; later implementation details may refine mechanisms but may not silently move a surface between `KEEP`, `SLASH`, `REMOVE`, and `CONDITIONAL`.
