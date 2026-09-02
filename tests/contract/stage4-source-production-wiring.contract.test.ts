import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  InMemoryAssetStorage,
  InMemoryOriginalAssetRepository,
} from '../../adapters/stage2-in-memory/src/index.js';
import {
  InMemoryEvidenceRepository,
  InMemoryTransformationRepository,
} from '../../adapters/stage3-in-memory/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../adapters/plain-text-lucas-augmented/src/index.js';
import { SourcesStage3Pipeline } from '../../adapters/sources-stage3-pipeline/src/index.js';
import {
  InMemoryAIProviderCallRepository,
  InMemoryCandidateRepository,
  InMemoryValidationRepository,
} from '../../adapters/stage4-in-memory/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import type {
  AIProviderAdapterPort,
  AIProviderExecutionResolverPort,
  StructuredGenerationRequest,
} from '../../modules/ai-provider/src/index.js';
import { createAIProviderModule } from '../../modules/ai-provider/src/index.js';
import { createCandidateGenerationModule } from '../../modules/candidate-generation/src/index.js';
import { createEvidenceModule } from '../../modules/evidence/src/index.js';
import { createTransformationModule } from '../../modules/transformation/src/index.js';
import { createOriginalAssetModule } from '../../modules/original-asset/src/index.js';
import { createValidationModule } from '../../modules/validation/src/index.js';
import { createChildEvent, ShotgunKernel } from '../../packages/kernel/src/index.js';
import type { AIExecutionIdentity } from '../../packages/contracts/src/index.js';

const hash = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const sourceInput = (contentHash: string, storageKey: string) => ({
  projectId: 'source-stage4-project',
  sourceId: '11111111-1111-4111-8111-111111111111',
  sourceVersionId: '22222222-2222-4222-8222-222222222222',
  storageKey,
  mediaType: 'text/plain' as const,
  contentHash,
  accessScope: ['owner'],
  sensitivity: 'public' as const,
});

const provider: AIProviderAdapterPort = {
  identity: {
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    adapterVersion: 'stage4-source-test-v1',
    dataPolicyVersion: 'deepseek-source-test-policy-v1',
  },
  async generateStructured(_request: StructuredGenerationRequest) {
    void _request;
    return {
      rawText: JSON.stringify({
        candidates: [
          {
            claimText: 'Shotgun stores Evidence.',
            evidenceId: '55555555-5555-4555-8555-555555555555',
          },
        ],
      }),
      providerResponseId: 'deepseek-response-1',
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
    };
  },
};

const fallbackProvider: AIProviderAdapterPort = {
  ...provider,
  identity: {
    ...provider.identity,
    provider: 'google-gemini',
    model: 'gemini-3.6-flash',
    adapterVersion: 'legacy-static-fallback-test-v1',
  },
};

const executionIdentity: AIExecutionIdentity = {
  providerId: 'deepseek',
  modelId: 'deepseek-v4-flash',
  aiConfigurationRevision: 4,
  credentialId: 'credential-deepseek',
  credentialRevision: 2,
  policyContextRevision: 'standing-policy-3',
  providerPolicyFingerprint: 'deepseek-policy-fingerprint-1',
};

const publishEvidenceIndexed = async (
  kernel: ShotgunKernel,
  input: {
    readonly projectId: string;
    readonly sourceVersionId: string;
    readonly revisionId: string;
    readonly evidenceCount: number;
    readonly reusedCount: number;
    readonly accessScope: readonly string[];
    readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
    readonly dataClassification: string;
  },
) => {
  const parent = {
    messageId: '33333333-3333-4333-8333-333333333333',
    messageType: 'SourceStage3Completed',
    messageKind: 'event' as const,
    schemaVersion: '1.0.0',
    producerModule: 'source-stage4-test',
    producerVersion: '1.0.0',
    correlationId: 'source-stage4-correlation',
    projectId: input.projectId,
    actor: { type: 'service' as const, id: 'source-stage4-test' },
    security: {
      accessScope: input.accessScope,
      sensitivity: input.sensitivity,
      dataClassification: input.dataClassification,
    },
    payload: {},
    createdAt: '2026-09-02T00:00:00.000Z',
    traceId: '44444444-4444-4444-8444-444444444444',
    idempotencyKey: 'source-stage4-parent',
  } as const;
  return kernel.connector.publishEvent(
    createChildEvent(parent, {
      messageType: 'EvidenceIndexed',
      schemaVersion: '1.0.0',
      producerModule: 'source-stage3-test',
      producerVersion: '1.0.0',
      idempotencyKey: `evidence-indexed:${input.projectId}:${input.revisionId}`,
      payload: {
        revisionId: input.revisionId,
        sourceVersionId: input.sourceVersionId,
        evidenceCount: input.evidenceCount,
        reusedCount: input.reusedCount,
      },
    }),
  );
};

describe('Stage 3 → Stage 4 production continuation', () => {
  it('starts one routed DeepSeek structured call after durable Evidence and reaches READY', async () => {
    const storage = new InMemoryAssetStorage();
    const evidenceRepository = new InMemoryEvidenceRepository(
      () => '55555555-5555-4555-8555-555555555555',
    );
    const transformationRepository = new InMemoryTransformationRepository();
    const aiRepository = new InMemoryAIProviderCallRepository();
    const candidateRepository = new InMemoryCandidateRepository();
    const validationRepository = new InMemoryValidationRepository();
    const textAdapter = new LucasAugmentedPlainTextAdapter();
    let providerCalls = 0;
    const countedProvider: AIProviderAdapterPort = {
      ...provider,
      generateStructured: async (request) => {
        providerCalls += 1;
        return provider.generateStructured(request);
      },
    };
    const resolver: AIProviderExecutionResolverPort = {
      resolve: async () => ({ adapter: countedProvider, executionIdentity }),
    };
    const kernel = new ShotgunKernel(new InProcessTransport());
    kernel.register(
      createOriginalAssetModule(new InMemoryOriginalAssetRepository(), storage),
      createTransformationModule(transformationRepository, textAdapter),
      createEvidenceModule(evidenceRepository, textAdapter),
      createAIProviderModule(
        aiRepository,
        fallbackProvider,
        { allowPrivate: true, allowRestricted: false, maxAttempts: 2 },
        { executionResolver: resolver },
      ),
      createCandidateGenerationModule(candidateRepository),
      createValidationModule(validationRepository),
    );
    await kernel.start();

    const bytes = new TextEncoder().encode('Shotgun stores Evidence.');
    const contentHash = hash(bytes);
    const storageKey = await storage.put(contentHash, bytes);
    let evidenceIndexed = false;
    const stage4Adapter = new SourcesStage3Pipeline({
      storage,
      transformer: textAdapter,
      locator: textAdapter,
      transformationRepository,
      evidenceRepository,
      stage4: {
        onEvidenceIndexed: async (input) => {
          evidenceIndexed = true;
          const delivery = await publishEvidenceIndexed(kernel, input);
          expect(
            delivery.consumers.every((consumer) => consumer.status === 'processed'),
            JSON.stringify(kernel.connector.deadLetters.list()),
          ).toBe(true);
        },
      },
    });

    await stage4Adapter.runForSourceVersion(sourceInput(contentHash, storageKey));
    expect(evidenceIndexed).toBe(true);

    const evidence = await evidenceRepository.listBySourceVersion(
      'source-stage4-project',
      '22222222-2222-4222-8222-222222222222',
    );
    expect(evidence.length).toBeGreaterThan(0);
    expect(providerCalls).toBe(1);
    const candidates = await candidateRepository.listBySourceVersion(
      'source-stage4-project',
      '22222222-2222-4222-8222-222222222222',
    );
    expect(candidates).toHaveLength(1);
    const candidate = candidates[0];
    expect(candidate?.status).toBe('READY');
    expect(candidate?.providerCall.executionIdentity).toEqual(executionIdentity);
    expect(aiRepository.list()[0]?.output?.providerResponseId).toBe('deepseek-response-1');
    await kernel.shutdown();
  });

  it('isolates Stage 4 continuation failure after durable Evidence', async () => {
    const storage = new InMemoryAssetStorage();
    const evidenceRepository = new InMemoryEvidenceRepository();
    const transformationRepository = new InMemoryTransformationRepository();
    const bytes = new TextEncoder().encode('Durable Evidence survives AI failure.');
    const contentHash = hash(bytes);
    const storageKey = await storage.put(contentHash, bytes);
    const pipeline = new SourcesStage3Pipeline({
      storage,
      transformer: new LucasAugmentedPlainTextAdapter(),
      locator: new LucasAugmentedPlainTextAdapter(),
      transformationRepository,
      evidenceRepository,
      stage4: {
        onEvidenceIndexed: async () => {
          throw new Error('provider policy denied');
        },
      },
    });

    const outcome = await pipeline.runForSourceVersion(sourceInput(contentHash, storageKey));
    expect(outcome.stage4.status).toBe('FAILED');
    const evidence = await evidenceRepository.listBySourceVersion(
      'source-stage4-project',
      '22222222-2222-4222-8222-222222222222',
    );
    expect(evidence.length).toBeGreaterThan(0);
  });
});
