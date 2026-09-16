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
    };

    await expect(runAIDurableMaterializationRecovery(repository, connector)).resolves.toEqual({
      attempted: 1,
      resumed: 0,
      failed: 1,
    });
    expect(connector.sendCommand).toHaveBeenCalledTimes(1);
    expect(repository.findByRequestId).toHaveBeenCalledWith('recovery-project', 'recovery-request');
  });
});
