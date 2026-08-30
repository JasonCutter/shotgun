import { describe, expect, it } from 'vitest';

import {
  createDerivedKnowledgeCandidateV1,
  createDiscoveryFindingEnvelopeV1,
  createDiscoveryReentryManifestV1,
  computeDiscoveryReentryLogicalIdentityV1,
  type DiscoveryFindingEnvelopeV1,
  type DiscoveryReviewResourceV1,
} from '../../packages/contracts/src/index.js';
import {
  DiscoveryReviewMaterializer,
  discoveryReviewMaterializationTargetForV1,
  DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
  normalizeDiscoveryFindingToReviewResourceV1,
  type DiscoveryReentryPersistencePort,
  type DiscoveryReentryStoredIntakeV1,
  type DiscoveryReviewResourceWriterPort,
} from '../../modules/discovery-reentry/src/index.js';
import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import {
  DiscoveryCandidateReviewTargetAdapter,
  InMemoryFrontendReviewStore,
  createInMemoryReviewDiscoveryCandidateReader,
  type ReviewDiscoveryCandidateDerivedSourceV1,
} from '../../adapters/frontend-review-in-memory/src/index.js';
import {
  FrontendReviewProductCoordinator,
  type FrontendReviewScopeV1,
} from '../../modules/frontend-review/src/index.js';

const projectId = 'akp-5-wp4-materialization-project';
const now = '2026-08-30T04:00:00.000Z';

const ref = (resourceId: string) => ({
  schemaVersion: '1.0.0' as const,
  resourceKind: 'CANONICAL_CLAIM' as const,
  resourceId,
  projectId,
  resourceState: 'CURRENT' as const,
});

const baseFinding = {
  schemaVersion: '1.0.0' as const,
  projectId,
  generationMethod: 'DETERMINISTIC' as const,
  status: 'DERIVED_INFERENCE' as const,
  lifecycleState: 'NEW' as const,
  evidenceIds: ['evidence-wp4-1'],
  sourceProjectionDigest: 'sha256:wp4-source',
  canonicalBase: {
    schemaVersion: '1.0.0' as const,
    canonicalVersion: 3,
    snapshotDigest: 'sha256:wp4-canonical',
  },
  discoveryBase: {
    schemaVersion: '1.0.0' as const,
    projectionRevision: 'projection-wp4-3',
    projectionDigest: 'sha256:wp4-discovery',
  },
  runId: 'run-wp4-1',
  signalSummary: {},
  rationale: 'The persisted derived signal needs governed review context.',
  derivationSummary: 'Deterministic WP4 integration fixture.',
  provenance: {
    schemaVersion: '1.0.0' as const,
    kind: 'DETERMINISTIC' as const,
    ruleId: 'wp4-test-rule',
    ruleVersion: '1',
    inputDigest: 'sha256:wp4-input',
  },
  accessScope: ['owner', 'review'],
  sensitivity: 'internal' as const,
  fingerprint: 'sha256:wp4-fingerprint',
  fingerprintVersion: 'discovery-fingerprint:v1',
  retentionClass: 'DURABLE_DERIVED_RECORD' as const,
  createdAt: now,
};

const findingFor = (
  findingType: DiscoveryFindingEnvelopeV1['findingType'],
): DiscoveryFindingEnvelopeV1 => {
  const one = ref('resource-one');
  const two = ref('resource-two');
  const three = ref('resource-three');
  switch (findingType) {
    case 'KNOWLEDGE_GAP':
      return createDiscoveryFindingEnvelopeV1({
        ...baseFinding,
        findingId: 'finding-knowledge-gap',
        findingRevision: 1,
        findingType,
        payload: {
          schemaVersion: '1.0.0',
          payloadType: findingType,
          gapKind: 'MISSING_FACT',
          subject: 'subject-one',
          missingFact: 'missing fact',
          question: 'Which fact is missing?',
        },
        relatedResourceRefs: [one],
      });
    case 'EVIDENCE_GAP':
      return createDiscoveryFindingEnvelopeV1({
        ...baseFinding,
        findingId: 'finding-evidence-gap',
        findingRevision: 1,
        findingType,
        payload: {
          schemaVersion: '1.0.0',
          payloadType: findingType,
          coverageKind: 'INSUFFICIENT',
          affectedResourceRef: one,
          coverageGap: 'The current support is insufficient.',
          requiredEvidence: 'A dated primary source is required.',
        },
        relatedResourceRefs: [one],
      });
    case 'RELATION_HYPOTHESIS':
      return createDiscoveryFindingEnvelopeV1({
        ...baseFinding,
        findingId: 'finding-relation-hypothesis',
        findingRevision: 1,
        findingType,
        payload: {
          schemaVersion: '1.0.0',
          payloadType: findingType,
          sourceEndpoint: one,
          targetEndpoint: two,
          proposedRelationType: 'DEPENDS_ON',
          direction: 'DIRECTED',
          temporalQualification: {
            schemaVersion: '1.0.0',
            validFrom: '2026-01-01T00:00:00.000Z',
            description: 'During the current planning period.',
          },
        },
        relatedResourceRefs: [one, two],
      });
    case 'PATTERN_HYPOTHESIS':
      return createDiscoveryFindingEnvelopeV1({
        ...baseFinding,
        findingId: 'finding-pattern-hypothesis',
        findingRevision: 1,
        findingType,
        payload: {
          schemaVersion: '1.0.0',
          payloadType: findingType,
          patternKind: 'RECURRING_ASSOCIATION',
          memberResourceRefs: [one, two, three],
          patternIdentity: 'pattern-one',
          patternStatement: 'The three resources show a recurring association.',
        },
        relatedResourceRefs: [one, two, three],
      });
    case 'CONFLICT_HYPOTHESIS':
      return createDiscoveryFindingEnvelopeV1({
        ...baseFinding,
        findingId: 'finding-conflict-hypothesis',
        findingRevision: 1,
        findingType,
        payload: {
          schemaVersion: '1.0.0',
          payloadType: findingType,
          participatingResourceRefs: [one, two],
          contradictionKind: 'FACTUAL',
          possibleContradiction: 'The two reviewed statements may disagree.',
        },
        relatedResourceRefs: [one, two],
      });
    case 'CLARIFICATION_QUESTION':
      return createDiscoveryFindingEnvelopeV1({
        ...baseFinding,
        findingId: 'finding-clarification-question',
        findingRevision: 1,
        findingType,
        payload: {
          schemaVersion: '1.0.0',
          payloadType: findingType,
          investigationTargetRefs: [one],
          question: 'Which interpretation should be investigated?',
          context: 'The available context has two plausible readings.',
          proposedNextStep: 'Ask the owner for the missing context.',
        },
        relatedResourceRefs: [one],
      });
    case 'ACTION_SUGGESTION':
      return createDiscoveryFindingEnvelopeV1({
        ...baseFinding,
        findingId: 'finding-action-suggestion',
        findingRevision: 1,
        findingType,
        payload: {
          schemaVersion: '1.0.0',
          payloadType: findingType,
          suggestedAction: 'Review the source record with the owner.',
          rationale: 'Owner confirmation is needed before any action.',
          affectedResourceRefs: [one, two],
          riskContext: 'External side effects are not authorized.',
          executionStatus: 'CANDIDATE_ONLY',
        },
        relatedResourceRefs: [one, two],
      });
  }
};

const pairFor = (finding: DiscoveryFindingEnvelopeV1) => {
  const manifest = createDiscoveryReentryManifestV1({
    manifestId: `manifest:${finding.findingId}`,
    finding,
    requestedReentryPurpose: DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
    createdAt: now,
  });
  const logicalIdentity = computeDiscoveryReentryLogicalIdentityV1({
    projectId: finding.projectId,
    findingId: finding.findingId,
    findingRevision: finding.findingRevision,
    findingType: finding.findingType,
    sourceProjectionDigest: finding.sourceProjectionDigest,
    canonicalBase: finding.canonicalBase,
    requestedReentryPurpose: DISCOVERY_REENTRY_PURPOSE_DERIVED_PROVENANCE_VALIDATION,
  });
  const candidate = createDerivedKnowledgeCandidateV1({
    candidateId: `discovery-reentry-candidate:${logicalIdentity.logicalIdentityKey}`,
    finding,
    manifest,
    approvedRelatedResourceRefs: finding.relatedResourceRefs.map((value) => ({
      ...value,
      resourceState: 'APPROVED' as const,
      resourceRevision: 'approved-1',
    })),
    createdAt: now,
  });
  return { manifest, candidate, logicalIdentityKey: logicalIdentity.logicalIdentityKey };
};

const derivedSource = (
  resource: DiscoveryReviewResourceV1,
): ReviewDiscoveryCandidateDerivedSourceV1 => ({
  origin: 'DERIVED_DISCOVERY',
  reviewResourceId: resource.reviewResourceId,
  resourceRevision: resource.resourceRevision,
  candidateId: resource.candidateId,
  candidateRevision: resource.candidateRevision,
  resourceProjectId: resource.projectId,
  effectiveProjectId: resource.effectiveProjectId,
  content: resource.content,
  evidence: resource.evidenceLineage,
  impact: resource.content.normalizedMaterial?.impact.map((entry) => ({ ...entry })) ?? [],
  lineage: resource,
  contentDigest: resource.contentDigest,
  createdAt: resource.createdAt,
  updatedAt: resource.updatedAt,
});

const scope: FrontendReviewScopeV1 = {
  principalId: 'principal-wp4',
  sessionId: 'session-wp4',
  activeProjectId: projectId,
  accessRevision: 'access-wp4',
  policyContextRevision: 'policy-wp4',
  sensitivityClearance: 'ALL',
  accessScope: ['owner', 'review'],
};

describe('AKP-5 WP4 type-specific Review materialization', () => {
  it('exhaustively normalizes all seven Finding types with their frozen targets', () => {
    const expected = {
      KNOWLEDGE_GAP: 'KNOWLEDGE_GAP_INVESTIGATION',
      EVIDENCE_GAP: 'EVIDENCE_GAP_INVESTIGATION',
      RELATION_HYPOTHESIS: 'RELATION_CANDIDATE',
      PATTERN_HYPOTHESIS: 'DERIVED_CLAIM_CANDIDATE',
      CONFLICT_HYPOTHESIS: 'CONFLICT_REVIEW',
      CLARIFICATION_QUESTION: 'CLARIFICATION_WORK_ITEM',
      ACTION_SUGGESTION: 'ACTION_CANDIDATE',
    } as const;
    for (const [findingType, target] of Object.entries(expected)) {
      const finding = findingFor(findingType as DiscoveryFindingEnvelopeV1['findingType']);
      const { candidate } = pairFor(finding);
      const resource = normalizeDiscoveryFindingToReviewResourceV1({ finding, candidate });
      expect(discoveryReviewMaterializationTargetForV1(finding.findingType)).toBe(target);
      expect(resource.content.normalizedMaterial?.findingType).toBe(findingType);
      expect(resource.content.normalizedMaterial?.materializationTarget).toBe(target);
      expect(resource.reviewEligibility).toBe('ELIGIBLE_AFTER_VALIDATION');
      expect(candidate.reviewEligibility).toBe('NOT_ELIGIBLE');
      expect(resource.content.normalizedMaterial?.comparison.before).toEqual({
        state: 'NOT_AVAILABLE',
        reason: 'NO_AUTHORITATIVE_PREVIOUS_CANONICAL_VALUE',
      });
      expect(resource.content.normalizedMaterial?.typeSpecific.findingType).toBe(findingType);
      expect(resource.content.normalizedMaterial?.impact.length).toBeGreaterThan(0);
    }
  });

  it('preserves type semantics and avoids affirmative or executable authority', () => {
    const relation = findingFor('RELATION_HYPOTHESIS');
    const relationResource = normalizeDiscoveryFindingToReviewResourceV1({
      finding: relation,
      candidate: pairFor(relation).candidate,
    });
    expect(relationResource.content.normalizedMaterial?.typeSpecific).toMatchObject({
      findingType: 'RELATION_HYPOTHESIS',
      relationType: 'DEPENDS_ON',
      direction: 'DIRECTED',
    });
    expect(relationResource.content.normalizedMaterial?.comparison.after.state).toBe('PROPOSED');

    const conflict = findingFor('CONFLICT_HYPOTHESIS');
    const conflictResource = normalizeDiscoveryFindingToReviewResourceV1({
      finding: conflict,
      candidate: pairFor(conflict).candidate,
    });
    expect(conflictResource.content.normalizedMaterial?.typeSpecific).toMatchObject({
      findingType: 'CONFLICT_HYPOTHESIS',
      statementA: { resourceId: 'resource-one' },
      statementB: { resourceId: 'resource-two' },
    });
    expect(conflictResource.content.normalizedMaterial?.comparison.after.state).toBe('CONFLICTING');
    expect(conflictResource.content.detail).not.toContain('SourceVersion');

    const action = findingFor('ACTION_SUGGESTION');
    const actionResource = normalizeDiscoveryFindingToReviewResourceV1({
      finding: action,
      candidate: pairFor(action).candidate,
    });
    expect(actionResource.content.normalizedMaterial?.typeSpecific).toMatchObject({
      findingType: 'ACTION_SUGGESTION',
      executionStatus: 'CANDIDATE_ONLY',
      recommendedAction: 'Review the source record with the owner.',
    });
    expect(actionResource.content.normalizedMaterial?.comparison.after.state).toBe(
      'CANDIDATE_ONLY',
    );
  });

  it('fails closed for candidate/Finding authority and security mismatches', () => {
    const finding = findingFor('KNOWLEDGE_GAP');
    const { candidate } = pairFor(finding);
    expect(() =>
      normalizeDiscoveryFindingToReviewResourceV1({
        finding,
        candidate: { ...candidate, findingId: 'caller-selected-finding' },
      }),
    ).toThrow(/authoritative Finding/);
    expect(() =>
      normalizeDiscoveryFindingToReviewResourceV1({
        finding,
        candidate: { ...candidate, accessScope: ['owner', 'review', 'admin'] },
      }),
    ).toThrow(/widens Finding authority/);
    expect(() =>
      normalizeDiscoveryFindingToReviewResourceV1({
        finding,
        candidate: { ...candidate, sensitivity: 'public' },
      }),
    ).toThrow(/weakens Finding protection/);
    expect(() =>
      normalizeDiscoveryFindingToReviewResourceV1({
        finding,
        candidate: { ...candidate, reviewEligibility: 'ELIGIBLE_AFTER_VALIDATION' as never },
      }),
    ).toThrow(/NOT_ELIGIBLE|reviewEligibility/);
  });

  it('reloads the authoritative pair and provides deterministic create/idempotent persistence', async () => {
    const finding = findingFor('PATTERN_HYPOTHESIS');
    const { manifest, candidate, logicalIdentityKey } = pairFor(finding);
    const stored: DiscoveryReentryStoredIntakeV1 = {
      logicalIdentityKey,
      manifest,
      candidate,
      lifecycle: {
        projectId,
        findingId: finding.findingId,
        findingRevision: finding.findingRevision,
        lifecycleState: 'VALIDATING',
        lifecycleRevision: 2,
        updatedAt: now,
      },
    };
    const persistence = {
      findExisting: async () => stored,
      findFinding: async () => finding,
    } as unknown as DiscoveryReentryPersistencePort;
    let persisted: DiscoveryReviewResourceV1 | undefined;
    const writer: DiscoveryReviewResourceWriterPort = {
      save: async (resource) => {
        if (persisted === undefined) {
          persisted = resource;
          return 'CREATED';
        }
        if (persisted.contentDigest === resource.contentDigest) return 'IDEMPOTENT';
        throw new Error('immutable resource conflict');
      },
    };
    const materializer = new DiscoveryReviewMaterializer(persistence, writer);
    const first = await materializer.materialize({ logicalIdentityKey: stored.logicalIdentityKey });
    const second = await materializer.materialize({
      logicalIdentityKey: stored.logicalIdentityKey,
    });
    expect(first.status).toBe('CREATED');
    expect(second.status).toBe('IDEMPOTENT');
    expect((first as { resource: DiscoveryReviewResourceV1 }).resource.contentDigest).toBe(
      (second as { resource: DiscoveryReviewResourceV1 }).resource.contentDigest,
    );
  });

  it('reaches existing ADR-128 Review through the adapter without Approval or Canonical mutation', async () => {
    const finding = findingFor('EVIDENCE_GAP');
    const resource = normalizeDiscoveryFindingToReviewResourceV1({
      finding,
      candidate: pairFor(finding).candidate,
    });
    const adapter = new DiscoveryCandidateReviewTargetAdapter(
      createInMemoryReviewDiscoveryCandidateReader([derivedSource(resource)]),
    );
    const store = new InMemoryFrontendReviewStore();
    const coordinator = new FrontendReviewProductCoordinator(
      store,
      new InMemoryFrontendCommandGateway(),
      [adapter],
      () => new Date(now),
    );
    const queue = await coordinator.listReviewQueue(scope, {
      schemaVersion: '1.0.0',
      pageSize: 20,
    });
    const context = await coordinator.getReviewContext(scope, {
      schemaVersion: '1.0.0',
      reviewContextId: queue.items[0]!.reviewContextId,
      contextRevision: queue.items[0]!.contextRevision,
    });
    const result = await coordinator.recordReviewDecisions(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'wp4-approve-request',
      idempotencyKey: 'wp4-approve-idempotency',
      reviewContextId: context.context.reviewContextId,
      expectedContextRevision: context.context.contextRevision,
      expectedTargetRevision: context.context.targetRevision,
      expectedTargetDigest: context.context.targetDigest,
      itemDecisions: [
        {
          schemaVersion: '1.0.0',
          reviewItemId: context.context.items[0]!.reviewItemId,
          intent: 'APPROVE',
          reason: 'Review the normalized evidence gap.',
        },
      ],
    });
    expect(result.aggregateState).toBe('ACCEPTED_FOR_AUTHORING');
    expect(result.approvals).toBeUndefined();
    expect(store.approvals.size).toBe(0);
    await expect(
      adapter.readImpact({
        scope,
        source: (await adapter.listSourceTargets(projectId))[0]!,
        reviewItemId: 'item-1',
      }),
    ).resolves.toHaveLength(1);
  });
});
