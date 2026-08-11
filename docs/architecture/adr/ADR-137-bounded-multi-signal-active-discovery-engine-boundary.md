# ADR-137 — Bounded Multi-Signal Active Discovery Engine Boundary

- Status: **PROPOSED**
- Proposed at: 2026-08-11
- Decision owner: `USER`
- Work item: `AKP-3 — Active Discovery Engine`
- Subject base: `main@f08ae632220ac613ae0e90c04930ceb323aac40b`
- Related ADRs: ADR-084, ADR-089, ADR-090, ADR-098, ADR-133, ADR-135, ADR-136
- Product implementation: **NOT_AUTHORIZED**

## Context

Current Stage 10 Discovery is bounded and safe but intentionally narrow: it reads the Compiled Truth graph, finds Entity nodes with no approved edge, and emits a deterministic Knowledge Gap question. This proves the basic derived-inference/suppression contract but does not implement Step 17's relationship, pattern, evidence-gap, question or Action discovery.

AKP requires broader discovery without converting the system into an unbounded autonomous agent or allowing an LLM to read/write the entire knowledge store without deterministic controls.

## Decision

### 1. Discovery engine uses typed signal ports

The engine reads approved/project-authorized state through bounded Ports rather than direct database access:

- `CompiledTruthSignalPort`
- `HybridRetrievalSignalPort`
- `GraphSignalPort`
- `TemporalConflictSignalPort`
- `EvidenceCoverageSignalPort`

Each read is bound to project, access scope, sensitivity, source projection/canonical version and an explicit budget.

### 2. Deterministic and AI-assisted strategies coexist

The engine owns a registry of versioned strategies. Strategies declare their supported finding types, required signals, maximum work budget and whether external AI is optional/required.

Examples for v1:

- disconnected/under-connected approved Entity -> deterministic Knowledge Gap;
- weak/missing Evidence coverage -> deterministic Evidence Gap;
- semantic neighbor + graph absence -> bounded Relation Hypothesis candidate set;
- bounded semantic/temporal/graph neighborhood -> Pattern Hypothesis candidate set;
- accepted gap/hypothesis context -> Clarification Question or Action Suggestion.

Generation method is preserved as `DETERMINISTIC`, `AI_ASSISTED` or `HYBRID` under ADR-136.

### 3. AI does not own candidate-space expansion

The deterministic system selects the bounded candidate neighborhood before an AI call. The system never sends the entire knowledge store to a model and asks it to freely discover everything.

A typical relation flow is:

```text
Authorized semantic neighbors
+ graph topology absence
+ temporal compatibility
-> bounded endpoint pairs
-> optional AI relation classification/explanation
-> deterministic schema/identity/evidence checks
-> DiscoveryFindingEnvelope
```

### 4. Discovery model profile

Define a revisioned `DiscoveryModelProfile` independent from the active Ask model and the SemanticEmbeddingProfile. It references a Server-registered model/capability and resolves execution through ADR-133 authority when external AI is used.

Every AI-assisted finding persists effective provider/model/configuration/credential/policy/prompt/schema revisions sufficient for audit/reproduction without storing secrets.

### 5. Quality gates before persistence

A proposed finding is rejected/suppressed before durable publication if required typed resources do not exist, the finding crosses an unauthorized scope, a relation already exists canonically, the proposal self-references invalidly, required evidence/provenance is absent, the fingerprint is an exact duplicate, or schema/temporal constraints fail.

A Knowledge/Evidence Gap may intentionally describe missing evidence; that absence is itself explicit provenance and is not silently treated as positive support.

### 6. Bounded ranking dimensions

Discovery priority remains a vector of explainable dimensions such as:

- novelty;
- user/project relevance from explicit policy;
- evidence coverage;
- impact/reach;
- temporal urgency;
- redundancy penalty;
- cost/risk penalty.

No composite is named Truth Probability. The final prioritization policy is versioned and AKP-7 may adapt non-epistemic weights from explicit feedback.

### 7. Work budgets

Every run enforces bounded limits beyond the current maxNodes/maxSuggestions:

- nodes/resources scanned;
- semantic neighbors per resource;
- candidate pairs/groups;
- findings emitted;
- provider calls;
- input/output tokens where applicable;
- estimated cost;
- wall-clock deadline;
- concurrency.

Budget exhaustion produces a typed partial/truncated result, not silent incompleteness.

### 8. Pattern scope for v1

V1 Pattern Discovery is limited to explainable bounded cluster/trend/recurring-association hypotheses built from typed neighborhoods and temporal/graph/retrieval signals. It does not require unsupervised model training, vector clustering over an unlimited corpus or arbitrary iterative autonomous research.

### 9. Challenger is optional, provenance-ready

Important findings may later use an independent-provider challenger as allowed by the canonical ADD. V1 does not make a second-provider call a universal completion requirement. The finding/provenance model must support recording a challenger assessment without treating model majority as truth.

## Consequences

- Discovery becomes materially more active while preserving deterministic scope and cost control.
- AI can classify/explain bounded candidates rather than owning the search universe.
- The engine can continue deterministic strategies when external AI is unavailable.
- More explicit budgets and partial-completeness states are required.

## Rejected alternatives

- LLM receives the whole project and recursively searches until it decides to stop.
- All-pairs vector comparisons over every knowledge item.
- Automatic Canonical edge creation from high semantic similarity.
- A single opaque model score controlling truth, ranking and approval.
- Mandatory multi-provider challenger for every finding.
- ML/fine-tuning as a prerequisite for v1.