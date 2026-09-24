import { describe, expect, it, vi } from 'vitest';

import {
  recoverPendingSourceKnowledgeResets,
  type PendingSourceKnowledgeReset,
} from '../../scripts/t3-launch-recovery.js';

const unresolved = (projectId: string, requestId: string): PendingSourceKnowledgeReset => ({
  projectId,
  requestId,
  requestState: 'APPROVED',
  epoch: 1,
  epochState: 'RESET_PENDING',
});

describe('T3 local launcher recovery gate', () => {
  it('runs each approved reset sequentially and verifies the pending set is empty', async () => {
    const pending = [unresolved('project-a', 'request-a'), unresolved('project-b', 'request-b')];
    const listUnresolved = vi
      .fn<() => Promise<readonly PendingSourceKnowledgeReset[]>>()
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce([]);
    const executed: string[] = [];

    await expect(
      recoverPendingSourceKnowledgeResets({ listUnresolved }, async (request) => {
        executed.push(`${request.projectId}:${request.requestId}`);
      }),
    ).resolves.toEqual(pending);

    expect(executed).toEqual(['project-a:request-a', 'project-b:request-b']);
    expect(listUnresolved).toHaveBeenCalledTimes(2);
  });

  it('does not invoke maintenance when all Project epochs are ready', async () => {
    const listUnresolved = vi.fn(async () => [] as readonly PendingSourceKnowledgeReset[]);
    const execute = vi.fn(async () => {});

    await expect(recoverPendingSourceKnowledgeResets({ listUnresolved }, execute)).resolves.toEqual(
      [],
    );

    expect(listUnresolved).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it('blocks startup when a reset has no valid durable request or remains unresolved', async () => {
    const orphanedEpoch = { ...unresolved('project-a', ''), requestState: '' };
    const invalidRepository = {
      listUnresolved: vi.fn(async () => [orphanedEpoch]),
    };
    const execute = vi.fn(async () => {});
    await expect(recoverPendingSourceKnowledgeResets(invalidRepository, execute)).rejects.toThrow(
      'invalid unresolved Project epoch',
    );
    expect(execute).not.toHaveBeenCalled();

    const stillPendingRepository = {
      listUnresolved: vi
        .fn<() => Promise<readonly PendingSourceKnowledgeReset[]>>()
        .mockResolvedValueOnce([unresolved('project-a', 'request-a')])
        .mockResolvedValueOnce([unresolved('project-a', 'request-a')]),
    };
    await expect(
      recoverPendingSourceKnowledgeResets(stillPendingRepository, async () => {}),
    ).rejects.toThrow('did not verify every Project reset');
  });

  it('stops before processing the next Project after a maintenance failure', async () => {
    const pending = [unresolved('project-a', 'request-a'), unresolved('project-b', 'request-b')];
    const listUnresolved = vi.fn(async () => pending);
    const executed: string[] = [];

    await expect(
      recoverPendingSourceKnowledgeResets({ listUnresolved }, async (request) => {
        executed.push(request.projectId);
        throw new Error('maintenance failed');
      }),
    ).rejects.toThrow('maintenance failed');
    expect(executed).toEqual(['project-a']);
    expect(listUnresolved).toHaveBeenCalledTimes(1);
  });
});
