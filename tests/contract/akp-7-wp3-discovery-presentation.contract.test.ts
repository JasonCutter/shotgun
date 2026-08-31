import { describe, expect, it } from 'vitest';

import {
  createDiscoveryFindingEnvelopeV1,
  decodeDiscoveryFeedbackEventV1,
  decodeDiscoverySuppressionDirectiveV1,
  type DiscoveryFindingEnvelopeInputV1,
  type DiscoveryFindingEnvelopeV1,
  type DiscoveryResourceRefV1,
} from '../../packages/contracts/src/index.js';
import { InMemoryDiscoveryFeedbackRepository } from '../../adapters/discovery-feedback-in-memory/src/index.js';
import {
  FrontendDiscoveryProductReadCoordinator,
  createEncryptedDiscoveryProductCursorCodec,
  type DiscoveryProductPageCursorV1,
  type DiscoveryProductReadInput,
  type DiscoveryProductReadSource,
  type DiscoveryProductResourceAuthorizationV1,
} from '../../modules/frontend-discovery-product/src/index.js';
import { rankAcceptedDiscoveryCandidatesV1 } from '../../modules/discovery-quality-gate/src/index.js';
import type { DiscoveryFindingLifecycleCurrentV1 } from '../../modules/discovery-finding-lifecycle/src/index.js';

const NOW = '2026-08-31T12:00:00.000Z';

const scope = (principalId = 'principal-a'): DiscoveryProductReadInput => ({
  principalId,
  sessionId: `session-${principalId}`,
  activeProject: {
    id: 'project-1',
    label: 'Project 1',
    isOwner: true,
    sensitivityClearance: 'private',
  },
  accessibleProjects: [],
  accessRevision: 'project-1:access-1',
  policyContextRevision: 'policy-context-1',
  accessScope: ['owner'],
});

const ref = (
  resourceId: string,
  resourceKind: DiscoveryResourceRefV1['resourceKind'] = 'CANONICAL_CLAIM',
) => ({
  schemaVersion: '1.0.0' as const,
  resourceKind,
  resourceId,
  projectId: 'project-1',
  resourceState: 'CURRENT' as const,
});

const finding = (
  findingId: string,
  overrides: Partial<DiscoveryFindingEnvelopeInputV1> = {},
): DiscoveryFindingEnvelopeV1 =>
  createDiscoveryFindingEnvelopeV1({
    schemaVersion: '1.0.0',
    findingId,
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
      missingFact: `fact-${findingId}`,
      question: `question-${findingId}`,
    },
    relatedResourceRefs: [],
    evidenceIds: [],
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
    runId: `run-${findingId}`,
    signalSummary: { novelty: 0.5, evidenceCoverage: 0.5 },
    rationale: 'bounded rationale',
    derivationSummary: 'bounded derivation',
    provenance: {
      schemaVersion: '1.0.0',
      kind: 'DETERMINISTIC',
      ruleId: 'rule-1',
      ruleVersion: '1',
      inputDigest: 'sha256:input',
    },
    accessScope: ['owner'],
    sensitivity: 'internal',
    fingerprint: `sha256:${findingId}`,
    fingerprintVersion: 'discovery-fingerprint:v1',
    retentionClass: 'DURABLE_DERIVED_RECORD',
    createdAt: NOW,
    ...overrides,
  } as DiscoveryFindingEnvelopeInputV1);

const mandatoryConflict = (findingId: string): DiscoveryFindingEnvelopeV1 => {
  const conflict = ref(`conflict-${findingId}`, 'CANONICAL_CONFLICT');
  return finding(findingId, {
    findingType: 'KNOWLEDGE_GAP',
    payload: {
      schemaVersion: '1.0.0',
      payloadType: 'KNOWLEDGE_GAP',
      gapKind: 'KNOWN_CONFLICT_QUESTION',
      knownConflictRef: conflict,
      missingResolutionInput: 'resolution input',
      question: 'which conflict resolution is current?',
    },
    relatedResourceRefs: [conflict],
    fingerprint: `sha256:${findingId}`,
  });
};

class Source implements DiscoveryProductReadSource {
  constructor(readonly findings: readonly DiscoveryFindingEnvelopeV1[]) {}

  async listFindings(
    projectId: string,
    after: DiscoveryProductPageCursorV1 | undefined,
    limit: number,
  ): Promise<readonly DiscoveryFindingEnvelopeV1[]> {
    const ordered = this.findings
      .filter((candidate) => candidate.projectId === projectId)
      .toSorted(
        (left, right) =>
          left.findingId.localeCompare(right.findingId) ||
          left.findingRevision - right.findingRevision,
      );
    const start = after
      ? ordered.findIndex(
          (candidate) =>
            candidate.findingId > after.findingId ||
            (candidate.findingId === after.findingId &&
              candidate.findingRevision > after.findingRevision),
        )
      : 0;
    return ordered.slice(
      start < 0 ? ordered.length : start,
      (start < 0 ? ordered.length : start) + limit,
    );
  }

  async findFinding(input: { projectId: string; findingId: string; findingRevision: number }) {
    return this.findings.find(
      (candidate) =>
        candidate.projectId === input.projectId &&
        candidate.findingId === input.findingId &&
        candidate.findingRevision === input.findingRevision,
    );
  }

  async findLifecycle(input: {
    projectId: string;
    findingId: string;
    findingRevision: number;
  }): Promise<DiscoveryFindingLifecycleCurrentV1 | undefined> {
    const candidate = await this.findFinding(input);
    return candidate
      ? {
          projectId: candidate.projectId,
          findingId: candidate.findingId,
          findingRevision: candidate.findingRevision,
          lifecycleState: candidate.lifecycleState,
          lifecycleRevision: 1,
          updatedAt: candidate.createdAt,
        }
      : undefined;
  }

  async findReentryDisposition() {
    return undefined;
  }

  async findReviewBinding() {
    return undefined;
  }

  async findResourceAuthorization(
    resource: DiscoveryResourceRefV1,
  ): Promise<DiscoveryProductResourceAuthorizationV1 | undefined> {
    return {
      projectId: resource.projectId,
      resourceKind: resource.resourceKind,
      resourceId: resource.resourceId,
      resourceState: resource.resourceState,
      ...(resource.resourceRevision === undefined
        ? {}
        : { resourceRevision: resource.resourceRevision }),
      accessScope: ['owner'],
      sensitivity: 'internal',
      graphEligible: false,
    };
  }

  async findEvidence() {
    return undefined;
  }
}

const feedback = (
  principalId: string,
  findingId: string,
  feedbackKind: 'USEFUL' | 'NOT_RELEVANT' | 'ALREADY_KNOWN' | 'TOO_FREQUENT',
  feedbackId: string,
  createdAt = NOW,
) =>
  decodeDiscoveryFeedbackEventV1({
    schemaVersion: '1.0.0',
    feedbackId,
    projectId: 'project-1',
    findingId,
    findingRevision: 1,
    actor: { type: 'user', id: principalId },
    principalId,
    feedbackClass: 'UTILITY',
    feedbackKind,
    scope: 'PROJECT',
    createdAt,
  });

const suppression = (
  principalId: string,
  sourceFindingId: string,
  suppressionKind: 'SUPPRESS_EXACT' | 'SUPPRESS_SIMILAR' | 'SNOOZE',
  suppressionId: string,
  overrides: Record<string, unknown> = {},
) =>
  decodeDiscoverySuppressionDirectiveV1({
    schemaVersion: '1.0.0',
    suppressionId,
    projectId: 'project-1',
    actor: { type: 'user', id: principalId },
    principalId,
    sourceFindingId,
    sourceFindingRevision: 1,
    suppressionKind,
    scope: 'FINDING',
    ...(suppressionKind === 'SUPPRESS_EXACT'
      ? {
          matcherKind: 'EXACT_FINGERPRINT',
          matcherVersion: 'discovery-fingerprint:v1',
          fingerprint: `sha256:${sourceFindingId}`,
          fingerprintVersion: 'discovery-fingerprint:v1',
        }
      : suppressionKind === 'SUPPRESS_SIMILAR'
        ? { matcherKind: 'SEMANTIC_FAMILY', matcherVersion: 'semantic-family:v1' }
        : { matcherKind: 'NONE', expiresAt: '2026-09-01T00:00:00.000Z' }),
    createdAt: NOW,
    ...overrides,
  });

const coordinator = (
  findings: readonly DiscoveryFindingEnvelopeV1[],
  repository: InMemoryDiscoveryFeedbackRepository,
  now = NOW,
) =>
  new FrontendDiscoveryProductReadCoordinator(new Source(findings), {
    feedbackRepository: repository,
    rankingAuthority: rankAcceptedDiscoveryCandidatesV1,
    now: () => now,
    cursorCodec: createEncryptedDiscoveryProductCursorCodec('akp-7-wp3-contract-secret'),
  });

describe('AKP-7 WP3 ranked Discovery presentation contract', () => {
  it('reuses deterministic ranking, applies latest bounded utility and ranks before pagination', async () => {
    const low = finding('finding-a', { signalSummary: { novelty: 0, evidenceCoverage: 0 } });
    const high = finding('finding-z', { signalSummary: { novelty: 1, evidenceCoverage: 1 } });
    const repository = new InMemoryDiscoveryFeedbackRepository(() => NOW);
    await repository.appendFeedback(
      feedback(
        'principal-a',
        'finding-a',
        'NOT_RELEVANT',
        'feedback-1',
        '2026-08-31T11:59:59.998Z',
      ),
    );
    await repository.appendFeedback(
      feedback('principal-a', 'finding-a', 'USEFUL', 'feedback-2', '2026-08-31T11:59:59.999Z'),
    );
    const product = coordinator([low, high], repository);
    const page = await product.listFindings({
      ...scope(),
      request: { schemaVersion: '1.0.0', limit: 1 },
    });
    expect(page.findings[0]?.findingId).toBe('finding-z');
    expect(page.findings[0]?.presentation).toEqual({ rank: 1, reasonCodes: ['BASE_RANK'] });
    expect(page.presentation).toMatchObject({
      algorithmVersion: 'discovery-ranking-policy:v1',
      policyIdentity: 'discovery-ranking-policy:builtin-v1',
      policySource: 'BUILT_IN_FALLBACK',
      utilityAdjustmentVersion: 'discovery-utility-adjustment:v1',
      semanticMatcherVersion: 'semantic-family:v1',
    });
    expect(page).not.toHaveProperty('truthProbability');
    const continuation = await product.listFindings({
      ...scope(),
      request: { schemaVersion: '1.0.0', limit: 1, cursor: page.nextCursor },
    });
    expect(continuation.findings[0]?.findingId).toBe('finding-a');
    expect(continuation.findings[0]?.presentation?.rank).toBe(2);
    expect(continuation.findings[0]?.presentation?.reasonCodes).toContain('UTILITY_USEFUL');
  });

  it('keeps utility and suppression principal-scoped and rejects cursor replay', async () => {
    const target = finding('finding-a');
    const other = finding('finding-b');
    const repository = new InMemoryDiscoveryFeedbackRepository(() => NOW);
    await repository.appendFeedback(
      feedback('principal-a', 'finding-a', 'NOT_RELEVANT', 'feedback-a'),
    );
    await repository.appendSuppression(
      suppression('principal-a', 'finding-b', 'SNOOZE', 'snooze-a'),
    );
    const product = coordinator([target, other], repository);
    const principalA = await product.listFindings({
      ...scope(),
      request: { schemaVersion: '1.0.0', limit: 10 },
    });
    expect(principalA.findings.map((entry) => entry.findingId)).toEqual(['finding-a']);
    const principalB = await product.listFindings({
      ...scope('principal-b'),
      request: { schemaVersion: '1.0.0', limit: 10 },
    });
    expect(principalB.findings.map((entry) => entry.findingId)).toEqual(['finding-a', 'finding-b']);

    const cursorProduct = coordinator([target, other, finding('finding-c')], repository);
    const first = await cursorProduct.listFindings({
      ...scope(),
      request: { schemaVersion: '1.0.0', limit: 1 },
    });
    await expect(
      cursorProduct.listFindings({
        ...scope('principal-b'),
        request: { schemaVersion: '1.0.0', limit: 1, cursor: first.nextCursor },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('enforces exact fingerprint/version, snooze expiry, and latest utility monotonicity', async () => {
    const exact = finding('finding-a');
    const changed = finding('finding-b', { fingerprint: 'sha256:changed' });
    const repository = new InMemoryDiscoveryFeedbackRepository(() => NOW);
    await repository.appendSuppression(
      suppression('principal-a', 'finding-a', 'SUPPRESS_EXACT', 'exact-a'),
    );
    await repository.appendSuppression(
      suppression('principal-a', 'finding-a', 'SUPPRESS_EXACT', 'exact-wrong-version', {
        fingerprintVersion: 'discovery-fingerprint:v2',
      }),
    );
    await repository.appendSuppression(
      suppression('principal-a', 'finding-b', 'SNOOZE', 'snooze-b'),
    );
    const hidden = await coordinator([exact, changed], repository).listFindings({
      ...scope(),
      request: { schemaVersion: '1.0.0', limit: 10 },
    });
    expect(hidden.findings.map((entry) => entry.findingId)).toEqual([]);

    const visibleAfterExpiry = await coordinator(
      [exact, changed],
      repository,
      '2026-09-02T00:00:00.000Z',
    ).listFindings({
      ...scope(),
      request: { schemaVersion: '1.0.0', limit: 10 },
    });
    expect(visibleAfterExpiry.findings.map((entry) => entry.findingId)).toEqual(['finding-b']);
  });

  it('limits semantic-family suppression to explicit matcher scope and preserves mandatory visibility', async () => {
    const source = finding('finding-a');
    const sameFamily = finding('finding-b');
    const unrelated = finding('finding-c', {
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'KNOWLEDGE_GAP',
        gapKind: 'MISSING_FACT',
        subject: 'Different subject',
        missingFact: 'fact-c',
        question: 'question-c',
      },
    });
    const mandatory = mandatoryConflict('finding-d');
    const repository = new InMemoryDiscoveryFeedbackRepository(() => NOW);
    await repository.appendSuppression(
      suppression('principal-a', 'finding-a', 'SUPPRESS_SIMILAR', 'similar-finding'),
    );
    await repository.appendSuppression(
      suppression('principal-a', 'finding-d', 'SUPPRESS_EXACT', 'exact-mandatory'),
    );
    const findingScope = await coordinator(
      [source, sameFamily, unrelated, mandatory],
      repository,
    ).listFindings({
      ...scope(),
      request: { schemaVersion: '1.0.0', limit: 10 },
    });
    expect(findingScope.findings.map((entry) => entry.findingId)).toEqual([
      'finding-b',
      'finding-c',
      'finding-d',
    ]);
    expect(
      findingScope.findings.find((entry) => entry.findingId === 'finding-d')?.presentation
        ?.reasonCodes,
    ).toContain('MANDATORY_VISIBILITY_OVERRIDE');

    const projectDirective = suppression(
      'principal-a',
      'finding-a',
      'SUPPRESS_SIMILAR',
      'similar-project',
      {
        scope: 'PROJECT',
      },
    );
    const projectRepository = new InMemoryDiscoveryFeedbackRepository(() => NOW);
    await projectRepository.appendSuppression(projectDirective);
    const projectScope = await coordinator(
      [source, sameFamily, unrelated],
      projectRepository,
    ).listFindings({
      ...scope(),
      request: { schemaVersion: '1.0.0', limit: 10 },
    });
    expect(projectScope.findings.map((entry) => entry.findingId)).toEqual(['finding-c']);
  });
});
