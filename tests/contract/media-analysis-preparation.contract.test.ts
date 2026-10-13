import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

import {
  prepareMediaFrameAnalysis,
  type MediaPreparationAsset,
  type MediaPreparationManifest,
  type MediaFrameProducerPort,
  type PreparedFrameExecutorPort,
  type PreparedFrameExecutionResponse,
} from '../../modules/media-analysis-preparation/src/index.js';
import { sha256Text } from '../../packages/contracts/src/index.js';

const hash = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const png = () => {
  const bytes = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(64, 16);
  bytes.writeUInt32BE(48, 20);
  return bytes;
};
const asset = (): MediaPreparationAsset => {
  const bytes = Buffer.from('synthetic original bytes');
  return {
    projectId: 'project',
    sourceId: 'source',
    sourceVersionId: 'v1',
    originalAssetId: 'asset',
    sourceContentHash: hash(bytes),
    mediaType: 'video/mp4',
    bytes,
    byteLength: bytes.length,
  };
};
const manifest = (): MediaPreparationManifest => ({
  source: {
    projectId: 'project',
    sourceId: 'source',
    sourceVersionId: 'v1',
    sourceContentHash: asset().sourceContentHash,
    mediaType: 'video/mp4',
    durationMs: 1200,
    frameCount: 4,
  },
  originalAssetId: 'asset',
  originalByteLength: asset().byteLength,
  generator: { id: 'offline-fixture', version: '1.0.0', commit: 'authored-fixture' },
  frames: [0, 3].map((frameIndex) => ({
    frameIndex,
    timestampMs: frameIndex === 0 ? 0 : 900,
    frameContentHash: hash(png()),
    widthPx: 64,
    heightPx: 48,
    bytes: png(),
  })),
});
const response = (): PreparedFrameExecutionResponse => ({
  rawText: JSON.stringify({
    frames: [
      { frameIndex: 3, description: 'Generated red shape; meaning unverified.' },
      { frameIndex: 0, description: '조건: 10%가 아니다. 😀' },
    ],
  }),
  providerResponseId: 'synthetic-response',
  modelVersion: 'fixture-model',
  imageTransportRevision: 'fixture-v1',
  imageRequestDigest: sha256Text('actual fixture transport request'),
  imageContentHashes: [hash(png()), hash(png())],
  inputTokens: 10,
  outputTokens: 4,
  totalTokens: 14,
});
const fixture = (output: PreparedFrameExecutionResponse = response(), produced = manifest()) => {
  const producer: MediaFrameProducerPort = { extract: vi.fn(async () => produced) };
  const executeOnce = vi.fn(async () => output);
  const executor: PreparedFrameExecutorPort = {
    identity: {
      providerId: 'fixture-provider',
      modelId: 'fixture-model',
      adapterVersion: 'fixture-adapter-v1',
      transportRevision: 'fixture-v1',
    },
    executeOnce,
  };
  return { producer, executor, executeOnce };
};

describe('inactive single-use media analysis preparation contract', () => {
  it('maps all selected frames once in display order and declares unsampled meaning', async () => {
    const f = fixture();
    const plan = await prepareMediaFrameAnalysis(asset(), [0, 3], f.producer, f.executor);
    expect(f.executeOnce).not.toHaveBeenCalled();
    const result = await plan.execute();
    expect(result.status).toBe('GENERATED_UNVERIFIED');
    if (result.status !== 'GENERATED_UNVERIFIED') throw Error('unexpected result');
    expect(result.alignment.alignments.map((entry) => entry.selector)).toMatchObject([
      { frameIndex: 0, timestampMs: 0 },
      { frameIndex: 3, timestampMs: 900 },
    ]);
    expect(result.alignment.derivedText).toContain('조건: 10%가 아니다. 😀');
    expect(result.alignment.semanticStatus).toBe('UNVERIFIED');
    expect(result.alignment.alignmentStatus).toBe('DECLARED');
    expect(result.coverage).toEqual({
      selectedFrameIndices: [0, 3],
      describedFrameIndices: [0, 3],
      unsampledFrameCount: 2,
      unsampledMeaning: 'UNVERIFIED',
      audioTranscribed: false,
      fullMediaMeaningVerified: false,
    });
    expect(result.provenance).toMatchObject({
      planDigest: plan.planDigest,
      providerResponseId: 'synthetic-response',
      responseDigest: sha256Text(response().rawText),
      transportRequestDigest: response().imageRequestDigest,
      execution: f.executor.identity,
      decoder: manifest().generator,
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14,
    });
    expect(result).not.toHaveProperty('evidenceId');
    expect(result.alignment).not.toHaveProperty('origin');
    expect(plan.executionDisposition()).toBe('SUCCEEDED');
    await expect(plan.execute()).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      retryable: false,
    });
    expect(f.executeOnce).toHaveBeenCalledTimes(1);
  });

  it('rejects every over-limit/empty/duplicate/unsorted selection without model calls', async () => {
    for (const selected of [[], [0, 0], [3, 0], [0, 1, 2, 3, 4]]) {
      const f = fixture();
      await expect(
        prepareMediaFrameAnalysis(asset(), selected, f.producer, f.executor),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(f.executeOnce).not.toHaveBeenCalled();
    }
  });

  it('rejects forged original identity/hash and producer asset/frame bindings before execution', async () => {
    const wrong = asset();
    for (const changed of [
      { ...wrong, sourceContentHash: sha256Text('changed') },
      { ...wrong, byteLength: 1 },
    ]) {
      const f = fixture();
      await expect(
        prepareMediaFrameAnalysis(changed, [0, 3], f.producer, f.executor),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(f.producer.extract).not.toHaveBeenCalled();
    }
    for (const changed of [
      { ...manifest(), originalAssetId: 'different' },
      { ...manifest(), source: { ...manifest().source, sourceVersionId: 'v2' } },
      { ...manifest(), frames: [manifest().frames[0]!] },
      { ...manifest(), frames: [manifest().frames[0]!, manifest().frames[0]!] },
      {
        ...manifest(),
        frames: manifest().frames.map((frame) => ({
          ...frame,
          frameContentHash: sha256Text('changed'),
        })),
      },
      { ...manifest(), frames: manifest().frames.map((frame) => ({ ...frame, timestampMs: 900 })) },
      { ...manifest(), frames: manifest().frames.map((frame) => ({ ...frame, widthPx: 65 })) },
    ]) {
      const f = fixture(response(), changed);
      await expect(
        prepareMediaFrameAnalysis(asset(), [0, 3], f.producer, f.executor),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(f.executeOnce).not.toHaveBeenCalled();
    }
  });

  it.each([
    { frames: [{ frameIndex: 0, description: 'only one' }] },
    {
      frames: [
        { frameIndex: 0, description: 'one' },
        { frameIndex: 0, description: 'duplicate' },
      ],
    },
    {
      frames: [
        { frameIndex: 0, description: 'one' },
        { frameIndex: 2, description: 'unknown' },
      ],
    },
    {
      frames: [
        { frameIndex: 0, description: 'one' },
        { frameIndex: 3, description: ' ' },
      ],
    },
    {
      frames: [
        { frameIndex: 0, description: 'one', fact: true },
        { frameIndex: 3, description: 'two' },
      ],
    },
    {
      frames: [
        { frameIndex: 0, description: 'a'.repeat(30_001) },
        { frameIndex: 3, description: 'two' },
      ],
    },
    { frames: [], origin: 'source' },
  ])(
    'rejects incomplete/duplicate/unknown/untrusted structured output without retries',
    async (payload) => {
      const f = fixture({ ...response(), rawText: JSON.stringify(payload) });
      const plan = await prepareMediaFrameAnalysis(asset(), [0, 3], f.producer, f.executor);
      await expect(plan.execute()).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        retryable: false,
      });
      expect(plan.executionDisposition()).toBe('OUTPUT_REJECTED');
      await expect(plan.execute()).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(f.executeOnce).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { modelVersion: 'other-model' },
    { imageTransportRevision: 'other' },
    { imageContentHashes: [sha256Text('other'), hash(png())] },
    { imageContentHashes: [] },
    { imageRequestDigest: 'invalid' },
    { providerResponseId: undefined },
    { inputTokens: -1 },
    { rawText: '{' },
  ])('rejects invalid provenance without repeating execution: %j', async (patch) => {
    const f = fixture({ ...response(), ...patch });
    const plan = await prepareMediaFrameAnalysis(asset(), [0, 3], f.producer, f.executor);
    await expect(plan.execute()).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(f.executeOnce).toHaveBeenCalledTimes(1);
  });

  it('holds uncertain outcome and prevents concurrent or second-handle executor reuse', async () => {
    const f = fixture();
    f.executeOnce.mockRejectedValue(new Error('network outcome unknown with secret'));
    const first = await prepareMediaFrameAnalysis(asset(), [0, 3], f.producer, f.executor);
    const second = await prepareMediaFrameAnalysis(asset(), [0, 3], f.producer, f.executor);
    const result = first.execute();
    await expect(first.execute()).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(second.execute()).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await result).toMatchObject({ status: 'OUTCOME_UNKNOWN', retryPermitted: false });
    expect(first.executionDisposition()).toBe('OUTCOME_UNKNOWN');
    expect(JSON.stringify(await result)).not.toContain('secret');
    expect(f.executeOnce).toHaveBeenCalledTimes(1);
  });

  it('snapshots source/frame bytes and execution identity before asynchronous execution', async () => {
    const produced = manifest();
    const f = fixture(response(), produced);
    const input = asset();
    const plan = await prepareMediaFrameAnalysis(input, [0, 3], f.producer, f.executor);
    input.bytes.fill(0);
    produced.frames[0]!.bytes.fill(0);
    (produced.source as { sourceId: string }).sourceId = 'mutated';
    const result = await plan.execute();
    expect(result.status).toBe('GENERATED_UNVERIFIED');
    const call = f.executeOnce.mock.calls[0]! as unknown as [
      { images: { bytes: Uint8Array; expectedContentHash: string }[] },
    ];
    expect(hash(call[0].images[0]!.bytes)).toBe(call[0].images[0]!.expectedContentHash);
    if (result.status === 'GENERATED_UNVERIFIED')
      expect(result.alignment.source.sourceId).toBe('source');
  });

  it('rejects identity or callable changes after preparation before any execution', async () => {
    for (const change of ['identity-value', 'identity-object', 'callable'] as const) {
      const f = fixture();
      const plan = await prepareMediaFrameAnalysis(asset(), [0, 3], f.producer, f.executor);
      const replacement = vi.fn(async () => response());
      const mutable = f.executor as {
        identity: {
          providerId: string;
          modelId: string;
          adapterVersion: string;
          transportRevision: string;
        };
        executeOnce: PreparedFrameExecutorPort['executeOnce'];
      };
      if (change === 'identity-value') mutable.identity.modelId = 'unapproved-model';
      else if (change === 'identity-object') mutable.identity = { ...mutable.identity };
      else mutable.executeOnce = replacement;
      await expect(plan.execute()).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(plan.executionDisposition()).toBe('NOT_EXECUTED');
      expect(f.executeOnce).not.toHaveBeenCalled();
      expect(replacement).not.toHaveBeenCalled();
    }
  });

  it('invokes the captured callable with its original private-field executor instance', async () => {
    class PrivateFieldExecutor implements PreparedFrameExecutorPort {
      readonly identity = fixture().executor.identity;
      #calls = 0;
      #output = response();

      async executeOnce(): Promise<PreparedFrameExecutionResponse> {
        this.#calls++;
        return this.#output;
      }

      get calls(): number {
        return this.#calls;
      }
    }

    const executor = new PrivateFieldExecutor();
    const plan = await prepareMediaFrameAnalysis(asset(), [0, 3], fixture().producer, executor);
    expect(executor.calls).toBe(0);
    expect((await plan.execute()).status).toBe('GENERATED_UNVERIFIED');
    expect(executor.calls).toBe(1);
    await expect(plan.execute()).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(executor.calls).toBe(1);
  });

  it('rejects identity or callable changes during decoder await before any execution', async () => {
    for (const change of ['identity-value', 'identity-object', 'callable'] as const) {
      const f = fixture();
      const replacement = vi.fn(async () => response());
      const mutable = f.executor as {
        identity: {
          providerId: string;
          modelId: string;
          adapterVersion: string;
          transportRevision: string;
        };
        executeOnce: PreparedFrameExecutorPort['executeOnce'];
      };
      let resolveDecoder!: (value: MediaPreparationManifest) => void;
      const producer: MediaFrameProducerPort = {
        extract: () =>
          new Promise((resolve) => {
            resolveDecoder = resolve;
          }),
      };
      const preparation = prepareMediaFrameAnalysis(asset(), [0, 3], producer, f.executor);
      if (change === 'identity-value') mutable.identity.modelId = 'unapproved-model';
      else if (change === 'identity-object') mutable.identity = { ...mutable.identity };
      else mutable.executeOnce = replacement;
      resolveDecoder(manifest());
      await expect(preparation).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(f.executeOnce).not.toHaveBeenCalled();
      expect(replacement).not.toHaveBeenCalled();
    }
  });
});
