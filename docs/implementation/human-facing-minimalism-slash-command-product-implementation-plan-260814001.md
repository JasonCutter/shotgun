---
id: HFM-SLASH-PLAN-260814001
classification: CANDIDATE
status: DESIGN_READY_FOR_REVIEW
created_at: 2026-08-14
subject_base: 575b8031b3beccc9fba5541809285c5a29b89d11
repository: JasonCutter/shotgun
canonical_branch: main
governing_adr: ADR-140
trigger: 2026-08-14 local Product smoke test + owner UI principles
---

# Shotgun Human-Facing Minimalism + Slash Command Product Implementation Plan

## 0. Purpose

This document is the complete implementation plan for the post-local-acceptance Product UI correction program triggered by the 2026-08-14 owner smoke test.

The program is not a general redesign and is not an open-ended UI cleanup. Its purpose is to move Shotgun from a technically complete but information-heavy owner interface to a **minimal owner-facing Product surface** in which:

- only information that materially helps human judgment remains visible;
- only controls that the owner reasonably needs to touch remain persistent;
- rare but necessary controls move to a discoverable `/` command layer;
- internal-only information disappears from the normal Product UI;
- urgent risk, approval, failure, cost, permission, and destructive states remain proactively visible;
- existing domain authority and safety boundaries remain unchanged.

This plan contains the detailed design, section boundaries, implementation sequence, per-section completion targets, excluded scope, verification policy, and final completion contract.

## 1. Program start and finish boundary

### 1.1 Start point

The program begins from:

```text
Repository: JasonCutter/shotgun
Canonical base: main@575b8031b3beccc9fba5541809285c5a29b89d11
Local Product: launchable and previously accepted
2026-08-14 smoke test: completed for current observable owner surfaces
New owner principles: Human-Facing Minimalism + Slash Command Control Plane
ADR: ADR-140 PROPOSED
```

The smoke test produced three classes of evidence that define the implementation input:

1. confirmed functional defects, including non-responsive global Search and locale persistence without actual UI language application;
2. severe UX defects, including Answer placement, technical-detail layout collapse, duplicate Claim/Evidence display, and prototype/admin language;
3. structural Product issues, including too many persistent settings/options, inactive feature pages, internal-only telemetry, and duplicate navigation/command surfaces.

### 1.2 Finish point

This program is complete only when all of the following are true:

```text
HFM-S0 through HFM-S8: COMPLETE
All owner-facing surfaces classified KEEP / SLASH / REMOVE
All REQUIRED REMOVE items absent from normal Product UI
All REQUIRED SLASH capabilities reachable through slash discovery
Slash commands preserve existing authority/safety boundaries
Search path works in its final chosen form
ko-KR locale is actually reflected in owner-facing UI where supported
Critical Source Detail and Ask hierarchy defects are fixed
Inactive/unimplemented destinations are no longer misleadingly visible
Targeted runtime regression: PASS
Required CI on exact implementation head: PASS
Implementation PR: merged
Post-merge main CI: PASS
Final completion record: written
Status Authority: FINAL_AFTER_MERGE
```

Code complete, local visual improvement, or passing unit tests alone do not satisfy program completion.

## 2. Source-of-truth transition

The temporary Google Drive document `UI개선사항` is a working note used during smoke testing only.

Until this implementation plan is owner-approved, it may be consulted as temporary evidence. Once this plan is approved/frozen and becomes the accepted implementation authority:

- this plan becomes the authoritative implementation backlog and detailed design;
- Google Drive `UI개선사항` is retired from implementation authority;
- no new implementation requirements are added only to the Drive note;
- later changes must be made to this plan through explicit amendment/history, not by silently editing an external temporary list.

The Drive document is not Canonical product truth and is not a completion authority.

## 3. Non-negotiable Product principles

### HFM-P01 — Human usefulness first

A field, status, button, option, menu, or page is not entitled to screen space merely because the system has the data or capability.

### HFM-P02 — KEEP / SLASH / REMOVE classification

Every persistent owner-facing element must be classified:

- `KEEP`: frequent or decision-critical;
- `SLASH`: rare but legitimate owner control/inspection capability;
- `REMOVE`: internal-only, redundant, non-actionable, misleading, or unnecessary for human judgment.

Unclassified elements are not allowed at final closure.

### HFM-P03 — Default UI is a projection, not a system console

The owner UI shows a useful projection of Shotgun, not the complete internal state of Shotgun.

### HFM-P04 — Rare controls are command-discoverable

If a control may be needed but does not justify persistent visibility, it moves behind `/` rather than remaining in Settings by default.

### HFM-P05 — No memorization requirement

The owner must only need to remember `/`. Command names are searchable and discoverable.

### HFM-P06 — Safety cannot be hidden

Immediate approval, destructive, privacy, credential, permission, cost, or failure states stay visible when actionable.

### HFM-P07 — Slash is not an authority bypass

Slash commands route to existing protected commands, APIs, domain services, or read models. They do not create a shortcut around project binding, approval, authorization, idempotency, policy, or persistence ownership.

### HFM-P08 — Hidden when irrelevant, surfaced when actionable

A capability may be absent from persistent navigation and still appear temporarily when the runtime determines that owner action is required.

### HFM-P09 — Korean owner UI

`ko-KR` is a real Product locale, not stored metadata only. Owner-facing labels and messages covered by localization must render in Korean when selected. Technical identifiers may retain canonical English forms only when that is useful.

### HFM-P10 — Evidence reuse and no duplicate testing

Already-passed behavior outside the changed impact surface is not re-run merely for ceremony. Verification is targeted to changed behavior and direct dependencies.

## 4. Target owner interaction model

### 4.1 Persistent Product surface

The intended persistent surface is small.

Initial `KEEP` candidates:

- Home — only useful action/attention summary;
- Sources — owner knowledge intake/library work;
- Ask — main question/answer and slash-command entry surface;
- current Project context — compact, only if required to avoid acting on the wrong project.

Persistent navigation is not allowed to become a catalog of every subsystem.

### 4.2 Conditional attention surface

The Product may temporarily surface:

- review/approval required;
- external action awaiting approval or verification;
- failed task requiring owner action;
- credential/provider problem blocking the requested work;
- destructive confirmation;
- privacy/permission conflict;
- cost/budget condition that changes execution;
- recovery/data-loss warning.

The item disappears from persistent attention once resolved unless it has separate ongoing value.

### 4.3 Slash-command surface

Typing `/` at the beginning of the Ask input opens a command picker.

Target interaction:

```text
/
  검색 또는 명령 입력…

  프로젝트
  프로젝트 전환
  프로젝트 이름 변경
  새 프로젝트 만들기

  AI
  AI 모델 변경
  Provider 설정
  자격 증명 설정

  보기 / 점검
  변경 이력 보기
  실행 상태 보기
  기술 정보 보기
  진단 보기

  환경 설정
  언어 변경
  시간대 변경

  작업
  검색
  내보내기
  다시 시도
```

Actual names are localized labels. Canonical internal command IDs remain stable and separate from display text.

### 4.4 Focused command UI

A slash command does not need to execute entirely as text.

Examples:

- `/ai` → temporary focused AI configuration panel;
- `/project rename` → one-field rename dialog;
- `/language` → locale selector;
- `/history` → bounded history surface;
- `/technical` → temporary technical detail drawer for the current resource;
- `/search` → search query/result surface;
- destructive commands → existing confirmation/approval flow.

The principle is **on-demand UI instead of permanent UI**.

## 5. Initial surface disposition hypothesis

This is the starting design for HFM-S0 audit. HFM-S0 may refine individual items, but any change must preserve the governing principles.

| Existing surface/capability | Initial disposition | Design intent |
|---|---|---|
| Home | KEEP | compact current/actionable summary only |
| Sources | KEEP | primary owner workflow |
| Ask | KEEP | primary owner workflow + slash entry |
| Knowledge if not operationally useful/implemented | REMOVE until useful | do not expose development roadmap |
| Review when nothing actionable | conditional/SLASH | surface automatically only when attention required |
| External Actions | conditional/SLASH | no permanent empty destination |
| Activity | SLASH | operational inspection, not normal navigation |
| History | SLASH | audit capability, rarely needed |
| Settings landing page | REMOVE as permanent navigation candidate | split actual controls into slash/focused panels |
| Project Admin | SLASH | rare management operation |
| Preferences | SLASH | locale/timezone/density on demand |
| AI Settings | SLASH, possibly contextual KEEP only while blocked | owner-adjustable but not normal work surface |
| Models separate page | REMOVE | duplicate/unimplemented against AI settings |
| Costs & Budgets placeholder | REMOVE until real actionable capability exists | no fake tier/UNAVAILABLE page |
| Connectors placeholder | REMOVE until implemented/actionable | no fake tier/UNAVAILABLE page |
| Directives placeholder | REMOVE until implemented/actionable | no inactive destination |
| Schema Packs placeholder | REMOVE until implemented/actionable | internal/advanced unless later proven owner-needed |
| Diagnostics | SLASH or developer-only | on-demand troubleshooting only |
| Advanced policy | SLASH only if owner must truly alter it; otherwise REMOVE | no internal policy console by default |
| top Search button | REMOVE if `/search`/Ask-native path replaces it | one search entry model |
| top Commands button | REMOVE or alternate trigger to same slash registry | no duplicate command model |
| UUID/revision/locator default display | REMOVE | technical-only |
| Technical details disclosure | SLASH/contextual diagnostic | only when explicitly requested |
| internal enums/authority wording | REMOVE | translate to owner action/status |

## 6. Slash command architecture design

### 6.1 Command registry

Introduce one owner-command registry with stable internal definitions. Suggested conceptual contract:

```ts
type OwnerCommandDefinition = {
  id: string;
  category: OwnerCommandCategory;
  labelKey: string;
  descriptionKey: string;
  aliases: string[];
  keywords: string[];
  availability: (context: OwnerCommandContext) => CommandAvailability;
  risk: 'READ' | 'WRITE' | 'DESTRUCTIVE';
  presentation: 'NAVIGATE' | 'DIALOG' | 'DRAWER' | 'INLINE' | 'EXECUTE';
  execute: OwnerCommandExecutor;
};
```

The registry is Product UI composition metadata, not a new source of domain truth.

### 6.2 Command availability

A command can be:

- `AVAILABLE` — selectable;
- `UNAVAILABLE_WITH_REASON` — shown only when the reason helps the owner;
- `HIDDEN` — not relevant to current context or not implemented.

Do not show fake upgrade/tier messaging unless a real entitlement policy exists.

### 6.3 Context binding

Command context includes only authority-safe references, for example:

- active project identity;
- current route/resource identity;
- current conversation identity;
- owner locale;
- existing capability/read-model output.

The client must not invent server authority fields.

### 6.4 Input behavior

Slash mode activates only when `/` is in the command-trigger position, initially at the beginning of an otherwise empty Ask draft or after leading whitespace. Normal questions containing `/` are not reinterpreted unexpectedly.

Required behavior:

- `/` opens palette;
- typing filters commands;
- Arrow Up/Down moves selection;
- Enter selects;
- Escape closes;
- pointer selection works;
- screen reader labels announce command name/category/state;
- selected command replaces command mode rather than submitting a normal Ask question accidentally.

### 6.5 Search matching

Command discovery supports:

- localized labels;
- English canonical aliases where useful;
- Korean keywords;
- prefix and substring match at minimum;
- case-insensitive matching for Latin aliases.

Fuzzy matching is optional and must not be introduced if deterministic simple matching is sufficient.

### 6.6 Mutation execution

For write commands:

```text
Slash selection
→ focused owner input
→ existing request decoder / protected command boundary
→ existing authority/policy checks
→ outcome recovery / result state
→ concise owner feedback
```

No slash-specific direct database mutation path is allowed.

### 6.7 Destructive command design

Destructive commands are discoverable but never one-step executable.

Required sequence:

```text
/select command
→ show affected resource + consequence
→ explicit confirmation
→ existing protected mutation
→ final outcome
```

Where the existing Product already has stronger approval requirements, those remain authoritative.

## 7. Localization design

The current Preferences persistence is proven to store `Korean (ko-KR)` and `Asia/Seoul (KST)` across refresh, but the owner UI remains English. This program closes that gap.

Required model:

- locale preference persists as it does now;
- UI strings use stable message keys rather than embedded owner-facing English where changed by this program;
- `ko-KR` and `en-US` are supported for the migrated owner-facing surfaces;
- missing translation fallback is deterministic;
- domain IDs, code identifiers, provider/model canonical names, and source content are not translated merely for visual consistency;
- server errors are mapped to owner-facing localized summaries where the client already has an error classification boundary; raw technical detail remains diagnostic-only.

This program does not require translating every repository document, log, test name, or internal API field.

## 8. Sectioned implementation program

---

# HFM-S0 — Baseline Freeze and KEEP/SLASH/REMOVE Inventory

## Goal

Convert the smoke-test observations and ADR-140 principles into a complete implementation inventory before UI code is removed or relocated.

## Detailed design work

1. enumerate every persistent owner-facing route, sidebar item, top-bar item, Settings category, persistent action, status block, technical disclosure, and empty-state destination;
2. assign `KEEP`, `SLASH`, `REMOVE`, or `CONDITIONAL`;
3. for every `SLASH` item, assign a replacement slash command or explicit grouped command path;
4. for every `REMOVE` item, state whether only presentation is removed or whether dead UI code can also be deleted;
5. identify safety exceptions that remain conditionally visible;
6. map each moved write control to its existing protected backend command/API;
7. identify any control that appears owner-adjustable but actually has no implemented backend capability; classify it `REMOVE`, not `SLASH`;
8. freeze the minimal persistent navigation candidate.

## Required artifacts

- inventory table in this plan or an append-only engineering evidence file;
- route/control → disposition mapping;
- slash command initial registry list;
- affected file/module map.

## Completion target

```text
100% persistent owner-facing elements classified
0 unexplained Settings destinations
0 SLASH item without replacement access path
0 REMOVE item required for immediate safety/decision
Owner approval of HFM-S0 disposition
```

No later section starts before HFM-S0 is accepted.

---

# HFM-S1 — Slash Command Foundation

## Goal

Implement the reusable slash command registry, discovery UI, and Ask-input integration without yet migrating every advanced capability.

## Detailed design

- create registry/domain types in the frontend composition layer;
- do not place domain business rules in the registry;
- integrate slash trigger into Ask draft input;
- add palette component with category grouping and search;
- add keyboard, pointer, focus, Escape, and accessibility behavior;
- ensure slash selection cannot accidentally submit as Ask text;
- expose stable command IDs separate from localized display labels;
- add context-aware availability evaluation;
- add command-result presentation primitives: navigate, focused dialog, drawer, inline status;
- make current top Commands entry either open the same registry or mark it for later removal; do not maintain two registries.

## Initial foundation commands

Read/navigation only for this section, for example:

- `/sources`
- `/history`
- `/activity`
- `/project`
- `/settings ai` or `/ai`
- `/preferences`
- `/search`
- `/help`

Exact visible Korean labels are localized; aliases may remain English.

## Completion target

```text
Typing / opens command palette
Command filtering works and is case-insensitive for Latin aliases
Keyboard + pointer selection PASS
Escape/focus behavior PASS
Normal Ask submission unaffected
Command registry is single source for slash discovery
Read/navigation commands do not bypass route/project authority
Targeted tests PASS
```

---

# HFM-S2 — Rare Owner Controls Migration to Slash

## Goal

Move legitimate but infrequently used owner controls out of permanent UI and into focused slash-command flows.

## Priority migration candidates

### Project controls

- switch project;
- create project;
- rename project;
- archive project;
- request deletion.

### Preferences

- locale;
- timezone;
- date/time format;
- screen density;
- reduce motion.

### AI configuration

- provider selection;
- model selection;
- credential setup/update;
- connection test where still useful;
- relevant privacy/eligibility explanation when blocking execution.

### Inspection

- history;
- activity;
- technical details;
- diagnostics when implemented enough to help the owner.

## Detailed design

- each command opens the smallest UI necessary for the task;
- no full Settings page is required merely to host one selector;
- mutations route through existing server command boundaries;
- success/failure feedback is concise and localized;
- dangerous actions retain confirmation;
- unsupported placeholder capabilities are not migrated as fake commands;
- command results may link to a deeper temporary view when genuinely needed.

## Completion target

```text
All HFM-S0 SLASH controls in this section reachable from /
No moved control requires the old persistent Settings path
All writes use existing protected backend boundaries
Destructive confirmation preserved
Project binding preserved
Targeted mutation/read tests PASS
```

---

# HFM-S3 — Persistent Navigation and Settings Compression

## Goal

Remove persistent destinations that exist only because the system has subsystems, not because the owner needs them continuously.

## Detailed design

### Sidebar

Retain only approved HFM-S0 `KEEP` destinations. Expected default is Home, Sources, Ask plus minimal Project context.

Hide/remove:

- unimplemented Knowledge/Review placeholders;
- External Actions empty destination when no action requires attention;
- Activity permanent navigation;
- History permanent navigation;
- permanent Settings navigation if all required controls are accessible contextually or through slash.

### Top bar

- remove duplicate Search if final search is Ask-native or `/search`;
- remove duplicate Commands button or make it an alternate trigger for the exact same slash registry, then evaluate whether it still adds value;
- keep Project context only if it prevents wrong-project action; project switching itself may be slash-driven.

### Settings

- remove Models duplicate/unimplemented surface;
- remove Costs/Budgets, Connectors, Directives, Schema Packs, Diagnostics placeholders from normal owner navigation until they represent real owner-actionable capability;
- remove `not available in this tier` wording where no real tier policy exists;
- keep no permanent advanced page merely for internal capability exposure.

## Completion target

```text
Persistent navigation contains only accepted KEEP surfaces
0 unimplemented destination shown as normal Product navigation
0 duplicate Models/AI owner path
0 fake tier placeholder page in normal navigation
All removed rare controls remain reachable through accepted SLASH path where required
```

---

# HFM-S4 — Internal Information Removal and Conditional Attention Projection

## Goal

Remove information that is useful to Shotgun internals but not useful to the owner, while preserving proactive human attention for real decisions.

## REMOVE examples

- UUIDs and revisions in normal cards;
- locators;
- command ledger wording;
- protected command boundary wording;
- server-authoritative/internal-authority exposition that does not change owner action;
- raw `UNAVAILABLE` enums;
- Job/Run/Attempt/Stage/Event terminology in normal owner views unless a diagnostic command was explicitly requested;
- duplicate status fields such as `Status: Active` + `Active: Yes`;
- development roadmap text such as `Coming later` or `not implemented in this Section`;
- technical provider-routing internals that the owner cannot/should not control.

## Conditional attention design

Introduce or reuse an owner-attention projection that shows only actionable items. Empty queues should collapse rather than consume large permanent cards.

Examples of owner-facing messages:

- `승인이 필요합니다.`
- `AI 연결을 확인해야 합니다.`
- `외부 작업 실행 전 확인이 필요합니다.`
- `작업이 실패했습니다. 다시 시도하거나 세부 정보를 확인하세요.`

Detailed technical causes are available through `/technical` or `/diagnose` when appropriate.

## Completion target

```text
0 REQUIRED internal-only field visible by default
0 development-stage wording in owner Product UI
Empty attention sections collapse/compact
Actionable safety/failure states remain visible
Technical detail still retrievable on demand where required
```

---

# HFM-S5 — Critical Functional and Information-Hierarchy Repairs

## Goal

Close the directly observed Product defects that remain important after the new interaction model is applied.

## HFM-S5.1 Search

The current global Search showed no loading, result, no-result, error, or navigation reaction for `JasonNote` and `jasonnote`.

Final design decision under this program:

- maintain one real search path;
- prefer Ask-native `/search` or integrated search over a duplicate top-level Search modal;
- case-insensitive Latin matching;
- explicit loading/result/no-result/error states;
- search scope visible in owner language;
- old dead Search entry removed once replacement is verified.

## HFM-S5.2 Locale application

- persist preference as already proven;
- bind owner UI strings to locale;
- refresh must restore the selected locale and render translated surfaces;
- no need to translate raw source content or canonical identifiers.

## HFM-S5.3 Source Detail

- eliminate vertical UUID/revision collapse;
- remove normal technical IDs instead of merely making them prettier;
- technical details available on demand;
- if extracted Claim/candidate text and Evidence text are identical, avoid duplicate default rendering;
- show human concepts such as content, evidence, source, and provenance only to the depth needed for judgment.

## HFM-S5.4 Ask Conversation

Required hierarchy:

```text
질문
→ 답변
→ 근거/인용
→ 필요한 상태/주의
→ 후속 작업
```

The Answer must not appear beneath secondary action buttons as if it were helper text.

## Completion target

```text
Search final path PASS
Case-insensitive check PASS
Loading/no-result/error contract PASS
ko-KR renders localized migrated UI after refresh
Source Detail critical layout/duplication defects closed
Ask answer hierarchy corrected
```

---

# HFM-S6 — Product Visual Normalization of Remaining KEEP Surfaces

## Goal

After removal and migration, make only the remaining surfaces coherent and efficient. This section must not re-expand the interface.

## Detailed design

- widen desktop content where useful; remove excessive unused right-side space;
- reduce oversized empty cards;
- use compact empty states;
- standardize Primary / Secondary / Disabled / Warning / Destructive / Status semantics;
- use status badges only where status helps decision-making;
- normalize spacing, form hierarchy, labels, and typography;
- use Korean owner-facing copy for migrated strings;
- remove duplicated project context;
- preserve accessibility and responsive behavior;
- do not add decorative complexity to compensate for removed information.

### Home target

Home becomes an owner action center, not an operational telemetry dashboard. Empty sections disappear or compact. Only work requiring attention and useful recent/continue context remains.

### Sources target

Prioritize intake, source identity, useful state, and opening the source. Remove implementation-oriented helper text.

### Ask target

Question/answer is visually dominant. Slash discovery should feel native to the question box rather than an admin command console.

## Completion target

```text
Remaining KEEP surfaces share one visual hierarchy
No large empty placeholder regions without user value
Buttons have consistent semantic roles
No new always-visible advanced controls introduced
Representative desktop/responsive runtime check PASS
```

---

# HFM-S7 — Targeted Runtime Regression and Owner Acceptance

## Goal

Verify the changed owner interaction model without re-running historical tests unrelated to the delta.

## Required runtime journeys

### Journey A — normal owner path

```text
launch
→ Home
→ Sources
→ open Source
→ Ask
→ receive/read Answer
```

### Journey B — slash discoverability

```text
Ask input
→ /
→ find command without memorizing exact name
→ open read command
→ return to Ask
```

### Journey C — slash write control

Use one safe representative persistent preference mutation, e.g. locale/timezone, rather than destructive project changes.

```text
/
→ preference command
→ change value
→ save through existing boundary
→ refresh
→ value and visible effect persist
```

### Journey D — search

```text
/search
→ mixed-case query
→ observable loading
→ result or explicit no-result
→ no silent click
```

### Journey E — hidden technical access

```text
normal Source/Ask surface: no raw technical clutter
→ /technical or contextual diagnostic command
→ requested details become temporarily available
```

## Verification policy

Do not rerun already-passed unrelated historical suites. Add/re-run only:

- slash registry/input tests;
- changed navigation/settings tests;
- changed localization tests;
- Search tests;
- Source Detail/Ask changed tests;
- directly affected accessibility tests;
- repository required CI automatically triggered by the implementation head.

## Completion target

```text
All required runtime journeys PASS
0 new blocker/regression in changed owner paths
0 duplicate manual CI on same exact head
Owner accepts the final interface behavior
```

---

# HFM-S8 — Governance, Merge, and Final Closure

## Goal

Turn the accepted implementation from branch evidence into canonical completed Product authority.

## Sequence

1. freeze final exact implementation head;
2. confirm targeted verification evidence;
3. confirm required CI PASS on exact head;
4. disposition every implementation-plan item as `FIXED`, `DEFERRED`, `REJECTED`, or `OUT_OF_SCOPE`;
5. create/update final implementation verification record;
6. mark PR ready only after owner approval;
7. merge to `main`;
8. confirm canonical main SHA;
9. inspect automatic post-merge main CI only; do not start duplicate CI;
10. record final completion and status authority.

## Completion target

```text
HFM-S0..S8 COMPLETE
Implementation PR MERGED
Canonical main confirmed
Post-merge CI SUCCESS
Unresolved REQUIRED functional defect: NONE
Unresolved REQUIRED HFM UI item: NONE
Status Authority: FINAL_AFTER_MERGE
```

## 9. Initial slash command catalog

This is a design catalog, not a requirement to implement unsupported backend capability.

| Stable intent | Owner label example | Risk | Initial section | Notes |
|---|---|---:|---|---|
| `help.commands` | 명령어 보기 | READ | S1 | command discoverability |
| `search.global` | 검색 | READ | S1/S5 | replaces dead duplicate Search surface |
| `project.switch` | 프로젝트 전환 | READ/WRITE context | S2 | existing project authority |
| `project.create` | 프로젝트 만들기 | WRITE | S2 | focused dialog |
| `project.rename` | 프로젝트 이름 변경 | WRITE | S2 | focused dialog |
| `project.archive` | 프로젝트 보관 | DESTRUCTIVE-like | S2 | confirmation required |
| `project.delete_request` | 프로젝트 삭제 요청 | DESTRUCTIVE | S2 | explicit existing boundary |
| `preferences.locale` | 언어 변경 | WRITE | S2/S5 | must have visible effect |
| `preferences.timezone` | 시간대 변경 | WRITE | S2 | persistence |
| `preferences.display` | 화면 표시 설정 | WRITE | S2 | density/motion if retained |
| `ai.configure` | AI 설정 | WRITE | S2 | provider/model/credential focused panel |
| `ai.test_connection` | AI 연결 확인 | READ/action | S2 | only if still owner-useful |
| `history.open` | 변경 이력 보기 | READ | S1/S2 | on demand |
| `activity.open` | 실행 상태 보기 | READ | S1/S2 | owner wording, not raw job topology |
| `technical.current` | 기술 정보 보기 | READ | S2/S4 | temporary, context-bound |
| `diagnostics.open` | 진단 보기 | READ | S2/S4 | only if useful implementation exists |
| `answer.export` | 답변 내보내기 | WRITE/file | later in scope if existing action retained | secondary Ask action candidate |
| `action.retry` | 다시 시도 | WRITE | contextual | only when retry is valid |

Unsupported placeholder features do not receive slash commands merely to preserve their names.

## 10. Risk and authority matrix

| Command class | Can be hidden from normal UI? | Confirmation | Existing authority required |
|---|---|---|---|
| read/navigation | yes | no | project/resource read scope |
| preference write | yes | normal save/result | existing settings command/API |
| provider/model credential | yes, except blocking state | explicit save/test feedback | credential/provider policy |
| project mutation | yes | according to existing mutation | project admin authority |
| destructive | command may be hidden, warning may not | mandatory | existing destructive boundary |
| approval-required action | normal entry may be hidden until relevant | mandatory existing approval | existing approval authority |
| diagnostic | yes | no | bounded technical read authority |

## 11. Explicit excluded scope

This program does **not** implement unrelated deferred capabilities merely because their old placeholder screens are being removed.

Excluded unless separately authorized:

- full Knowledge workspace feature implementation if still deferred;
- Review feature expansion beyond necessary conditional attention routing;
- Cost & Billing backend;
- Connector backend activation;
- Directives backend activation;
- Schema Pack backend implementation;
- new Diagnostics telemetry platform;
- new advanced model-routing subsystem beyond existing AI provider/model authority;
- cloud deployment / SaaS tiering;
- production hosting;
- desktop installer/wrapper;
- new Canonical semantics;
- new Claim/Fact rules;
- new external-action authority model;
- destructive test data creation only for UI verification;
- broad redesign of all internal/admin/developer tooling.

Removing an unavailable owner screen does not mean deleting the underlying future architecture contract.

## 12. File/module impact hypothesis

Exact file list is frozen in HFM-S0. Expected impact areas include:

- `apps/shotgun-web/src/routes/ask-workspace.tsx` and Ask input composition;
- global shell/navigation components;
- `apps/shotgun-web/src/section3/global-tools.tsx` or its successor;
- Settings routes/components;
- Source Detail route/components;
- Search modal/query/result implementation;
- owner-facing localization/message resources to be introduced or normalized;
- frontend route tests and component tests directly covering changed behavior;
- existing server Product APIs for preferences/project/AI configuration only where current UI integration is incomplete.

Domain modules are changed only if a concrete implementation gap prevents the required owner behavior. UI cleanup must not casually rewrite domain authority.

## 13. Testing strategy

### Required test classes

- registry deterministic filtering;
- slash trigger parsing;
- keyboard and focus behavior;
- command availability by context;
- command → existing protected action routing;
- localization selection/rendering;
- Search observable state transitions;
- conditional visibility of attention items;
- absence tests for removed persistent controls where valuable;
- Source Detail and Ask information hierarchy regressions.

### Not required by default

- new full E2E framework;
- repeating every historical Frontend phase suite;
- manual duplicate CI after the same exact head already passed;
- destructive project deletion merely to prove the button moved;
- test data creation for inactive/deferred features.

## 14. Implementation order

The order is strict because later UI deletion depends on earlier access replacement.

```text
HFM-S0  Inventory / disposition freeze
   ↓
HFM-S1  Slash foundation
   ↓
HFM-S2  Rare controls migrated to slash
   ↓
HFM-S3  Persistent navigation/settings compression
   ↓
HFM-S4  Internal information removal + conditional attention
   ↓
HFM-S5  Functional/search/locale/critical hierarchy repairs
   ↓
HFM-S6  Visual normalization of remaining surfaces
   ↓
HFM-S7  Targeted runtime owner acceptance
   ↓
HFM-S8  Governance / merge / post-merge closure
```

A later section must not be used to silently expand an earlier accepted section. If a new requirement materially changes the architecture, record an amendment and ADR impact before implementation.

## 15. Program status model

Each section uses:

```text
NOT_STARTED
IN_PROGRESS
IMPLEMENTED_PENDING_VERIFICATION
ACCEPTED
COMPLETE / FINAL_AFTER_MERGE (program final authority only after S8)
```

Section implementation may be accepted on a feature branch, but the overall program remains incomplete until S8 canonical closure.

## 16. Final Definition of Done

The implementation is complete when the owner can use Shotgun without being required to understand Shotgun internals.

A final acceptance reviewer must be able to answer YES to all of the following:

1. Does the normal screen contain only information useful to current human judgment or action?
2. Are rare but necessary controls discoverable by typing `/` without memorizing commands?
3. Are internal-only identifiers and state absent unless explicitly requested?
4. Are unimplemented/inactive Product destinations hidden rather than advertised as broken/tier-locked features?
5. Are approval, destructive, failure, privacy, permission, credential, and cost decisions still surfaced proactively when relevant?
6. Does slash execution preserve all existing authority and safety boundaries?
7. Does Search produce an observable outcome rather than silent no-op behavior?
8. Does a saved `ko-KR` preference actually affect the migrated owner UI?
9. Is the Ask answer presented immediately after the question, before secondary actions?
10. Are Source Detail evidence/technical displays understandable without redundant or vertically broken technical data?
11. Are all implementation items dispositioned with no unresolved REQUIRED item?
12. Has the accepted implementation reached canonical main with required post-merge CI success?

Only then:

```text
HFM Slash Command Product Program = COMPLETE
Status Authority = FINAL_AFTER_MERGE
```
