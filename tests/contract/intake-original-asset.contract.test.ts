import { describe, expect, it } from 'vitest';

import { InMemoryTransport } from '../../adapters/transport-in-memory/src/index.js';
import {
  InMemoryOriginalAssetRepository,
  InMemoryAssetStorage,
} from '../../adapters/stage2-in-memory/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import type { AssetReference } from '../../packages/contracts/src/index.js';
import {
  createStage2Harness,
  directTextCommand,
  fileCommand,
  intakeResultQuery,
  resolveAssetQuery,
} from '../helpers/stage-2.js';

const transports = [
  ['in-memory', () => new InMemoryTransport()],
  ['in-process', () => new InProcessTransport()],
] as const;

type PublicIntakeResult = {
  readonly submissionId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly versionNumber: number;
  readonly assetReference: AssetReference;
  readonly assetReused: boolean;
  readonly versionCreated: boolean;
};

describe.each(transports)('%s Stage 2 contract', (_name, createTransport) => {
  it('normalizes direct text and resolves the exact original UTF-8 bytes', async () => {
    const { kernel } = await createStage2Harness({ transport: createTransport() });
    const original = '첫 줄 그대로\r\nSecond line  ';
    const command = directTextCommand('direct-1', original);

    await kernel.connector.sendCommand(command);
    const resultDelivery = await kernel.connector.query<PublicIntakeResult>(
      intakeResultQuery(command),
    );
    const result = resultDelivery.result.payload;
    const resolved = await kernel.connector.query<{
      contentBase64: string;
      text: string;
    }>(resolveAssetQuery(command, result.assetReference));

    expect(result.submissionId).toBe('direct-1');
    expect(result.versionNumber).toBe(1);
    expect(resolved.result.payload.text).toBe(original);
    expect(Buffer.from(resolved.result.payload.contentBase64, 'base64')).toEqual(
      Buffer.from(original, 'utf8'),
    );
  });

  it('preserves .txt and plain-text .md file bytes without rewriting line endings', async () => {
    const { kernel } = await createStage2Harness({ transport: createTransport() });
    const cases = [
      ['file-txt', 'notes.txt', 'text/plain' as const, Buffer.from('a\r\nb\n', 'utf8')],
      ['file-md', 'notes.md', 'text/markdown' as const, Buffer.from('# 제목\n\n본문', 'utf8')],
    ] as const;

    for (const [submissionId, fileName, mediaType, bytes] of cases) {
      const command = fileCommand(submissionId, fileName, mediaType, bytes);
      await kernel.connector.sendCommand(command);
      const result = (await kernel.connector.query<PublicIntakeResult>(intakeResultQuery(command)))
        .result.payload;
      const resolved = await kernel.connector.query<{ contentBase64: string }>(
        resolveAssetQuery(command, result.assetReference),
      );
      expect(Buffer.from(resolved.result.payload.contentBase64, 'base64')).toEqual(bytes);
    }
  });

  it('distinguishes asset deduplication, a new Source and a new SourceVersion', async () => {
    const { kernel } = await createStage2Harness({ transport: createTransport() });
    const first = directTextCommand('version-first', 'version one');
    await kernel.connector.sendCommand(first);
    const firstResult = (await kernel.connector.query<PublicIntakeResult>(intakeResultQuery(first)))
      .result.payload;

    const sameAssetNewSource = directTextCommand('same-asset-new-source', 'version one');
    await kernel.connector.sendCommand(sameAssetNewSource);
    const newSourceResult = (
      await kernel.connector.query<PublicIntakeResult>(intakeResultQuery(sameAssetNewSource))
    ).result.payload;

    const newVersion = directTextCommand('version-second', 'version two', {
      sourceId: firstResult.sourceId,
    });
    await kernel.connector.sendCommand(newVersion);
    const newVersionResult = (
      await kernel.connector.query<PublicIntakeResult>(intakeResultQuery(newVersion))
    ).result.payload;

    const sameVersion = directTextCommand('same-version', 'version one', {
      sourceId: firstResult.sourceId,
    });
    await kernel.connector.sendCommand(sameVersion);
    const sameVersionResult = (
      await kernel.connector.query<PublicIntakeResult>(intakeResultQuery(sameVersion))
    ).result.payload;

    expect(newSourceResult.sourceId).not.toBe(firstResult.sourceId);
    expect(newSourceResult.assetReference.assetId).toBe(firstResult.assetReference.assetId);
    expect(newSourceResult.assetReused).toBe(true);
    expect(newVersionResult.sourceId).toBe(firstResult.sourceId);
    expect(newVersionResult.versionNumber).toBe(2);
    expect(newVersionResult.sourceVersionId).not.toBe(firstResult.sourceVersionId);
    expect(sameVersionResult.sourceVersionId).toBe(firstResult.sourceVersionId);
    expect(sameVersionResult.versionCreated).toBe(false);
  });

  it('does not create duplicate versions when a command is delivered again', async () => {
    const repository = new InMemoryOriginalAssetRepository();
    const storage = new InMemoryAssetStorage();
    const firstHarness = await createStage2Harness({
      transport: createTransport(),
      originalAssetRepository: repository,
      storage,
    });
    const command = directTextCommand('durable-dedup', 'same command');

    await firstHarness.kernel.connector.sendCommand(command);
    await firstHarness.kernel.connector.sendCommand(command);
    await firstHarness.kernel.shutdown();

    const secondHarness = await createStage2Harness({
      transport: createTransport(),
      intakeRepository: firstHarness.intakeRepository,
      originalAssetRepository: repository,
      storage,
    });
    const replayedAfterRestart = directTextCommand('durable-dedup', 'same command');
    await secondHarness.kernel.connector.sendCommand(replayedAfterRestart);

    expect(repository.counts()).toEqual({
      assets: 1,
      sources: 1,
      versions: 1,
      receipts: 1,
    });
  });

  it('rejects reuse of an idempotency key for different original content', async () => {
    const repository = new InMemoryOriginalAssetRepository();
    const { kernel } = await createStage2Harness({
      transport: createTransport(),
      originalAssetRepository: repository,
    });
    const first = directTextCommand('idempotency-conflict', 'first content');
    const conflicting = directTextCommand('idempotency-conflict', 'different content');

    await kernel.connector.sendCommand(first);
    await expect(kernel.connector.sendCommand(conflicting)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(repository.counts()).toEqual({
      assets: 1,
      sources: 1,
      versions: 1,
      receipts: 1,
    });
  });

  it('denies cross-project and insufficient-scope resolver requests', async () => {
    const { kernel } = await createStage2Harness({ transport: createTransport() });
    const command = directTextCommand('security-asset', 'private original');
    await kernel.connector.sendCommand(command);
    const result = (await kernel.connector.query<PublicIntakeResult>(intakeResultQuery(command)))
      .result.payload;

    await expect(
      kernel.connector.query(
        resolveAssetQuery(command, result.assetReference, { projectId: 'project-b' }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      kernel.connector.query(
        resolveAssetQuery(command, result.assetReference, { accessScope: ['viewer'] }),
      ),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });

  it('records Intake through OriginalAssetStored in separate Trace and Audit stores', async () => {
    const { kernel } = await createStage2Harness({ transport: createTransport() });
    const command = directTextCommand('audit-trace', 'trace me');

    await kernel.connector.sendCommand(command);

    const traceTypes = kernel.connector.traces
      .findByTraceId(command.traceId)
      .map((record) => `${record.messageType}:${record.status}`);
    const audit = kernel.connector.audit.findByTraceId(command.traceId);
    expect(traceTypes).toContain('SubmitIntake:succeeded');
    expect(traceTypes).toContain('IntakeAccepted:succeeded');
    expect(traceTypes).toContain('OriginalAssetStored:published');
    expect(audit.some((record) => record.messageType === 'SubmitIntake')).toBe(true);
    expect(audit.some((record) => record.messageType === 'IntakeAccepted')).toBe(true);
    expect(audit.some((record) => record.messageType === 'OriginalAssetStored')).toBe(true);
    expect(audit.every((record) => !('payload' in record))).toBe(true);
  });
});
