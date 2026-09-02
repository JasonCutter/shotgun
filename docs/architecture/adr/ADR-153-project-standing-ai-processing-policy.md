# ADR-153 — Project Standing AI Processing Policy

- Status: **ACCEPTED BY USER / IMPLEMENTATION AUTHORIZED**
- Proposed at: 2026-09-02
- Accepted at: 2026-09-02
- Accepted by: `USER` through the Standing AI Processing Policy implementation request
- Decision owner: `USER`
- Related ADRs: ADR-133, ADR-143, ADR-147, ADR-148
- Predecessor exact head: `237691b9609da3ad92361803ce805bbfea5271af`

## Context

ADR-133/A4 correctly separated deployment authority from Project/provider
privacy approval, but its routine `proposal -> separate approval` interaction
requires an Owner decision for each provider's private use. That is unsuitable
for a Project whose Owner has deliberately enabled automatic AI processing.

This decision changes the routine Product interaction without erasing the
historical A4 approval/rejection stream or weakening any security boundary.

## Decision

Shotgun owns a durable Project-level `AI Automatic Processing` policy. The
policy is bound to one configured provider and has append-only revisions. When
it is enabled and the selected execution provider matches its binding:

| Resource sensitivity | Effective standing result                                       |
| -------------------- | --------------------------------------------------------------- |
| public               | permitted, subject to provider/configuration authority          |
| internal             | permitted, subject to provider/configuration authority          |
| private              | permitted only when the deployment ceiling permits the provider |
| restricted           | externally blocked                                              |

The Project standing policy is separate from:

1. provider identity, model, configuration revision, and vault-owned credential;
2. the deployment/operator hard ceiling;
3. resource sensitivity, access scope, and Source/Evidence authority.

The standing policy does not contain secrets and cannot create or substitute a
credential. A provider change is a meaningful boundary: an enabled policy bound
to provider A does not authorize provider B. The Owner must explicitly save the
new provider binding before enabling automatic processing for it.

The policy is resolved server-side for every new AI-assisted execution. Ask,
embedding, and Discovery use the same effective policy contract. Existing
execution pins retain their existing provider/configuration/policy identity;
new executions observe revocation and provider changes immediately.

## Deployment ceiling

The deployment ceiling remains a hard deny. Managed deployments can explicitly
deny providers through `AI_PRIVATE_EGRESS_ALLOWED_PROVIDERS` and
`SHOTGUN_DEPLOYMENT_MODE=managed`. A normal local-owner installation uses the
selected registered provider as the default private-transfer ceiling when no
explicit operator allowlist is present. This removes repeated local environment
editing while preserving an explicit managed-deployment deny mechanism.

`restricted` external transfer remains denied regardless of standing policy,
provider approval history, or local deployment mode.

## Compatibility and migration

Migration `060_project_standing_ai_processing_policy.sql` creates an immutable
revision stream and a current pointer. Existing Projects are seeded with
revision 1, `enabled=false`, and their current configured provider when one
exists (otherwise `deepseek`). This is a deterministic disabled migration
state; an explicit historical A4 rejection is never interpreted as approval.

New Projects initialize the same disabled revision in their creation
transaction. The historical A4 provider approval tables, proposals, audit
events, and read surfaces remain intact for audit and compatibility. They are
not used as the routine approval gate when a current standing policy is bound
to the selected provider.

Policy writes use optimistic revision checks, append-only history, and an audit
event containing only Project/provider/configuration/policy identity. Rollback
is to the previous current policy revision by writing a new disabled or
provider-bound revision; no historical row is edited or deleted.

## Product surface

The normal Settings → AI surface exposes one Project-level switch, the bound
Provider, private automatic-use status, and the restricted external-transfer
hard block. It does not expose a capability matrix or per-operation approval
toggles. Historical A4 review information remains available as an advanced
audit/compatibility surface.

## Open-source integration decision

No new OSS runtime is adopted. OPA, Casbin, and OpenFGA remain deferred/rejected
for this bounded deterministic policy contract because introducing a second
policy runtime would add migration and replacement risk without improving the
current Project/provider/sensitivity decision. The implementation is an
in-process deterministic Policy package behind `StandingAIProcessingPolicy*`
ports. It can be replaced later without exposing adapter schema or provider
SDK types in the shared contract.

## Acceptance boundary

This ADR authorizes only the durable standing-policy contract, persistence,
effective-resolution wiring for currently Product-wired paths, the normal AI
settings surface, focused tests, and final repository validation. It does not
authorize post-AKP/v2 work, provider SDK adoption, restricted-data transfer,
Ready, merge, deployment, or reinterpretation of deferred ADR-147/ADR-150
authority.
