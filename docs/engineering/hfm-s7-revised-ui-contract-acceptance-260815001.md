# HFM-S7 Revised UI Contract Acceptance — 260815001

- **Record:** HFM-S7-C0
- **Status:** COMPLETE / OWNER_APPROVED / FROZEN
- **Owner approval date:** 2026-08-15
- **Subject exact head:** `c7d7133cf205350b357ffc2866dfb669e39ff851`
- **Draft PR:** #118
- **Scope:** Shotgun PC Owner UI architecture and documentation governance only
- **Governing ADR:** [ADR-146 — PC Global Conversation Shell and GUI/Slash Dual-Control](../architecture/adr/ADR-146-pc-global-conversation-shell-and-gui-slash-dual-control.md)

## Acceptance statement

> **S7-C0 acceptance authorizes architecture/documentation closure only. S7-C1 Product implementation requires a separate GPT-issued request.**

The owner approved and froze the revised Shotgun PC Owner UI contract on 2026-08-15. This record closes HFM-S7-C0 architecture and documentation governance for the subject exact head. It does not start Product implementation, change runtime behavior, modify frontend components or CSS, alter APIs, database, migrations, dependencies, package files, provider routing, source backend classification, or test behavior.

## Frozen architecture summary

| Contract area          | Accepted and frozen decision                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Product scope          | **PC-only**; phone, tablet, touch-first, and mobile navigation are excluded.                                                                    |
| Interaction model      | **GUI + Slash dual-control**. GUI and slash/Ctrl/Cmd+K are different discovery paths over the same underlying actions and authority boundaries. |
| Global shell           | Persistent Instrument Panel / Tree Navigation / Center Workspace / Conversation Pane / Global Composer.                                         |
| Geometry               | Instrument Panel **64px**; Tree Navigation **240px**; Conversation Pane **420px**; Center uses remaining fluid width.                           |
| Natural-language entry | Global Composer is persistent on all PC routes and is the single normal question entry point.                                                   |
| Ask authority          | Verified Knowledge, or existing equivalent question-mode authority, remains semantically unchanged and becomes a compact Composer mode control. |
| Architecture authority | ADR-146 supersedes ADR-145 without erasing ADR-145’s accepted historical record.                                                                |

## Frozen PC shell responsibilities

| Region                       | Owner-facing responsibility                                                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top Instrument Panel         | Shotgun identity, current Project, Workspace breadcrumb, effective AI provider/model and connection state, Source count, and valid conditional attention counts. |
| Left Tree Navigation         | Choosing the current work area, function, object, or context.                                                                                                    |
| Center Interaction Workspace | Performing work with functions, objects, settings, commands, evidence, proposals, editors, and details.                                                          |
| Right Conversation Pane      | User questions, Shotgun answers, citations, conversation history, and progress/success/failure state.                                                            |
| Bottom Global Composer       | Common natural-language question entry and shared owner-command discovery.                                                                                       |

Normal zero-count attention states are omitted. Instrument Panel routing is Project to Project switcher, AI state to **Settings > AI**, Sources count to **Sources > Library**, and actionable Review/External Action counts to their corresponding Center Workspace. The shell does not expose UUIDs, revisions, request IDs, run IDs, or internal technical counters.

## Exact frozen Tree taxonomy

```text
Home
├─ Sources
│  ├─ Library
│  └─ Add Source
│     [dynamic selected Source context]
│     ├─ Preview
│     ├─ Evidence
│     └─ Versions
│
├─ Ask
│  └─ Conversations
│
├─ Search
│
├─ Knowledge
│  [ONLY when actual route/authority is available]
│
├─ Operations
│  ├─ Review
│  │  [ONLY when actual route/authority is available]
│  ├─ External Actions
│  ├─ Activity
│  │  [only when actually available]
│  └─ History
│     [only when actually available]
│
└─ Settings
   ├─ AI
   ├─ Privacy
   ├─ Preferences
   └─ Project
```

Sources-scoped Search remains a Sources Library toolbar/filter rather than a Tree leaf. Object-specific actions such as Export, Retry, Delete, and Answer-derived Proposal remain contextual and may also be reached through slash.

## Conversation, command, and workspace contract

Normal Composer text submits an Ask question under current Project authority. `/` opens shared owner-command discovery; `Ctrl/Cmd+K` opens the same command registry and discovery. Command execution is not recorded in Conversation as though it were a natural-language user question. The existing large Ask question form is not retained as a second general composer.

The Center owns selected-function interaction, Source Library and Add Source, Source Preview/Evidence/Versions, Search results and details, Settings, command work surfaces, Answer-derived proposals/drafts, and available Review/External Action details. The Right Pane retains question-and-answer prose, citations, source affordances, and the original conversation when an answer-derived action routes an object to Center.

## Sources and Settings decisions

Sources defaults to Library; Add Source is an independent Center Workspace. Source rows are clear selectable targets with keyboard accessibility and visible focus. Preview, Evidence, and Versions are separate interaction modes. Owner-facing Source public/private selection and repeated public/private metadata are removed from Owner UI only. Existing backend classification/security fields, safe defaults, and authority invariants remain intact.

Settings > AI contains Provider, Model, credential state, write-only replacement input, Connection Test, and Save. Connection Test uses the current selected provider, current selected model, and that provider’s effective saved credential only; it neither demands nor tests unrelated provider credentials or fallback. Stored secret material is never redisplayed.

Settings > Privacy is an inspectable provider/privacy review workflow. Settings > Project assigns Project switching to the Instrument Panel and Project create, rename, archive, restore, and delete-request to Center Project Management. Only truly destructive, final, or authority-sensitive actions retain explicit confirmation dialogs.

## Knowledge and Review availability policy

Knowledge and Review workspaces are not created by this UI correction. Until actual route and authority availability exist, neither Knowledge nor Review appears as a normal clickable Tree destination, and neither `knowledge.open` nor `review.open` appears as normally available slash discovery. Command availability projection and actual route authority must agree. Runtime correction is deferred to S7-C6.

## Frozen visual system

| Token                       | Value     |
| --------------------------- | --------- |
| App Background              | `#F4F6F8` |
| Primary Surface             | `#FFFFFF` |
| Secondary Surface           | `#EEF2F5` |
| Primary Text                | `#17212B` |
| Secondary Text              | `#5D6875` |
| Border                      | `#D7DEE6` |
| Navigation / Brand Graphite | `#1B222A` |
| Interactive Steel Blue      | `#356FC3` |
| Selected Background         | `#E8F0FB` |
| Success / Connected         | `#2E7D5B` |
| Attention                   | `#A86B16` |
| Error / Destructive         | `#B83B3B` |

Green is success/connected only, red is error/destructive only, and normal interaction/navigation uses Graphite, Steel Blue, and neutral surfaces. State is never conveyed by color alone. Restrained glass is limited to eligible shell/command surfaces and is prohibited for Answer prose, Source Preview reading body, Evidence text, warnings/errors/destructive surfaces, and form inputs.

## Modal policy

Modals are reserved for final confirmation: delete request, irreversible/destructive action, and final authority-sensitive approval where an existing domain contract requires it. Project Management, Project Rename, AI Configuration, command discovery, and non-destructive proposal initiation are Center Workspace activity rather than long-lived modal workflows.

## Preserved invariants

The frozen interaction architecture preserves Project binding; protected API boundaries; access/security/privacy authority; revision correctness; idempotency; outcome recovery; Ask persistence semantics; citation/evidence authority; destructive confirmation; credential-secret non-disclosure; AI provider routing authority; Canonical approval flow; the requirement that AI output remains a candidate until approved; Claim/Fact separation; and Compiled Truth as a derived projection from Canonical records.

## Implementation authorization boundary

The S7 correction slices remain **C1 through C8**. Product implementation has **NOT started** under this request. Specifically, this record does not authorize implementation of Global Composer, Tree Navigation, Instrument Panel, UI runtime correction for Knowledge/Review, frontend component or CSS changes, APIs, database/schema/migration changes, provider routing changes, backend source classification changes, dependencies, package files, broad tests, PR Ready, merge, or S7-C1.
