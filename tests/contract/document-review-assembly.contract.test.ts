import { describe, expect, it } from 'vitest';

import {
  createDocumentReviewAssembly,
  documentReviewManifest,
  documentReviewUxMockContract,
} from '../../assemblies/document-review/src/index.js';
import { FakeAIProviderAdapter } from '../../adapters/ai-provider-fake/src/index.js';
import { InMemoryAssetStorage } from '../../adapters/stage2-in-memory/src/index.js';
import { SimpleTextDiffAdapter } from '../../adapters/text-diff-simple/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import type { AssetStoragePort } from '../../modules/original-asset/src/index.js';
import type { ComparisonResult, DraftChangeSet } from '../../packages/contracts/src/index.js';
import {
  changesQuery,
  directTextCommand,
  intakeResultQuery,
  reviewQuery,
} from '../helpers/stage-5.js';

class RecordingStorage implements AssetStoragePort {
  puts = 0;

  constructor(private readonly inner = new InMemoryAssetStorage()) {}

  put(contentHash: string, bytes: Uint8Array): Promise<string> {
    this.puts += 1;
    return this.inner.put(contentHash, bytes);
  }

  read(storageKey: string): Promise<Uint8Array> {
    return this.inner.read(storageKey);
  }
}

const runReview = async (
  assembly: Awaited<ReturnType<typeof createDocumentReviewAssembly>>,
  suffix: string,
) => {
  const command = directTextCommand(`stage12-${suffix}`, 'Milo weighs 5 kg.');
  await assembly.kernel.connector.sendCommand(command);
  const intake = (
    await assembly.kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
  ).result.payload;
  const changes = (
    await assembly.kernel.connector.query<{ items: readonly DraftChangeSet[] }>(
      changesQuery(command, intake.sourceVersionId),
    )
  ).result.payload.items;
  return { command, draft: changes[0] };
};

describe('Stage 12 Document Review Assembly', () => {
  it('runs an in-memory review without Canonical Knowledge or the Shotgun application', async () => {
    const assembly = await createDocumentReviewAssembly();
    const { draft } = await runReview(assembly, 'standalone');
    const health = assembly.kernel.health();

    expect(draft).toMatchObject({
      classification: 'NEW_CLAIM',
      operation: 'ADD_CLAIM',
      status: 'PENDING_REVIEW',
    });
    expect(health.modules).toHaveLength(documentReviewManifest.modules.length);
    expect(health.modules).not.toContain('stage6.canonical-knowledge');
    expect(health.capabilities).not.toContain('canonical-knowledge-writer');
    await assembly.kernel.shutdown();
  });

  it('replaces Storage, AI, Transport and jsdiff without changing domain modules', async () => {
    const storage = new RecordingStorage();
    const aiProvider = new FakeAIProviderAdapter();
    const manifest = {
      ...documentReviewManifest,
      adapters: {
        ...documentReviewManifest.adapters,
        transport: {
          port: 'MessageTransport',
          selected: 'in-process',
          alternatives: ['in-memory'],
        },
        diff: {
          port: 'TextDiffPort',
          selected: 'shotgun-simple-prefix-suffix',
          alternatives: ['jsdiff-9.0.0'],
        },
      },
    };
    const assembly = await createDocumentReviewAssembly({
      transport: new InProcessTransport(),
      assetStorage: storage,
      aiProvider,
      textDiff: new SimpleTextDiffAdapter(),
      manifest,
    });
    const { command, draft } = await runReview(assembly, 'replacement');
    const bundle = (
      await assembly.kernel.connector.query<{ comparison: ComparisonResult }>(
        reviewQuery(command, draft!.changeSetId),
      )
    ).result.payload;

    expect(bundle.comparison.diff).toEqual([{ type: 'insert', value: 'Milo weighs 5 kg.' }]);
    expect(storage.puts).toBe(1);
    expect(aiProvider.calls()).toBe(1);
    expect(assembly.kernel.health().modules).toEqual(
      documentReviewManifest.modules.map((item) => item.name),
    );
    await assembly.kernel.shutdown();
  });

  it('exposes the ddsyasas and OpenKnowledge UX patterns only as a Mock Contract', () => {
    expect(documentReviewUxMockContract).toMatchObject({
      schemaVersion: '1.0.0',
      reviewView: {
        requiredFields: ['candidate', 'machineDiff', 'evidence', 'status'],
        actions: ['approve', 'hold', 'reject'],
        canonicalCommit: false,
      },
    });
  });
});
