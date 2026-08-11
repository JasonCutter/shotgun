# ADR-137 — Bounded Multi-Signal Active Discovery Engine Boundary

- Status: **PROPOSED**
- Proposed at: 2026-08-11
- Decision owner: `USER`
- Work item: `AKP-3 — Active Discovery Engine`
- Subject base: `main@f08ae632220ac613ae0e90c04930ceb323aac40b`
- Related ADRs: ADR-084, ADR-089, ADR-090, ADR-098, ADR-133, ADR-135, ADR-136
- Product implementation: **NOT_AUTHORIZED**

## Context

Current Stage 10 Discovery is bounded and safe but intentionally narrow: it reads the Compiled Truth graph, finds Entity nodes with no approved edge, and emits a deterministic Knowledge Gap question. This proves the basic derived-inference/suppression contract but does not implement Step 17's relationship, pattern, conflict, evidence-gap, question or Action discovery.

AKP requires broader discovery without converting the system into an unbounded autonomous agent or allowing an LLM to read/write the entire knowledge store without deterministic controls.

## Decision

### 1. Discovery engine uses typed signal ports

The engine reads approved/project-authorized state through bounded Ports rather than direct database access:

- `CompiledTruthSignalPort`
- `HybridRetrievalSignalPort`
- `GraphSignalPort`
- `TemporalConflictSignalPort`
- `EvidenceCoverageSignalPort`

Each read is bound to project, access scope, sensitivity, source projection/canonical version and an explicit budget. Multi-resource derivation uses ADR-136's restrictive common-scope / highest-sensitivity composition before persistence or AI egress.

### 2. Deterministic and AI-assisted strategies coexist

The engine owns a registry of versioned strategies. Strategies declare their supported finding types, required signals, maximum work budget and whether external AI is optional/required.

Examples for v1:

- disconnected/under-connected approved Entity -> deterministic Knowledge Gap;
- weak/missing Evidence coverage -> deterministic Evidence Gap;
- semantic neighbor + graph absence -> bounded Relation Hypothesis candidate set;
- bounded semantic/temporal/graph neighborhood -> Pattern Hypothesis candidate set;
- competing current propositions/relations with incompatible values or temporal claims -> bounded Conflict Hypothesis candidate set;
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

A typical conflict flow similarly starts from bounded competing propositions/resources selected by deterministic semantic/typed/temporal rules. AI may explain/classify a possible contradiction but cannot declare a Canonical Conflict by itself.

### 4. Discovery model profile

Define a revisioned `DiscoveryModelProfile` independent from the active Ask model and the SemanticEmbeddingProfile. It references a Server-registered model/capability and resolves execution through ADR-133 authority when external AI is used.

Every AI-assisted finding persists effective provider/model/configuration/credential/policy/prompt/schema revisions sufficient for audit/reproduction without storing secrets.

### 5. Knowledge content is data, never instructions

Approved knowledge can still contain adversarial or instruction-like text. AI-assisted Discovery therefore sends bounded structured data envelopes with explicit instruction/data separation. Knowledge content cannot override system, provider, privacy, access, budget or schema policy.

Discovery model calls have **no external Action/tool execution authority**. Structured model output is treated as untrusted candidate data and passes deterministic decoding/schema/security/identity/evidence gates before persistence. Prompt-injection-like content cannot cause tools, external Actions, credential access or policy changes.

### 6. Quality gates before persistence

A proposed finding is rejected/suppressed before durable publication if required typed resources do not exist, the finding crosses an unauthorized scope, an equivalent relation/conflict/finding already exists canonically, the proposal self-references invalidly, required evidence/provenance is absent, the fingerprint is an exact duplicate, or schema/temporal constraints fail.

A Knowledge/Evidence Gap may intentionally describe missing evidence; that absence is itself explicit provenance and is not silently treated as positive support.

### 7. Bounded ranking dimensions

Discovery priority remains a vector of explainable dimensions such as novelty, explicit user/project relevance, evidence coverage, impact/reach, temporal urgency, redundancy penalty and cost/risk penalty.

No composite is named Truth Probability. The final prioritization policy is versioned and AKP-7 may adapt non-epistemic weights from explicit feedback.

### 8. Work budgets

Every run enforces bounded limits beyond the current maxNodes/maxSuggestions: resources scanned, semantic neighbors, candidate pairs/groups, findings emitted, provider calls, input/output tokens, estimated cost, wall-clock deadline and concurrency.

Budget exhaustion produces a typed partial/truncated result, not silent incompleteness.

### 9. Pattern scope for v1

V1 Pattern Discovery is limited to explainable bounded cluster/trend/recurring-association/temporal-change hypotheses built from typed neighborhoods and temporal/graph/retrieval signals. It does not require unsupervised model training, vector clustering over an unlimited corpus or arbitrary iterative autonomous research.

### 10. Challenger is optional, provenance-ready

Important findings may later use an independent-provider challenger as allowed by the canonical ADD. V1 does not make a second-provider call a universal completion requirement. The finding/provenance model must support recording a challenger assessment without treating model majority as truth.

## Consequences

- Discovery becomes materially more active while preserving deterministic scope and cost control.
- AI can classify/explain bounded candidates rather than owning the search universe.
- Potential contradictions have an explicit discovery strategy without becoming Canonical Conflict prematurely.
- AI-assisted Discovery remains tool-less and resistant to content-driven policy override.
- The engine can continue deterministic strategies when external AI is unavailable.

## Rejected alternatives

- LLM receives the whole project and recursively searches until it decides to stop.
- All-pairs vector comparisons over every knowledge item.
- Automatic Canonical edge/conflict creation from high semantic/model similarity.
- Treat knowledge text as executable model instructions or permit Discovery model tool execution.
- A single opaque model score controlling truth, ranking and approval.
- Mandatory multi-provider challenger for every finding.
- ML/fine-tuning as a prerequisite for v1.