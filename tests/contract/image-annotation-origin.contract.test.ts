import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { PythonDocumentFormatAdapter } from '../../adapters/document-format-python/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../adapters/plain-text-lucas-augmented/src/index.js';
import {
  InMemoryAssetStorage,
  InMemoryIntakeRepository,
  InMemoryOriginalAssetRepository,
} from '../../adapters/stage2-in-memory/src/index.js';
import {
  InMemoryEvidenceRepository,
  InMemoryTransformationRepository,
} from '../../adapters/stage3-in-memory/src/index.js';
import {
  InMemoryAIProviderCallRepository,
  InMemoryCandidateRepository,
} from '../../adapters/stage4-in-memory/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import {
  createAIProviderModule,
  type AIProviderAdapterPort,
} from '../../modules/ai-provider/src/index.js';
import { createCandidateGenerationModule } from '../../modules/candidate-generation/src/index.js';
import { buildEvidenceCandidates, createEvidenceModule } from '../../modules/evidence/src/index.js';
import { createIntakeModule } from '../../modules/intake/src/index.js';
import { createOriginalAssetModule } from '../../modules/original-asset/src/index.js';
import { createTransformationModule } from '../../modules/transformation/src/index.js';
import {
  type AssetReference,
  type EvidenceSpan,
  type TransformationRevision,
  createChildEvent,
  sha256Text,
  stableJson,
  unicodeSlice,
} from '../../packages/contracts/src/index.js';
import { ShotgunKernel } from '../../packages/kernel/src/index.js';
import { fileCommand, resolveAssetQuery } from '../helpers/stage-2.js';
import {
  createStage3Harness,
  documentRevisionQuery,
  evidenceListQuery,
  intakeResultQuery,
} from '../helpers/stage-3.js';

const transformer = () =>
  new PythonDocumentFormatAdapter({
    pythonExecutable: process.env.PYTHON ?? 'python',
    multimodal: { describe: async () => '모델이 파란 영역이라고 설명합니다. 😀' },
  });

describe('generated image annotations do not become original quotation authority', () => {
  it('preserves original bytes and generated text/BBox while excluding every annotation node from Evidence', async () => {
    const { kernel, evidenceRepository } = await createStage3Harness({
      transport: new InProcessTransport(),
      transformer: transformer(),
    });
    try {
      const bytes = await readFile(path.resolve('tests/fixtures/stage-8/golden.png'));
      const command = fileCommand('image-annotation', 'golden.png', 'image/png', bytes);
      await kernel.connector.sendCommand(command);
      const result = (
        await kernel.connector.query<{
          sourceVersionId: string;
          assetReference: AssetReference;
        }>(intakeResultQuery(command))
      ).result.payload;
      const revision = (
        await kernel.connector.query<TransformationRevision>(
          documentRevisionQuery(command, result.sourceVersionId),
        )
      ).result.payload;
      expect(revision.transformer.version).toBe('1.15.0');
      expect(revision.documentIR.mediaType).toBe('image/png');
      expect(revision.documentIR.blocks[0]?.text).toBe('모델이 파란 영역이라고 설명합니다. 😀');
      expect(revision.sourceMap.entries.map((entry) => entry.nodeKind)).toEqual(
        expect.arrayContaining(['document', 'paragraph', 'sentence']),
      );
      expect(revision.sourceMap.entries.every((entry) => entry.origin === 'annotation')).toBe(true);
      const root = revision.sourceMap.entries.find((entry) => entry.pointer === '')!;
      for (const entry of revision.sourceMap.entries) {
        expect(unicodeSlice(root.quote.exact, entry.position.start, entry.position.end)).toBe(
          entry.quote.exact,
        );
        expect(entry.exactHash).toBe(sha256Text(entry.quote.exact));
      }
      expect(revision.sourceMap.entries.flatMap((entry) => entry.selectors ?? [])).toContainEqual({
        type: 'BoundingBoxSelector',
        x: 0,
        y: 0,
        width: 320,
        height: 180,
        unit: 'px',
      });
      expect(revision.sourceMapHash).toBe(sha256Text(stableJson(revision.sourceMap)));
      expect(buildEvidenceCandidates(revision, new LucasAugmentedPlainTextAdapter())).toEqual([]);
      expect(
        await evidenceRepository.listBySourceVersion(command.projectId!, result.sourceVersionId),
      ).toEqual([]);
      await expect(
        kernel.connector.query<{ items: readonly EvidenceSpan[] }>(
          evidenceListQuery(command, result.sourceVersionId),
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', operation: 'list-evidence-spans' });
      const resolved = (
        await kernel.connector.query<{ contentBase64: string; assetReference: AssetReference }>(
          resolveAssetQuery(command, result.assetReference),
        )
      ).result.payload;
      expect(Buffer.from(resolved.contentBase64, 'base64')).toEqual(bytes);
      expect(resolved.assetReference.contentHash).toBe(revision.sourceContentHash);
      // The existing success event requires positive original Evidence. An
      // annotation-only transform must not advertise successful grounding.
      expect(kernel.connector.deadLetters.list()).toContainEqual(
        expect.objectContaining({
          consumerId: 'stage3.evidence',
          error: expect.objectContaining({ code: 'VALIDATION_ERROR', operation: 'validate-input' }),
        }),
      );
    } finally {
      await kernel.shutdown();
    }
  });

  it('the existing Stage 4 continuation rejects a positive-count notification with no original Evidence before a provider attempt or Candidate', async () => {
    const generateStructured = vi.fn<AIProviderAdapterPort['generateStructured']>();
    const provider: AIProviderAdapterPort = {
      identity: {
        provider: 'fake',
        model: 'image-annotation-negative',
        adapterVersion: 'test',
        dataPolicyVersion: 'test',
      },
      generateStructured,
    };
    const providerRepository = new InMemoryAIProviderCallRepository();
    const candidateRepository = new InMemoryCandidateRepository();
    const kernel = new ShotgunKernel(new InProcessTransport());
    kernel.register(
      createIntakeModule(new InMemoryIntakeRepository()),
      createOriginalAssetModule(new InMemoryOriginalAssetRepository(), new InMemoryAssetStorage()),
      createTransformationModule(new InMemoryTransformationRepository(), transformer()),
      createEvidenceModule(new InMemoryEvidenceRepository(), new LucasAugmentedPlainTextAdapter()),
      createAIProviderModule(providerRepository, provider, {
        allowPrivate: true,
        allowRestricted: false,
        maxAttempts: 2,
      }),
      createCandidateGenerationModule(candidateRepository),
    );
    await kernel.start();
    try {
      const bytes = await readFile(path.resolve('tests/fixtures/stage-8/golden.png'));
      const command = fileCommand('image-stage4-rejection', 'golden.png', 'image/png', bytes);
      await kernel.connector.sendCommand(command);
      const result = (
        await kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
      ).result.payload;
      const revision = (
        await kernel.connector.query<TransformationRevision>(
          documentRevisionQuery(command, result.sourceVersionId),
        )
      ).result.payload;
      // Adversarial, schema-valid notification cannot manufacture original
      // Evidence from the annotation or bypass the repository read.
      const delivery = await kernel.connector.publishEvent(
        createChildEvent(command, {
          messageType: 'EvidenceIndexed',
          schemaVersion: '1.0.0',
          producerModule: 'image-annotation-negative',
          producerVersion: '1.0.0',
          idempotencyKey: 'forged-positive-image-evidence-count',
          payload: {
            sourceVersionId: result.sourceVersionId,
            revisionId: revision.revisionId,
            evidenceCount: 1,
            reusedCount: 0,
          },
        }),
      );
      expect(delivery.consumers.some((consumer) => consumer.status !== 'processed')).toBe(true);
      expect(generateStructured).not.toHaveBeenCalled();
      expect(providerRepository.list()).toEqual([]);
      expect(candidateRepository.counts()).toEqual({ batches: 0, candidates: 0 });
      expect(kernel.connector.deadLetters.list()).toContainEqual(
        expect.objectContaining({
          consumerId: 'stage4.candidate-generation',
          error: expect.objectContaining({ code: 'VALIDATION_ERROR', operation: 'load-evidence' }),
        }),
      );
    } finally {
      await kernel.shutdown();
    }
  });

  it('retains literal source origin for an existing non-image converter', async () => {
    const bytes = await readFile(path.resolve('tests/fixtures/stage-8/golden.csv'));
    const output = await transformer().transform({
      sourceId: 'source',
      sourceVersionId: 'version',
      sourceContentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      mediaType: 'text/csv',
      contentBase64: bytes.toString('base64'),
    });
    expect(output.sourceMap.entries.length).toBeGreaterThan(0);
    expect(output.sourceMap.entries.every((entry) => entry.origin === 'source')).toBe(true);
    expect(output.sourceMapHash).toBe(sha256Text(stableJson(output.sourceMap)));
  });
});
