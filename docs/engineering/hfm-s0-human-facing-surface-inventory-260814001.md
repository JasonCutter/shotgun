---
id: HFM-S0-INVENTORY-260814001
classification: CANDIDATE
status: OWNER_REVIEW_REQUIRED
created_at: 2026-08-14
subject_base: 5c3cebc9d08ec50edec3fa7bd2f69568387c7a78
repository: JasonCutter/shotgun
canonical_branch: main
governing_adr: ADR-145
implementation_plan: docs/implementation/human-facing-minimalism-slash-command-product-implementation-plan-260814001.md
section: HFM-S0
---

# HFM-S0 — Human-Facing Surface Inventory and Baseline Freeze Candidate

## 0. Status and authority

This document is the HFM-S0 owner-review candidate for the complete owner-facing surface disposition required by ADR-145 and `HFM-SLASH-PLAN-260814001`.

It is **not yet an accepted baseline**. Until the owner accepts this inventory:

```text
HFM-S0: IN_PROGRESS / OWNER_REVIEW_REQUIRED
HFM-S1: NOT_AUTHORIZED
Product implementation under HFM-S1..S8: NOT_STARTED
```

No Product code change is authorized by this candidate alone.

## 1. Baseline inspected

The inventory is based on the canonical Product at:

```text
main@5c3cebc9d08ec50edec3fa7bd2f69568387c7a78
```

The audit covered the current production composition and owner-facing frontend route tree, including:

- `assemblies/shotgun-app/src/application.ts`
- `adapters/frontend-product-read-in-memory/src/index.ts`
- `adapters/postgres/src/index.ts`
- `apps/shotgun-web/src/app/router.tsx`
- `apps/shotgun-web/src/shell/*`
- `apps/shotgun-web/src/session/project-selector.tsx`
- `apps/shotgun-web/src/section3/global-tools.tsx`
- Home, Sources, Source Detail, Ask, Knowledge, Review, External Action, Activity, History routes
- all current Settings routes
- shared `TechnicalDetails` presentation

The audit also preserves the 2026-08-14 owner smoke-test findings already incorporated into ADR-145 and the frozen HFM implementation plan. The retired Google Drive `UI개선사항` note is not used as implementation authority.

## 2. Classification semantics

The final HFM-S0 classification uses exactly four owner-facing dispositions.

| Disposition | Meaning |
|---|---|
| `KEEP` | Frequent, task-primary, or directly useful to current human judgment. It remains visible in the relevant normal workflow. |
| `SLASH` | Legitimate but infrequent control, inspection, or advanced workflow. It is removed from persistent UI and remains discoverable through `/` or a focused UI opened from `/`. |
| `REMOVE` | Internal-only, redundant, misleading, non-actionable, duplicated, or not useful enough to justify owner-facing Product surface. No replacement is required unless another row explicitly preserves the underlying capability. |
| `CONDITIONAL` | Hidden when irrelevant but automatically surfaced when a runtime state requires owner attention, confirmation, recovery, or safety judgment. |

A route may be `SLASH` while controls inside the route are `KEEP` once that focused route has been intentionally opened. A backend contract may remain intact even when its current owner-facing placeholder route is `REMOVE`.

## 3. Frozen minimal persistent Product surface candidate

If this HFM-S0 candidate is accepted, the persistent owner-facing Product surface is frozen to:

```text
Top context
- Shotgun product identity
- compact current Project identity
- conditional global warning/attention state

Persistent navigation
- Home
- Sources
- Ask
```

No other subsystem is entitled to permanent navigation merely because a route or backend contract exists.

The compact Project identity is `KEEP` because acting in the wrong Project has authority and data-placement consequences. The **Project switch control itself is `SLASH`** and is not a permanent dropdown.

First-Project creation is a `CONDITIONAL` onboarding exception because slash discovery through Ask cannot be relied upon before a Project exists.

## 4. Global shell and navigation inventory

| Surface / control | Disposition | Replacement / rule | Removal boundary |
|---|---|---|---|
| Product name `Shotgun` | KEEP | Compact brand identity | Presentation retained |
| Current Project name | KEEP | Compact non-duplicated context | Presentation retained, duplicate copies removed |
| Persistent Project selector dropdown | SLASH | `project.switch` | Remove persistent dropdown; retain protected switch API and leave guards |
| First Project onboarding link | CONDITIONAL | First-run focused creation | Visible only when no Project exists |
| Home navigation | KEEP | `/` | Persistent |
| Sources navigation | KEEP | `/sources` | Persistent |
| Ask navigation | KEEP | `/ask` | Persistent |
| Knowledge navigation item | REMOVE from persistent nav | `knowledge.open` | Capability retained; persistent nav entry removed |
| Review navigation item | REMOVE from persistent nav | `review.open` + automatic attention | Capability retained; persistent nav entry removed |
| External Actions navigation item | REMOVE from persistent nav | `external_action.open` + automatic attention | Capability retained; persistent nav entry removed |
| Activity navigation item | REMOVE from persistent nav | `activity.open` | Capability retained; persistent nav entry removed |
| History navigation item | REMOVE from persistent nav | `history.open` | Capability retained; persistent nav entry removed |
| Settings navigation item | REMOVE | Decomposed commands below | Settings mega-surface removed from normal navigation |
| `COMING_LATER` / disabled route cards in nav | REMOVE | None | Do not advertise roadmap or implementation state |
| Mobile `More` duplicate subsystem list | REMOVE | Same compact KEEP set | Remove duplicate catalog behavior |
| Global top-bar Search button | REMOVE | `search.global` | Remove only after slash search replacement passes HFM-S5 verification |
| Current top-bar `Commands` button | REMOVE as a separate command model | Same HFM slash registry only | Legacy navigation palette removed/replaced; no second registry |
| `Ctrl/Cmd+K` legacy palette behavior | REMOVE as independent palette | May become alternate trigger to the same slash registry only if HFM-S1 proves value | No separate navigation/project-switch implementation |
| Offline banner | CONDITIONAL | Automatic | Must remain proactively visible while offline |
| Global leading warning | CONDITIONAL | Automatic | Must remain proactively visible while actionable |
| Loading / route error boundary | CONDITIONAL | Automatic | Retain accessible recovery behavior |
| Skip link / route focus accessibility | KEEP | Infrastructure | Retain |

### 4.1 Production-shell correction note

The normal Product composition currently wires `InMemoryGlobalShellProjection`, `InMemoryActionCenterProjection`, `InMemoryBackgroundSummaryProjection`, `InMemoryNotificationSummaryProjection`, `InMemoryGlobalSearch`, and `InMemoryRouteGuardProjection` into the production frontend read coordinator.

The current shell projection still emits Knowledge and Review as `COMING_LATER`, even though substantial Product implementations exist. HFM-S0 therefore classifies **shell discoverability separately from capability existence**. HFM-S3 must change the shell projection so persistent navigation represents the frozen HFM surface rather than historical phase-state navigation.

## 5. Home inventory

| Surface / control | Disposition | Final intent |
|---|---|---|
| Home route | KEEP | Owner action center |
| First-run `Create your first Project` | CONDITIONAL | Show only when no Project exists |
| Ordinary Project State card | REMOVE | Project identity already exists in compact global context |
| Project lifecycle problem requiring action | CONDITIONAL | Surface only if archived/deletion/recovery/other state changes current action |
| Primary action: add/use Sources | KEEP | High-frequency task |
| Primary action: Ask | KEEP | High-frequency task |
| Disabled future/roadmap primary actions | REMOVE | No development-roadmap UI |
| Attention Queue when items exist | CONDITIONAL | Primary owner attention projection |
| Empty `No attention needed` card | REMOVE | Collapse entirely when empty |
| Continue Working entries | KEEP when non-empty | Resume useful work |
| Empty Continue Working server/browser subsections | REMOVE | No empty-card tax |
| Recent resources | KEEP when non-empty | Useful continuation |
| Pinned resources | KEEP when non-empty | Useful continuation |
| Empty Recent/Pinned placeholders | REMOVE | Collapse |
| Operational Summary counts | REMOVE | Raw operational telemetry is not normal owner UI |
| Failed background work requiring intervention | CONDITIONAL | Convert to actionable owner attention rather than telemetry count |
| Active background work | CONDITIONAL only when it affects current user action | Otherwise hidden |
| Unread notification count | CONDITIONAL only when a real owner notification exists | No inert metric |
| Stale snapshot warning | CONDITIONAL | Preserve when it changes actionability |
| Loading/error state | CONDITIONAL | Preserve accessible recovery |

## 6. Sources inventory

### 6.1 Sources workspace

| Surface / control | Disposition | Final intent |
|---|---|---|
| Sources route | KEEP | Primary knowledge-intake workflow |
| Duplicate Project label inside page | REMOVE | Use compact global Project context |
| Draft Queue | KEEP | Owner staging area before submit |
| Input type Direct Text / File / URL | KEEP | Core intake choice |
| Source label | KEEP | Human resource identity |
| Source classification request | KEEP | Real owner security classification request, server validated |
| Direct Text / File / URL payload input | KEEP | Core intake |
| Add intake draft | KEEP | Core intake |
| Draft list | KEEP when non-empty | Review staged inputs before submit |
| Submit drafts | KEEP | Core write |
| Discard drafts | KEEP/contextual | Core draft management |
| Internal `immutable bytes`, `Command Ledger`, `server-authoritative command` prose | REMOVE | Replace with concise owner-language progress only |
| Staging/submitting progress | CONDITIONAL | Show simple progress while active |
| Project mismatch warning | CONDITIONAL | Safety boundary |
| Invalid seed warning | CONDITIONAL | Safety/recovery |
| Offline/stale state | CONDITIONAL | Safety/actionability |
| Intake failure | CONDITIONAL | Recovery |
| Cancel active submission | CONDITIONAL | Only when cancellation is valid |
| Retry failed item | CONDITIONAL | Only when retry is valid |
| Exact duplicate decision | CONDITIONAL | Show only for an actual duplicate decision |
| Raw submission/item/decision IDs | SLASH | `technical.current` | 

### 6.2 Source Library

| Surface / control | Disposition | Final intent |
|---|---|---|
| Source Library | KEEP | Primary owner resource list |
| Source-local search | KEEP | Workflow-local search remains separate from global `/search` |
| Source label | KEEP | Primary identity |
| Media type | KEEP as compact secondary metadata | Useful for understanding source material |
| Source classification | KEEP as compact secondary metadata | Security-relevant |
| Raw lifecycle / preview / Ask-usage enums | REMOVE from default | Do not display implementation-state vocabulary |
| Action-affecting readiness, e.g. unusable for Ask | CONDITIONAL | Show only if it changes what owner can do |
| Long Ask-usage explanation on every row | REMOVE | Replace with concise conditional state only |
| Open Source | KEEP | Primary drill-down |
| `Open pinned Version` implementation wording | REMOVE wording | Replace with owner-facing `Open` / version context in detail |
| No Sources / no matches | KEEP as compact empty state | Must not become oversized placeholder |

## 7. Source Detail inventory

| Surface / control | Disposition | Final intent |
|---|---|---|
| Source Detail route | KEEP | Normal drill-down from Sources and citations |
| Source label | KEEP | Primary identity |
| Back to Source Library | KEEP | Workflow navigation |
| Return to cited Ask/Knowledge resource | KEEP/contextual | Preserve citation navigation |
| Human version number | KEEP | Useful provenance/history |
| Version history selector | KEEP | Owner can inspect prior versions |
| Original Preview | KEEP | Primary source inspection |
| Evidence text | KEEP | Trust/judgment surface |
| Evidence origin/provenance | KEEP | Useful to judge evidence |
| Preview/Ask readiness ordinary status | REMOVE from default | Hide when normal |
| Preview/Ask readiness problem | CONDITIONAL | Show if it blocks a task |
| Source ID | SLASH | `technical.current` |
| SourceVersion ID | SLASH | `technical.current` |
| Evidence ID | SLASH | `technical.current` |
| Evidence revision | SLASH | `technical.current` |
| Repeated candidate/claim text identical to Evidence text | REMOVE duplicate rendering | One human-readable text occurrence; provenance remains accessible |
| `Technical details` disclosure | SLASH | Replace default `<details>` with command/context diagnostic surface |

## 8. Ask inventory

### 8.1 Draft and context

| Surface / control | Disposition | Final intent |
|---|---|---|
| Ask route | KEEP | Primary owner workflow and slash entry |
| Duplicate Project label inside Ask | REMOVE | Use compact global context |
| Question input | KEEP | Primary action; `/` trigger integrated here |
| Submit question | KEEP | Primary action |
| Ask mode | KEEP/contextual | Directly changes answer semantics; show only where multiple modes are relevant |
| Source selection in source-aware mode | KEEP/contextual | Directly controls answer context |
| Source labels | KEEP | Human choice |
| Raw Source / SourceVersion IDs in selection | SLASH | `technical.current` |
| Draft explanation about protected command boundary / Canonical / original Evidence | REMOVE | Internal architecture prose |
| Provider eligibility block | CONDITIONAL | Must surface if Ask cannot proceed |
| Privacy/provider action required | CONDITIONAL | Must give direct focused recovery path |
| Submission-outcome unknown recovery | CONDITIONAL | Preserve original request identity; no duplicate submit |
| General disabled/internal submission-state prose | REMOVE | Replace with concise actionable owner state |

### 8.2 Conversation and answer

| Surface / control | Disposition | Final intent |
|---|---|---|
| Conversation list | KEEP, compact | Continue prior questions |
| Conversation title | KEEP | Human identity |
| Turn count | REMOVE | Low-value metadata |
| Normal latest run state | REMOVE | Do not display telemetry when healthy |
| Active/failed latest run state | CONDITIONAL | Show only while actionable or in progress |
| User question | KEEP | First element of each turn |
| Final answer text | KEEP | Immediately after question |
| Citations / evidence links | KEEP | Immediately after answer |
| Partial answer while generating | CONDITIONAL | Show only during generation |
| Failure message | CONDITIONAL | Show actionable failure |
| Failure code | SLASH | `technical.current` |
| `AnswerRun` implementation term | REMOVE | Use owner-language `answer` / `attempt` only where necessary |
| Cancel answer | CONDITIONAL | Only while cancellable |
| Retry after failure | CONDITIONAL | Show when recovery is the likely next action |
| Retry in non-failure/advanced cases | SLASH | `action.retry` |
| Export answer | SLASH | `answer.export` |
| Helpful / Not helpful buttons | REMOVE | No demonstrated owner-critical value in the single-owner Product surface; backend contract may remain |
| Propose Intake Draft | SLASH | `answer.propose_intake` |
| Propose Draft ChangeSet | SLASH | `answer.propose_change` |
| Propose Directive transition | SLASH | `answer.propose_directive`; this preserves the implemented transition-seed path and is distinct from the unavailable Directives Settings page |
| Check existing Answer command outcome | CONDITIONAL | Recovery only |
| Export result panel | CONDITIONAL | Show after explicit export action |
| Persistent action row before answer | REMOVE | HFM-S5 must reorder |

### 8.3 Frozen Ask hierarchy

The accepted target order is:

```text
Question
→ Answer
→ Citations / Evidence
→ actionable status / warning if any
→ secondary actions
```

Secondary controls must never visually precede the answer they operate on.

## 9. Knowledge inventory

### 9.1 Capability finding

Knowledge must **not** be treated as unimplemented merely because the current shell labels it `COMING_LATER`.

The canonical Product contains implemented Knowledge routes and a production `PostgresKnowledgeWorkspaceProjection`, including list/search/detail/compare/graph and bounded correction/draft functionality.

### 9.2 Disposition

| Surface / control | Disposition | Final intent |
|---|---|---|
| Persistent Knowledge nav entry | REMOVE | Minimal persistent navigation |
| Knowledge capability entry | SLASH | `knowledge.open` |
| Knowledge search/filter within intentionally opened workspace | KEEP inside focused workspace | Core knowledge inspection |
| Knowledge Pages | KEEP inside focused workspace | Human-readable derived/canonical knowledge view |
| Knowledge Detail | KEEP inside focused workspace | Drill-down |
| Compare | KEEP/contextual inside focused workspace | On-demand comparison |
| Graph | KEEP/contextual inside focused workspace | On-demand relationship inspection |
| Knowledge correction proposal/editor | SLASH/contextual | `knowledge.correct` or focused correction from selected item |
| Projection/readiness ordinary metadata | REMOVE | Internal projection state |
| Partial/stale projection that changes trust/action | CONDITIONAL | Surface only when materially relevant |
| Raw stable IDs / snapshot IDs / projection revisions | SLASH | `technical.current` |
| Internal read-only/server-authoritative explanatory prose | REMOVE | Replace with human-language purpose only |

Underlying Knowledge Product code is **retained**. HFM removes permanent navigation cost, not implemented capability.

## 10. Review inventory

### 10.1 Capability finding

Review is also materially implemented despite the current shell `COMING_LATER` presentation. The Product contains a guarded Review workspace, queue/detail reads, decision recording, comments, dependency-aware aggregate state, approvals, and outcome-unknown recovery.

### 10.2 Disposition

| Surface / control | Disposition | Final intent |
|---|---|---|
| Persistent Review nav entry | REMOVE | No permanent empty destination |
| Pending review requiring owner decision | CONDITIONAL | Automatically surface in Home/attention context |
| Manual Review queue access | SLASH | `review.open` |
| Empty Review workspace destination | REMOVE from normal UI | No empty queue page in persistent navigation |
| Queue filters/list | KEEP once Review is opened | Required to inspect multiple pending items |
| Review item detail/evidence/impact | KEEP once Review is opened | Decision-critical |
| Approve / Reject / Request revision / Hold | KEEP in active Review context | Decision-critical write controls |
| Review comment | KEEP in active Review context | Decision support |
| Review decision/history summary | KEEP in focused Review context | Audit context |
| Outcome-unknown recovery | CONDITIONAL | Preserve original command identity |
| Raw context/item/decision IDs, revisions, digests | SLASH | `technical.current` |

Review decisions remain routed through the existing protected Review command boundary. HFM does not alter Canonical approval authority.

## 11. External Action inventory

### 11.1 Capability finding

External Action is a real guarded governance workspace with queue/detail, manifest/risk/preflight/execution/attempt/verification/result/audit/approval reads and governed Cancel/Rollback/Compensation/Verify/recovery paths.

### 11.2 Disposition

| Surface / control | Disposition | Final intent |
|---|---|---|
| Persistent External Actions nav entry | REMOVE | No permanent empty destination |
| Action waiting for approval/verification/owner intervention | CONDITIONAL | Proactively surface |
| Manual External Action inspection | SLASH | `external_action.open` |
| Queue/detail once opened | KEEP inside focused workspace | Required for governed action judgment |
| Risk/manifest/preflight information that changes decision | KEEP in active action context | Safety-critical |
| Approval requirement | CONDITIONAL | Never hidden behind slash |
| Cancel | CONDITIONAL/contextual | Only when current action is cancellable |
| Rollback | CONDITIONAL/contextual | Only when available and consequence is clear |
| Prepare compensation | CONDITIONAL/contextual | Only when required/available |
| Verify | CONDITIONAL/contextual | Only when verification is required/available |
| Outcome-unknown recovery | CONDITIONAL | Never re-execute blindly |
| Raw action/execution/attempt/verification IDs and internal revision topology | SLASH | `technical.current` |
| Empty `no external actions` destination | REMOVE from normal UI | Collapse; no permanent navigation |

Existing external-action safety, approval, idempotency, and protected command boundaries remain unchanged.

## 12. Activity inventory

| Surface / control | Disposition | Final intent |
|---|---|---|
| Persistent Activity nav entry | REMOVE | Operational inspection is not a normal owner task |
| Activity workspace | SLASH | `activity.open` |
| Queue/filter/list while explicitly opened | KEEP inside focused workspace | Useful operational inspection |
| High-level state / attention / related resource | KEEP inside focused workspace | Human-readable operational context |
| Failed work requiring action | CONDITIONAL | Surface proactively without requiring Activity discovery |
| Retry/Cancel delegated to owning domain | CONDITIONAL/contextual | Show only when server says action is valid |
| Projection freshness/adaptor/snapshot telemetry | SLASH technical | `technical.current` |
| Job/Run/Attempt/Stage/Event raw topology | SLASH technical | Not normal owner UI |
| Raw Activity/Run/Job IDs | SLASH technical | Not normal owner UI |
| Empty Activity destination | REMOVE from normal UI | No persistent empty route |

Activity remains an inspection capability; it is not deleted.

## 13. History inventory

| Surface / control | Disposition | Final intent |
|---|---|---|
| Persistent History nav entry | REMOVE | Audit is infrequent |
| History workspace | SLASH | `history.open` |
| Domain filters/list while opened | KEEP inside focused workspace | Audit navigation |
| Human event label/time/domain | KEEP inside focused workspace | Audit understanding |
| Payload availability summary | KEEP when auditing | Explains missing/redacted evidence |
| Raw payload JSON/tombstone payload | SLASH technical | `technical.current` |
| Raw source event/resource IDs | SLASH technical | `technical.current` |
| External Action / Review lineage links | KEEP/contextual | Audit follow-through |
| Reversal draft creation from eligible Canonical history item | KEEP/contextual inside explicitly opened History | It creates a draft, not direct Canonical reversal; existing Review boundary takes over |
| Empty History destination | REMOVE from normal UI | No persistent empty route |

## 14. Settings decomposition inventory

The permanent Settings landing page and category catalog are removed as owner information architecture. Real owner controls are preserved as focused slash/conditional flows; placeholder categories with no current backend capability are removed instead of receiving fake commands.

### 14.1 Settings shell

| Surface / control | Disposition | Final intent |
|---|---|---|
| Persistent Settings nav | REMOVE | Decomposed focused commands |
| Settings landing / Category Index | REMOVE | No settings catalog |
| `Policy Control Plane` wording | REMOVE | Internal architecture term |
| `Settings & Project Administration` mega-header | REMOVE | No mega-surface |
| Current/Target/Resource Project badges | REMOVE | Internal authority projection; use one compact current Project identity and contextual warning only when scopes differ materially |
| Settings-local Project selector | REMOVE | Project switch is `project.switch` |
| Settings category tabs | REMOVE | Commands replace real capabilities |
| Generic Settings confirmation dialog primitive | CONDITIONAL | Reuse/refactor for destructive command confirmation |
| Category counts/warnings index | REMOVE | Action-required items feed conditional attention instead |

### 14.2 Preferences

| Surface / control | Disposition | Command |
|---|---|---|
| Preferences page | SLASH | Focused preferences UI |
| Locale | SLASH | `preferences.locale` |
| Timezone | SLASH | `preferences.timezone` |
| Date/time format | SLASH | `preferences.display` |
| Screen density | SLASH | `preferences.display` |
| Reduce motion | SLASH | `preferences.display` |

Writes continue through `apiClient.updatePrincipalPreferences` with existing active/target/resource Project binding, expected revision, request identity, and idempotency.

### 14.3 Project Administration

| Surface / control | Disposition | Command / condition |
|---|---|---|
| Project Admin page | SLASH | `project.manage` / focused project picker |
| Project list for management | SLASH | Open only on demand |
| Create first Project | CONDITIONAL | First-run onboarding |
| Create additional Project | SLASH | `project.create` |
| Switch Project | SLASH | `project.switch` |
| Rename Project | SLASH | `project.rename` |
| Archive Project | SLASH + destructive confirmation | `project.archive` |
| Restore Project | SLASH | `project.restore` |
| Request deletion | SLASH + destructive confirmation | `project.delete_request` |
| `Status: Active` + `Active: Yes` duplicate semantics | REMOVE duplicate | One lifecycle state when useful |
| Project ID / revision | SLASH technical | `technical.current` |
| `Details / Policy` misleading label | REMOVE wording | Focused management action only |

All writes remain on existing Project Administration APIs and expected-revision/idempotency contracts.

### 14.4 Models

| Surface / control | Disposition | Reason |
|---|---|---|
| Separate Models page | REMOVE | Duplicates AI configuration concept and current PostgreSQL `getModelDescriptors()` returns `UNAVAILABLE` unconditionally |
| Model Profiles/Routing placeholder | REMOVE | No slash command for unsupported Product capability |

Underlying contracts may remain for future architecture. No current owner-facing route or command advertises this capability.

### 14.5 AI

| Surface / control | Disposition | Command / condition |
|---|---|---|
| Permanent AI Settings page | SLASH | `ai.configure` |
| Provider choice | SLASH | Inside focused AI config |
| Model choice | SLASH | Inside focused AI config; no separate Models page |
| API credential create/replace | SLASH | Inside focused AI config |
| Test Connection | SLASH/contextual | `ai.test_connection` or same focused panel |
| Save AI configuration | SLASH | Existing protected config save |
| Revoke/remove credential | SLASH + destructive confirmation | Inside focused AI config |
| Credential/provider failure blocking Ask | CONDITIONAL | Proactively surface with direct recovery |
| Provider privacy review/approval blocking requested work | CONDITIONAL | Proactively surface |
| Provider privacy management when not blocking | SLASH | Inside focused AI/privacy flow |
| Provider/model display names | KEEP inside focused AI config | Human choice |
| Server catalog revision / capability revision | REMOVE default | Technical only |
| Credential/config revisions | REMOVE default | Technical only |
| Runtime pinning / AnswerRun identity exposition | REMOVE default | Internal execution mechanics |
| `Canonical Product workspace` / policy-command prose | REMOVE | Internal architecture wording |

### 14.6 Costs & Budgets

| Surface / control | Disposition | Reason |
|---|---|---|
| Costs & Budgets page | REMOVE | Current PostgreSQL `getCostBudget()` returns `UNAVAILABLE` unconditionally; no real tier activation path |
| `not available in this tier` message | REMOVE | Misrepresents current implementation state |
| Future real budget threshold requiring decision | CONDITIONAL, future only | May surface when a real backend capability exists; not a current slash command |

### 14.7 Privacy & Sensitivity

| Surface / control | Disposition | Command / condition |
|---|---|---|
| Permanent Privacy page | SLASH | `privacy.open` |
| Request external AI transfer review | SLASH or direct conditional recovery | `privacy.review` |
| Pending approval blocking work | CONDITIONAL | Proactive attention |
| Privacy/permission conflict | CONDITIONAL | Never hidden |
| Sensitivity when it changes allowed action | CONDITIONAL | Human decision support |
| Retention/privacy summary on explicit inspection | KEEP inside focused privacy view | Useful policy understanding |
| Approval/revision internals | REMOVE default | Technical only |
| Project-level vs provider-specific approval | KEEP as distinct human concepts when relevant | Must not be presented as one ambiguous approval |

The Privacy backend is real: `getPrivacyRetention()` derives current settings and pending proposal state, and review writes continue through the existing settings command boundary.

### 14.8 Connectors

| Surface / control | Disposition | Reason |
|---|---|---|
| Connectors page | REMOVE | Current PostgreSQL `getConnectorSettings()` returns `UNAVAILABLE` unconditionally |
| `not available in this tier` message | REMOVE | No real entitlement/tier path |
| Connector placeholder cards | REMOVE | No fake slash command |

If a future connector becomes a real owner capability, it receives a new HFM classification at that time rather than being pre-advertised now.

### 14.9 Directives & Priority

| Surface / control | Disposition | Reason |
|---|---|---|
| Directives Settings page | REMOVE | Current PostgreSQL `getDirectiveProposals()` returns `UNAVAILABLE` unconditionally |
| `not available in this tier` message | REMOVE | Misleading placeholder |
| Ask `Propose Directive` transition | SLASH | Separate implemented transition-seed capability; not evidence that the Settings page is available |

### 14.10 Schema Packs

| Surface / control | Disposition | Reason |
|---|---|---|
| Schema Packs page | REMOVE | Current PostgreSQL `getSchemaPacks()` returns `UNAVAILABLE` unconditionally |
| `not available in this tier` message | REMOVE | Misleading placeholder |
| Future schema architecture contracts | KEEP internally | Not owner Product UI until actionable |

### 14.11 Diagnostics

| Surface / control | Disposition | Reason |
|---|---|---|
| Diagnostics page | REMOVE for current Product | Current PostgreSQL `getDiagnostics()` returns `UNAVAILABLE` unconditionally |
| `System Diagnostics & Real-Fact Telemetry` owner destination | REMOVE | No current Product value; development/operations concept |
| `diagnostics.open` slash command | REMOVE from initial HFM registry | Do not create a command for an unavailable backend |

A later real diagnostic capability may be reintroduced as `SLASH`, but HFM-S0 does not reserve visible Product space for it now.

### 14.12 Advanced

| Surface / control | Disposition | Reason |
|---|---|---|
| Generic Advanced page | REMOVE | Generic internal policy console conflicts with HFM focused-command model |
| `Technical details` project/settings/policy revisions | SLASH technical | Not normal owner UI |
| Validate/Preview/Apply generic policy setting | REMOVE as generic owner surface | Underlying protected settings machinery remains; a specific user-needed setting must receive a specific future command |
| Outcome-unknown recovery for a real settings command | CONDITIONAL | Preserve recovery if/when invoked by a focused command |

No generic `/advanced` command is created.

## 15. Shared technical-information rule

The current `TechnicalDetails` component is a generic `<details>` disclosure embedded across multiple normal owner routes. Under the frozen HFM candidate:

```text
Default owner surface: no raw technical disclosure
Explicit /technical request: temporary context-bound technical drawer/view
```

The following are removed from normal default rendering unless a separate row explicitly keeps a human-readable abstraction:

- UUIDs and stable internal IDs;
- revisions and projection revisions;
- locators and resource paths;
- command/request/idempotency identities;
- raw enum values;
- Job/Run/Attempt/Stage/Event topology;
- provider/configuration revision mechanics;
- policy-context revisions;
- raw audit payload JSON.

The data itself is not deleted. It remains available to logs, APIs, persistence, tests, and bounded technical inspection where required.

## 16. Initial slash-command registry frozen by HFM-S0

The command catalog below is the required discoverability replacement for every accepted `SLASH` capability. HFM-S1 may refine labels/aliases/presentation primitives, but it may not silently remove access to these accepted intents.

| Stable command intent | Example owner label | Risk | Existing capability basis |
|---|---|---:|---|
| `help.commands` | 명령어 보기 | READ | HFM command registry |
| `search.global` | 전체 검색 | READ | existing `searchGlobal` read path; final UI repaired in HFM-S5 |
| `project.switch` | 프로젝트 전환 | WRITE-context | `switchActiveProject` |
| `project.manage` | 프로젝트 관리 | READ | existing project list/details |
| `project.create` | 프로젝트 만들기 | WRITE | `createProject`; first-project case remains conditional onboarding |
| `project.rename` | 프로젝트 이름 변경 | WRITE | `updateProject` |
| `project.archive` | 프로젝트 보관 | DESTRUCTIVE-LIKE | `archiveProject` + confirmation |
| `project.restore` | 프로젝트 복원 | WRITE | `restoreProject` |
| `project.delete_request` | 프로젝트 삭제 요청 | DESTRUCTIVE | `requestDeleteProject` + confirmation |
| `preferences.locale` | 언어 변경 | WRITE | `updatePrincipalPreferences` |
| `preferences.timezone` | 시간대 변경 | WRITE | `updatePrincipalPreferences` |
| `preferences.display` | 화면 표시 설정 | WRITE | `updatePrincipalPreferences` |
| `ai.configure` | AI 설정 | WRITE | provider/model/credential/config APIs |
| `ai.test_connection` | AI 연결 확인 | READ/ACTION | existing connection test API |
| `privacy.open` | 개인정보 및 외부 전송 설정 | READ | `getPrivacyRetention` |
| `privacy.review` | 외부 AI 전송 검토 | WRITE/APPROVAL | existing Settings review command path |
| `knowledge.open` | 지식 보기 | READ | production Knowledge projection/routes |
| `knowledge.correct` | 지식 수정 제안 | WRITE-DRAFT | existing Knowledge draft/correction path |
| `review.open` | 검토 열기 | READ/WRITE | existing Review queue/decision workspace |
| `external_action.open` | 외부 작업 보기 | READ/WRITE | existing governed External Action workspace |
| `activity.open` | 실행 상태 보기 | READ | existing Activity workspace |
| `history.open` | 변경 이력 보기 | READ | existing History workspace |
| `technical.current` | 기술 정보 보기 | READ | context-bound replacement for default `TechnicalDetails` |
| `answer.export` | 답변 내보내기 | WRITE/FILE | existing Ask export API |
| `action.retry` | 다시 시도 | WRITE | existing owning-domain retry paths; only available when valid |
| `answer.propose_intake` | 답변에서 자료 초안 만들기 | WRITE-DRAFT | existing Ask transition seed |
| `answer.propose_change` | 답변에서 변경 제안 만들기 | WRITE-DRAFT | existing Ask transition seed |
| `answer.propose_directive` | 답변에서 지시 제안 만들기 | WRITE-DRAFT | existing Ask transition seed |

Explicitly **not** in the initial registry because the current PostgreSQL Product backend is unavailable:

```text
models.*
costs.*
connectors.*
directives.settings.*
schema.*
diagnostics.*
advanced.*
```

A command name is not a promise of future capability. Unsupported placeholders remain hidden.

## 17. Moved write controls → existing authority boundary

HFM changes presentation and discovery, not mutation authority.

| Owner intent | Existing protected path that remains authoritative |
|---|---|
| Switch Project | `apiClient.switchActiveProject` + existing leave guards/cache purge/session boundary |
| Create first Project | `apiClient.createFirstProject` |
| Create Project | `apiClient.createProject` |
| Rename Project | `apiClient.updateProject` with expected revision/request identity/idempotency |
| Archive Project | `apiClient.archiveProject` with expected revision/request identity/idempotency |
| Restore Project | `apiClient.restoreProject` with expected revision/request identity/idempotency |
| Request Project deletion | `apiClient.requestDeleteProject` with expected revision/request identity/idempotency |
| Update locale/timezone/display | `apiClient.updatePrincipalPreferences` |
| AI credential create/replace | `createAICredential` / `replaceAICredential` + existing outcome recovery |
| AI credential revoke/remove | `revokeAICredential` / `removeAICredential` + explicit confirmation |
| Save AI provider/model configuration | `saveAIConfiguration` |
| Test AI connection | `testAIConnection` |
| Provider privacy proposal/approval | existing AI provider privacy proposal/approval APIs |
| Project external-transfer review | existing `applySettingsCommand` review-required / approval flow |
| Source intake | existing Sources staging + submit protected write client |
| Source duplicate resolution | existing exact-duplicate decision and `resolveDuplicate` |
| Source cancel/retry | existing Sources cancel/retry commands |
| Ask submit | existing Ask protected submit + client-request outcome resolution |
| Ask cancel/retry/export/transition | existing Answer command APIs + outcome recovery |
| Review decision | existing `recordReviewDecisions` + command outcome resolution |
| External Action cancel/rollback/compensation/verify | existing governed External Action command APIs + semantic digest/outcome recovery |
| Activity retry/cancel | delegated existing owning-domain command APIs; Activity does not become mutation authority |
| History reversal | existing `createReversalDraftChangeSet`; Review remains the approval/authoring boundary |
| Knowledge correction | existing frontend Knowledge draft/correction boundary; no direct Canonical write |

No HFM command executor may write directly to persistence where one of these boundaries exists.

## 18. Safety exceptions frozen by HFM-S0

The following are `CONDITIONAL` and must surface without requiring the owner to remember or type a slash command:

1. approval required before a Canonical-affecting transition;
2. pending Review decision that blocks requested work;
3. External Action approval, verification, compensation, or other owner decision;
4. destructive Project archive/deletion confirmation;
5. privacy/external-transfer conflict;
6. provider or credential failure blocking requested AI work;
7. permission/access conflict that changes whether an action can proceed;
8. real cost/budget threshold that changes execution, **when such a backend capability actually exists**;
9. failed operation requiring owner action;
10. outcome-unknown recovery state;
11. stale/offline state when it changes actionability or trust;
12. data-loss/recovery warning;
13. first-Project onboarding when no Project exists.

Resolved conditions disappear from persistent attention unless they have independent ongoing value.

## 19. Removal-depth matrix

`REMOVE` does not always mean deleting backend or future architecture code. The implementation boundary is frozen as follows.

### 19.1 Presentation relocation only — underlying Product capability retained

These lose permanent navigation/default display but their implemented capability remains and is re-exposed through slash or conditional UI:

- Knowledge;
- Review;
- External Action;
- Activity;
- History;
- Preferences;
- Project Administration;
- AI configuration;
- Privacy;
- technical inspection data;
- Project switching;
- global Search backend/read path;
- retry/recovery/domain commands.

### 19.2 Owner UI may be deleted after replacement/absence is verified

The following current presentation code has no required persistent replacement of the same screen:

- Settings Category Index / category-tab mega-navigation;
- separate Models owner page;
- Costs & Budgets placeholder page;
- Connectors placeholder page;
- Directives Settings placeholder page;
- Schema Packs placeholder page;
- Diagnostics placeholder page;
- generic Advanced owner page;
- legacy top-bar Search modal after `/search` passes;
- legacy top-bar Commands/navigation palette after slash registry passes;
- persistent raw `TechnicalDetails` embeds after `technical.current` replacement exists;
- empty operational/attention placeholder cards;
- disabled `COMING_LATER` navigation presentations.

### 19.3 Must not be deleted merely because owner UI is removed

- backend contracts reserved for future architecture;
- persistence schema;
- Canonical semantics;
- Claim/Fact separation;
- Compiled Truth derivation;
- review/approval authority;
- External Action governance;
- provider/privacy policy;
- idempotency and outcome recovery;
- project binding/access control;
- audit/history data;
- raw diagnostic data used by tests/logs/internal tools.

## 20. Affected file/module map for HFM-S1..S6

HFM-S0 does not change these files, but freezes them as the expected impact surface.

### Shell / navigation / command entry

- `apps/shotgun-web/src/app/router.tsx`
- `apps/shotgun-web/src/shell/application-shell.tsx`
- `apps/shotgun-web/src/shell/primary-navigation.tsx`
- `apps/shotgun-web/src/shell/top-bar.tsx`
- `apps/shotgun-web/src/session/project-selector.tsx`
- `apps/shotgun-web/src/section3/global-tools.tsx`
- new HFM slash registry/palette/input composition modules
- `adapters/frontend-product-read-in-memory/src/index.ts`
- `assemblies/shotgun-app/src/application.ts` only if production projection composition must change to satisfy the accepted shell contract

### KEEP routes

- `apps/shotgun-web/src/routes/home-page.tsx`
- `apps/shotgun-web/src/routes/sources-workspace.tsx`
- `apps/shotgun-web/src/routes/source-detail-workspace.tsx`
- `apps/shotgun-web/src/routes/ask-workspace.tsx`

### Slash / conditional capability routes

- Knowledge route family and `apps/shotgun-web/src/knowledge/*`
- `apps/shotgun-web/src/routes/review-workspace.tsx`
- `apps/shotgun-web/src/routes/external-action-workspace.tsx`
- `apps/shotgun-web/src/routes/activity-workspace.tsx`
- `apps/shotgun-web/src/routes/history-workspace.tsx`

### Settings decomposition

- `apps/shotgun-web/src/routes/settings/settings-layout.tsx`
- `apps/shotgun-web/src/routes/settings/category-index-view.tsx`
- `apps/shotgun-web/src/routes/settings/preferences-workspace.tsx`
- `apps/shotgun-web/src/routes/settings/projects-workspace.tsx`
- `apps/shotgun-web/src/routes/settings/project-details-workspace.tsx`
- `apps/shotgun-web/src/routes/settings/models-workspace.tsx`
- `apps/shotgun-web/src/routes/settings/ai-workspace.tsx`
- `apps/shotgun-web/src/routes/settings/costs-workspace.tsx`
- `apps/shotgun-web/src/routes/settings/privacy-workspace.tsx`
- `apps/shotgun-web/src/routes/settings/connectors-workspace.tsx`
- `apps/shotgun-web/src/routes/settings/directives-workspace.tsx`
- `apps/shotgun-web/src/routes/settings/schema-workspace.tsx`
- `apps/shotgun-web/src/routes/settings/diagnostics-workspace.tsx`
- `apps/shotgun-web/src/routes/settings/advanced-workspace.tsx`

### Shared presentation / localization

- `apps/shotgun-web/src/components/technical-details.tsx`
- owner-facing Product labels/messages
- new `ko-KR` / `en-US` message resources or equivalent localization layer

### Existing protected backend paths to preserve

- `adapters/postgres/src/index.ts`
- Project Administration modules/repositories
- Settings command boundary
- AI settings/vault/config/privacy modules
- Sources write pipeline
- Ask command/execution modules
- Review modules
- External Action modules
- History/Activity read models

Backend code changes are allowed later only if a concrete Product behavior cannot be achieved through the existing authority path.

## 21. HFM-S0 final completion checklist

This candidate satisfies the required HFM-S0 design work as follows:

- [x] Persistent routes inventoried.
- [x] Sidebar items inventoried.
- [x] Top-bar items inventoried.
- [x] Settings categories inventoried.
- [x] Major persistent actions/status blocks/technical disclosures/empty destinations inventoried.
- [x] Every listed surface assigned `KEEP`, `SLASH`, `REMOVE`, or `CONDITIONAL`.
- [x] Every accepted `SLASH` capability assigned a discoverable command intent.
- [x] Every major `REMOVE` category has a presentation-only vs UI-deletion vs architecture-retention boundary.
- [x] Safety exceptions identified.
- [x] Moved write controls mapped to existing protected APIs/command boundaries.
- [x] Backend-unavailable owner categories identified and excluded from slash registry.
- [x] Minimal persistent navigation candidate frozen.
- [x] Expected implementation file/module impact mapped.
- [ ] **Owner accepts the HFM-S0 disposition.**

The final checkbox is the only remaining HFM-S0 completion gate.

## 22. State transition after owner decision

If the owner accepts this document without amendment:

```text
HFM-S0-INVENTORY-260814001: ACCEPTED / BASELINE_FROZEN
HFM-S0: COMPLETE
HFM-S1: AUTHORIZED / NOT_STARTED
```

If the owner changes a disposition, the change is recorded in this artifact before HFM-S0 is marked complete. HFM-S1 must not silently reinterpret this inventory.

Until that explicit owner decision:

```text
HFM-S1 MUST NOT START.
```
