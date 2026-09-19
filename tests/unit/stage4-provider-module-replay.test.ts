import { describe, expect, it, vi } from 'vitest';

import { InMemoryAIProviderCallRepository } from '../../adapters/stage4-in-memory/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import {
  createAIProviderModule,
  type AIProviderAdapterPort,
} from '../../modules/ai-provider/src/index.js';
import {
  createChildQuery,
  createCommand,
  ShotgunError,
  ShotgunKernel,
} from '../../packages/kernel/src/index.js';

const root = createCommand({
  messageType: 'TestRoot',
  schemaVersion: '1.0.0',
  producerModule: 'stage4-provider-module-test',
  producerVersion: '1.0.0',
  idempotencyKey: 'stage4-provider-module-test',
  projectId: 'stage4-provider-module-replay',
  actor: { type: 'service', id: 'stage4-provider-module-test' },
  security: {
    accessScope: ['owner'],
    sensitivity: 'public',
    dataClassification: 'public',
  },
  payload: {},
});

const makeQuery = () =>
  createChildQuery(root, {
    messageType: 'GenerateStructured',
    schemaVersion: '1.0.0',
    producerModule: 'stage4-provider-module-test',
    producerVersion: '1.0.0',
    payload: {
      requestId: 'terminal-module-replay-request',
      taskProfile: 'candidate-extraction',
      schemaName: 'ClaimCandidateBatch.v1',
      policyVersion: 'direct-only-v1',
      dataClassification: 'public',
      sourceVersionId: 'source-1',
      accessScope: ['owner'],
      sensitivity: 'public',
      evidence: [
        {
          evidenceId: 'evidence-1',
          text: 'Milo weighs 5 kg.',
          exactHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
          revisionId: 'revision-1',
        },
      ],
    },
  });

describe('Stage 4 provider module terminal replay guard', () => {
  it('does not resolve or invoke a provider again after a durable terminal failure', async () => {
    let calls = 0;
    const provider: AIProviderAdapterPort = {
      identity: {
        provider: 'test-provider',
        adapterVersion: 'test-provider-v1',
        model: 'test-model',
        dataPolicyVersion: 'test-policy-v1',
      },
      async generateStructured() {
        calls += 1;
        throw new ShotgunError({
          code: 'CONFIGURATION_REQUIRED',
          safeMessage: 'The test provider is not configured.',
          module: 'stage4-provider-module-test',
          operation: 'generate-structured',
          retryable: false,
        });
      },
    };
    const kernel = new ShotgunKernel(new InProcessTransport());
    kernel.register(
      createAIProviderModule(new InMemoryAIProviderCallRepository(), provider, {
        allowPrivate: false,
        allowRestricted: false,
        maxAttempts: 2,
      }),
    );
    await kernel.start();

    await expect(kernel.connector.query(makeQuery())).rejects.toMatchObject({
      code: 'CONFIGURATION_REQUIRED',
    });
    await expect(kernel.connector.query(makeQuery())).rejects.toMatchObject({
      code: 'CONFIGURATION_REQUIRED',
      safeMessage:
        'The prior provider attempt failed terminally and will not be called again automatically.',
    });
    expect(calls).toBe(1);

    await kernel.shutdown();
  });

  it('passes the request signal to the provider and rejects a late response before storage', async () => {
    const repository = new InMemoryAIProviderCallRepository();
    let releaseProvider!: (response: { rawText: string }) => void;
    let providerStarted!: () => void;
    const providerStartedPromise = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });
    let receivedSignal!: AbortSignal;
    const provider = {
      identity: {
        provider: 'test-provider',
        adapterVersion: 'test-provider-v1',
        model: 'test-model',
        dataPolicyVersion: 'test-policy-v1',
      },
      async generateStructured() {
        throw new Error('signal-aware provider path was not used');
      },
      generateStructuredWithSignal: vi.fn(
        async (_request: unknown, signal?: AbortSignal) =>
          new Promise<{ rawText: string }>((resolve) => {
            receivedSignal = signal!;
            providerStarted();
            releaseProvider = resolve;
          }),
      ),
    } satisfies AIProviderAdapterPort;
    const kernel = new ShotgunKernel(new InProcessTransport());
    kernel.register(
      createAIProviderModule(repository, provider, {
        allowPrivate: false,
        allowRestricted: false,
        maxAttempts: 2,
      }),
    );
    await kernel.start();

    const controller = new AbortController();
    const request = kernel.connector.query(makeQuery(), { signal: controller.signal });
    await providerStartedPromise;
    controller.abort('cancel-late-provider-response');
    releaseProvider({ rawText: '{"candidates":[]}' });

    await expect(request).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(receivedSignal.aborted).toBe(true);
    await vi.waitFor(async () => {
      const record = await repository.findByRequestId(
        root.projectId!,
        'terminal-module-replay-request',
      );
      expect(record?.state).toBe('OUTCOME_UNKNOWN');
      expect(record?.output).toBeUndefined();
    });
    expect(provider.generateStructuredWithSignal).toHaveBeenCalledWith(
      expect.objectContaining({ responseSchema: expect.any(Object) }),
      receivedSignal,
    );
    await kernel.shutdown();
  });
});
