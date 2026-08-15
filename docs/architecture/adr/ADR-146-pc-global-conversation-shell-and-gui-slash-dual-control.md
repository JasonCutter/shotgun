# ADR-146 — PC Global Conversation Shell and GUI/Slash Dual-Control

- **Status:** ACCEPTED
- **Date:** 2026-08-15
- **Accepted by owner:** 2026-08-15
- **Subject exact head:** `c7d7133cf205350b357ffc2866dfb669e39ff851`
- **Scope:** Shotgun PC Owner UI / Global Shell / Navigation / Conversation / Command boundary
- **Supersedes:** [ADR-145 — Human-Facing Minimalism and Slash Command Control Plane](ADR-145-human-facing-minimalism-and-slash-command-control-plane.md)

## Context

ADR-145 established **Human-Facing Minimalism** for Shotgun’s owner-facing Product UI. It retained high-frequency work in minimal persistent navigation, directed rare but legitimate owner controls principally to the slash-command plane entered from Ask, required attention-critical and destructive states to remain proactive, and prohibited slash from bypassing existing domain authority.

HFM-S7 runtime owner review established that slash-only discovery for legitimate owner controls is insufficient for the actual PC Product. An owner who does not already know command names must be able to discover and use major Shotgun Product capabilities through the GUI. The owner approved a replacement interaction architecture on 2026-08-15.

This ADR is an architecture and documentation governance decision only. It records the frozen S7-C0 Product interaction contract; it does **not** authorize or implement Product runtime changes.

## Decision

### Relationship to ADR-145

ADR-146 **supersedes ADR-145** as the governing owner-facing Product interaction architecture. ADR-145 remains an accepted historical predecessor. Its original date, accepted-by-owner record, context, decision text, rejected alternatives, consequences, and compatibility history remain preserved; its historical decision body is not rewritten by this decision.

The following ADR-145 principles remain binding:

- **Human-Facing Minimalism** remains the default owner UI rule.
- Actionable states remain conditionally and proactively visible when relevant.
- Safety exceptions, including approval blockers, destructive confirmation, privacy conflicts, provider or credential failures, recovery conditions, and similar actionable states, remain visible without command discovery.
- Slash and command registry protection remain required.
- Slash and GUI never bypass domain authority, policy, approval, protected command boundaries, project binding, authorization, or idempotency.
- Raw technical information remains hidden by default; UUIDs, revisions, request IDs, run IDs, internal technical counters, and equivalent implementation telemetry are not normal owner UI.

The following ADR-145 interaction choices are replaced:

- Slash-only discoverability for rare legitimate owner controls is replaced by **GUI + Slash dual-control**.
- Ask-only slash entry is replaced by a **Global Composer** and the same command discovery through **Ctrl/Cmd+K**.
- Flat Home / Sources / Ask persistent navigation is replaced by hierarchical **Tree Navigation**.
- The PC Product receives a persistent top / left / center / right / bottom global shell.
- Normal configuration and management move to the Center Workspace rather than long-lived modal surfaces.

### PC-only Product scope and dual-control

Shotgun Owner UI is **PC-only**. Phone UX, tablet UX, and touch-first or mobile navigation are outside this frozen Product contract.

The GUI and slash command plane are two discovery and acceleration paths over the **same underlying actions**. A user who does not know slash commands must still be able to use the major Shotgun Product capabilities through GUI navigation. Slash and Ctrl/Cmd+K are accelerators over the shared command registry; they must never create a separate authority or mutation path.

Unavailable capabilities must not appear as normal usable GUI or slash destinations. Command availability projection and actual route authority must agree.

### Frozen PC global shell

| Shell region | Baseline | Responsibility |
| --- | ---: | --- |
| Instrument Panel | 64px height | Project, location, operational status, and concise status routing. |
| Left Tree Navigation | 240px width | Selecting the work area, object, or function. |
| Center Interaction Workspace | Remaining fluid width | Interaction with selected functions, objects, settings, commands, evidence, and proposals. |
| Right Conversation Pane | 420px width | Questions, answers, citations, progress, and conversation history. |
| Global Composer | Persistent on all PC routes | Normal natural-language questions and shared owner-command entry. |

#### Instrument Panel

The 64px Instrument Panel persistently contains Shotgun identity/logo, the current Project selector, current Workspace breadcrumb, effective AI provider/model and connection state, and Source count. Knowledge/Canonical count appears only when its meaning and available destination are valid. Review pending count appears only when it is greater than zero and Review is actually available. External Action pending count appears only when it is greater than zero. Normal zero-count attention states are omitted.

| Instrument Panel item | Routing rule |
| --- | --- |
| Project | Opens the Project switcher. |
| AI state | Routes to **Settings > AI**. |
| Sources count | Routes to **Sources > Library**. |
| Actionable Review or External Action count | Routes to the corresponding Center Workspace. |

The Instrument Panel does not expose UUIDs, revisions, request IDs, run IDs, or internal technical counters.

#### Left Tree Navigation

The frozen 240px Tree taxonomy is:

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

Sources-scoped Search remains a Library toolbar/filter rather than a separate Sources Search leaf. Object-specific actions, including Export, Retry, Delete, and Answer-derived Proposal, are contextual actions and may also be invoked through slash; they are not copied wholesale into the Tree.

#### Center Interaction Workspace

The Center uses the remaining fluid width. It owns Sources Library and Add Source; Source Preview, Evidence, and Versions; Search results and details; Settings; command discovery and command work surfaces; Answer-derived proposals and drafts; Review and External Action details when available; and other object editors and details.

The Center does not duplicate question-and-answer prose that belongs in the Conversation Pane. Long-lived workspaces are not modal dialogs.

#### Right Conversation Pane

The 420px Right Conversation Pane owns user questions, Shotgun answers, current conversation and history, progress/success/failure state, citations/evidence/source affordances, and compact Answer context actions. Citation, evidence, and source selection route the relevant material to the Center. Answer-derived proposal, change, and intake actions route the resulting object to the Center while preserving the original conversation in the Right Pane.

#### Global Composer and Ask mode

The Global Composer is persistent on all PC routes and is the single normal natural-language question entry point.

| Input or control | Frozen behavior |
| --- | --- |
| Normal text | Submits an Ask question under current Project authority. |
| `/` | Opens shared owner-command discovery. |
| `Ctrl/Cmd+K` | Opens the same command registry and discovery. |
| Command execution | Is not added to Conversation as though it were a user question. |

The existing large Ask question form is not retained as a second general composer. The existing **Verified Knowledge**, or equivalent question-mode authority, is preserved as a compact Composer mode control. This ADR does not change its backend, default, or authority semantics.

### Sources contract

Sources defaults to **Library**. **Add Source** is an independent Center Workspace. A Source row becomes a clear selectable target while preserving keyboard accessibility and visible focus. Preview, Evidence, and Versions are separate interaction modes. Where practical, page-position prose such as large “Source Detail,” “Back to Library,” and redundant breadcrumb-like labels is replaced by Tree and Instrument Panel context.

Owner-facing Source public/private selection and repeated public/private metadata are removed from the Owner UI. This UI decision does **not** delete or relax backend classification or security fields; safe defaults and authority invariants remain preserved.

### Settings contract

**Settings > AI** contains Provider, Model, credential state, a write-only replacement input, Connection Test, and Save. Connection Test operates on the current selected provider, current selected model, and that provider’s effective saved credential. It must not arbitrarily require or test an unrelated provider credential or fallback. Stored secret material is never redisplayed.

**Settings > Privacy** becomes an inspectable provider/privacy review workflow. Request and Approve are not represented solely by recoloring or relabeling the same unexplained button; the user can understand what is approved and its effect.

**Settings > Project** separates responsibilities: Project switching belongs in the Instrument Panel, while Project create, rename, archive, restore, and delete-request belong in Center Project Management.

### Knowledge and Review availability policy

S7 runtime reproduced that `knowledge.open` and `review.open` navigate to workspaces currently unavailable in this Section. This ADR does not build new Knowledge or Review Product workspaces merely to satisfy this UI correction.

Until actual route and authority availability exist, Knowledge and Review are not exposed as normal clickable Tree destinations, and `knowledge.open` and `review.open` are not exposed as normally available slash-discovery commands. The implementation correction belongs to S7-C6, not to this architecture record.

### Visual system freeze

| Token | Approved value |
| --- | --- |
| App Background | `#F4F6F8` |
| Primary Surface | `#FFFFFF` |
| Secondary Surface | `#EEF2F5` |
| Primary Text | `#17212B` |
| Secondary Text | `#5D6875` |
| Border | `#D7DEE6` |
| Navigation / Brand Graphite | `#1B222A` |
| Interactive Steel Blue | `#356FC3` |
| Selected Background | `#E8F0FB` |
| Success / Connected | `#2E7D5B` |
| Attention | `#A86B16` |
| Error / Destructive | `#B83B3B` |

Green is semantic success/connected only, not normal Shotgun identity or navigation color. Red is error/destructive only. Normal interaction and navigation use Graphite, Steel Blue, and neutral surfaces. State is never conveyed by color alone.

Restrained glass is allowed only on limited shell and command surfaces. Answer prose, Source Preview reading body, Evidence text, warning/error/destructive surfaces, and form inputs are not glass surfaces.

### Modal policy

A modal is for final confirmation, not normal workspace activity. Explicit confirmation remains for delete request, irreversible or destructive action, and final authority-sensitive approval where the existing domain contract requires it.

Normal configuration, management, and discovery move to the Center Workspace, including Project Management, Project Rename, AI Configuration, command discovery, and non-destructive proposal initiation.

### Preserved invariants

ADR-146 changes owner-facing interaction architecture only. It preserves Project binding; protected API boundaries; access, security, and privacy authority; revision correctness; idempotency; outcome recovery; Ask persistence semantics; citation/evidence authority; destructive confirmation; credential secret non-disclosure; AI provider routing authority; Canonical approval flow; the rule that AI output remains a candidate until approved; Claim/Fact separation; and the rule that Compiled Truth is derived from Canonical records.

## Consequences

The PC Product gains a discoverable hierarchy without returning to dashboard clutter or permanently exposing every control. GUI navigation and slash commands remain a single Product authority model, while the Global Composer makes questions and commands consistently available across PC work.

S7-C0 closes architecture and documentation governance only. Product implementation remains separately authorized through S7 correction slices C1 through C8. This ADR does not implement Global Composer, Tree Navigation, Instrument Panel, route availability correction, provider routing changes, Source backend classification changes, database changes, dependencies, CSS changes, or other runtime behavior.

## Rejected alternatives

### Retain slash-only discovery for rare owner controls

Rejected. Runtime owner review demonstrated that legitimate Product capability must be discoverable by users who do not know slash commands.

### Return to a broad persistent dashboard

Rejected. It would reverse Human-Facing Minimalism and permanently expose controls that do not support the current task.

### Make command-only interaction the Product architecture

Rejected. GUI discovery remains necessary for major Product capabilities on PC.

### Build mobile or touch-first navigation into this contract

Rejected. The approved Product scope is explicitly PC-only.

### Keep normal configuration and management in long-lived modals

Rejected. Center Workspace is the durable location for normal work; modals remain reserved for final confirmation.
