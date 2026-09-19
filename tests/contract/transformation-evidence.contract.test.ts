import { createChildEvent } from '../../packages/contracts/src/index.js';
import { describe, expect, it } from 'vitest';

import { InMemoryTransport } from '../../adapters/transport-in-memory/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import type { EvidenceSpan, TransformationRevision } from '../../packages/contracts/src/index.js';
import {
  createStage3Harness,
  directTextCommand,
  documentRevisionByRevisionQuery,
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

  it('replays two historical transformer revisions without consulting the current transformer', async () => {
    const { kernel, transformationRepository, evidenceRepository } = await createStage3Harness({
      transport: createTransport(),
    });
    const command = directTextCommand('stage3-historical-replay', 'R1 sentence. R2 sentence.');
    await kernel.connector.sendCommand(command);
    const stored = (
      await kernel.connector.query<{ sourceId: string; sourceVersionId: string }>(
        intakeResultQuery(command),
      )
    ).result.payload;
    const revision1 = (
      await kernel.connector.query<TransformationRevision>(
        documentRevisionQuery(command, stored.sourceVersionId),
      )
    ).result.payload;
    const revision2 = (
      await transformationRepository.save({
        projectId: command.projectId!,
        sourceId: stored.sourceId,
        sourceVersionId: stored.sourceVersionId,
        sourceContentHash: revision1.sourceContentHash,
        transformer: { id: revision1.transformer.id, version: '1.1.0' },
        output: {
          documentIR: revision1.documentIR,
          sourceMap: revision1.sourceMap,
          documentHash: revision1.documentHash,
          sourceMapHash: revision1.sourceMapHash,
        },
        accessScope: command.security!.accessScope,
        sensitivity: command.security!.sensitivity,
        createdAt: revision1.createdAt,
      })
    ).revision;

    const exactR1 = (
      await kernel.connector.query<TransformationRevision>(
        documentRevisionByRevisionQuery(command, stored.sourceVersionId, revision1.revisionId),
      )
    ).result.payload;
    const exactR2 = (
      await kernel.connector.query<TransformationRevision>(
        documentRevisionByRevisionQuery(command, stored.sourceVersionId, revision2.revisionId),
      )
    ).result.payload;

    expect(exactR1.revisionId).toBe(revision1.revisionId);
    expect(exactR2.revisionId).toBe(revision2.revisionId);
    expect(exactR1.transformer.version).toBe('1.0.1');
    expect(exactR2.transformer.version).toBe('1.1.0');

    for (const [key, revision] of [
      ['r1', exactR1],
      ['r2', exactR2],
    ] as const) {
      await kernel.connector.publishEvent(
        createChildEvent(command, {
          messageType: 'DocumentTransformed',
          schemaVersion: '1.0.0',
          producerModule: 'stage3-historical-replay-test',
          producerVersion: '1.0.0',
          idempotencyKey: `historical-replay:${key}:${revision.revisionId}`,
          payload: {
            attemptId:
              key === 'r1'
                ? '00000000-0000-4000-8000-000000000001'
                : '00000000-0000-4000-8000-000000000002',
            revisionId: revision.revisionId,
            sourceId: revision.sourceId,
            sourceVersionId: revision.sourceVersionId,
            transformerId: revision.transformer.id,
            transformerVersion: revision.transformer.version,
            documentHash: revision.documentHash,
            sourceMapHash: revision.sourceMapHash,
            reusedRevision: false,
          },
        }),
      );
    }
    expect(
      (
        await evidenceRepository.listByRevision(
          command.projectId!,
          stored.sourceVersionId,
          revision1.revisionId,
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await evidenceRepository.listByRevision(
          command.projectId!,
          stored.sourceVersionId,
          revision2.revisionId,
        )
      ).length,
    ).toBeGreaterThan(0);
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
