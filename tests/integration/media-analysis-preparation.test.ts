import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

import {
  DeepSeekConnectivityAdapter,
  DEEPSEEK_IMAGE_TRANSPORT_REVISION,
} from '../../adapters/ai-provider-deepseek/src/index.js';
import {
  FfmpegOfflineMediaAdapter,
  PinnedFfmpegOfflineRunner,
  mediaBytesHash,
  type OfflineMediaRunner,
  type OfflineMediaAsset,
} from '../../adapters/media-frame-ffmpeg-offline/src/index.js';
import {
  prepareMediaFrameAnalysis,
  type PreparedFrameExecutorPort,
} from '../../modules/media-analysis-preparation/src/index.js';
import { sha256Text } from '../../packages/contracts/src/index.js';

const runtime =
  'C:/dev/artifacts/vp-full-completion-2026-10-12/media-frame-runtime/ffmpeg-9.0.2-essentials_build/bin';
const realFixture = runtime + '/../proof/synthetic-vfr.mp4';
const source = (bytes: Uint8Array): OfflineMediaAsset => ({
  projectId: 'synthetic-project',
  sourceId: 'synthetic-source',
  sourceVersionId: 'synthetic-v1',
  originalAssetId: 'synthetic-original',
  mediaType: 'video/mp4',
  bytes,
  byteLength: bytes.length,
  sourceContentHash: mediaBytesHash(bytes),
});
const fakeRunner = (): OfflineMediaRunner => ({
  run: async (command) => {
    if (command.tool === 'ffmpeg') {
      const header = Buffer.alloc(33);
      Buffer.from('89504e470d0a1a0a', 'hex').copy(header);
      header.writeUInt32BE(13, 8);
      header.write('IHDR', 12);
      header.writeUInt32BE(64, 16);
      header.writeUInt32BE(48, 20);
      return header;
    }
    return Buffer.from(
      JSON.stringify(
        command.args.includes('-show_frames')
          ? {
              frames: [0, 100, 400, 900].map((pts) => ({
                pts,
                pts_time: (pts / 1000).toFixed(6),
                width: 64,
                height: 48,
              })),
            }
          : {
              streams: [
                {
                  index: 0,
                  codec_type: 'video',
                  width: 64,
                  height: 48,
                  time_base: '1/1000',
                  start_time: '0.000000',
                },
              ],
              format: { duration: '1.200000' },
            },
      ),
    );
  },
});
const preparedNativeExecutor = (indices: readonly number[], failNetwork = false) => {
  const rawText = JSON.stringify({
    frames: indices.map((frameIndex) => ({
      frameIndex,
      description: `Authored fake HTTP description for selected frame ${frameIndex}; semantic meaning unverified.`,
    })),
  });
  const fetch = vi.fn(async (_url: string | URL, _init?: RequestInit) => {
    if (failNetwork) throw Error('synthetic unknown network outcome');
    return new Response(
      JSON.stringify({
        model: 'deepseek-flash',
        id: 'synthetic-native-response',
        choices: [{ message: { content: rawText } }],
        usage: { prompt_tokens: 31, completion_tokens: 17, total_tokens: 48 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });
  const adapter = new DeepSeekConnectivityAdapter({ fetch });
  const executor: PreparedFrameExecutorPort = {
    identity: {
      providerId: adapter.providerId,
      modelId: 'deepseek-flash',
      adapterVersion: adapter.adapterVersion,
      transportRevision: DEEPSEEK_IMAGE_TRANSPORT_REVISION,
    },
    executeOnce: (prepared) =>
      adapter.generateImageStructured({
        apiKey: new TextEncoder().encode('SYNTHETIC-KEY-NOT-LIVE'),
        modelId: 'deepseek-flash',
        request: {
          systemInstruction: prepared.systemInstruction,
          prompt: prepared.prompt,
          responseSchema: prepared.responseSchema,
          maxOutputTokens: prepared.maxOutputTokens,
        },
        images: prepared.images.map((image) => ({
          mediaType: image.mediaType,
          contentBase64: Buffer.from(image.bytes).toString('base64'),
          expectedContentHash: image.expectedContentHash,
        })),
      }),
  };
  return { executor, fetch, rawText };
};

describe('prepared offline frames → native DeepSeek fake HTTP → media alignment v1', () => {
  it('connects interchangeable CLI producer and native byte-pinned transport without activation', async () => {
    const bytes = Buffer.concat([
      Buffer.from([0, 0, 0, 16]),
      Buffer.from('ftypisom'),
      Buffer.alloc(8),
    ]);
    const producer = new FfmpegOfflineMediaAdapter(fakeRunner());
    const native = preparedNativeExecutor([0, 3]);
    const prepared = await prepareMediaFrameAnalysis(
      source(bytes),
      [0, 3],
      producer,
      native.executor,
    );
    expect(native.fetch).not.toHaveBeenCalled();
    const result = await prepared.execute();
    if (result.status !== 'GENERATED_UNVERIFIED')
      throw Error('Expected generated unverified result');
    expect(native.fetch).toHaveBeenCalledTimes(1);
    const init = native.fetch.mock.calls[0]![1]!;
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('deepseek-flash');
    expect(body.max_tokens).toBe(4096);
    expect(
      body.messages[1].content.filter((part: { type: string }) => part.type === 'image_url'),
    ).toHaveLength(2);
    const uploadedHashes = body.messages[1].content
      .filter((part: { type: string }) => part.type === 'image_url')
      .map((part: { image_url: { url: string } }) =>
        mediaBytesHash(Buffer.from(part.image_url.url.split(',')[1]!, 'base64')),
      );
    expect(uploadedHashes).toEqual(result.provenance.frameContentHashes);
    expect(result.provenance.transportRequestDigest).toBe(sha256Text(String(init.body)));
    expect(result.provenance.responseDigest).toBe(sha256Text(native.rawText));
    expect(result.provenance.execution.transportRevision).toBe(DEEPSEEK_IMAGE_TRANSPORT_REVISION);
    expect(result.alignment.source.sourceContentHash).toBe(mediaBytesHash(bytes));
    expect(result.alignment.alignments.map((entry) => entry.selector)).toMatchObject([
      { frameIndex: 0, timestampMs: 0 },
      { frameIndex: 3, timestampMs: 900 },
    ]);
    expect(result.coverage.unsampledFrameCount).toBe(2);
    expect(result.coverage.fullMediaMeaningVerified).toBe(false);
    await expect(prepared.execute()).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(native.fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps native HTTP uncertainty single-use without a second provider request', async () => {
    const bytes = Buffer.concat([
      Buffer.from([0, 0, 0, 16]),
      Buffer.from('ftypisom'),
      Buffer.alloc(8),
    ]);
    const native = preparedNativeExecutor([0, 3], true);
    const prepared = await prepareMediaFrameAnalysis(
      source(bytes),
      [0, 3],
      new FfmpegOfflineMediaAdapter(fakeRunner()),
      native.executor,
    );
    expect(await prepared.execute()).toMatchObject({
      status: 'OUTCOME_UNKNOWN',
      retryPermitted: false,
    });
    await expect(prepared.execute()).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(native.fetch).toHaveBeenCalledTimes(1);
  });
});

const ownedRuntimeAvailable =
  existsSync(realFixture) &&
  existsSync(runtime + '/ffmpeg.exe') &&
  existsSync(runtime + '/ffprobe.exe');
describe.skipIf(!ownedRuntimeAvailable)(
  'real pinned offline VFR producer and native fake HTTP prepared chain',
  () => {
    it('binds real decoded PNG bytes and original variable presentation timestamps', async () => {
      const bytes = await readFile(realFixture);
      const producer = new FfmpegOfflineMediaAdapter(new PinnedFfmpegOfflineRunner(runtime));
      const native = preparedNativeExecutor([0, 1, 3]);
      const prepared = await prepareMediaFrameAnalysis(
        source(bytes),
        [0, 1, 3],
        producer,
        native.executor,
      );
      const result = await prepared.execute();
      if (result.status !== 'GENERATED_UNVERIFIED')
        throw Error('Expected generated unverified result');
      expect(result.alignment.source.frameCount).toBe(4);
      expect(result.alignment.alignments.map((entry) => entry.selector)).toMatchObject([
        { frameIndex: 0, timestampMs: 0 },
        { frameIndex: 1, timestampMs: 100 },
        { frameIndex: 3, timestampMs: 900 },
      ]);
      const body = JSON.parse(String(native.fetch.mock.calls[0]![1]!.body));
      const uploadedHashes = body.messages[1].content
        .filter((part: { type: string }) => part.type === 'image_url')
        .map((part: { image_url: { url: string } }) =>
          mediaBytesHash(Buffer.from(part.image_url.url.split(',')[1]!, 'base64')),
        );
      expect(uploadedHashes).toEqual(result.provenance.frameContentHashes);
      expect(
        result.alignment.alignments.map(
          (entry) => (entry.selector as { frameContentHash: string }).frameContentHash,
        ),
      ).toEqual(uploadedHashes);
      expect(result.coverage).toMatchObject({
        unsampledFrameCount: 1,
        unsampledMeaning: 'UNVERIFIED',
        audioTranscribed: false,
        fullMediaMeaningVerified: false,
      });
      expect(native.fetch).toHaveBeenCalledTimes(1);
    }, 60_000);
  },
);
