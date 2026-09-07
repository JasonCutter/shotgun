import { describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { InMemoryCanonicalSnapshotAdapter } from '../../adapters/stage5-in-memory/src/index.js';
import type { InMemoryComparisonRepository } from '../../adapters/stage5-in-memory/src/index.js';
import { createCommand, type ClaimCandidate } from '../../packages/contracts/src/index.js';
import type { CandidateRepositoryPort } from '../../modules/candidate-generation/src/index.js';

const projectId = 'project-stale-reentry-integration';
const actor = { type: 'user' as const, id: 'owner-stale-reentry' };
const security = {
  accessScope: ['owner'],
  sensitivity: 'internal' as const,
  dataClassification: 'knowledge',
};

const candidate = (candidateId: string, status: ClaimCandidate['status'] = 'READY') =>
  ({
    candidateId,
    batchId: `batch-${candidateId}`,
    revisionNumber: 1,
    projectId,
    sourceVersionId: `source-${candidateId}`,
    claimText: `Claim ${candidateId}`,
    evidenceIds: [`evidence-${candidateId}`],
    evidenceMode: 'DIRECT_EVIDENCE',
    extractionProfile: 'direct-only',
    status,
    providerCall: {} as ClaimCandidate['providerCall'],
    accessScope: ['owner'],
    sensitivity: 'internal',
    createdAt: '2026-09-07T00:00:00.000Z',
  }) as ClaimCandidate;

const candidateRepository = (records: readonly ClaimCandidate[]): CandidateRepositoryPort => ({
  async findById(requestProjectId, candidateId) {
    return requestProjectId === projectId
      ? records.find((record) => record.candidateId === candidateId)
      : undefined;
  },
  async saveBatch() {
    throw new Error('not used by stale re-entry test');
  },
  async failMaterialization() {
    throw new Error('not used by stale re-entry test');
  },
  async findBatchByIdempotencyKey() {
    return undefined;
  },
  async listBySourceVersion() {
    return [];
  },
  async updateStatus() {
    throw new Error('not used by stale re-entry test');
  },
});

const command = (candidateId: string, idempotencyKey: string) =>
  createCommand({
    messageType: 'RecompareClaimCandidate',
    schemaVersion: '1.0.0',
    producerModule: 'stale-reentry-test',
    producerVersion: '1.0.0',
    idempotencyKey,
    projectId,
    actor,
    security,
    payload: { candidateId },
  });

describe('Stage 5 stale comparison re-entry command boundary', () => {
  it('creates a new review identity for a current snapshot and deduplicates replay', async () => {
    const snapshots = new InMemoryCanonicalSnapshotAdapter({ [projectId]: [] });
    const app = await createApplication({
      candidateRepository: candidateRepository([
        candidate('candidate-a'),
        candidate('candidate-b'),
      ]),
      canonicalSnapshot: snapshots,
      canonicalProjectionRecoveryIntervalMs: false,
      discoverySchedulerIntervalMs: false,
      aiDurableMaterializationRecoveryEnabled: false,
    });
    try {
      const comparisonStore = app.repositories.comparisons as InMemoryComparisonRepository;
      const first = await app.kernel.connector.sendCommand<{
        comparisonId: string;
        candidateId: string;
        snapshotVersion: number;
      }>(command('candidate-b', 'recompare-candidate-b-v0'));
      const replay = await app.kernel.connector.sendCommand(
        command('candidate-b', 'recompare-candidate-b-v0'),
      );

      expect(first.status).toBe('processed');
      expect(replay.status).toBe('duplicate');
      expect(first.result.comparisonId).toBeDefined();
      expect(first.result.candidateId).toBe('candidate-b');
      expect(first.result.snapshotVersion).toBe(1);
      expect(comparisonStore.count()).toBe(1);
      const changeSet = await app.repositories.reviews.findByComparisonId(
        projectId,
        first.result.comparisonId,
      );
      expect(changeSet).toMatchObject({
        candidateId: 'candidate-b',
        comparisonId: first.result.comparisonId,
        expectedCanonicalVersion: 1,
        status: 'PENDING_REVIEW',
      });

      // Simulate the Canonical authority advancing through its explicit
      // approval path. Re-entry must pin the next server snapshot and leave
      // the first Comparison/ChangeSet untouched.
      snapshots.replaceClaims(projectId, [
        {
          claimId: 'canonical-claim-1',
          text: 'An explicitly approved Canonical claim.',
          revisionNumber: 1,
          evidenceIds: ['evidence-canonical-1'],
        },
      ]);
      const second = await app.kernel.connector.sendCommand<{
        comparisonId: string;
        candidateId: string;
        snapshotVersion: number;
      }>(command('candidate-b', 'recompare-candidate-b-v1'));
      const secondReplay = await app.kernel.connector.sendCommand(
        command('candidate-b', 'recompare-candidate-b-v1'),
      );

      expect(second.status).toBe('processed');
      expect(secondReplay.status).toBe('duplicate');
      expect(second.result.comparisonId).not.toBe(first.result.comparisonId);
      expect(second.result.snapshotVersion).toBe(2);
      expect(comparisonStore.count()).toBe(2);
      expect(changeSet).toMatchObject({
        comparisonId: first.result.comparisonId,
        expectedCanonicalVersion: 1,
        status: 'PENDING_REVIEW',
      });
      const refreshedChangeSet = await app.repositories.reviews.findByComparisonId(
        projectId,
        second.result.comparisonId,
      );
      expect(refreshedChangeSet).toMatchObject({
        comparisonId: second.result.comparisonId,
        expectedCanonicalVersion: 2,
        status: 'PENDING_REVIEW',
      });
    } finally {
      await app.server.close();
    }
  });

  it('fails closed for a rejected Candidate and for a project mismatch', async () => {
    const snapshots = new InMemoryCanonicalSnapshotAdapter({ [projectId]: [] });
    const app = await createApplication({
      candidateRepository: candidateRepository([candidate('candidate-rejected', 'REJECTED')]),
      canonicalSnapshot: snapshots,
      canonicalProjectionRecoveryIntervalMs: false,
      discoverySchedulerIntervalMs: false,
      aiDurableMaterializationRecoveryEnabled: false,
    });
    try {
      const comparisonStore = app.repositories.comparisons as InMemoryComparisonRepository;
      await expect(
        app.kernel.connector.sendCommand(command('candidate-rejected', 'recompare-rejected')),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(
        app.kernel.connector.sendCommand({
          ...command('candidate-rejected', 'recompare-project-mismatch'),
          projectId: 'different-project',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(comparisonStore.count()).toBe(0);
    } finally {
      await app.server.close();
    }
  });
});
