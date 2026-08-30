import { describe, expect, it } from 'vitest';

import {
  assessDiscoveryReentryFreshnessV1,
  type DiscoveryReentryFreshnessBindingV1,
  type DiscoveryReentryFreshnessCurrentStateV1,
} from '../../packages/contracts/src/index.js';

const projectId = 'akp-5-wp5-freshness-project';
const ref = {
  schemaVersion: '1.0.0' as const,
  resourceKind: 'CANONICAL_CLAIM' as const,
  resourceId: 'claim-1',
  projectId,
  resourceState: 'APPROVED' as const,
  resourceRevision: 'revision-1',
};

const binding = (): DiscoveryReentryFreshnessBindingV1 => ({
  projectId,
  findingId: 'finding-1',
  findingRevision: 1,
  findingType: 'RELATION_HYPOTHESIS',
  sourceProjectionDigest: 'sha256:source',
  canonicalBase: { schemaVersion: '1.0.0', canonicalVersion: 4, snapshotDigest: 'sha256:base' },
  discoveryBase: {
    schemaVersion: '1.0.0',
    projectionRevision: 'projection-4',
    projectionDigest: 'sha256:discovery',
  },
  approvedRelatedResourceRefs: [ref],
  relatedResourceMaterialDigests: [
    { resourceKind: ref.resourceKind, resourceId: ref.resourceId, materialDigest: 'sha256:claim' },
  ],
  evidenceIds: ['evidence-1'],
  evidenceLineage: [
    {
      schemaVersion: '1.0.0',
      evidenceId: 'evidence-1',
      sourceId: 'source-1',
      sourceVersionId: 'source-version-1',
      evidenceSpanId: 'span-1',
    },
  ],
  evidenceMaterialDigests: [{ evidenceId: 'evidence-1', materialDigest: 'sha256:evidence' }],
  derivationProvenanceDigest: 'sha256:provenance',
  validationProfileVersion: 'discovery-derived-validation:v1',
  accessScope: ['project:read'],
  sensitivity: 'internal',
  reviewTarget: {
    reviewResourceId: 'review-resource-1',
    resourceRevision: 1,
    resourceDigest: 'sha256:review-resource',
  },
});

const current = (): DiscoveryReentryFreshnessCurrentStateV1 => ({
  projectId,
  findingRevision: 1,
  lifecycleState: 'REVIEW_READY',
  sourceProjectionMaterialDigest: 'sha256:source',
  discoveryBaseMaterialDigest: 'sha256:discovery',
  relatedResources: [
    {
      ...ref,
      availability: 'AVAILABLE',
      materialDigest: 'sha256:claim',
      accessScope: ['project:read'],
      sensitivity: 'internal',
    },
  ],
  evidence: [
    {
      evidenceId: 'evidence-1',
      projectId,
      availability: 'AVAILABLE',
      sourceId: 'source-1',
      sourceVersionId: 'source-version-1',
      evidenceSpanId: 'span-1',
      materialDigest: 'sha256:evidence',
      accessScope: ['project:read'],
      sensitivity: 'internal',
    },
  ],
  authorization: 'AUTHORIZED',
  sensitivityPolicy: 'UNCHANGED',
  reviewTarget: {
    status: 'CURRENT',
    resourceRevision: 1,
    resourceDigest: 'sha256:review-resource',
  },
});

const assess = (overrides: Partial<DiscoveryReentryFreshnessCurrentStateV1> = {}) =>
  assessDiscoveryReentryFreshnessV1({
    binding: binding(),
    current: { ...current(), ...overrides },
    assessedAt: '2026-08-31T00:00:00.000Z',
  });

describe('AKP-5 WP5 Discovery freshness contract', () => {
  it('keeps FRESH when a later unrelated Canonical version is not a relied-on change', () => {
    const result = assess();
    expect(result.state).toBe('FRESH');
    expect(result.reasonCodes).toEqual([]);
  });

  it('requires revalidation when a relied-on resource proposition changes', () => {
    const result = assess({
      relatedResources: [
        {
          ...current().relatedResources[0]!,
          resourceRevision: 'revision-2',
          materialDigest: 'sha256:changed-claim',
        },
      ],
    });
    expect(result.state).toBe('REVALIDATION_REQUIRED');
    expect(result.reasonCodes).toContain('RELATED_RESOURCE_CHANGED');
  });

  it('invalidates without creating a reviewable result when a relied-on resource disappears', () => {
    const result = assess({
      relatedResources: [{ ...current().relatedResources[0]!, availability: 'UNAVAILABLE' }],
    });
    expect(result.state).toBe('INVALIDATED');
    expect(result.reasonCodes).toContain('RELATED_RESOURCE_UNAVAILABLE');
  });

  it('returns authorization denial for a narrowed scope or sensitivity policy', () => {
    expect(assess({ authorization: 'DENIED' })).toMatchObject({
      state: 'AUTHORIZATION_DENIED',
      reasonCodes: ['ACCESS_NO_LONGER_AUTHORIZED'],
    });
    expect(
      assess({ sensitivityPolicy: 'CHANGED', currentSensitivity: 'restricted' }),
    ).toMatchObject({
      state: 'AUTHORIZATION_DENIED',
      reasonCodes: ['SENSITIVITY_POLICY_CHANGED'],
    });
  });

  it('fails closed when the current sensitivity policy is unknown', () => {
    expect(assess({ sensitivityPolicy: 'UNKNOWN' })).toMatchObject({
      state: 'PERSISTENCE_FAILURE',
      reasonCodes: [],
    });
  });

  it('detects Evidence lineage change/unavailability and Review target supersession', () => {
    expect(
      assess({
        evidence: [
          {
            ...current().evidence[0]!,
            evidenceSpanId: 'span-2',
          },
        ],
      }).reasonCodes,
    ).toContain('EVIDENCE_LINEAGE_CHANGED');
    expect(
      assess({
        reviewTarget: { status: 'SUPERSEDED' },
      } as Partial<DiscoveryReentryFreshnessCurrentStateV1>),
    ).toMatchObject({ state: 'INVALIDATED', reasonCodes: ['REVIEW_TARGET_SUPERSEDED'] });
  });
});
