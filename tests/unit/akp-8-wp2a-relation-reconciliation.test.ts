import { describe, expect, it } from 'vitest';

import { observeDiscoveryReconciliation } from '../../adapters/discovery-runtime-product/src/index.js';
import type {
  CompiledTruthProjection,
  DiscoveryFindingEnvelopeV1,
} from '../../packages/contracts/src/index.js';

const projection: CompiledTruthProjection = {
  projectId: 'project-1',
  projectorVersion: '1.0.0',
  sourceSnapshotDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  logicalDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  canonicalVersion: 2,
  items: [
    {
      id: 'entity:a',
      type: 'ENTITY',
      revisionNumber: 1,
      label: 'Entity A',
      state: 'CURRENT',
      source: 'APPROVED_KNOWLEDGE',
      evidenceIds: ['evidence:a'],
      accessScope: ['owner'],
      sensitivity: 'private',
    },
    {
      id: 'entity:b',
      type: 'ENTITY',
      revisionNumber: 1,
      label: 'Entity B',
      state: 'CURRENT',
      source: 'APPROVED_KNOWLEDGE',
      evidenceIds: ['evidence:b'],
      accessScope: ['owner'],
      sensitivity: 'private',
    },
  ],
  graph: {
    nodes: [],
    edges: [
      {
        id: 'relation:canonical:1',
        from: 'entity:a',
        to: 'entity:b',
        relationType: 'RELATED_TO',
        direction: 'DIRECTED',
        validFrom: '2026-01-01T00:00:00.000Z',
        source: 'CANONICAL_RELATION',
      },
    ],
    fallback: { available: true, modes: ['LIST', 'TABLE'] },
  },
  projectedAt: '2026-09-01T00:00:00.000Z',
  buildMode: 'FULL_REBUILD',
};

const finding = (temporalQualification?: { validFrom?: string; validTo?: string }) =>
  ({
    projectId: 'project-1',
    findingId: 'finding-relation-1',
    findingRevision: 1,
    findingType: 'RELATION_HYPOTHESIS',
    payload: {
      payloadType: 'RELATION_HYPOTHESIS',
      sourceEndpoint: {
        projectId: 'project-1',
        resourceId: 'entity:a',
        resourceRevision: '1',
      },
      targetEndpoint: {
        projectId: 'project-1',
        resourceId: 'entity:b',
        resourceRevision: '1',
      },
      proposedRelationType: 'RELATED_TO',
      direction: 'DIRECTED',
      ...(temporalQualification === undefined ? {} : { temporalQualification }),
    },
    relatedResourceRefs: [],
  }) as unknown as DiscoveryFindingEnvelopeV1;

describe('AKP-8 WP2A relation reconciliation contract', () => {
  it('resolves a relation hypothesis only after exact Canonical relation and endpoint checks', async () => {
    await expect(
      observeDiscoveryReconciliation({
        finding: finding({ validFrom: '2026-01-01T00:00:00.000Z' }),
        projection,
        canonicalBase: {
          schemaVersion: '1.0.0',
          canonicalVersion: 2,
          snapshotDigest: projection.sourceSnapshotDigest,
        },
      }),
    ).resolves.toBe('CANONICAL_EQUIVALENT_ACCEPTED');

    await expect(
      observeDiscoveryReconciliation({
        finding: finding({ validFrom: '2026-02-01T00:00:00.000Z' }),
        projection,
        canonicalBase: {
          schemaVersion: '1.0.0',
          canonicalVersion: 2,
          snapshotDigest: projection.sourceSnapshotDigest,
        },
      }),
    ).resolves.toBe('UNCHANGED');
  });
});
