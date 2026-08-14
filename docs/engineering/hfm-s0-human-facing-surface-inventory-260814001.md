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
- Home, Sources, Source Detail, Ask, Knowledge, Review, External Action, Activity, and History routes
- all current Settings routes
- shared `TechnicalDetails` presentation

The audit also preserves the 2026-08-14 owner smoke-test findings already incorporated into ADR-145 and the frozen HFM implementation plan. The retired Google Drive `UI개선사항` note is not used as implementation authority.

## 2. Classification semantics

The final HFM-S0 classification uses exactly four owner-facing dispositions.

- `KEEP` — frequent, task-primary, or directly useful to current human judgment. It remains visible in the relevant normal workflow.
- `SLASH` — legitimate but infrequent control, inspection, or advanced workflow. It is removed from persistent UI and remains discoverable through `/` or a focused UI opened from `/`.
- `REMOVE` — internal-only, redundant, misleading, non-actionable, duplicated, or not useful enough to justify owner-facing Product surface. No replacement is required unless another inventory entry explicitly preserves the underlying capability.
- `CONDITIONAL` — hidden when irrelevant but automatically surfaced when a runtime state requires owner attention, confirmation, recovery, or safety judgment.

A route may be `SLASH` while controls inside that route are `KEEP` once the focused route has been intentionally opened. A backend contract may remain intact even when its current owner-facing placeholder route is `REMOVE`.

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

The compact Project identity is `KEEP` because acting in the wrong Project has authority and data-placement consequences. The Project switch control itself is `SLASH` and is not a permanent dropdown.

First-Project creation is a `CONDITIONAL` onboarding exception because slash discovery through Ask cannot be relied upon before a Project exists.

## 4. Global shell and navigation inventory

- Product name `Shotgun` — `KEEP`. Retain compact brand identity.
- Current Project name — `KEEP`. Show once as compact context and remove duplicate copies.
- Persistent Project selector dropdown — `SLASH`. Replace with `project.switch`; preserve the protected switch API and existing leave guards.
- First Project onboarding link — `CONDITIONAL`. Show only when no Project exists.
- Home navigation — `KEEP`.
- Sources navigation — `KEEP`.
- Ask navigation — `KEEP`.
- Knowledge persistent navigation item — `REMOVE`. Preserve the implemented capability through `knowledge.open`.
- Review persistent navigation item — `REMOVE`. Preserve manual access through `review.open` and surface pending owner decisions conditionally.
- External Actions persistent navigation item — `REMOVE`. Preserve manual access through `external_action.open` and surface actionable work conditionally.
- Activity persistent navigation item — `REMOVE`. Preserve through `activity.open`.
- History persistent navigation item — `REMOVE`. Preserve through `history.open`.
- Settings persistent navigation item — `REMOVE`. Decompose real owner controls into focused commands and conditional attention.
- `COMING_LATER`, `TEMPORARILY_UNAVAILABLE`, and similar disabled route entries — `REMOVE`. Do not advertise development or roadmap state.
- Mobile `More` duplicate subsystem list — `REMOVE`. Mobile navigation uses the same compact `KEEP` set.
- Global top-bar Search button and modal — `REMOVE` after `search.global` is implemented and HFM-S5 verifies the replacement.
- Current top-bar `Commands` button — `REMOVE` as a separate command model. HFM must have one registry only.
- Existing `Ctrl/Cmd+K` navigation palette — `REMOVE` as an independent palette. HFM-S1 may reuse the shortcut only as an alternate trigger to the exact same slash registry if that adds value.
- Offline banner — `CONDITIONAL`. It remains proactively visible while offline.
- Global leading warning — `CONDITIONAL`. It remains proactively visible while actionable.
- Loading and route error boundaries — `CONDITIONAL`. Preserve accessible recovery behavior.
- Skip link and route focus accessibility — `KEEP` as infrastructure.

### 4.1 Production-shell correction finding

The normal Product composition currently wires `InMemoryGlobalShellProjection`, `InMemoryActionCenterProjection`, `InMemoryBackgroundSummaryProjection`, `InMemoryNotificationSummaryProjection`, `InMemoryGlobalSearch`, and `InMemoryRouteGuardProjection` into the production frontend read coordinator.

The current shell projection still emits Knowledge and Review as `COMING_LATER`, even though substantial Product implementations exist. HFM-S0 therefore classifies shell discoverability separately from capability existence. HFM-S3 must make persistent navigation represent the frozen HFM surface rather than historical phase-state navigation.

## 5. Home inventory

- Home route — `KEEP`. It becomes an owner action center rather than an operational console.
- First-run `Create your first Project` — `CONDITIONAL`.
- Ordinary Project State card — `REMOVE`. Current Project identity already exists globally.
- Project lifecycle problem that changes current action — `CONDITIONAL`.
- Primary action to add or use Sources — `KEEP`.
- Primary action to Ask — `KEEP`.
- Disabled future or roadmap primary actions — `REMOVE`.
- Attention Queue when actionable items exist — `CONDITIONAL` and primary.
- Empty `No attention needed` card — `REMOVE`; collapse it entirely.
- Continue Working entries — `KEEP` when non-empty.
- Empty Continue Working server/browser subsections — `REMOVE`.
- Recent resources — `KEEP` when non-empty.
- Pinned resources — `KEEP` when non-empty.
- Empty Recent/Pinned placeholders — `REMOVE`.
- Operational Summary counts — `REMOVE` as normal telemetry.
- Failed background work requiring owner intervention — `CONDITIONAL`; project it as an actionable item rather than a telemetry count.
- Active background work — `CONDITIONAL` only when it affects the current user action.
- Unread notification count — `CONDITIONAL` only when a real owner notification exists.
- Stale snapshot warning — `CONDITIONAL` when it changes actionability or trust.
- Loading/error state — `CONDITIONAL`.

## 6. Sources inventory

### 6.1 Sources workspace

- Sources route — `KEEP` as a primary knowledge-intake workflow.
- Duplicate Project label inside the page — `REMOVE`; use compact global Project context.
- Draft Queue — `KEEP`.
- Input type Direct Text / File / URL — `KEEP`.
- Source label — `KEEP`.
- Source classification request — `KEEP`. It is a real owner security classification request that the server validates.
- Direct Text / File / URL payload input — `KEEP`.
- Add intake draft — `KEEP`.
- Draft list — `KEEP` when non-empty.
- Submit drafts — `KEEP`.
- Discard drafts — `KEEP` in draft context.
- Internal `immutable bytes`, `Command Ledger`, and `server-authoritative command` prose — `REMOVE`; replace with concise owner-language progress only.
- Staging/submitting progress — `CONDITIONAL` while work is active.
- Project mismatch warning — `CONDITIONAL`.
- Invalid seed warning — `CONDITIONAL`.
- Offline/stale state — `CONDITIONAL`.
- Intake failure — `CONDITIONAL`.
- Cancel active submission — `CONDITIONAL` only when cancellation is valid.
- Retry failed item — `CONDITIONAL` only when retry is valid.
- Exact duplicate decision — `CONDITIONAL` only for an actual duplicate decision.
- Raw submission/item/decision IDs — `SLASH` through `technical.current`.

### 6.2 Source Library

- Source Library — `KEEP`.
- Source-local search — `KEEP`. This workflow-local search remains separate from global `search.global`.
- Source label — `KEEP`.
- Media type — `KEEP` as compact secondary metadata.
- Source classification — `KEEP` as compact security-relevant metadata.
- Raw lifecycle / preview / Ask-usage enums — `REMOVE` from default display.
- Action-affecting readiness such as a Source being unusable for Ask — `CONDITIONAL`.
- Long Ask-usage explanation on every row — `REMOVE`; replace with concise conditional state only.
- Open Source — `KEEP`.
- `Open pinned Version` implementation wording — `REMOVE` wording; use an owner-facing Open action and show human version context in detail.
- No Sources / no matches — `KEEP` as a compact empty state, not a large placeholder.

## 7. Source Detail inventory

- Source Detail route — `KEEP` as normal drill-down from Sources and citations.
- Source label — `KEEP`.
- Back to Source Library — `KEEP`.
- Return to cited Ask/Knowledge resource — `KEEP` when a return target exists.
- Human version number — `KEEP`.
- Version history selector — `KEEP`.
- Original Preview — `KEEP`.
- Evidence text — `KEEP`.
- Evidence origin/provenance — `KEEP` because it helps trust judgment.
- Ordinary Preview/Ask readiness status — `REMOVE` from default display.
- Preview/Ask readiness problem — `CONDITIONAL` if it blocks a task.
- Source ID — `SLASH` through `technical.current`.
- SourceVersion ID — `SLASH` through `technical.current`.
- Evidence ID — `SLASH` through `technical.current`.
- Evidence revision — `SLASH` through `technical.current`.
- Repeated candidate/claim text that is identical to Evidence text — `REMOVE` duplicate rendering. One human-readable occurrence remains and provenance stays available.
- Default `Technical details` disclosure — `SLASH`; replace default `<details>` presentation with a context-bound technical surface.

## 8. Ask inventory

### 8.1 Draft and context

- Ask route — `KEEP` as a primary owner workflow and slash entry point.
- Duplicate Project label inside Ask — `REMOVE`.
- Question input — `KEEP`; HFM-S1 integrates the `/` trigger here.
- Submit question — `KEEP`.
- Ask mode — `KEEP` contextually because it directly changes answer semantics; show it only where multiple modes are relevant.
- Source selection in source-aware mode — `KEEP` contextually.
- Source labels — `KEEP`.
- Raw Source / SourceVersion IDs in selection — `SLASH` through `technical.current`.
- Draft explanation about protected command boundary / Canonical / original Evidence — `REMOVE`.
- Provider eligibility block — `CONDITIONAL` if Ask cannot proceed.
- Privacy/provider action required — `CONDITIONAL` with a direct focused recovery path.
- Submission-outcome unknown recovery — `CONDITIONAL`; preserve original request identity and never duplicate-submit.
- General disabled/internal submission-state prose — `REMOVE`; replace with concise actionable owner state.

### 8.2 Conversation and answer

- Conversation list — `KEEP`, compact.
- Conversation title — `KEEP`.
- Turn count — `REMOVE` as low-value metadata.
- Normal latest run state — `REMOVE`.
- Active/failed latest run state — `CONDITIONAL` while actionable or in progress.
- User question — `KEEP` as the first element of each turn.
- Final answer text — `KEEP` immediately after the question.
- Citations / evidence links — `KEEP` immediately after the answer.
- Partial answer while generating — `CONDITIONAL`.
- Failure message — `CONDITIONAL`.
- Failure code — `SLASH` through `technical.current`.
- `AnswerRun` implementation term — `REMOVE`; use owner-language `answer` or `attempt` only where necessary.
- Cancel answer — `CONDITIONAL` only while cancellable.
- Retry after failure — `CONDITIONAL` when recovery is the likely next action.
- Retry in non-failure or advanced cases — `SLASH` through `action.retry`.
- Export answer — `SLASH` through `answer.export`.
- Helpful / Not helpful buttons — `REMOVE` from the current owner Product surface. The backend contract may remain.
- Propose Intake Draft — `SLASH` through `answer.propose_intake`.
- Propose Draft ChangeSet — `SLASH` through `answer.propose_change`.
- Propose Directive transition — `SLASH` through `answer.propose_directive`. This preserves the implemented transition-seed path and is distinct from the unavailable Directives Settings page.
- Check existing Answer command outcome — `CONDITIONAL` recovery only.
- Export result panel — `CONDITIONAL` after explicit export.
- Persistent action row before the answer — `REMOVE`; HFM-S5 must reorder it.

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

- Persistent Knowledge nav entry — `REMOVE`.
- Knowledge capability entry — `SLASH` through `knowledge.open`.
- Knowledge search/filter inside an intentionally opened workspace — `KEEP` inside that focused workspace.
- Knowledge Pages — `KEEP` inside the focused workspace.
- Knowledge Detail — `KEEP` inside the focused workspace.
- Compare — `KEEP` contextually inside the focused workspace.
- Graph — `KEEP` contextually inside the focused workspace.
- Knowledge correction proposal/editor — `SLASH` or contextually opened through `knowledge.correct`.
- Ordinary projection/readiness metadata — `REMOVE`.
- Partial/stale projection that changes trust or action — `CONDITIONAL`.
- Raw stable IDs / snapshot IDs / projection revisions — `SLASH` through `technical.current`.
- Internal read-only/server-authoritative explanatory prose — `REMOVE`.

Underlying Knowledge Product code is retained. HFM removes permanent navigation cost, not implemented capability.

## 10. Review inventory

### 10.1 Capability finding

Review is materially implemented despite the current shell `COMING_LATER` presentation. The Product contains a guarded Review workspace, queue/detail reads, decision recording, comments, dependency-aware aggregate state, approvals, and outcome-unknown recovery.

### 10.2 Disposition

- Persistent Review nav entry — `REMOVE`.
- Pending review requiring owner decision — `CONDITIONAL`; surface automatically in owner attention.
- Manual Review queue access — `SLASH` through `review.open`.
- Empty Review workspace destination — `REMOVE` from normal UI.
- Queue filters/list — `KEEP` once Review is intentionally opened.
- Review item detail/evidence/impact — `KEEP` once Review is opened.
- Approve / Reject / Request revision / Hold — `KEEP` in the active Review context.
- Review comment — `KEEP` in the active Review context.
- Review decision/history summary — `KEEP` in focused Review context.
- Outcome-unknown recovery — `CONDITIONAL`.
- Raw context/item/decision IDs, revisions, and digests — `SLASH` through `technical.current`.

Review decisions remain routed through the existing protected Review command boundary. HFM does not alter Canonical approval authority.

## 11. External Action inventory

### 11.1 Capability finding

External Action is a real guarded governance workspace with queue/detail, manifest/risk/preflight/execution/attempt/verification/result/audit/approval reads and governed Cancel/Rollback/Compensation/Verify/recovery paths.

### 11.2 Disposition

- Persistent External Actions nav entry — `REMOVE`.
- Action waiting for approval, verification, compensation, or owner intervention — `CONDITIONAL` and proactively visible.
- Manual External Action inspection — `SLASH` through `external_action.open`.
- Queue/detail once intentionally opened — `KEEP` inside the focused workspace.
- Risk/manifest/preflight information that changes a decision — `KEEP` in active action context.
- Approval requirement — `CONDITIONAL` and never hidden behind slash.
- Cancel — `CONDITIONAL` only when the current action is cancellable.
- Rollback — `CONDITIONAL` only when available and consequence is clear.
- Prepare compensation — `CONDITIONAL` only when required or available.
- Verify — `CONDITIONAL` only when verification is required or available.
- Outcome-unknown recovery — `CONDITIONAL`; never re-execute blindly.
- Raw action/execution/attempt/verification IDs and internal revision topology — `SLASH` through `technical.current`.
- Empty `no external actions` destination — `REMOVE` from normal UI.

Existing external-action safety, approval, idempotency, and protected command boundaries remain unchanged.

## 12. Activity inventory

- Persistent Activity nav entry — `REMOVE`.
- Activity workspace — `SLASH` through `activity.open`.
- Queue/filter/list while explicitly opened — `KEEP` inside the focused workspace.
- High-level state / attention / related resource — `KEEP` inside the focused workspace.
- Failed work requiring action — `CONDITIONAL`; surface proactively without requiring Activity discovery.
- Retry/Cancel delegated to the owning domain — `CONDITIONAL` only when the server says the action is valid.
- Projection freshness/adaptor/snapshot telemetry — `SLASH` technical.
- Job/Run/Attempt/Stage/Event raw topology — `SLASH` technical.
- Raw Activity/Run/Job IDs — `SLASH` technical.
- Empty Activity destination — `REMOVE` from normal UI.

Activity remains an implemented inspection capability; it is not deleted.

## 13. History inventory

- Persistent History nav entry — `REMOVE`.
- History workspace — `SLASH` through `history.open`.
- Domain filters/list while opened — `KEEP` inside the focused workspace.
- Human event label/time/domain — `KEEP` inside the focused workspace.
- Payload availability summary — `KEEP` while auditing because it explains missing or redacted evidence.
- Raw payload JSON/tombstone payload — `SLASH` technical.
- Raw source event/resource IDs — `SLASH` technical.
- External Action / Review lineage links — `KEEP` contextually.
- Reversal draft creation from an eligible Canonical history item — `KEEP` contextually inside explicitly opened History. It creates a draft rather than a direct Canonical reversal; the existing Review boundary takes over.
- Empty History destination — `REMOVE` from normal UI.

## 14. Settings decomposition inventory

The permanent Settings landing page and category catalog are removed as owner information architecture. Real owner controls are preserved as focused slash/conditional flows; placeholder categories with no current backend capability are removed instead of receiving fake commands.

### 14.1 Settings shell

- Persistent Settings nav — `REMOVE`.
- Settings landing / Category Index — `REMOVE`.
- `Policy Control Plane` wording — `REMOVE`.
- `Settings & Project Administration` mega-header — `REMOVE`.
- Current/Target/Resource Project badges — `REMOVE`; use one compact current Project identity and a contextual warning only if a scope difference materially changes an action.
- Settings-local Project selector — `REMOVE`; Project switch is `project.switch`.
- Settings category tabs — `REMOVE`.
- Generic Settings confirmation dialog primitive — `CONDITIONAL`; reuse or refactor it for destructive command confirmation.
- Category counts/warnings index — `REMOVE`; action-required items feed conditional owner attention instead.

### 14.2 Preferences

- Preferences page — `SLASH` as a focused preferences UI.
- Locale — `SLASH` through `preferences.locale`.
- Timezone — `SLASH` through `preferences.timezone`.
- Date/time format — `SLASH` through `preferences.display`.
- Screen density — `SLASH` through `preferences.display`.
- Reduce motion — `SLASH` through `preferences.display`.

Writes continue through `apiClient.updatePrincipalPreferences` with existing active/target/resource Project binding, expected revision, request identity, and idempotency.

### 14.3 Project Administration

- Project Admin page — `SLASH` through `project.manage` or a focused project picker.
- Project list for management — `SLASH`.
- Create first Project — `CONDITIONAL` first-run onboarding.
- Create additional Project — `SLASH` through `project.create`.
- Switch Project — `SLASH` through `project.switch`.
- Rename Project — `SLASH` through `project.rename`.
- Archive Project — `SLASH` plus destructive confirmation through `project.archive`.
- Restore Project — `SLASH` through `project.restore`.
- Request deletion — `SLASH` plus destructive confirmation through `project.delete_request`.
- `Status: Active` plus `Active: Yes` duplicate semantics — `REMOVE` duplicate; retain one lifecycle state when useful.
- Project ID / revision — `SLASH` technical.
- `Details / Policy` misleading label — `REMOVE` wording.

All writes remain on existing Project Administration APIs and expected-revision/idempotency contracts.

### 14.4 Models

- Separate Models page — `REMOVE`.
- Model Profiles/Routing placeholder — `REMOVE`.

Reason: the page duplicates the AI configuration concept and the current PostgreSQL `getModelDescriptors()` returns `UNAVAILABLE` unconditionally. No slash command is created for an unsupported Product capability. Underlying future contracts may remain.

### 14.5 AI

- Permanent AI Settings page — `SLASH` through `ai.configure`.
- Provider choice — `SLASH` inside focused AI configuration.
- Model choice — `SLASH` inside focused AI configuration; there is no separate Models command.
- API credential create/replace — `SLASH` inside focused AI configuration.
- Test Connection — `SLASH` or contextual through `ai.test_connection` or the same focused panel.
- Save AI configuration — `SLASH` using the existing protected configuration save.
- Revoke/remove credential — `SLASH` plus destructive confirmation.
- Credential/provider failure blocking Ask — `CONDITIONAL` with direct recovery.
- Provider privacy review/approval blocking requested work — `CONDITIONAL`.
- Provider privacy management when not blocking — `SLASH` inside focused AI/privacy flow.
- Provider/model display names — `KEEP` inside focused AI configuration.
- Server catalog revision / capability revision — `REMOVE` from default owner UI.
- Credential/config revisions — `REMOVE` from default owner UI.
- Runtime pinning / AnswerRun identity exposition — `REMOVE` from default owner UI.
- `Canonical Product workspace` and policy-command prose — `REMOVE`.

### 14.6 Costs & Budgets

- Costs & Budgets page — `REMOVE`.
- `not available in this tier` message — `REMOVE`.
- Future real budget threshold requiring a decision — `CONDITIONAL` only after a real backend capability exists.

Reason: the current PostgreSQL `getCostBudget()` returns `UNAVAILABLE` unconditionally and there is no real tier activation path. No current slash command is created.

### 14.7 Privacy & Sensitivity

- Permanent Privacy page — `SLASH` through `privacy.open`.
- Request external AI transfer review — `SLASH` or direct `CONDITIONAL` recovery through `privacy.review`.
- Pending approval blocking work — `CONDITIONAL`.
- Privacy/permission conflict — `CONDITIONAL` and never hidden.
- Sensitivity when it changes the allowed action — `CONDITIONAL`.
- Retention/privacy summary on explicit inspection — `KEEP` inside the focused privacy view.
- Approval/revision internals — `REMOVE` from default owner UI.
- Project-level and provider-specific approval — `KEEP` as distinct human concepts when relevant; they must not be presented as one ambiguous approval.

The Privacy backend is real: `getPrivacyRetention()` derives current settings and pending proposal state, and review writes continue through the existing settings command boundary.

### 14.8 Connectors

- Connectors page — `REMOVE`.
- `not available in this tier` message — `REMOVE`.
- Connector placeholder cards — `REMOVE`.

Reason: the current PostgreSQL `getConnectorSettings()` returns `UNAVAILABLE` unconditionally. No fake slash command is created. A future real connector capability receives a new HFM classification when it becomes actionable.

### 14.9 Directives & Priority

- Directives Settings page — `REMOVE`.
- `not available in this tier` message — `REMOVE`.
- Ask `Propose Directive` transition — `SLASH` as a separate implemented transition-seed capability.

Reason: the current PostgreSQL `getDirectiveProposals()` returns `UNAVAILABLE` unconditionally. The implemented Ask transition does not make the Settings page available.

### 14.10 Schema Packs

- Schema Packs page — `REMOVE`.
- `not available in this tier` message — `REMOVE`.
- Future schema architecture contracts — retained internally, not exposed as owner Product UI until actionable.

Reason: the current PostgreSQL `getSchemaPacks()` returns `UNAVAILABLE` unconditionally.

### 14.11 Diagnostics

- Diagnostics page — `REMOVE` for the current Product.
- `System Diagnostics & Real-Fact Telemetry` owner destination — `REMOVE`.
- `diagnostics.open` — `REMOVE` from the initial HFM registry.

Reason: the current PostgreSQL `getDiagnostics()` returns `UNAVAILABLE` unconditionally. A later real diagnostic capability may be reintroduced as `SLASH`, but HFM-S0 does not reserve visible Product space for it now.

### 14.12 Advanced

- Generic Advanced page — `REMOVE`.
- Project/settings/policy revisions in its `Technical details` block — `SLASH` technical.
- Generic Validate/Preview/Apply policy setting UI — `REMOVE` as a generic owner surface.
- Outcome-unknown recovery for a real focused Settings command — `CONDITIONAL`.

The underlying protected settings machinery remains. A specific user-needed setting must receive a specific future command rather than a generic `/advanced` command.

## 15. Shared technical-information rule

The current `TechnicalDetails` component is a generic `<details>` disclosure embedded across multiple normal owner routes. Under the frozen HFM candidate:

```text
Default owner surface: no raw technical disclosure
Explicit /technical request: temporary context-bound technical drawer/view
```

The following are removed from normal default rendering unless another inventory entry explicitly keeps a human-readable abstraction:

- UUIDs and stable internal IDs
- revisions and projection revisions
- locators and resource paths
- command/request/idempotency identities
- raw enum values
- Job/Run/Attempt/Stage/Event topology
- provider/configuration revision mechanics
- policy-context revisions
- raw audit payload JSON

The data itself is not deleted. It remains available to logs, APIs, persistence, tests, and bounded technical inspection where required.

## 16. Initial slash-command registry frozen by HFM-S0

The following command intents are the discoverability replacement for accepted `SLASH` capabilities. HFM-S1 may refine labels, aliases, and presentation primitives, but it may not silently remove access to an accepted intent.

- `help.commands` — 명령어 보기. `READ`. HFM command discovery.
- `search.global` — 전체 검색. `READ`. Existing `searchGlobal` read path; final behavior repaired in HFM-S5.
- `project.switch` — 프로젝트 전환. Context write through `switchActiveProject`.
- `project.manage` — 프로젝트 관리. `READ` through existing project list/details.
- `project.create` — 프로젝트 만들기. `WRITE` through `createProject`; first-Project creation remains conditional onboarding.
- `project.rename` — 프로젝트 이름 변경. `WRITE` through `updateProject`.
- `project.archive` — 프로젝트 보관. Destructive-like write through `archiveProject` plus confirmation.
- `project.restore` — 프로젝트 복원. `WRITE` through `restoreProject`.
- `project.delete_request` — 프로젝트 삭제 요청. `DESTRUCTIVE` through `requestDeleteProject` plus confirmation.
- `preferences.locale` — 언어 변경. `WRITE` through `updatePrincipalPreferences`.
- `preferences.timezone` — 시간대 변경. `WRITE` through `updatePrincipalPreferences`.
- `preferences.display` — 화면 표시 설정. `WRITE` through `updatePrincipalPreferences`.
- `ai.configure` — AI 설정. `WRITE` through existing provider/model/credential/configuration APIs.
- `ai.test_connection` — AI 연결 확인. Read/action through the existing connection test API.
- `privacy.open` — 개인정보 및 외부 전송 설정. `READ` through `getPrivacyRetention`.
- `privacy.review` — 외부 AI 전송 검토. Approval write through the existing Settings review command path.
- `knowledge.open` — 지식 보기. `READ` through the production Knowledge projection/routes.
- `knowledge.correct` — 지식 수정 제안. Draft write through the existing Knowledge draft/correction path.
- `review.open` — 검토 열기. Read/write through the existing Review queue/decision workspace.
- `external_action.open` — 외부 작업 보기. Read/write through the existing governed External Action workspace.
- `activity.open` — 실행 상태 보기. `READ` through the existing Activity workspace.
- `history.open` — 변경 이력 보기. `READ` through the existing History workspace.
- `technical.current` — 기술 정보 보기. `READ`, context-bound replacement for default `TechnicalDetails`.
- `answer.export` — 답변 내보내기. Export through the existing Ask export API.
- `action.retry` — 다시 시도. `WRITE` through existing owning-domain retry paths and available only when valid.
- `answer.propose_intake` — 답변에서 자료 초안 만들기. Draft write through the existing Ask transition-seed path.
- `answer.propose_change` — 답변에서 변경 제안 만들기. Draft write through the existing Ask transition-seed path.
- `answer.propose_directive` — 답변에서 지시 제안 만들기. Draft write through the existing Ask transition-seed path.

The following are explicitly **not** in the initial registry because the current PostgreSQL Product backend is unavailable:

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

- Switch Project → `apiClient.switchActiveProject` plus existing leave guards/cache purge/session boundary.
- Create first Project → `apiClient.createFirstProject`.
- Create Project → `apiClient.createProject`.
- Rename Project → `apiClient.updateProject` with expected revision/request identity/idempotency.
- Archive Project → `apiClient.archiveProject` with expected revision/request identity/idempotency.
- Restore Project → `apiClient.restoreProject` with expected revision/request identity/idempotency.
- Request Project deletion → `apiClient.requestDeleteProject` with expected revision/request identity/idempotency.
- Update locale/timezone/display → `apiClient.updatePrincipalPreferences`.
- AI credential create/replace → `createAICredential` / `replaceAICredential` plus existing outcome recovery.
- AI credential revoke/remove → `revokeAICredential` / `removeAICredential` plus explicit confirmation.
- Save AI provider/model configuration → `saveAIConfiguration`.
- Test AI connection → `testAIConnection`.
- Provider privacy proposal/approval → existing AI provider privacy proposal/approval APIs.
- Project external-transfer review → existing `applySettingsCommand` review-required / approval flow.
- Source intake → existing Sources staging plus protected submit write client.
- Source duplicate resolution → existing exact-duplicate decision plus `resolveDuplicate`.
- Source cancel/retry → existing Sources cancel/retry commands.
- Ask submit → existing protected Ask submit plus client-request outcome resolution.
- Ask cancel/retry/export/transition → existing Answer command APIs plus outcome recovery.
- Review decision → existing `recordReviewDecisions` plus command outcome resolution.
- External Action cancel/rollback/compensation/verify → existing governed External Action command APIs plus semantic digest/outcome recovery.
- Activity retry/cancel → delegated existing owning-domain command APIs; Activity does not become mutation authority.
- History reversal → existing `createReversalDraftChangeSet`; Review remains the approval/authoring boundary.
- Knowledge correction → existing frontend Knowledge draft/correction boundary; no direct Canonical write.

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
8. real cost/budget threshold that changes execution, when such a backend capability actually exists;
9. failed operation requiring owner action;
10. outcome-unknown recovery state;
11. stale/offline state when it changes actionability or trust;
12. data-loss/recovery warning;
13. first-Project onboarding when no Project exists.

Resolved conditions disappear from persistent attention unless they have independent ongoing value.

## 19. Removal-depth matrix

### 19.1 Presentation relocation only — underlying Product capability retained

These lose permanent navigation/default display but their implemented capability remains and is re-exposed through slash or conditional UI:

- Knowledge
- Review
- External Action
- Activity
- History
- Preferences
- Project Administration
- AI configuration
- Privacy
- technical inspection data
- Project switching
- global Search backend/read path
- retry/recovery/domain commands

### 19.2 Owner UI may be deleted after replacement or absence is verified

The following current presentation code has no required persistent replacement of the same screen:

- Settings Category Index / category-tab mega-navigation
- separate Models owner page
- Costs & Budgets placeholder page
- Connectors placeholder page
- Directives Settings placeholder page
- Schema Packs placeholder page
- Diagnostics placeholder page
- generic Advanced owner page
- legacy top-bar Search modal after `search.global` passes
- legacy top-bar Commands/navigation palette after the slash registry passes
- persistent raw `TechnicalDetails` embeds after `technical.current` replacement exists
- empty operational/attention placeholder cards
- disabled `COMING_LATER` navigation presentations

### 19.3 Must not be deleted merely because owner UI is removed

- backend contracts reserved for future architecture
- persistence schema
- Canonical semantics
- Claim/Fact separation
- Compiled Truth derivation
- review/approval authority
- External Action governance
- provider/privacy policy
- idempotency and outcome recovery
- project binding/access control
- audit/history data
- raw diagnostic data used by tests/logs/internal tools

## 20. Affected file/module map for HFM-S1..S6

HFM-S0 does not change these Product files, but freezes them as the expected impact surface.

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
