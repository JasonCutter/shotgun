# Knowledge Flow Baseline Structured-source Verification 260729001

## Subject

- Structured source: `docs/architecture/knowledge-flow/knowledge-flow-baseline-v1.0.json`
- Generated output: `docs/SHOTGUN_KNOWLEDGE_FLOW_BASELINE_v1.0.html`
- Generator: `scripts/render-knowledge-flow-baseline.mjs`
- Date: 2026-07-29

## Preserved content checks

| Check                                     | Result              |
| ----------------------------------------- | ------------------- |
| Phase count                               | PASS — 6            |
| Step count                                | PASS — 22           |
| Step range                                | PASS — 1 through 22 |
| Duplicate Step number                     | PASS — none         |
| Core principles                           | PASS — 4            |
| Feedback/rediscovery loops                | PASS — 2            |
| Cross-phase safeguards                    | PASS — 5            |
| Claim and Fact distinction                | PASS                |
| AI output remains Candidate               | PASS                |
| Compiled Truth remains derived Projection | PASS                |
| Provenance requirement retained           | PASS                |

## Authority conversion

Before this increment, the HTML file itself was recorded as the Canonical source with structured-source normalization pending.

After this increment:

- the JSON file is the Canonical source;
- the HTML file is a versioned Generated presentation;
- the Renderer deterministically embeds the complete structured source;
- CI checks committed HTML equality with `npm run docs:knowledge-flow:check`;
- direct HTML edits fail the generated-output check.

## Semantic decision

The architecture meaning is preserved. Presentation and implementation details of the old hand-authored HTML are not treated as Canonical architecture. The regenerated page preserves the full Phase/Step descriptions, routes, principles and safeguards in a simpler responsive presentation.

## Verification state

- Local structure extraction and Renderer generation: PASS
- Exact committed generated-output check: pending GitHub Actions on the final PR Head
- Documentation governance, Quality, Frontend and Required Gates: pending GitHub Actions

## Claim supported

The Knowledge Flow baseline no longer depends on hand-edited HTML as its authority. It has a machine-readable Canonical source, deterministic versioned HTML output and a CI drift check.
