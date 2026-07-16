import { createChildEvent } from '../../packages/contracts/src/index.js';
import { describe, expect, it } from 'vitest';

import { InMemoryTransport } from '../../adapters/transport-in-memory/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import type { EvidenceSpan, TransformationRevision } from '../../packages/contracts/src/index.js';
import {
  createStage3Harness,
  directTextCommand,
  documentRevisionQuery,
  evidenceListQuery,
  evidenceQuery,
  intakeResultQuery,
} from '../helpers/stage-3.js';

const transports = [
  ['in-memory', () => new InMemoryTransport()],
  ['in-process', () => new InProcessTransport()],
] as const;

describe.each(transports)('%s Stage 3 contract', (_name, createTransport) => {
  it('transforms original text and restores exact paragraph and sentence evidence', async () => {
    const { kernel } = await createStage3Harness({ transport: createTransport() });
    const original = '첫 문장입니다. 두 번째입니다.\r\n\r\nEmoji 🐶 works!';
    const command = directTextCommand('stage3-flow', original);

    await kernel.connector.sendCommand(command);
    const intake = (
      await kernel.connector.query<{
        sourceVersionId: string;
      }>(intakeResultQuery(command))
    ).result.payload;
    const revision = (
      await kernel.connector.query<TransformationRevision>(
        documentRevisionQuery(command, intake.sourceVersionId),
      )
    ).result.payload;
    const list = (
      await kernel.connector.query<{
        items: readonly {
          evidenceId: string;
          nodeKind: string;
        }[];
      }>(evidenceListQuery(command, intake.sourceVersionId))
    ).result.payload;
    const sentence = list.items.find((item) => item.nodeKind === 'sentence')!;
    const evidence = (
      await kernel.connector.query<EvidenceSpan>(evidenceQuery(command, sentence.evidenceId))
    ).result.payload;

    expect(revision.documentIR.blocks).toHaveLength(2);
    expect(
      revision.sourceMap.entries.filter((entry) => entry.nodeKind === 'paragraph'),
    ).toHaveLength(2);
    expect(evidence.quote.exact).toBe('첫 문장입니다.');
    expect(
      Array.from(original).slice(evidence.position.start, evidence.position.end).join(''),
    ).toBe(evidence.quote.exact);
  });

  it('reuses the same Revision and Evidence when the source event is replayed', async () => {
    const { kernel, transformationRepository, evidenceRepository } = await createStage3Harness({
      transport: createTransport(),
    });
    const command = directTextCommand('stage3-idempotent', 'same input. same output.');
    await kernel.connector.sendCommand(command);
    const stored = (
      await kernel.connector.query<{
        sourceId: string;
        sourceVersionId: string;
        versionNumber: number;
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
    const before = evidenceRepository.count();

    await kernel.connector.publishEvent(
      createChildEvent(command, {
        messageType: 'OriginalAssetStored',
        schemaVersion: '1.0.0',
        producerModule: 'stage3-contract-test',
        producerVersion: '1.0.0',
        idempotencyKey: `manual-replay:${stored.sourceVersionId}`,
        payload: {
          submissionId: command.payload.submissionId,
          sourceId: stored.sourceId,
          sourceVersionId: stored.sourceVersionId,
          versionNumber: stored.versionNumber,
          assetReference: stored.assetReference,
          assetReused: true,
          versionCreated: false,
        },
      }),
    );

    expect(transformationRepository.counts()).toEqual({ attempts: 2, revisions: 1 });
    expect(evidenceRepository.count()).toBe(before);
  });

  it('denies document and evidence queries without owner scope', async () => {
    const { kernel } = await createStage3Harness({ transport: createTransport() });
    const command = directTextCommand('stage3-security', 'private evidence');
    await kernel.connector.sendCommand(command);
    const stored = (
      await kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
    ).result.payload;
    const denied = {
      ...documentRevisionQuery(command, stored.sourceVersionId),
      security: {
        ...command.security!,
        accessScope: ['viewer'],
      },
    };

    await expect(kernel.connector.query(denied)).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
  });
});
