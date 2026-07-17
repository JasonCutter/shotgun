import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresCompiledTruthRepository } from '../../adapters/postgres-stage10/src/index.js';
import type {
  CompiledTruthProjection,
  DerivedInferenceCandidate,
} from '../../packages/contracts/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const projection = (buildMode: 'FULL_REBUILD' | 'INCREMENTAL'): CompiledTruthProjection => ({
  projectId: 'project-stage10',
  projectorVersion: '1.0.0',
  sourceSnapshotDigest: `sha256:${'1'.repeat(64)}`,
  logicalDigest: `sha256:${'2'.repeat(64)}`,
  canonicalVersion: 3,
  items: [
    {
      id: 'entity:isolated',
      type: 'ENTITY',
      label: 'Isolated',
      state: 'CURRENT',
      source: 'APPROVED_KNOWLEDGE',
      evidenceIds: ['evidence:1'],
      accessScope: ['owner'],
      sensitivity: 'private',
    },
  ],
  graph: {
    nodes: [
      {
        id: 'entity:isolated',
        type: 'ENTITY',
        label: 'Isolated',
        state: 'CURRENT',
        source: 'APPROVED_KNOWLEDGE',
        evidenceIds: ['evidence:1'],
        accessScope: ['owner'],
        sensitivity: 'private',
      },
    ],
    edges: [],
    fallback: { available: true, modes: ['LIST', 'TABLE'] },
  },
  projectedAt: '2026-07-17T10:00:00.000Z',
  buildMode,
});

const inference: DerivedInferenceCandidate = {
  candidateId: 'inference:isolated',
  fingerprint: `sha256:${'3'.repeat(64)}`,
  status: 'DERIVED_INFERENCE',
  candidateType: 'KNOWLEDGE_GAP',
  question: 'What approved relationship is missing for Isolated?',
  relatedNodeIds: ['entity:isolated'],
  evidenceIds: ['evidence:1'],
  sourceProjectionDigest: `sha256:${'2'.repeat(64)}`,
  reentryPhase: 'VALIDATION',
  createdAt: '2026-07-17T10:01:00.000Z',
};

describe.runIf(pool)('Stage 10 PostgreSQL projection persistence', () => {
  beforeEach(async () => {
    await pool!.query(
      'TRUNCATE projection.discovery_inferences, projection.compiled_truth CASCADE',
    );
  });

  afterAll(async () => {
    await pool!.end();
  });

  it('survives restart, keeps full/incremental parity and suppresses duplicate inference', async () => {
    const first = new PostgresCompiledTruthRepository(pool!);
    await first.synchronize(projection('FULL_REBUILD'));

    const restarted = new PostgresCompiledTruthRepository(pool!);
    expect(await restarted.findProjection('project-stage10')).toEqual(projection('FULL_REBUILD'));
    const incremental = await restarted.synchronize(projection('INCREMENTAL'));
    expect(incremental.logicalDigest).toBe(projection('FULL_REBUILD').logicalDigest);
    expect(incremental.buildMode).toBe('INCREMENTAL');

    const accepted = await restarted.saveInferences('project-stage10', [inference]);
    expect(accepted).toEqual({ accepted: [inference], suppressedFingerprints: [] });
    const repeated = await restarted.saveInferences('project-stage10', [inference]);
    expect(repeated).toEqual({
      accepted: [],
      suppressedFingerprints: [inference.fingerprint],
    });
    expect(await restarted.listInferences('project-stage10')).toEqual([inference]);
  });
});
