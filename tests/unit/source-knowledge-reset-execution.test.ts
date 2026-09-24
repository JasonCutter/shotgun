import { describe, expect, it } from 'vitest';

import {
  assertCompleteKnowledgeResetOwnerSet,
  createKnowledgeResetMaintenanceExecutor,
  KNOWLEDGE_RESET_OWNER_ORDER,
  KnowledgeResetExecutionError,
  type KnowledgeResetOwnerPort,
  type KnowledgeResetRequestV1,
} from '../../modules/source-knowledge-reset/src/index.js';

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

const createHarness = (
  input: {
    readonly fingerprint?: `sha256:${string}`;
    readonly impactDigest?: `sha256:${string}`;
    readonly executorUnavailable?: boolean;
    readonly journalPrepareFails?: boolean;
  } = {},
) => {
  const request: KnowledgeResetRequestV1 = {
    schemaVersion: '1.0.0',
    requestId: 'request-1',
    projectId: 'project-1',
    projectRevision: 4,
    manifestDigest: digest('a'),
    ownerManifestDigest: digest('c'),
    preservedConfigurationDigest: digest('b'),
    state: 'APPROVED',
    expectedKnowledgeEpoch: 2,
    knowledgeEpoch: 3,
    blockerCodes: [],
    counts: {
      sourceCount: 2,
      sourceVersionCount: 3,
      sourceDerivedRecordCount: 14,
      redactedHistoryRecordCount: 4,
      rebuildProjectionCount: 5,
      sharedAssetCount: 1,
      blockedRecordCount: 0,
    },
    completedSteps: [],
    casStatus: 'NOT_STARTED',
    backupStatus: 'PENDING',
    createdAt: '2026-09-23T01:00:00.000Z',
    updatedAt: '2026-09-23T01:00:00.000Z',
  };
  const counts = request.counts;
  const completedSteps = new Set<string>();
  const calls: string[] = [];
  const effectivePurges = new Set<string>();
  const journal: string[] = [];
  let failAfterFirstEvidencePurge = true;
  let executorChecks = 0;
  let state = request.state;
  const owners: KnowledgeResetOwnerPort[] = KNOWLEDGE_RESET_OWNER_ORDER.map((ownerId) => ({
    ownerId,
    async fence() {
      calls.push(`fence:${ownerId}`);
    },
    async purge() {
      calls.push(`purge:${ownerId}`);
      effectivePurges.add(ownerId);
      if (ownerId === 'evidence' && failAfterFirstEvidencePurge) {
        failAfterFirstEvidencePurge = false;
        throw new Error('simulated process interruption after owner commit');
      }
    },
    async rebuild() {
      calls.push(`rebuild:${ownerId}`);
    },
    async verify() {
      calls.push(`verify:${ownerId}`);
      return { verified: true, blockerCodes: [] };
    },
  }));
  const executor = createKnowledgeResetMaintenanceExecutor({
    owners,
    maintenance: {
      async assertDedicatedExecutor() {
        executorChecks += 1;
        if (input.executorUnavailable) {
          throw new KnowledgeResetExecutionError(
            'ERASURE_EXECUTOR_UNAVAILABLE',
            'Dedicated erasure executor identity is unavailable.',
          );
        }
      },
      async withExclusiveMaintenanceLock(action) {
        calls.push('maintenance-lock:acquired');
        return action();
      },
    },
    async inspectApprovedImpact() {
      return {
        counts,
        blockers: [],
        manifestDigest: input.impactDigest ?? digest('c'),
      };
    },
    repository: {
      async readForExecution() {
        return {
          request: { ...request, state, completedSteps: [...completedSteps].sort() },
          completedSteps: [...completedSteps],
        };
      },
      async setExecutionState(update) {
        state = update.state;
      },
      async markExecutionStepComplete(update) {
        completedSteps.add(update.step);
      },
      async markExecutionComplete() {
        state = 'COMPLETE';
        return {
          ...request,
          state: 'COMPLETE',
          completedSteps: [...completedSteps].sort(),
        };
      },
    },
    async fingerprintPreservedConfiguration() {
      return input.fingerprint ?? digest('b');
    },
    async appendJournal(entry) {
      if (entry.phase === 'PREPARED' && input.journalPrepareFails) {
        throw new KnowledgeResetExecutionError(
          'KNOWLEDGE_RESET_JOURNAL_UNAVAILABLE',
          'Prepared journal write failed.',
        );
      }
      if (!journal.includes(entry.phase)) journal.push(entry.phase);
    },
  });

  return {
    executor,
    request,
    owners,
    calls,
    completedSteps,
    effectivePurges,
    journal,
    get state() {
      return state;
    },
    get executorChecks() {
      return executorChecks;
    },
  };
};

describe('ADR-171 forward-only owner maintenance executor', () => {
  it('requires a complete, unique owner closure before constructing a runner', () => {
    const harness = createHarness();
    expect(() => assertCompleteKnowledgeResetOwnerSet(harness.owners.slice(0, -1))).toThrow(
      /owner closure is incomplete/u,
    );
    expect(() =>
      assertCompleteKnowledgeResetOwnerSet([...harness.owners, harness.owners[0]!]),
    ).toThrow(/Duplicate Source knowledge reset owner/u);
  });

  it('recovers the same request after a post-commit interruption without repeating effective erasure', async () => {
    const harness = createHarness();
    const execution = {
      projectId: harness.request.projectId,
      requestId: harness.request.requestId,
    };

    await expect(harness.executor.execute(execution)).rejects.toThrow(
      'simulated process interruption after owner commit',
    );
    expect(harness.state).toBe('OUTCOME_UNKNOWN');
    expect(harness.journal).toEqual(['PREPARED']);

    const completed = await harness.executor.execute(execution);
    expect(completed.state).toBe('COMPLETE');
    expect(harness.state).toBe('COMPLETE');
    expect(harness.journal).toEqual(['PREPARED', 'VERIFIED']);
    expect(harness.effectivePurges.size).toBe(KNOWLEDGE_RESET_OWNER_ORDER.length);
    expect(harness.calls.filter((call) => call === 'purge:evidence')).toHaveLength(2);
    expect(harness.calls.filter((call) => call === 'fence:ask')).toHaveLength(2);
    expect(harness.completedSteps.has('verify:canonical')).toBe(true);
  });

  it('blocks after fencing if preserved Project/Auth/AI state changed', async () => {
    const harness = createHarness({ fingerprint: digest('c') });
    await expect(
      harness.executor.execute({
        projectId: harness.request.projectId,
        requestId: harness.request.requestId,
      }),
    ).rejects.toBeInstanceOf(KnowledgeResetExecutionError);
    expect(harness.state).toBe('BLOCKED');
    expect(harness.journal).toEqual([]);
    expect(harness.calls[0]).toBe('maintenance-lock:acquired');
    expect(harness.calls.some((call) => call.startsWith('fence:'))).toBe(true);
    expect(harness.calls.some((call) => call.startsWith('purge:'))).toBe(false);
  });

  it('blocks after fencing but before PREPARED if Source impact changed after approval', async () => {
    const harness = createHarness({ impactDigest: digest('d') });
    await expect(
      harness.executor.execute({
        projectId: harness.request.projectId,
        requestId: harness.request.requestId,
      }),
    ).rejects.toMatchObject({ blockerCode: 'STALE_PREVIEW' });
    expect(harness.state).toBe('BLOCKED');
    expect(harness.calls.some((call) => call.startsWith('fence:'))).toBe(true);
    expect(harness.calls.some((call) => call.startsWith('purge:'))).toBe(false);
    expect(harness.journal).toEqual([]);
  });

  it('does not acquire the maintenance lock or mutate when the dedicated executor is unavailable', async () => {
    const harness = createHarness({ executorUnavailable: true });
    await expect(
      harness.executor.execute({
        projectId: harness.request.projectId,
        requestId: harness.request.requestId,
      }),
    ).rejects.toMatchObject({ blockerCode: 'ERASURE_EXECUTOR_UNAVAILABLE' });
    expect(harness.state).toBe('APPROVED');
    expect(harness.calls).toEqual([]);
    expect(harness.journal).toEqual([]);
  });

  it('records no content checkpoint when PREPARED cannot be made durable', async () => {
    const harness = createHarness({ journalPrepareFails: true });
    await expect(
      harness.executor.execute({
        projectId: harness.request.projectId,
        requestId: harness.request.requestId,
      }),
    ).rejects.toMatchObject({ blockerCode: 'KNOWLEDGE_RESET_JOURNAL_UNAVAILABLE' });
    expect(harness.state).toBe('BLOCKED');
    expect(harness.calls.some((call) => call.startsWith('purge:'))).toBe(false);
    expect(harness.journal).toEqual([]);
  });
});
