# Shotgun Knowledge Flow Documents

## Canonical source boundary

- Knowledge Flow baseline structured source: [`knowledge-flow-baseline-v1.0.json`](knowledge-flow-baseline-v1.0.json)
- Generated interactive HTML: [`../../SHOTGUN_KNOWLEDGE_FLOW_BASELINE_v1.0.html`](../../SHOTGUN_KNOWLEDGE_FLOW_BASELINE_v1.0.html)
- Detailed Map v0.3: [`shotgun-knowledge-flow-detailed-map.md`](shotgun-knowledge-flow-detailed-map.md)

The JSON file is the Canonical structured source for baseline v1.0. The HTML is a versioned Generated presentation and must not be edited independently.

## Regeneration

```bash
npm run docs:knowledge-flow:render
npm run docs:knowledge-flow:check
```

The CI check fails when the committed HTML differs from deterministic Renderer output.

## Preserved baseline structure

- 6 Phases
- 22 Steps
- four core principles
- two feedback/rediscovery loops
- five cross-phase safeguards

## Change rules

1. Change the JSON source through an approved Git pull request.
2. Regenerate the HTML in the same change.
3. Preserve Step identifiers unless a separately approved architecture change explicitly revises them.
4. Record semantic changes in an ADR or Knowledge Flow change history.
5. Do not treat presentation layout changes as architecture changes when the structured meaning is unchanged.
