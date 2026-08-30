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
} from '../../packages/contracts/src/index.js';
import {
  FrontendDiscoveryProductReadCoordinator,
  type DiscoveryProductReadInput,
  type DiscoveryProductReadSource,
  type DiscoveryProductReviewBindingV1,
} from '../../modules/frontend-discovery-product/src/index.js';
import type { DiscoveryFindingPageCursorV1 } from '../../modules/discovery-finding-persistence/src/index.js';
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
  ) {}

  async listFindings(
    _projectId: string,
    after: DiscoveryFindingPageCursorV1 | undefined,
    limit: number,
  ) {
    const ordered = [...this.findings].sort((a, b) => a.findingId.localeCompare(b.findingId));
    const start =
      after === undefined ? 0 : ordered.findIndex((item) => item.findingId > after.findingId);
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

  async findLifecycle() {
    return this.lifecycle;
  }
  async findReentryDisposition() {
    return this.disposition;
  }
  async findReviewBinding() {
    return this.reviewBinding;
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
    expect(result.finding.lineage.evidence[0]).toMatchObject({
      evidenceId: 'evidence-1',
      sourceId: 'source-1',
      sourceVersionId: 'source-version-1',
      evidenceSpanId: 'evidence-revision-1',
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
});
