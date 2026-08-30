import { describe, expect, it } from 'vitest';

import type {
  ClaimCandidate,
  DiscoveryApprovedResourceRevisionRefV1,
  DiscoveryFindingEnvelopeInputV1,
  DiscoveryFindingPayloadV1,
  DiscoveryResourceRefV1,
} from '../../packages/contracts/src/index.js';
import {
  DISCOVERY_DERIVED_VALIDATION_PROFILE_V1,
  DISCOVERY_FINDING_LIFECYCLE_STATES,
  DISCOVERY_FINDING_TYPES,
  DISCOVERY_REENTRY_ELIGIBILITY_STATES,
  DISCOVERY_REENTRY_TARGET_BY_TYPE,
  DISCOVERY_REVIEW_ELIGIBILITY_STATES,
  assertDiscoveryReentryManifestMatchesFindingV1,
  computeDiscoveryReentryLogicalIdentityV1,
  createDerivedKnowledgeCandidateV1,
  createDiscoveryFindingEnvelopeV1,
  createDiscoveryReentryManifestV1,
  decodeDerivedKnowledgeCandidateV1,
  decodeDiscoveryApprovedResourceRevisionRefsV1,
  decodeDiscoveryCandidateOriginV1,
  decodeDiscoveryDerivedValidationProfileV1,
  decodeDiscoveryFindingReadyV1,
  decodeDiscoveryReentryManifestV1,
  deriveDiscoveryReentryEligibilityV1,
  deriveDiscoveryReviewEligibilityV1,
  discoveryCandidateOriginFromDerivedCandidateV1,
  validateDiscoveryApprovedResourceRevisionResolutionV1,
} from '../../packages/contracts/src/index.js';

const approvedRef = (
  resourceId: string,
  overrides: Partial<DiscoveryResourceRefV1> = {},
): DiscoveryResourceRefV1 => ({
  schemaVersion: '1.0.0',
  resourceKind: 'CANONICAL_CLAIM',
  resourceId,
  projectId: 'project-1',
  resourceState: 'APPROVED',
  resourceRevision: 'claim-revision-4',
  ...overrides,
});

const resolvedRef = (
  resourceId: string,
  overrides: Partial<DiscoveryApprovedResourceRevisionRefV1> = {},
): DiscoveryApprovedResourceRevisionRefV1 => ({
  schemaVersion: '1.0.0',
  resourceKind: 'CANONICAL_CLAIM',
  resourceId,
  projectId: 'project-1',
  resourceState: 'APPROVED',
  resourceRevision: 'authoritative-revision-4',
  ...overrides,
});

const knowledgeGapPayload: DiscoveryFindingPayloadV1 = {
  schemaVersion: '1.0.0',
  payloadType: 'KNOWLEDGE_GAP',
  gapKind: 'MISSING_FACT',
  subject: 'Milo',
  missingFact: 'current weight',
  question: "What is Milo's current weight?",
};

const actionPayload: DiscoveryFindingPayloadV1 = {
  schemaVersion: '1.0.0',
  payloadType: 'ACTION_SUGGESTION',
  suggestedAction: 'Review the related claims together.',
  rationale: 'A human review may resolve the derived signal.',
  affectedResourceRefs: [approvedRef('claim-1')],
  executionStatus: 'CANDIDATE_ONLY',
};

const findingInput = (
  findingType: DiscoveryFindingPayloadV1['payloadType'] = 'KNOWLEDGE_GAP',
  payload: DiscoveryFindingPayloadV1 = knowledgeGapPayload,
  relatedResourceRefs: readonly DiscoveryResourceRefV1[] = [approvedRef('claim-1')],
  overrides: Partial<DiscoveryFindingEnvelopeInputV1> = {},
): DiscoveryFindingEnvelopeInputV1 =>
  ({
    schemaVersion: '1.0.0',
    findingId: 'finding-1',
    findingRevision: 2,
    projectId: 'project-1',
    findingType,
    generationMethod: 'DETERMINISTIC',
    lifecycleState: 'NEW',
    payload,
    relatedResourceRefs,
    evidenceIds: ['evidence-1'],
    sourceProjectionDigest: 'sha256:projection-4',
    canonicalBase: {
      schemaVersion: '1.0.0',
      canonicalVersion: 4,
      snapshotDigest: 'sha256:canonical-4',
    },
    discoveryBase: {
      schemaVersion: '1.0.0',
      projectionRevision: 'projection-revision-4',
      projectionDigest: 'sha256:discovery-4',
    },
    runId: 'run-1',
    signalSummary: { novelty: 0.4, evidenceCoverage: 0.2 },
    rationale: 'A bounded signal identifies a derived knowledge gap.',
    derivationSummary: 'Derived from a pinned discovery projection.',
    provenance: {
      schemaVersion: '1.0.0',
      kind: 'DETERMINISTIC',
      ruleId: 'discovery.rule.gap',
      ruleVersion: '3',
      inputDigest: 'sha256:input-4',
    },
    accessScope: ['owner', 'reviewer'],
    sensitivity: 'internal',
    fingerprint: 'sha256:finding-1',
    fingerprintVersion: 'discovery-fingerprint:v1',
    retentionClass: 'DURABLE_DERIVED_RECORD',
    createdAt: '2026-08-30T00:00:00.000Z',
    ...overrides,
  }) as DiscoveryFindingEnvelopeInputV1;

describe('AKP-5 WP1 re-entry and derived-validation contracts', () => {
  it('decodes the strict manifest shape and rejects omissions/unknown fields', () => {
    const sourceFinding = createDiscoveryFindingEnvelopeV1(findingInput());
    const manifest = createDiscoveryReentryManifestV1({
      manifestId: 'manifest-1',
      finding: sourceFinding,
      requestedReentryPurpose: 'DERIVED_PROVENANCE_VALIDATION',
      createdAt: '2026-08-30T00:01:00.000Z',
    });

    expect(decodeDiscoveryReentryManifestV1(manifest)).toEqual(manifest);
    const missing = { ...manifest } as Record<string, unknown>;
    delete missing.canonicalBase;
    expect(() => decodeDiscoveryReentryManifestV1(missing)).toThrow(/canonicalBase.*required/);
    expect(() => decodeDiscoveryReentryManifestV1({ ...manifest, confidence: 0.9 })).toThrow(
      /unknown field/,
    );
    expect(manifest).not.toHaveProperty('sourceVersionId');
  });

  it('uses deterministic versioned identity and ignores creation/delivery noise', () => {
    const manifest = createDiscoveryReentryManifestV1({
      manifestId: 'manifest-random-a',
      finding: createDiscoveryFindingEnvelopeV1(findingInput()),
      requestedReentryPurpose: 'DERIVED_PROVENANCE_VALIDATION',
      createdAt: '2026-08-30T00:01:00.000Z',
    });
    const identity = computeDiscoveryReentryLogicalIdentityV1(manifest);
    const retryIdentity = computeDiscoveryReentryLogicalIdentityV1({
      ...manifest,
      manifestId: 'manifest-random-b',
      requestedReentryPurpose: manifest.requestedReentryPurpose,
    });
    expect(retryIdentity).toEqual(identity);

    expect(
      computeDiscoveryReentryLogicalIdentityV1({
        ...manifest,
        findingRevision: manifest.findingRevision + 1,
      }).logicalIdentityKey,
    ).not.toBe(identity.logicalIdentityKey);
    expect(
      computeDiscoveryReentryLogicalIdentityV1({
        ...manifest,
        requestedReentryPurpose: 'RECHECK_STALE_BASE',
      }).logicalIdentityKey,
    ).not.toBe(identity.logicalIdentityKey);
    expect(
      computeDiscoveryReentryLogicalIdentityV1({
        ...manifest,
        canonicalBase: { ...manifest.canonicalBase, canonicalVersion: 5 },
      }).logicalIdentityKey,
    ).not.toBe(identity.logicalIdentityKey);
    expect(identity.identityVersion).toBe('discovery-reentry-identity:v1');
  });

  it('keeps SOURCE_EVIDENCE and DERIVED_DISCOVERY origins discriminated', () => {
    const direct = decodeDiscoveryCandidateOriginV1({
      origin: 'SOURCE_EVIDENCE',
      sourceVersionId: 'source-version-1',
      evidenceIds: ['evidence-1'],
    });
    expect(direct.origin).toBe('SOURCE_EVIDENCE');
    expect(() =>
      decodeDiscoveryCandidateOriginV1({ origin: 'SOURCE_EVIDENCE', evidenceIds: ['evidence-1'] }),
    ).toThrow(/sourceVersionId.*required/);

    const derived = createDerivedKnowledgeCandidateV1({
      candidateId: 'derived-candidate-1',
      finding: createDiscoveryFindingEnvelopeV1(findingInput()),
      manifest: createDiscoveryReentryManifestV1({
        manifestId: 'manifest-1',
        finding: createDiscoveryFindingEnvelopeV1(findingInput()),
        requestedReentryPurpose: 'DERIVED_PROVENANCE_VALIDATION',
        createdAt: '2026-08-30T00:01:00.000Z',
      }),
      approvedRelatedResourceRefs: [resolvedRef('claim-1')],
      createdAt: '2026-08-30T00:02:00.000Z',
    });
    const derivedOrigin = discoveryCandidateOriginFromDerivedCandidateV1(derived);
    expect(derived.origin).toBe('DERIVED_DISCOVERY');
    expect(derivedOrigin.origin).toBe('DERIVED_DISCOVERY');
    expect(derivedOrigin.findingId).toBe('finding-1');
    expect(derived).not.toHaveProperty('sourceVersionId');
    expect(() =>
      decodeDerivedKnowledgeCandidateV1({ ...derived, sourceVersionId: 'fake' }),
    ).toThrow(/unknown field/);
  });

  it('preserves finding, manifest, base, approved-resource and Evidence lineage', () => {
    const sourceFinding = createDiscoveryFindingEnvelopeV1(findingInput());
    const manifest = createDiscoveryReentryManifestV1({
      manifestId: 'manifest-lineage-1',
      finding: sourceFinding,
      requestedReentryPurpose: 'DERIVED_PROVENANCE_VALIDATION',
      createdAt: '2026-08-30T00:01:00.000Z',
    });
    const candidate = createDerivedKnowledgeCandidateV1({
      candidateId: 'derived-lineage-1',
      finding: sourceFinding,
      manifest,
      approvedRelatedResourceRefs: [resolvedRef('claim-1')],
      validationProfile: DISCOVERY_DERIVED_VALIDATION_PROFILE_V1,
      createdAt: '2026-08-30T00:02:00.000Z',
    });
    const resolvedRelatedResourceRefs = [resolvedRef('claim-1')];
    expect(candidate).toMatchObject({
      projectId: 'project-1',
      findingId: sourceFinding.findingId,
      findingRevision: sourceFinding.findingRevision,
      manifestId: manifest.manifestId,
      sourceProjectionDigest: sourceFinding.sourceProjectionDigest,
      canonicalBase: sourceFinding.canonicalBase,
      discoveryBase: sourceFinding.discoveryBase,
      relatedResourceRefs: resolvedRelatedResourceRefs,
      evidenceIds: manifest.evidenceIds,
      derivationProvenance: sourceFinding.provenance,
    });
    expect(manifest.relatedResourceRefs).toEqual([
      expect.objectContaining({ resourceId: 'claim-1', resourceRevision: 'claim-revision-4' }),
    ]);
    expect(candidate.relatedResourceRefs[0]?.resourceState).toBe('APPROVED');
    expect(candidate.relatedResourceRefs[0]?.resourceRevision).toBe('authoritative-revision-4');
    expect(decodeDerivedKnowledgeCandidateV1(candidate)).toEqual(candidate);
  });

  it('has exactly one finite mapping intent for each of the seven finding types', () => {
    expect(Object.keys(DISCOVERY_REENTRY_TARGET_BY_TYPE).sort()).toEqual(
      [...DISCOVERY_FINDING_TYPES].sort(),
    );
    for (const findingType of DISCOVERY_FINDING_TYPES) {
      expect(DISCOVERY_REENTRY_TARGET_BY_TYPE[findingType]).toEqual(expect.any(String));
    }
    expect(DISCOVERY_REENTRY_TARGET_BY_TYPE.ACTION_SUGGESTION).toBe('ACTION_CANDIDATE_GOVERNANCE');
    expect(DISCOVERY_REENTRY_TARGET_BY_TYPE.KNOWLEDGE_GAP).toBe(
      'VALIDATION_OR_KNOWLEDGE_GAP_GOVERNANCE',
    );
  });

  it('rejects unsupported mappings, keeps gaps non-Fact and keeps actions candidate-only', () => {
    const gapFinding = createDiscoveryFindingEnvelopeV1(findingInput());
    const gapManifest = createDiscoveryReentryManifestV1({
      manifestId: 'manifest-gap-1',
      finding: gapFinding,
      requestedReentryPurpose: 'DERIVED_PROVENANCE_VALIDATION',
      createdAt: '2026-08-30T00:01:00.000Z',
    });
    const gapCandidate = createDerivedKnowledgeCandidateV1({
      candidateId: 'candidate-gap-1',
      finding: gapFinding,
      manifest: gapManifest,
      approvedRelatedResourceRefs: [resolvedRef('claim-1')],
      createdAt: '2026-08-30T00:02:00.000Z',
    });
    expect(gapCandidate.governanceTarget).toContain('KNOWLEDGE_GAP');
    expect(gapCandidate).not.toHaveProperty('fact');
    expect(() =>
      decodeDerivedKnowledgeCandidateV1({
        ...gapCandidate,
        governanceTarget: 'ACTION_CANDIDATE_GOVERNANCE',
      }),
    ).toThrow(/governanceTarget/);

    const actionFinding = createDiscoveryFindingEnvelopeV1(
      findingInput('ACTION_SUGGESTION', actionPayload, [approvedRef('claim-1')]),
    );
    const actionCandidate = createDerivedKnowledgeCandidateV1({
      candidateId: 'candidate-action-1',
      finding: actionFinding,
      manifest: createDiscoveryReentryManifestV1({
        manifestId: 'manifest-action-1',
        finding: actionFinding,
        requestedReentryPurpose: 'DERIVED_PROVENANCE_VALIDATION',
        createdAt: '2026-08-30T00:01:00.000Z',
      }),
      approvedRelatedResourceRefs: [resolvedRef('claim-1')],
      createdAt: '2026-08-30T00:02:00.000Z',
    });
    expect(actionCandidate.actionExecutionStatus).toBe('CANDIDATE_ONLY');
    expect(() =>
      decodeDerivedKnowledgeCandidateV1({
        ...actionCandidate,
        actionExecutionStatus: 'EXECUTE',
      }),
    ).toThrow();
  });

  it('enforces project/security inheritance and approved revision requirements', () => {
    const sourceFinding = createDiscoveryFindingEnvelopeV1(findingInput());
    const manifest = createDiscoveryReentryManifestV1({
      manifestId: 'manifest-security-1',
      finding: sourceFinding,
      requestedReentryPurpose: 'DERIVED_PROVENANCE_VALIDATION',
      createdAt: '2026-08-30T00:01:00.000Z',
    });
    expect(() =>
      assertDiscoveryReentryManifestMatchesFindingV1(
        { ...manifest, accessScope: ['owner', 'admin'] },
        sourceFinding,
      ),
    ).toThrow(/must not widen/);
    expect(() =>
      assertDiscoveryReentryManifestMatchesFindingV1(
        { ...manifest, sensitivity: 'public' },
        sourceFinding,
      ),
    ).toThrow(/must not weaken/);
    expect(() =>
      decodeDiscoveryReentryManifestV1({
        ...manifest,
        relatedResourceRefs: [{ ...approvedRef('other'), projectId: 'project-2' }],
      }),
    ).toThrow(/projectId/);
    const currentFinding = createDiscoveryFindingEnvelopeV1(
      findingInput('KNOWLEDGE_GAP', knowledgeGapPayload, [
        { ...approvedRef('claim-1'), resourceState: 'CURRENT' },
      ]),
    );
    const currentManifest = createDiscoveryReentryManifestV1({
      manifestId: 'manifest-current-resource',
      finding: currentFinding,
      requestedReentryPurpose: 'DERIVED_PROVENANCE_VALIDATION',
      createdAt: '2026-08-30T00:01:00.000Z',
    });
    expect(() =>
      createDerivedKnowledgeCandidateV1({
        candidateId: 'candidate-current-resource',
        finding: currentFinding,
        manifest: currentManifest,
        approvedRelatedResourceRefs: [],
        createdAt: '2026-08-30T00:02:00.000Z',
      }),
    ).toThrow(/exactly one resolved ref/);
  });

  it('separates production-shaped Finding refs from server-resolved approved revisions', () => {
    const productionShapedRef: DiscoveryResourceRefV1 = {
      schemaVersion: '1.0.0',
      resourceKind: 'CANONICAL_CLAIM',
      resourceId: 'claim-1',
      projectId: 'project-1',
      resourceState: 'APPROVED',
    };
    const productionFinding = createDiscoveryFindingEnvelopeV1(
      findingInput('KNOWLEDGE_GAP', knowledgeGapPayload, [productionShapedRef]),
    );
    const manifest = createDiscoveryReentryManifestV1({
      manifestId: 'manifest-production-shaped-1',
      finding: productionFinding,
      requestedReentryPurpose: 'DERIVED_PROVENANCE_VALIDATION',
      createdAt: '2026-08-30T00:01:00.000Z',
    });
    expect(manifest.relatedResourceRefs).toEqual([productionShapedRef]);
    expect(manifest.relatedResourceRefs[0]).not.toHaveProperty('resourceRevision');

    const resolved = resolvedRef('claim-1', { resourceRevision: 'authoritative-revision-X' });
    expect(
      validateDiscoveryApprovedResourceRevisionResolutionV1(manifest.relatedResourceRefs, [
        resolved,
      ]),
    ).toEqual([resolved]);
    const candidate = createDerivedKnowledgeCandidateV1({
      candidateId: 'candidate-production-shaped-1',
      finding: productionFinding,
      manifest,
      approvedRelatedResourceRefs: [resolved],
      createdAt: '2026-08-30T00:02:00.000Z',
    });
    expect(candidate.relatedResourceRefs).toEqual([resolved]);
    expect(candidate.relatedResourceRefs[0]?.resourceRevision).toBe('authoritative-revision-X');
    expect(candidate).not.toHaveProperty('sourceVersionId');

    expect(() =>
      createDerivedKnowledgeCandidateV1({
        candidateId: 'candidate-without-resolution',
        finding: productionFinding,
        manifest,
        approvedRelatedResourceRefs: [],
        createdAt: '2026-08-30T00:02:00.000Z',
      }),
    ).toThrow(/exactly one resolved ref/);
  });

  it('fails closed for every approved-revision one-to-one resolution mismatch', () => {
    const original = [
      {
        ...approvedRef('claim-1'),
        resourceState: 'CURRENT' as const,
        resourceRevision: undefined,
      },
      {
        ...approvedRef('claim-2'),
        resourceState: 'CURRENT' as const,
        resourceRevision: undefined,
      },
    ];
    const validResolved = [resolvedRef('claim-1'), resolvedRef('claim-2')];
    expect(validateDiscoveryApprovedResourceRevisionResolutionV1(original, validResolved)).toEqual(
      validResolved,
    );
    expect(() =>
      validateDiscoveryApprovedResourceRevisionResolutionV1(original, [resolvedRef('claim-1')]),
    ).toThrow(/exactly one resolved ref/);
    expect(() =>
      validateDiscoveryApprovedResourceRevisionResolutionV1(original, [
        resolvedRef('claim-1'),
        resolvedRef('foreign'),
      ]),
    ).toThrow(/preserve projectId, resourceKind and resourceId/);
    expect(() =>
      validateDiscoveryApprovedResourceRevisionResolutionV1(original, [
        resolvedRef('claim-1'),
        resolvedRef('claim-2', { projectId: 'project-2' }),
      ]),
    ).toThrow(/preserve projectId, resourceKind and resourceId/);
    expect(() =>
      validateDiscoveryApprovedResourceRevisionResolutionV1(original, [
        resolvedRef('claim-1'),
        resolvedRef('claim-2', { resourceKind: 'CANONICAL_ENTITY' }),
      ]),
    ).toThrow(/preserve projectId, resourceKind and resourceId/);
    expect(() =>
      validateDiscoveryApprovedResourceRevisionResolutionV1(original, [
        resolvedRef('claim-1'),
        resolvedRef('other-id'),
      ]),
    ).toThrow(/preserve projectId, resourceKind and resourceId/);
    expect(() =>
      validateDiscoveryApprovedResourceRevisionResolutionV1(original, [
        resolvedRef('claim-1'),
        resolvedRef('claim-1'),
      ]),
    ).toThrow(/duplicate resolved resource identities/);
    expect(() =>
      validateDiscoveryApprovedResourceRevisionResolutionV1(original, [
        resolvedRef('claim-1'),
        {
          ...resolvedRef('claim-2'),
          resourceState: 'CURRENT',
        },
      ]),
    ).toThrow(/must be APPROVED/);
    expect(() =>
      validateDiscoveryApprovedResourceRevisionResolutionV1(original, [
        resolvedRef('claim-1'),
        {
          ...resolvedRef('claim-2'),
          resourceRevision: undefined,
        },
      ]),
    ).toThrow(/resourceRevision.*required/);
    expect(() =>
      decodeDiscoveryApprovedResourceRevisionRefsV1([
        resolvedRef('claim-1'),
        resolvedRef('claim-1'),
      ]),
    ).toThrow(/duplicate resolved resource identities/);
  });

  it('keeps eligibility separate from Review eligibility and preserves stale/base vocabulary', () => {
    expect(DISCOVERY_REENTRY_ELIGIBILITY_STATES).toEqual([
      'ELIGIBLE_FOR_VALIDATION',
      'NOT_ELIGIBLE',
      'STALE',
      'TERMINAL',
    ]);
    expect(DISCOVERY_REVIEW_ELIGIBILITY_STATES).toEqual([
      'NOT_ELIGIBLE',
      'ELIGIBLE_AFTER_VALIDATION',
    ]);
    expect(deriveDiscoveryReentryEligibilityV1('NEW')).toBe('ELIGIBLE_FOR_VALIDATION');
    expect(deriveDiscoveryReentryEligibilityV1('VALIDATING')).toBe('ELIGIBLE_FOR_VALIDATION');
    expect(deriveDiscoveryReentryEligibilityV1('STALE')).toBe('STALE');
    expect(deriveDiscoveryReentryEligibilityV1('RESOLVED')).toBe('TERMINAL');
    expect(
      deriveDiscoveryReviewEligibilityV1({
        lifecycleState: 'REVIEW_READY',
        derivedValidationComplete: true,
        comparisonPreparationComplete: true,
        stale: false,
      }),
    ).toBe('ELIGIBLE_AFTER_VALIDATION');
    expect(
      deriveDiscoveryReviewEligibilityV1({
        lifecycleState: 'REVIEW_READY',
        derivedValidationComplete: false,
        comparisonPreparationComplete: true,
        stale: false,
      }),
    ).toBe('NOT_ELIGIBLE');
    expect(DISCOVERY_FINDING_LIFECYCLE_STATES).toContain('REENTERED');
    expect(DISCOVERY_FINDING_LIFECYCLE_STATES).toContain('SUPERSEDED');
  });

  it('round-trips the profile and remains compatible with FindingReady', () => {
    expect(
      decodeDiscoveryDerivedValidationProfileV1(DISCOVERY_DERIVED_VALIDATION_PROFILE_V1),
    ).toEqual(DISCOVERY_DERIVED_VALIDATION_PROFILE_V1);
    expect(() =>
      decodeDiscoveryDerivedValidationProfileV1({
        ...DISCOVERY_DERIVED_VALIDATION_PROFILE_V1,
        provider: 'engine-name',
      }),
    ).toThrow(/unknown field/);

    const findingReady = decodeDiscoveryFindingReadyV1({
      schemaVersion: '1.0.0',
      publicationId: 'publication-1',
      projectId: 'project-1',
      findingId: 'finding-1',
      findingRevision: 2,
      fingerprint: 'sha256:finding-1',
      fingerprintVersion: 'discovery-fingerprint:v1',
      jobId: 'job-1',
      runId: 'run-1',
      attemptId: 'attempt-1',
      canonicalBase: {
        schemaVersion: '1.0.0',
        canonicalVersion: 4,
        snapshotDigest: 'sha256:canonical-4',
      },
      requiredDiscoveryBase: {
        schemaVersion: '1.0.0',
        projectionRevision: 'projection-revision-4',
        projectionDigest: 'sha256:discovery-4',
      },
      occurredAt: '2026-08-30T00:03:00.000Z',
    });
    expect(findingReady.findingId).toBe('finding-1');
    expect(findingReady.requiredDiscoveryBase?.projectionDigest).toBe('sha256:discovery-4');
  });

  it('leaves the direct ClaimCandidate contract source-bound and unchanged', () => {
    const directOriginWitness: Pick<
      ClaimCandidate,
      'sourceVersionId' | 'evidenceMode' | 'extractionProfile'
    > = {
      sourceVersionId: 'source-version-1',
      evidenceMode: 'DIRECT_EVIDENCE',
      extractionProfile: 'direct-only',
    };
    expect(directOriginWitness).toEqual({
      sourceVersionId: 'source-version-1',
      evidenceMode: 'DIRECT_EVIDENCE',
      extractionProfile: 'direct-only',
    });
  });
});
