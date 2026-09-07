import { describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { InMemoryCanonicalSnapshotAdapter } from '../../adapters/stage5-in-memory/src/index.js';
import type { InMemoryComparisonRepository } from '../../adapters/stage5-in-memory/src/index.js';
import { createCommand, type ClaimCandidate } from '../../packages/contracts/src/index.js';
import { hashPassword, InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
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
      candidateRepository: candidateRepository([
        candidate('candidate-rejected', 'REJECTED'),
        candidate('candidate-sensitive'),
      ]),
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
      await expect(
        app.kernel.connector.sendCommand({
          ...command('candidate-sensitive', 'recompare-sensitivity-mismatch'),
          security: { ...security, sensitivity: 'public' },
        }),
      ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
      expect(comparisonStore.count()).toBe(0);
    } finally {
      await app.server.close();
    }
  });

  it('exposes only candidateId and idempotencyKey at the authenticated Product route', async () => {
    const authRepository = new InMemoryAuthRepository();
    await authRepository.bootstrapOwner({
      accountId: 'stale-reentry-route-owner',
      passwordHash: await hashPassword('stale-reentry-route-password'),
      projectId,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await authRepository.authenticatePassword(
      'stale-reentry-route-owner',
      'stale-reentry-route-password',
    );
    if (!principal) throw new Error('Route fixture principal was not created.');
    const session = await authRepository.createSession(
      principal.principalId,
      projectId,
      new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    );
    const cookie = `shotgun_session=${session.sessionToken}`;
    const app = await createApplication({
      authRepository,
      candidateRepository: candidateRepository([candidate('candidate-route')]),
      canonicalSnapshot: new InMemoryCanonicalSnapshotAdapter({ [projectId]: [] }),
      canonicalProjectionRecoveryIntervalMs: false,
      discoverySchedulerIntervalMs: false,
      aiDurableMaterializationRecoveryEnabled: false,
    });
    try {
      const csrf = async () =>
        (
          await app.server.inject({
            method: 'GET',
            url: '/api/v1/security/csrf',
            headers: { cookie },
          })
        ).json<{ csrfToken: string }>().csrfToken;
      const response = await app.server.inject({
        method: 'POST',
        url: '/comparisons/recompare',
        headers: { cookie, 'x-csrf-token': await csrf() },
        payload: { candidateId: 'candidate-route', idempotencyKey: 'route-recompare-1' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        commandStatus: 'processed',
        result: { candidateId: 'candidate-route', snapshotVersion: 1 },
      });

      const invalid = await app.server.inject({
        method: 'POST',
        url: '/comparisons/recompare',
        headers: { cookie, 'x-csrf-token': await csrf() },
        payload: {
          candidateId: 'candidate-route',
          idempotencyKey: 'route-recompare-2',
          projectId,
        },
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    } finally {
      await app.server.close();
    }
  });

  it('runs the A-K sequential review/re-entry path through Product routes', async () => {
    const authRepository = new InMemoryAuthRepository();
    await authRepository.bootstrapOwner({
      accountId: 'stale-reentry-sequential-owner',
      passwordHash: await hashPassword('stale-reentry-sequential-password'),
      projectId,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await authRepository.authenticatePassword(
      'stale-reentry-sequential-owner',
      'stale-reentry-sequential-password',
    );
    if (!principal) throw new Error('Sequential fixture principal was not created.');
    const session = await authRepository.createSession(
      principal.principalId,
      projectId,
      new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    );
    const cookie = `shotgun_session=${session.sessionToken}`;
    const app = await createApplication({
      authRepository,
      candidateRepository: candidateRepository([
        candidate('candidate-a'),
        candidate('candidate-b'),
      ]),
      canonicalProjectionRecoveryIntervalMs: false,
      discoverySchedulerIntervalMs: false,
      aiDurableMaterializationRecoveryEnabled: false,
    });
    try {
      const comparisonStore = app.repositories.comparisons as InMemoryComparisonRepository;
      const csrf = async () =>
        (
          await app.server.inject({
            method: 'GET',
            url: '/api/v1/security/csrf',
            headers: { cookie },
          })
        ).json<{ csrfToken: string }>().csrfToken;
      const recompare = async (candidateId: string, idempotencyKey: string) =>
        app.server.inject({
          method: 'POST',
          url: '/comparisons/recompare',
          headers: { cookie, 'x-csrf-token': await csrf() },
          payload: { candidateId, idempotencyKey },
        });
      const decide = async (changeSet: {
        readonly changeSetId: string;
        readonly contentDigest: string;
      }) =>
        app.server.inject({
          method: 'POST',
          url: '/reviews/decision',
          headers: { cookie, 'x-csrf-token': await csrf() },
          payload: {
            changeSetId: changeSet.changeSetId,
            expectedRevisionNumber: 1,
            expectedContentDigest: changeSet.contentDigest,
            decision: 'APPROVE',
            reason: 'Sequential stale re-entry acceptance.',
          },
        });

      const initialA = await recompare('candidate-a', 'sequential-a-v0');
      const initialB = await recompare('candidate-b', 'sequential-b-v0');
      expect(initialA.statusCode).toBe(200);
      expect(initialB.statusCode).toBe(200);
      const initialAResult = initialA.json().result as { comparisonId: string };
      const initialBResult = initialB.json().result as { comparisonId: string };
      const oldA = await app.repositories.reviews.findByComparisonId(
        projectId,
        initialAResult.comparisonId,
      );
      const oldB = await app.repositories.reviews.findByComparisonId(
        projectId,
        initialBResult.comparisonId,
      );
      if (!oldA || !oldB) throw new Error('Initial ChangeSets were not materialized.');
      expect((await app.repositories.canonical.getSnapshot(projectId)).version).toBe(0);

      const approvedA = await decide(oldA);
      expect(approvedA.statusCode).toBe(200);
      const afterA = await app.repositories.canonical.getSnapshot(projectId);
      expect(afterA.version).toBe(1);
      expect(afterA.claims).toHaveLength(1);

      const staleOldB = await decide(oldB);
      expect(staleOldB.statusCode).toBe(409);
      expect(staleOldB.json()).toMatchObject({ code: 'STALE_VERSION' });
      const oldBAfterFailure = await app.repositories.reviews.findById(projectId, oldB.changeSetId);
      expect(oldBAfterFailure).toMatchObject({ status: 'STALE' });

      const reenteredB = await recompare('candidate-b', 'sequential-b-v1');
      expect(reenteredB.statusCode).toBe(200);
      const reenteredResult = reenteredB.json().result as {
        comparisonId: string;
        snapshotVersion: number;
      };
      expect(reenteredResult.comparisonId).not.toBe(initialBResult.comparisonId);
      expect(reenteredResult.snapshotVersion).toBe(1);
      const newB = await app.repositories.reviews.findByComparisonId(
        projectId,
        reenteredResult.comparisonId,
      );
      if (!newB) throw new Error('Re-entered ChangeSet was not materialized.');
      expect(newB.expectedCanonicalVersion).toBe(1);

      const sameInputDifferentKey = await recompare('candidate-b', 'sequential-b-v1-alt');
      expect(sameInputDifferentKey.statusCode).toBe(200);
      expect(sameInputDifferentKey.json()).toMatchObject({
        commandStatus: 'processed',
        result: { comparisonId: reenteredResult.comparisonId, snapshotVersion: 1 },
      });
      expect(comparisonStore.count()).toBe(3);

      const approvedB = await decide(newB);
      expect(approvedB.statusCode).toBe(200);
      const afterB = await app.repositories.canonical.getSnapshot(projectId);
      expect(afterB.version).toBe(2);
      expect(afterB.claims).toHaveLength(2);

      const duplicateReentry = await recompare('candidate-b', 'sequential-b-v1');
      expect(duplicateReentry.statusCode).toBe(200);
      expect(duplicateReentry.json()).toMatchObject({ commandStatus: 'duplicate' });
      expect(comparisonStore.count()).toBe(3);
      expect(await app.repositories.reviews.findById(projectId, oldB.changeSetId)).toMatchObject({
        status: 'STALE',
      });
    } finally {
      await app.server.close();
    }
  });
});
