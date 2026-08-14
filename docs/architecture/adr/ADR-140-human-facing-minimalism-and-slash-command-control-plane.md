# ADR-140 — Human-Facing Minimalism and Slash Command Control Plane

- Status: ACCEPTED
- Date: 2026-08-14
- Accepted by owner: 2026-08-14
- Subject base: `main@575b8031b3beccc9fba5541809285c5a29b89d11`
- Scope: Shotgun Product UI / owner interaction boundary

## Context

2026-08-14 local Product smoke testing confirmed that Shotgun can expose materially more information and controls than the owner needs for ordinary use. Examples include internal identifiers, revisions, locators, implementation-state wording, backend availability codes, routing details, operational lineage terms, duplicate status fields, inactive feature surfaces, and configuration pages that are rarely needed.

The owner explicitly requires a different interaction model:

1. information that does not help a human make a decision must not occupy the normal UI;
2. controls that the human does not normally need to adjust must not remain permanently visible;
3. rare but necessary controls must remain reachable through a `/` command layer from the Ask input;
4. risk, approval, failure, cost, permission, or destructive-state information that requires immediate human attention must never be hidden behind slash commands;
5. the slash command layer must not bypass existing domain authority, approval, policy, or protected command boundaries.

## Decision

Shotgun adopts **Human-Facing Minimalism** as the default Product UI rule and introduces a **Slash Command Control Plane** as the secondary owner interaction layer.

Every owner-facing field, button, menu, setting, status, and page MUST be classified as one of:

- `KEEP`: frequently needed, decision-critical, or required for the current task; remains visible.
- `SLASH`: rarely needed but legitimate owner control or inspection capability; removed from persistent navigation and made discoverable through `/` commands.
- `REMOVE`: internal-only, non-actionable, redundant, or not useful to human judgment; removed from owner-facing Product UI.

The default owner UI is therefore not a complete mirror of system capability. It is a task-oriented projection over system capability.

## Slash command interaction contract

- Typing `/` at the beginning of the Ask input opens a searchable command palette.
- The user is not required to memorize command names.
- Commands are filtered by label, aliases, category, and natural-language keywords.
- Keyboard navigation and pointer selection are both supported.
- A selected command may:
  - navigate to an existing owner surface;
  - open a temporary focused panel/dialog;
  - invoke an existing protected mutation path;
  - show bounded technical diagnostics;
  - request a destructive action only through the existing confirmation/approval boundary.
- Slash execution never writes directly to persistence when an existing domain command boundary exists.
- Existing policy, approval, project binding, authorization, and idempotency contracts remain authoritative.

## Conditional visibility rule

The UI MAY surface normally hidden capabilities when they become actionable. Examples:

- pending approval;
- external action requiring confirmation;
- failed job requiring owner intervention;
- deletion/archive confirmation;
- credential failure;
- budget/cost threshold breach;
- privacy or permission conflict.

When the condition is resolved, the persistent visual surface should disappear again unless it has independent ongoing value.

## Initial persistent navigation intent

The target persistent navigation is intentionally small. As a starting contract, only high-frequency owner workspaces should remain persistent, such as:

- Home / action summary;
- Sources;
- Ask.

Other areas such as History, Activity, Project Administration, Preferences, AI configuration, diagnostics, and technical details are candidates for `SLASH` unless a later section proves they meet `KEEP` criteria. Unimplemented or non-actionable features are hidden rather than shown as disabled Product destinations.

## Technical-information rule

Raw system identifiers and internal state are not owner UI by default. UUIDs, revision IDs, locators, command-ledger terminology, routing internals, backend availability enums, internal job lineage, and similar data may remain in logs, APIs, persistence, tests, or diagnostic projections, but are shown to the owner only when a concrete troubleshooting or audit task requires them.

## Search and command relationship

Global Search and Commands must not remain two unrelated command surfaces if they duplicate purpose. Search may be exposed as `/search` or as an Ask-native search affordance. The current top-level Commands surface is expected to be removed or reduced to an alternate entry point into the same slash registry.

## Safety exceptions

The following MUST remain proactively visible when relevant and MUST NOT require the owner to know a slash command:

- approval required before Canonical commit;
- destructive action confirmation;
- external transfer/privacy conflict;
- credential or provider failure blocking the requested action;
- cost/budget condition that changes whether the action can proceed;
- failed operation requiring owner action;
- data-loss or recovery warning.

## Consequences

Positive:

- lower visual noise and lower cognitive load;
- fewer misleading inactive settings and prototype/admin surfaces;
- advanced capabilities remain available without permanent screen cost;
- one discoverable command registry can replace multiple duplicate navigation surfaces;
- owner attention is reserved for decisions rather than implementation telemetry.

Costs:

- command registry, discoverability, context binding, and focused action panels must be implemented carefully;
- hidden capabilities require strong slash search/alias coverage;
- tests must verify that rare controls remain reachable after persistent UI removal;
- accessibility and keyboard behavior become part of the command layer contract.

## Rejected alternatives

### Keep all Settings and add better styling
Rejected. It improves presentation but preserves unnecessary cognitive load.

### Hide all advanced functions without replacement
Rejected. Rare but necessary owner control would become inaccessible.

### Build a completely command-only Product
Rejected. High-frequency tasks and attention-critical states benefit from persistent visual affordances.

### Create a separate Advanced Settings mega-page
Rejected as the default. It moves clutter rather than eliminating it and duplicates the intended slash control plane.

## Compatibility boundary

This ADR changes the owner-facing interaction projection, not Canonical truth semantics. It does not alter Claim/Fact separation, approval authority, Compiled Truth derivation, external action safety, project authority, protected command semantics, or persistence ownership.
