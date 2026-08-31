import { describe, expect, it } from 'vitest';

import {
  FrontendContractError,
  createDiscoveryFindingEnvelopeV1,
  decodeListDiscoveryFindingsRequestV1,
  decodeListDiscoveryFindingsResultV1,
  decodeReadDiscoveryFindingRequestV1,
  type DiscoveryFindingEnvelopeV1,
  type DiscoveryFindingEnvelopeInputV1,
  type DiscoveryProductReentryStateV1,
  type DiscoveryResourceRefV1,
} from '../../packages/contracts/src/index.js';
import {
  FrontendDiscoveryProductReadCoordinator,
  createEncryptedDiscoveryProductCursorCodec,
  type DiscoveryProductFindingIdentityV1,
  type DiscoveryProductPageCursorV1,
  type DiscoveryProductReadInput,
  type DiscoveryProductResourceAuthorizationV1,
  type DiscoveryProductReadSource,
  type DiscoveryProductReviewBindingV1,
} from '../../modules/frontend-discovery-product/src/index.js';
import type { DiscoveryFindingLifecycleCurrentV1 } from '../../modules/discovery-finding-lifecycle/src/index.js';
import type { EvidenceSpan } from '../../packages/contracts/src/document-evidence.js';

describe('AKP-6 WP1 Discovery Product contracts', () => {
  it('rejects browser-authored authority fields and unknown fields', () => {
    expect(() =>
      decodeListDiscoveryFindingsRequestV1({
        schemaVersion: '1.0.0',
        projectId: 'attacker-project',
      }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeReadDiscoveryFindingRequestV1({
        schemaVersion: '1.0.0',
        findingId: 'finding-1',
        findingRevision: 1,
        lifecycleState: 'REVIEW_READY',
      }),
    ).toThrow(FrontendContractError);
  });

  it('strictly decodes the bounded list result and rejects unknown response fields', () => {
    const result = decodeListDiscoveryFindingsResultV1({
      schemaVersion: '1.0.0',
      projectId: 'project-1',
      accessRevision: 'project-1:owner',
      policyContextRevision: '7',
      findings: [],
    });
    expect(result.findings).toEqual([]);
    expect(() =>
      decodeListDiscoveryFindingsResultV1({
        schemaVersion: '1.0.0',
        projectId: 'project-1',
        accessRevision: 'project-1:owner',
        policyContextRevision: '7',
        findings: [],
        internalConfidence: 0.99,
      }),
    ).toThrow(FrontendContractError);
  });
});

const finding = (
  overrides: Partial<DiscoveryFindingEnvelopeInputV1> = {},
): DiscoveryFindingEnvelopeV1 =>
  createDiscoveryFindingEnvelopeV1({
    schemaVersion: '1.0.0',
    findingId: 'finding-1',
    findingRevision: 1,
    projectId: 'project-1',
    findingType: 'KNOWLEDGE_GAP',
    generationMethod: 'DETERMINISTIC',
    lifecycleState: 'NEW',
    payload: {
      schemaVersion: '1.0.0',
      payloadType: 'KNOWLEDGE_GAP',
      gapKind: 'MISSING_FACT',
      subject: 'Milo',
      missingFact: 'current weight',
      question: "What is Milo's current weight?",
    },
    relatedResourceRefs: [
      {
        schemaVersion: '1.0.0',
        resourceKind: 'CANONICAL_CLAIM',
        resourceId: 'claim-1',
        projectId: 'project-1',
        resourceState: 'CURRENT',
      },
    ],
    evidenceIds: ['evidence-1'],
    sourceProjectionDigest: 'sha256:projection',
    canonicalBase: {
      schemaVersion: '1.0.0',
      canonicalVersion: 1,
      snapshotDigest: 'sha256:canonical',
    },
    discoveryBase: {
      schemaVersion: '1.0.0',
      projectionRevision: 'projection-1',
      projectionDigest: 'sha256:discovery',
    },
    runId: 'run-1',
    signalSummary: { semanticSimilarity: 0.99, evidenceCoverage: 0.5, novelty: 0.25 },
    rationale: 'A bounded derived signal.',
    derivationSummary: 'Derived from an existing projection.',
    provenance: {
      schemaVersion: '1.0.0',
      kind: 'DETERMINISTIC',
      ruleId: 'rule-1',
      ruleVersion: '1',
      inputDigest: 'sha256:input',
    },
    accessScope: ['owner'],
    sensitivity: 'internal',
    fingerprint: 'sha256:finding',
    fingerprintVersion: 'discovery-fingerprint:v1',
    retentionClass: 'DURABLE_DERIVED_RECORD',
    createdAt: '2026-08-31T00:00:00.000Z',
    ...overrides,
  } as DiscoveryFindingEnvelopeInputV1);

const scope: DiscoveryProductReadInput = {
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProject: {
    id: 'project-1',
    label: 'Project 1',
    isOwner: true,
    sensitivityClearance: 'private',
  },
  accessibleProjects: [],
  accessRevision: 'project-1:owner',
  policyContextRevision: '7',
  accessScope: ['owner'],
};

const evidence: EvidenceSpan = {
  evidenceId: 'evidence-1',
  revisionId: 'evidence-revision-1',
  projectId: 'project-1',
  sourceId: 'source-1',
  sourceVersionId: 'source-version-1',
  pointer: '',
  nodeKind: 'document',
  origin: 'source',
  position: { type: 'TextPositionSelector', start: 0, end: 4, unit: 'unicode-code-point' },
  quote: { type: 'TextQuoteSelector', exact: 'Milo' },
  exactHash: 'sha256:quote',
  accessScope: ['owner'],
  sensitivity: 'internal',
  createdAt: '2026-08-31T00:00:00.000Z',
};

class FakeDiscoverySource implements DiscoveryProductReadSource {
  constructor(
    readonly findings: readonly DiscoveryFindingEnvelopeV1[],
    readonly lifecycle: DiscoveryFindingLifecycleCurrentV1,
    readonly disposition: Exclude<DiscoveryProductReentryStateV1, 'NOT_REQUESTED'> | undefined,
    readonly reviewBinding?: DiscoveryProductReviewBindingV1,
    readonly resourceAuthorization: (
      resource: DiscoveryResourceRefV1,
    ) => DiscoveryProductResourceAuthorizationV1 | undefined = (resource) =>
      resource.projectId === 'project-1' && resource.resourceId === 'claim-1'
        ? {
            projectId: resource.projectId,
            resourceKind: resource.resourceKind,
            resourceId: resource.resourceId,
            resourceState: resource.resourceState,
            ...(resource.resourceRevision === undefined
              ? {}
              : { resourceRevision: resource.resourceRevision }),
            accessScope: ['owner'],
            sensitivity: 'internal',
            graphEligible: true,
          }
        : undefined,
  ) {}

  async listFindings(
    _projectId: string,
    after: DiscoveryProductPageCursorV1 | undefined,
    limit: number,
  ) {
    const ordered = [...this.findings].sort(
      (a, b) => a.findingId.localeCompare(b.findingId) || a.findingRevision - b.findingRevision,
    );
    const start =
      after === undefined
        ? 0
        : ordered.findIndex(
            (item) =>
              item.findingId > after.findingId ||
              (item.findingId === after.findingId && item.findingRevision > after.findingRevision),
          );
    return ordered.slice(
      start < 0 ? ordered.length : start,
      (start < 0 ? ordered.length : start) + limit,
    );
  }

  async findFinding(input: { projectId: string; findingId: string; findingRevision: number }) {
    return this.findings.find(
      (item) =>
        item.projectId === input.projectId &&
        item.findingId === input.findingId &&
        item.findingRevision === input.findingRevision,
    );
  }

  async findLifecycle(input: DiscoveryProductFindingIdentityV1) {
    return {
      ...this.lifecycle,
      projectId: input.projectId,
      findingId: input.findingId,
      findingRevision: input.findingRevision,
    };
  }
  async findReentryDisposition() {
    return this.disposition;
  }
  async findReviewBinding() {
    return this.reviewBinding;
  }
  async findResourceAuthorization(resource: DiscoveryResourceRefV1) {
    return this.resourceAuthorization(resource);
  }
  async findEvidence(_projectId: string, evidenceId: string) {
    return evidenceId === evidence.evidenceId ? evidence : undefined;
  }
}

describe('AKP-6 WP1 Discovery Product coordinator', () => {
  it('uses current lifecycle authority, keeps DERIVED_INFERENCE, and preserves real lineage', async () => {
    const source = new FakeDiscoverySource(
      [finding()],
      {
        projectId: 'project-1',
        findingId: 'finding-1',
        findingRevision: 1,
        lifecycleState: 'REVIEW_READY',
        lifecycleRevision: 2,
        updatedAt: '2026-08-31T00:01:00.000Z',
      },
      'PROCESSED',
      {
        projectId: 'project-1',
        findingId: 'finding-1',
        findingRevision: 1,
        reviewResourceId: 'review-resource-1',
        resourceRevision: 1,
        lifecycleState: 'REVIEW_READY',
        reviewEligibility: 'ELIGIBLE_AFTER_VALIDATION',
      },
    );
    const result = await new FrontendDiscoveryProductReadCoordinator(source).readFinding({
      ...scope,
      request: { schemaVersion: '1.0.0', findingId: 'finding-1', findingRevision: 1 },
    });
    expect(result.finding.lifecycleState).toBe('REVIEW_READY');
    expect(result.finding.authority).toBe('DERIVED_INFERENCE');
    expect(result.finding.governance.reentryState).toBe('PROCESSED');
    expect(result.finding.governance.reviewResourceId).toBe('review-resource-1');
    expect(result.finding.capabilities.canOpenReview).toBe(true);
    expect(result.finding.capabilities.canOpenGraph).toBe(true);
    expect(result.finding.capabilities.canOpenActivity).toBe(false);
    expect(result.finding.capabilities.canInvestigate).toBe(false);
    expect(result.finding.lineage.evidence[0]).toMatchObject({
      evidenceId: 'evidence-1',
      sourceId: 'source-1',
      sourceVersionId: 'source-version-1',
      evidenceRevisionId: 'evidence-revision-1',
    });
    expect(result.finding.safeSignals).not.toHaveProperty('semanticSimilarity');
  });

  it('fails closed for a foreign-project finding and does not fabricate evidence', async () => {
    const foreign = finding({
      findingId: 'foreign',
      projectId: 'project-2',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'KNOWLEDGE_GAP',
        gapKind: 'MISSING_FACT',
        subject: 'Foreign',
        missingFact: 'hidden',
        question: 'hidden?',
      },
      relatedResourceRefs: [
        {
          schemaVersion: '1.0.0',
          resourceKind: 'CANONICAL_CLAIM',
          resourceId: 'foreign-claim',
          projectId: 'project-2',
          resourceState: 'CURRENT',
        },
      ],
    });
    const source = new FakeDiscoverySource(
      [foreign],
      {
        projectId: 'project-2',
        findingId: 'foreign',
        findingRevision: 1,
        lifecycleState: 'NEW',
        lifecycleRevision: 1,
        updatedAt: '2026-08-31T00:00:00.000Z',
      },
      undefined,
    );
    const result = await new FrontendDiscoveryProductReadCoordinator(source).listFindings({
      ...scope,
      request: { schemaVersion: '1.0.0', limit: 10 },
    });
    expect(result.findings).toEqual([]);
  });

  it.each([
    ['PROCESSED', 'UNKNOWN'],
    ['INELIGIBLE', 'UNKNOWN'],
    ['BLOCKED_NON_RETRYABLE', 'REVALIDATION_REQUIRED'],
    ['RETRYABLE', 'REVALIDATION_REQUIRED'],
  ] as const)(
    'maps the persisted %s re-entry disposition conservatively',
    async (disposition, freshness) => {
      const result = await new FrontendDiscoveryProductReadCoordinator(
        new FakeDiscoverySource(
          [finding()],
          {
            projectId: 'project-1',
            findingId: 'finding-1',
            findingRevision: 1,
            lifecycleState: 'REVIEW_READY',
            lifecycleRevision: 2,
            updatedAt: '2026-08-31T00:01:00.000Z',
          },
          disposition,
        ),
      ).readFinding({
        ...scope,
        request: { schemaVersion: '1.0.0', findingId: 'finding-1', findingRevision: 1 },
      });
      expect(result.finding.governance.reentryState).toBe(disposition);
      expect(result.finding.freshness.state).toBe(freshness);
    },
  );

  it('fails closed when a current related resource is revoked or over-clearance', async () => {
    const revoked = finding({
      relatedResourceRefs: [
        {
          schemaVersion: '1.0.0',
          resourceKind: 'CANONICAL_CLAIM',
          resourceId: 'revoked-claim',
          projectId: 'project-1',
          resourceState: 'CURRENT',
        },
      ],
    });
    const source = new FakeDiscoverySource(
      [revoked],
      {
        projectId: 'project-1',
        findingId: 'finding-1',
        findingRevision: 1,
        lifecycleState: 'REVIEW_READY',
        lifecycleRevision: 2,
        updatedAt: '2026-08-31T00:01:00.000Z',
      },
      undefined,
    );
    const listed = await new FrontendDiscoveryProductReadCoordinator(source).listFindings({
      ...scope,
      request: { schemaVersion: '1.0.0', limit: 10 },
    });
    expect(listed).not.toHaveProperty('count');
    expect(listed.findings).toEqual([]);
    await expect(
      new FrontendDiscoveryProductReadCoordinator(source).readFinding({
        ...scope,
        request: { schemaVersion: '1.0.0', findingId: 'finding-1', findingRevision: 1 },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const sensitive = new FakeDiscoverySource(
      [finding()],
      {
        projectId: 'project-1',
        findingId: 'finding-1',
        findingRevision: 1,
        lifecycleState: 'REVIEW_READY',
        lifecycleRevision: 2,
        updatedAt: '2026-08-31T00:01:00.000Z',
      },
      undefined,
      undefined,
      (resource) => ({
        projectId: resource.projectId,
        resourceKind: resource.resourceKind,
        resourceId: resource.resourceId,
        resourceState: resource.resourceState,
        accessScope: ['owner'],
        sensitivity: 'restricted',
        graphEligible: true,
      }),
    );
    const sensitiveListed = await new FrontendDiscoveryProductReadCoordinator(
      sensitive,
    ).listFindings({
      ...scope,
      request: { schemaVersion: '1.0.0', limit: 10 },
    });
    expect(sensitiveListed.findings).toEqual([]);

    const unavailable = new FakeDiscoverySource(
      [finding()],
      {
        projectId: 'project-1',
        findingId: 'finding-1',
        findingRevision: 1,
        lifecycleState: 'REVIEW_READY',
        lifecycleRevision: 2,
        updatedAt: '2026-08-31T00:01:00.000Z',
      },
      undefined,
      undefined,
      () => {
        throw new Error('authority unavailable');
      },
    );
    const unavailableListed = await new FrontendDiscoveryProductReadCoordinator(
      unavailable,
    ).listFindings({
      ...scope,
      request: { schemaVersion: '1.0.0', limit: 10 },
    });
    expect(unavailableListed.findings).toEqual([]);
  });

  it('protects typed payload resource references, keeps cursors opaque, and paginates without skips', async () => {
    const protectedPayload = finding({
      findingType: 'EVIDENCE_GAP',
      relatedResourceRefs: [
        {
          schemaVersion: '1.0.0',
          resourceKind: 'CANONICAL_CLAIM',
          resourceId: 'payload-only-secret',
          projectId: 'project-1',
          resourceState: 'CURRENT',
        },
      ],
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'EVIDENCE_GAP',
        coverageKind: 'ABSENT',
        affectedResourceRef: {
          schemaVersion: '1.0.0',
          resourceKind: 'CANONICAL_CLAIM',
          resourceId: 'payload-only-secret',
          projectId: 'project-1',
          resourceState: 'CURRENT',
        },
        coverageGap: 'hidden coverage',
        requiredEvidence: 'hidden evidence',
      },
    });
    const protectedSource = new FakeDiscoverySource(
      [protectedPayload],
      {
        projectId: 'project-1',
        findingId: 'finding-1',
        findingRevision: 1,
        lifecycleState: 'NEW',
        lifecycleRevision: 1,
        updatedAt: '2026-08-31T00:01:00.000Z',
      },
      undefined,
    );
    const protectedResult = await new FrontendDiscoveryProductReadCoordinator(
      protectedSource,
    ).listFindings({
      ...scope,
      request: { schemaVersion: '1.0.0', limit: 10 },
    });
    expect(protectedResult.findings).toEqual([]);

    const paginatedFindings = [
      finding({ findingId: 'finding-a' }),
      finding({
        findingId: 'finding-a-hidden',
        relatedResourceRefs: [
          {
            schemaVersion: '1.0.0',
            resourceKind: 'CANONICAL_CLAIM',
            resourceId: 'revoked-claim',
            projectId: 'project-1',
            resourceState: 'CURRENT',
          },
        ],
      }),
      finding({ findingId: 'finding-b' }),
      finding({ findingId: 'finding-c' }),
    ];
    const paginationSource = new FakeDiscoverySource(
      paginatedFindings,
      {
        projectId: 'project-1',
        findingId: 'finding-a',
        findingRevision: 1,
        lifecycleState: 'REVIEW_READY',
        lifecycleRevision: 2,
        updatedAt: '2026-08-31T00:01:00.000Z',
      },
      undefined,
    );
    const coordinator = new FrontendDiscoveryProductReadCoordinator(paginationSource, {
      cursorCodec: createEncryptedDiscoveryProductCursorCodec(
        'contract-test-discovery-cursor-secret',
      ),
    });
    const page1 = await coordinator.listFindings({
      ...scope,
      request: { schemaVersion: '1.0.0', limit: 1 },
    });
    expect(page1.findings.map((item) => item.findingId)).toEqual(['finding-a']);
    expect(page1.nextCursor).toBeDefined();
    expect(page1.nextCursor).not.toContain('finding-a');
    expect(page1.nextCursor).not.toContain('finding-hidden');
    const page2 = await coordinator.listFindings({
      ...scope,
      request: { schemaVersion: '1.0.0', limit: 1, cursor: page1.nextCursor },
    });
    expect(page2.findings.map((item) => item.findingId)).toEqual([]);
    const page3 = await coordinator.listFindings({
      ...scope,
      request: { schemaVersion: '1.0.0', limit: 1, cursor: page2.nextCursor },
    });
    expect(page3.findings.map((item) => item.findingId)).toEqual(['finding-b']);
    const page4 = await coordinator.listFindings({
      ...scope,
      request: { schemaVersion: '1.0.0', limit: 1, cursor: page3.nextCursor },
    });
    expect(page4.findings.map((item) => item.findingId)).toEqual(['finding-c']);
    expect(page4.nextCursor).toBeUndefined();

    const hiddenFirstSource = new FakeDiscoverySource(
      [
        finding({
          findingId: 'finding-0-hidden',
          relatedResourceRefs: paginatedFindings[1]!.relatedResourceRefs,
        }),
        paginatedFindings[0]!,
        paginatedFindings[2]!,
      ],
      {
        projectId: 'project-1',
        findingId: 'finding-a',
        findingRevision: 1,
        lifecycleState: 'REVIEW_READY',
        lifecycleRevision: 2,
        updatedAt: '2026-08-31T00:01:00.000Z',
      },
      undefined,
    );
    const hiddenFirstCoordinator = new FrontendDiscoveryProductReadCoordinator(hiddenFirstSource, {
      cursorCodec: createEncryptedDiscoveryProductCursorCodec(
        'contract-test-discovery-cursor-secret',
      ),
    });
    const hiddenFirstPage = await hiddenFirstCoordinator.listFindings({
      ...scope,
      request: { schemaVersion: '1.0.0', limit: 1 },
    });
    expect(hiddenFirstPage.findings).toEqual([]);
    expect(hiddenFirstPage.nextCursor).toBeDefined();
    expect(hiddenFirstPage.nextCursor).not.toContain('finding-0-hidden');
    const afterHiddenFirst = await hiddenFirstCoordinator.listFindings({
      ...scope,
      request: { schemaVersion: '1.0.0', limit: 1, cursor: hiddenFirstPage.nextCursor },
    });
    expect(afterHiddenFirst.findings.map((item) => item.findingId)).toEqual(['finding-a']);
  });

  it('does not expose a Review binding for non-ready current lifecycle', async () => {
    const source = new FakeDiscoverySource(
      [finding()],
      {
        projectId: 'project-1',
        findingId: 'finding-1',
        findingRevision: 1,
        lifecycleState: 'STALE',
        lifecycleRevision: 3,
        updatedAt: '2026-08-31T00:01:00.000Z',
      },
      undefined,
      {
        projectId: 'project-1',
        findingId: 'finding-1',
        findingRevision: 1,
        reviewResourceId: 'review-resource-1',
        resourceRevision: 1,
        lifecycleState: 'REVIEW_READY',
        reviewEligibility: 'ELIGIBLE_AFTER_VALIDATION',
      },
    );
    const result = await new FrontendDiscoveryProductReadCoordinator(source).readFinding({
      ...scope,
      request: { schemaVersion: '1.0.0', findingId: 'finding-1', findingRevision: 1 },
    });
    expect(result.finding.governance.reviewReadiness).toBe('NOT_ELIGIBLE');
    expect(result.finding.capabilities.canOpenReview).toBe(false);
  });
});
