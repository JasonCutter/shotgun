import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  InMemoryAssetStorage,
  InMemoryOriginalAssetRepository,
} from '../../adapters/stage2-in-memory/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import { ShotgunError } from '../../packages/contracts/src/index.js';
import type {
  AssetStoragePort,
  OriginalAssetRepositoryPort,
  StoreOriginalAssetInput,
} from '../../modules/original-asset/src/index.js';
import {
  createStage2Harness,
  directTextCommand,
  intakeResultQuery,
  resolveAssetQuery,
} from '../helpers/stage-2.js';

class FailOnceStorage implements AssetStoragePort {
  calls = 0;

  constructor(private readonly delegate: AssetStoragePort) {}

  async put(contentHash: string, bytes: Uint8Array): Promise<string> {
    this.calls += 1;
    if (this.calls === 1) {
      throw new ShotgunError({
        code: 'RETRYABLE_DEPENDENCY',
        safeMessage: 'Injected temporary storage failure.',
        module: 'reliability-test',
        operation: 'put',
        retryable: true,
      });
    }
    return this.delegate.put(contentHash, bytes);
  }

  read(storageKey: string): Promise<Uint8Array> {
    return this.delegate.read(storageKey);
  }
}

class CountingStorage implements AssetStoragePort {
  puts = 0;

  constructor(private readonly delegate: AssetStoragePort) {}

  async put(contentHash: string, bytes: Uint8Array): Promise<string> {
    this.puts += 1;
    return this.delegate.put(contentHash, bytes);
  }

  read(storageKey: string): Promise<Uint8Array> {
    return this.delegate.read(storageKey);
  }
}

class FailOnceRepository implements OriginalAssetRepositoryPort {
  calls = 0;

  constructor(private readonly delegate: OriginalAssetRepositoryPort) {}

  assertSource(projectId: string, sourceId: string) {
    return this.delegate.assertSource(projectId, sourceId);
  }

  async store(input: StoreOriginalAssetInput) {
    this.calls += 1;
    if (this.calls === 1) {
      throw new ShotgunError({
        code: 'RETRYABLE_DEPENDENCY',
        safeMessage: 'Injected temporary database failure after upload.',
        module: 'reliability-test',
        operation: 'store',
        retryable: true,
      });
    }
    return this.delegate.store(input);
  }

  findBySubmission(projectId: string, submissionId: string) {
    return this.delegate.findBySubmission(projectId, submissionId);
  }

  findByVersion(projectId: string, sourceVersionId: string) {
    return this.delegate.findByVersion(projectId, sourceVersionId);
  }
}

describe('Stage 2 reliability', () => {
  it('rejects an unknown Source before writing original bytes', async () => {
    const storage = new CountingStorage(new InMemoryAssetStorage());
    const { kernel } = await createStage2Harness({
      transport: new InProcessTransport(),
      storage,
    });
    const command = directTextCommand('unknown-source', 'must not upload', {
      sourceId: randomUUID(),
    });

    await kernel.connector.sendCommand(command);

    expect(storage.puts).toBe(0);
    expect(kernel.connector.deadLetters.list()).toHaveLength(1);
    expect(kernel.connector.deadLetters.list()[0]?.error.code).toBe('NOT_FOUND');
  });

  it('recovers from a failed upload without creating duplicate versions', async () => {
    const repository = new InMemoryOriginalAssetRepository();
    const storage = new FailOnceStorage(new InMemoryAssetStorage());
    const { kernel } = await createStage2Harness({
      transport: new InProcessTransport(),
      originalAssetRepository: repository,
      storage,
    });
    const command = directTextCommand('upload-retry', 'recover upload');

    await kernel.connector.sendCommand(command);

    const job = kernel.connector.jobs
      .list()
      .find((candidate) => candidate.consumerId.includes('stage2.original-asset'));
    expect(storage.calls).toBe(2);
    expect(job?.attempts.map((attempt) => attempt.status)).toEqual(['failed', 'succeeded']);
    expect(repository.counts()).toEqual({
      assets: 1,
      sources: 1,
      versions: 1,
      receipts: 1,
    });
  });

  it('reuses a completed content-addressed upload when persistence retries', async () => {
    const repository = new InMemoryOriginalAssetRepository();
    const failingRepository = new FailOnceRepository(repository);
    const storage = new InMemoryAssetStorage();
    const { kernel } = await createStage2Harness({
      transport: new InProcessTransport(),
      originalAssetRepository: failingRepository,
      storage,
    });
    const command = directTextCommand('database-retry', 'persist after upload');

    await kernel.connector.sendCommand(command);

    expect(failingRepository.calls).toBe(2);
    expect(repository.counts()).toEqual({
      assets: 1,
      sources: 1,
      versions: 1,
      receipts: 1,
    });
  });

  it('detects tampered original bytes before returning them', async () => {
    const repository = new InMemoryOriginalAssetRepository();
    const storage = new InMemoryAssetStorage();
    const { kernel } = await createStage2Harness({
      transport: new InProcessTransport(),
      originalAssetRepository: repository,
      storage,
    });
    const command = directTextCommand('tampered', 'trusted original');
    await kernel.connector.sendCommand(command);
    const result = (
      await kernel.connector.query<{
        assetReference: {
          assetId: string;
          versionId: string;
          mediaType: string;
          contentHash: string;
          sizeBytes: number;
          storageUri: string;
          accessScope: readonly string[];
        };
      }>(intakeResultQuery(command))
    ).result.payload;
    const stored = await repository.findBySubmission('project-a', 'tampered');
    storage.corrupt(stored!.storageKey, Buffer.from('changed bytes', 'utf8'));

    await expect(
      kernel.connector.query(resolveAssetQuery(command, result.assetReference)),
    ).rejects.toMatchObject({ code: 'STALE_VERSION' });
  });

  it('rejects a forged Asset Reference even when the version id exists', async () => {
    const { kernel } = await createStage2Harness({ transport: new InProcessTransport() });
    const command = directTextCommand('forged', 'immutable reference');
    await kernel.connector.sendCommand(command);
    const result = (
      await kernel.connector.query<{
        assetReference: {
          assetId: string;
          versionId: string;
          mediaType: string;
          contentHash: string;
          sizeBytes: number;
          storageUri: string;
          accessScope: readonly string[];
        };
      }>(intakeResultQuery(command))
    ).result.payload;
    const forged = {
      ...result.assetReference,
      storageUri: `asset://${result.assetReference.assetId}/versions/forged`,
    };

    await expect(kernel.connector.query(resolveAssetQuery(command, forged))).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});
