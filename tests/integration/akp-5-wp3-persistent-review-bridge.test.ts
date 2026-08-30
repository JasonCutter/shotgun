import { describe, expect, it } from 'vitest';

import {
  assertDiscoveryReviewResourceMatchesCandidateV1,
  computeDiscoveryReviewRootIdentityV1,
  DISCOVERY_DERIVED_VALIDATION_PROFILE_V1,
  discoveryReviewResourceContentDigestV1,
  decodeDiscoveryReviewResourceV1,
  type DerivedKnowledgeCandidateV1,
  type DiscoveryReviewResourceV1,
} from '../../packages/contracts/src/index.js';
import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import {
  DiscoveryCandidateReviewTargetAdapter,
  InMemoryFrontendReviewStore,
  type ReviewDiscoveryCandidateDerivedSourceV1,
  createInMemoryReviewDiscoveryCandidateReader,
} from '../../adapters/frontend-review-in-memory/src/index.js';
import {
  FrontendReviewProductCoordinator,
  type FrontendReviewScopeV1,
} from '../../modules/frontend-review/src/index.js';

const PROJECT = 'wp3-project-1';
const now = '2026-08-30T03:00:00.000Z';

const resourceWithoutDigest = {
  schemaVersion: '1.0.0' as const,
  origin: 'DERIVED_DISCOVERY' as const,
  projectId: PROJECT,
  reviewResourceId: computeDiscoveryReviewRootIdentityV1({
    projectId: PROJECT,
    candidateId: 'candidate-wp3-1',
    candidateRevision: 1,
    origin: 'DERIVED_DISCOVERY',
  }),
  resourceRevision: 1,
  effectiveProjectId: PROJECT,
  candidateId: 'candidate-wp3-1',
  candidateRevision: 1,
  findingId: 'finding-wp3-1',
  findingRevision: 1,
  findingType: 'KNOWLEDGE_GAP' as const,
  manifestId: 'manifest-wp3-1',
  governanceTarget: 'VALIDATION_OR_KNOWLEDGE_GAP_GOVERNANCE' as const,
  sourceProjectionDigest: 'sha256:wp3-source',
  canonicalBase: {
    schemaVersion: '1.0.0' as const,
    canonicalVersion: 8,
    snapshotDigest: 'sha256:wp3-canonical',
  },
  discoveryBase: {
    schemaVersion: '1.0.0' as const,
    projectionRevision: 'projection-wp3-8',
    projectionDigest: 'sha256:wp3-discovery',
  },
  relatedResourceRefs: [],
  evidenceIds: ['evidence-wp3-1'],
  derivationProvenance: {
    schemaVersion: '1.0.0' as const,
    kind: 'DETERMINISTIC' as const,
    ruleId: 'wp3-test-rule',
    ruleVersion: '1',
    inputDigest: 'sha256:wp3-input',
  },
  accessScope: ['owner'],
  sensitivity: 'internal' as const,
  validationProfile: DISCOVERY_DERIVED_VALIDATION_PROFILE_V1,
  validationResult: {
    schemaVersion: '1.0.0' as const,
    artifactKind: 'VALIDATION' as const,
    artifactId: 'validation-wp3-1',
    artifactRevision: '3',
    digest: 'sha256:wp3-validation',
  },
  lifecycleState: 'REVIEW_READY' as const,
  reviewEligibility: 'ELIGIBLE_AFTER_VALIDATION' as const,
  content: {
    schemaVersion: '1.0.0' as const,
    summary: 'Validated derived candidate',
    detail: 'Only the normalized post-validation projection is reviewable.',
    rationale: 'The derived validation artifact completed successfully.',
    expectedImpact: 'May create a governed authoring proposal later.',
  },
  evidenceLineage: [
    {
      schemaVersion: '1.0.0' as const,
      evidenceId: 'evidence-wp3-1',
    },
  ],
} satisfies Omit<DiscoveryReviewResourceV1, 'contentDigest' | 'createdAt' | 'updatedAt'>;

const authoritativeCandidate: DerivedKnowledgeCandidateV1 = {
  schemaVersion: '1.0.0',
  candidateId: resourceWithoutDigest.candidateId,
  candidateRevision: resourceWithoutDigest.candidateRevision,
  projectId: resourceWithoutDigest.projectId,
  origin: resourceWithoutDigest.origin,
  manifestId: resourceWithoutDigest.manifestId,
  findingId: resourceWithoutDigest.findingId,
  findingRevision: resourceWithoutDigest.findingRevision,
  findingType: resourceWithoutDigest.findingType,
  governanceTarget: resourceWithoutDigest.governanceTarget,
  sourceProjectionDigest: resourceWithoutDigest.sourceProjectionDigest,
  canonicalBase: resourceWithoutDigest.canonicalBase,
  discoveryBase: resourceWithoutDigest.discoveryBase,
  relatedResourceRefs: resourceWithoutDigest.relatedResourceRefs,
  evidenceIds: resourceWithoutDigest.evidenceIds,
  derivationProvenance: resourceWithoutDigest.derivationProvenance,
  accessScope: resourceWithoutDigest.accessScope,
  sensitivity: resourceWithoutDigest.sensitivity,
  validationProfile: resourceWithoutDigest.validationProfile,
  reentryEligibility: 'ELIGIBLE_FOR_VALIDATION',
  reviewEligibility: 'NOT_ELIGIBLE',
  createdAt: now,
};

const resource: DiscoveryReviewResourceV1 = {
  ...resourceWithoutDigest,
  contentDigest: discoveryReviewResourceContentDigestV1(resourceWithoutDigest),
  createdAt: now,
  updatedAt: now,
};

const derivedSource = (
  value: DiscoveryReviewResourceV1,
): ReviewDiscoveryCandidateDerivedSourceV1 => ({
  origin: 'DERIVED_DISCOVERY',
  reviewResourceId: value.reviewResourceId,
  resourceRevision: value.resourceRevision,
  candidateId: value.candidateId,
  candidateRevision: value.candidateRevision,
  resourceProjectId: value.projectId,
  effectiveProjectId: value.effectiveProjectId,
  content: value.content,
  evidence: value.evidenceLineage,
  impact: [],
  lineage: value,
  contentDigest: value.contentDigest,
  createdAt: value.createdAt,
  updatedAt: value.updatedAt,
});

const scope: FrontendReviewScopeV1 = {
  principalId: 'principal-wp3',
  sessionId: 'session-wp3',
  activeProjectId: PROJECT,
  accessRevision: 'access-wp3-1',
  policyContextRevision: 'policy-wp3-1',
  sensitivityClearance: 'ALL',
  accessScope: ['owner', 'review'],
};

describe('AKP-5 WP3 persistent Review bridge contract', () => {
  it('decodes only an explicit post-validation normalized resource', () => {
    expect(decodeDiscoveryReviewResourceV1(resource)).toEqual(resource);
    const rootInput = {
      projectId: resource.projectId,
      candidateId: resource.candidateId,
      candidateRevision: resource.candidateRevision,
      origin: resource.origin,
    } as const;
    expect(resource.reviewResourceId).toBe(computeDiscoveryReviewRootIdentityV1(rootInput));
    expect(resource.reviewResourceId).toBe(
      computeDiscoveryReviewRootIdentityV1({
        ...rootInput,
        // Resource revision, timestamps and content wording are intentionally
        // absent from the stable root input.
      }),
    );
    expect(
      computeDiscoveryReviewRootIdentityV1({
        ...rootInput,
        candidateId: 'different-candidate',
      }),
    ).not.toBe(resource.reviewResourceId);
    expect(() =>
      decodeDiscoveryReviewResourceV1({ ...resource, reviewResourceId: 'caller-selected-root' }),
    ).toThrow(/stable Review root identity/);
    expect(() =>
      decodeDiscoveryReviewResourceV1({ ...resource, lifecycleState: 'VALIDATING' }),
    ).toThrow(/REVIEW_READY/);
    expect(() => decodeDiscoveryReviewResourceV1({ ...resource, unexpected: true })).toThrow(
      /unknown field/i,
    );
  });

  it('requires exact authoritative candidate lineage while keeping WP2 eligibility separate', () => {
    expect(() =>
      assertDiscoveryReviewResourceMatchesCandidateV1(resource, authoritativeCandidate),
    ).not.toThrow();
    expect(authoritativeCandidate.reviewEligibility).toBe('NOT_ELIGIBLE');
    expect(resource.reviewEligibility).toBe('ELIGIBLE_AFTER_VALIDATION');
    expect(() =>
      assertDiscoveryReviewResourceMatchesCandidateV1(resource, {
        ...authoritativeCandidate,
        canonicalBase: {
          ...authoritativeCandidate.canonicalBase,
          snapshotDigest: 'sha256:wrong-canonical',
        },
      }),
    ).toThrow(/authoritative WP2 candidate lineage/);
  });

  it('materializes exact revision/digest and preserves derived lineage without fake SourceVersion', async () => {
    const source = derivedSource(resource);
    const adapter = new DiscoveryCandidateReviewTargetAdapter(
      createInMemoryReviewDiscoveryCandidateReader([source]),
    );

    await expect(adapter.listSourceTargets(PROJECT)).resolves.toEqual([
      {
        reviewResourceId: resource.reviewResourceId,
        targetId: resource.candidateId,
        targetRevision: '1',
        targetDigest: resource.contentDigest,
        targetLabel: resource.content.summary,
        resourceProjectId: PROJECT,
        effectiveProjectId: PROJECT,
        updatedAt: now,
        source: 'DISCOVERY_CANDIDATE',
      },
    ]);

    const target = (await adapter.listSourceTargets(PROJECT))[0]!;
    const materialized = await adapter.materializeContext({
      scope,
      source: target,
      reviewContextId: 'review-context-wp3-1',
      contextRevision: 1,
      generatedAt: now,
    });
    expect(materialized.context.canonicalBase).toBeUndefined();
    expect(materialized.context.artifactRefs.validation?.artifactId).toBe('validation-wp3-1');
    const {
      reviewResourceId,
      resourceRevision,
      effectiveProjectId,
      lifecycleState,
      reviewEligibility,
      content,
      evidenceLineage,
      contentDigest,
      createdAt,
      updatedAt,
      ...expectedLineage
    } = resource;
    void reviewResourceId;
    void resourceRevision;
    void effectiveProjectId;
    void lifecycleState;
    void reviewEligibility;
    void content;
    void evidenceLineage;
    void contentDigest;
    void createdAt;
    void updatedAt;
    expect(materialized.context.artifactRefs.discoveryLineage).toEqual(expectedLineage);
    expect(materialized.context.items[0]?.sourceItemRevision).toBe('1');
    expect(materialized.context.items[0]?.sourceItemDigest).toBe(resource.contentDigest);
    expect(await adapter.readEvidence({ scope, source: target, reviewItemId: 'item-1' })).toEqual(
      [],
    );
  });

  it('filters derived resources by server-authoritative project, access scope and sensitivity', async () => {
    const adapter = new DiscoveryCandidateReviewTargetAdapter(
      createInMemoryReviewDiscoveryCandidateReader([derivedSource(resource)]),
    );
    await expect(
      adapter.listSourceTargets(PROJECT, {
        ...scope,
        accessScope: ['review'],
      }),
    ).resolves.toEqual([]);
    await expect(
      adapter.listSourceTargets(PROJECT, {
        ...scope,
        sensitivityClearance: 'public',
      }),
    ).resolves.toEqual([]);
    await expect(
      adapter.listSourceTargets('foreign-project', {
        ...scope,
        activeProjectId: 'foreign-project',
      }),
    ).resolves.toEqual([]);
  });

  it('keeps the existing ADR-128 decision path and never creates an Approval for Discovery', async () => {
    const store = new InMemoryFrontendReviewStore();
    const coordinator = new FrontendReviewProductCoordinator(
      store,
      new InMemoryFrontendCommandGateway(),
      [
        new DiscoveryCandidateReviewTargetAdapter(
          createInMemoryReviewDiscoveryCandidateReader([derivedSource(resource)]),
        ),
      ],
      () => new Date(now),
    );
    const queue = await coordinator.listReviewQueue(scope, {
      schemaVersion: '1.0.0',
      pageSize: 50,
    });
    const queueItem = queue.items[0]!;
    const contextResult = await coordinator.getReviewContext(scope, {
      schemaVersion: '1.0.0',
      reviewContextId: queueItem.reviewContextId,
      contextRevision: queueItem.contextRevision,
    });
    const item = contextResult.context.items[0]!;
    const result = await coordinator.recordReviewDecisions(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'client-wp3-approve',
      idempotencyKey: 'idempotency-wp3-approve',
      reviewContextId: contextResult.context.reviewContextId,
      expectedContextRevision: contextResult.context.contextRevision,
      expectedTargetRevision: contextResult.context.targetRevision,
      expectedTargetDigest: contextResult.context.targetDigest,
      itemDecisions: [
        {
          schemaVersion: '1.0.0',
          reviewItemId: item.reviewItemId,
          intent: 'APPROVE',
          reason: 'Validated derived resource is ready for authoring.',
        },
      ],
    });
    expect(result.aggregateState).toBe('ACCEPTED_FOR_AUTHORING');
    expect(result.approvals).toBeUndefined();
    expect(store.approvals.size).toBe(0);
  });
});
