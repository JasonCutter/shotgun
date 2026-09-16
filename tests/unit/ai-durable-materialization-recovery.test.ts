import { describe, expect, it, vi } from 'vitest';

import {
  type AIProviderCallRepositoryPort,
  type AIProviderExecutionRecord,
} from '../../modules/ai-provider/src/index.js';
import { runAIDurableMaterializationRecovery } from '../../assemblies/shotgun-app/src/server.js';

const makeRecord = (state: 'MATERIALIZATION_FAILED' | 'COMPLETED') =>
  ({
    projectId: 'recovery-project',
    requestId: 'recovery-request',
    callId: 'provider-call',
    sourceVersionId: 'source-version',
    accessScope: ['owner'],
    sensitivity: 'private',
    dataClassification: 'test',
    state,
    status: state === 'COMPLETED' ? 'succeeded' : 'failed',
    output: {
      outputId: 'accepted-output',
      projectId: 'recovery-project',
      callId: 'provider-call',
    },
  }) as unknown as AIProviderExecutionRecord;

const repositoryFor = (
  record: AIProviderExecutionRecord,
  readCurrent: () => AIProviderExecutionRecord | undefined,
) =>
  ({
    markExpiredRunningAttemptsOutcomeUnknown: vi.fn(async () => undefined),
    listRecoverableMaterializations: vi.fn(async () => [record]),
    findByRequestId: vi.fn(async () => readCurrent()),
  }) as unknown as AIProviderCallRepositoryPort;

describe('AI Durable Materialization Recovery convergence classification', () => {
  it('counts a Resume exception as success only after exact durable convergence', async () => {
    let current = makeRecord('MATERIALIZATION_FAILED');
    const repository = repositoryFor(current, () => current);
    const connector = {
      sendCommand: vi.fn(async () => {
        current = makeRecord('COMPLETED');
        throw new Error('downstream handoff failed after convergence');
      }),
      reconcileCommandOutcome: vi.fn(async () => ({ state: 'COMPLETED' })),
    };

    await expect(runAIDurableMaterializationRecovery(repository, connector)).resolves.toEqual({
      attempted: 1,
      resumed: 1,
      failed: 0,
    });
    expect(connector.sendCommand).toHaveBeenCalledTimes(1);
    expect(repository.findByRequestId).toHaveBeenCalledWith('recovery-project', 'recovery-request');
  });

  it('fails closed when Resume throws without exact durable convergence', async () => {
    const current = makeRecord('MATERIALIZATION_FAILED');
    const repository = repositoryFor(current, () => current);
    const connector = {
      sendCommand: vi.fn(async () => {
        throw new Error('resume failed before convergence');
      }),
      reconcileCommandOutcome: vi.fn(async () => ({ state: 'FAILED' })),
    };

    await expect(runAIDurableMaterializationRecovery(repository, connector)).resolves.toEqual({
      attempted: 1,
      resumed: 0,
      failed: 1,
    });
    expect(connector.sendCommand).toHaveBeenCalledTimes(1);
    expect(repository.findByRequestId).toHaveBeenCalledWith('recovery-project', 'recovery-request');
  });

  it('reconciles a non-converged OUTCOME_UNKNOWN and retries the same command once', async () => {
    const current = makeRecord('MATERIALIZATION_FAILED');
    const repository = repositoryFor(current, () => current);
    const sentCommands: unknown[] = [];
    const reconciledCommands: unknown[] = [];
    let sends = 0;
    const connector = {
      sendCommand: vi.fn(async (command: unknown) => {
        sentCommands.push(command);
        if (sends++ === 0) throw { code: 'OUTCOME_UNKNOWN' };
      }),
      reconcileCommandOutcome: vi.fn(async (command: unknown) => {
        reconciledCommands.push(command);
        return { state: 'FAILED' };
      }),
    };

    await expect(runAIDurableMaterializationRecovery(repository, connector)).resolves.toEqual({
      attempted: 1,
      resumed: 1,
      failed: 0,
    });
    expect(connector.sendCommand).toHaveBeenCalledTimes(2);
    expect(connector.reconcileCommandOutcome).toHaveBeenCalledTimes(1);
    expect(sentCommands[0]).toMatchObject({
      idempotencyKey:
        'resume-candidate-materialization:recovery-project:recovery-request:accepted-output',
    });
    expect(sentCommands[1]).toEqual(sentCommands[0]);
    expect(reconciledCommands[0]).toEqual(sentCommands[0]);
  });

  it.each([
    ['returns no record', async () => undefined],
    ['returns a non-failed record', async () => ({ state: 'COMPLETED' })],
    [
      'throws',
      async () => {
        throw new Error('reconciliation unavailable');
      },
    ],
  ])('fails closed when reconciliation %s', async (_case, reconcile) => {
    const current = makeRecord('MATERIALIZATION_FAILED');
    const repository = repositoryFor(current, () => current);
    const connector = {
      sendCommand: vi.fn(async () => {
        throw { code: 'OUTCOME_UNKNOWN' };
      }),
      reconcileCommandOutcome: vi.fn(reconcile),
    };

    await expect(runAIDurableMaterializationRecovery(repository, connector)).resolves.toEqual({
      attempted: 1,
      resumed: 0,
      failed: 1,
    });
    expect(connector.sendCommand).toHaveBeenCalledTimes(1);
    expect(connector.reconcileCommandOutcome).toHaveBeenCalledTimes(1);
  });

  it('reconciles an already converged provider without resending Resume', async () => {
    const current = makeRecord('COMPLETED');
    const repository = repositoryFor(current, () => current);
    const sentCommands: unknown[] = [];
    const connector = {
      sendCommand: vi.fn(async (command: unknown) => {
        sentCommands.push(command);
        throw { code: 'OUTCOME_UNKNOWN' };
      }),
      reconcileCommandOutcome: vi.fn(async () => ({
        state: 'COMPLETED',
      })),
    };

    await expect(runAIDurableMaterializationRecovery(repository, connector)).resolves.toEqual({
      attempted: 1,
      resumed: 1,
      failed: 0,
    });
    expect(connector.sendCommand).toHaveBeenCalledTimes(1);
    expect(connector.reconcileCommandOutcome).toHaveBeenCalledTimes(1);
    expect(connector.reconcileCommandOutcome).toHaveBeenCalledWith(sentCommands[0], {
      result: null,
    });
  });

  it('does not send a third Resume when the bounded retry remains non-converged', async () => {
    const current = makeRecord('MATERIALIZATION_FAILED');
    const repository = repositoryFor(current, () => current);
    const connector = {
      sendCommand: vi.fn(async () => undefined).mockRejectedValue({ code: 'OUTCOME_UNKNOWN' }),
      reconcileCommandOutcome: vi.fn(async () => ({
        state: 'FAILED',
      })),
    };

    await expect(runAIDurableMaterializationRecovery(repository, connector)).resolves.toEqual({
      attempted: 1,
      resumed: 0,
      failed: 1,
    });
    expect(connector.sendCommand).toHaveBeenCalledTimes(2);
    expect(connector.reconcileCommandOutcome).toHaveBeenCalledTimes(1);
    expect(repository.findByRequestId).toHaveBeenCalledTimes(2);
  });
});
