import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FfmpegOfflineMediaAdapter,
  PinnedFfmpegOfflineRunner,
  MEDIA_FRAME_LIMITS,
  mediaBytesHash,
  type OfflineMediaAsset,
  type OfflineMediaCommand,
  type OfflineMediaRunner,
} from '../../adapters/media-frame-ffmpeg-offline/src/index.js';

const raw = Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from('ftypisom'), Buffer.alloc(8)]);
const asset = (): OfflineMediaAsset => ({
  projectId: 'project',
  sourceId: 'source',
  sourceVersionId: 'v1',
  originalAssetId: 'original',
  sourceContentHash: mediaBytesHash(raw),
  mediaType: 'video/mp4',
  byteLength: raw.length,
  bytes: raw,
});
const metadata = () => ({
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
});
const decoded = () => ({
  frames: [0, 100, 400, 900].map((pts) => ({
    pts,
    pts_time: (pts / 1000).toFixed(6),
    width: 64,
    height: 48,
  })),
});
const png = (width = 64): Buffer => {
  const bytes = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(48, 20);
  return bytes;
};
class Fake implements OfflineMediaRunner {
  readonly calls: OfflineMediaCommand[] = [];
  constructor(
    readonly meta: unknown = metadata(),
    readonly timing: unknown = decoded(),
    readonly frame: Buffer = png(),
  ) {}
  async run(command: OfflineMediaCommand): Promise<Buffer> {
    this.calls.push(command);
    return command.tool === 'ffmpeg'
      ? this.frame
      : Buffer.from(
          JSON.stringify(command.args.includes('-show_frames') ? this.timing : this.meta),
        );
  }
}
describe('inactive offline FFmpeg replacement contract', () => {
  it('pins original bytes, actual variable PTS and generated sample omissions', async () => {
    const runner = new Fake();
    const result = await new FfmpegOfflineMediaAdapter(runner).extract(asset(), [1, 3]);
    expect(result.source).toMatchObject({ durationMs: 1200, frameCount: 4, sourceVersionId: 'v1' });
    expect(
      result.frames.map((f) => [f.frameIndex, f.timestampMs, f.presentationTimestamp]),
    ).toEqual([
      [1, 100, '100'],
      [3, 900, '900'],
    ]);
    expect(result.frames[0]!.frameContentHash).toBe(mediaBytesHash(png()));
    expect(result.coverage).toEqual({
      kind: 'SAMPLED',
      sampledFrameIndices: [1, 3],
      unsampledFrameCount: 2,
      audioTranscribed: false,
      fullMediaMeaningVerified: false,
    });
    expect(result.semanticStatus).toBe('UNVERIFIED');
    for (const call of runner.calls) {
      expect(call.args).toContain('pipe:0');
      expect(call.args).toContain('-protocol_whitelist');
      expect(call.args[call.args.indexOf('-protocol_whitelist') + 1]).toBe('pipe');
      expect(call.args).toContain('-enable_drefs');
      expect(call.args).toContain('-use_absolute_path');
      expect(call.args).not.toContain('file');
      expect(call.input).toEqual(raw);
    }
    expect(runner.calls[2]!.args).toContain('select=eq(n\\,1)');
  });
  it('returns honest metadata-only coverage without implicitly selecting frames', async () => {
    const runner = new Fake();
    const result = await new FfmpegOfflineMediaAdapter(runner).extract(asset());
    expect(result.coverage).toMatchObject({ kind: 'METADATA_ONLY', unsampledFrameCount: 4 });
    expect(result.frames).toEqual([]);
    expect(runner.calls).toHaveLength(2);
  });
  it.each([
    { sourceContentHash: 'sha256:' + '0'.repeat(64) },
    { byteLength: raw.length + 1 },
    { mediaType: 'text/plain' },
    { originalAssetId: '' },
    { bytes: Buffer.from('#EXTM3U https://example.com') },
  ])('rejects invalid original binding before CLI invocation %j', async (patch) => {
    const runner = new Fake();
    await expect(
      new FfmpegOfflineMediaAdapter(runner).extract({ ...asset(), ...patch } as OfflineMediaAsset),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(runner.calls).toHaveLength(0);
  });
  it.each([[1, 1], [2, 1], [-1], [0.5], Array.from({ length: 17 }, (_, i) => i)])(
    'rejects unbounded/ambiguous sampling %j',
    async (...indices) => {
      const runner = new Fake();
      await expect(
        new FfmpegOfflineMediaAdapter(runner).extract(asset(), indices),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(runner.calls).toHaveLength(0);
    },
  );
  it.each([
    { ...metadata(), format: { duration: '99999999' } },
    { ...metadata(), streams: [{ ...metadata().streams[0], width: 8192 }] },
    { ...metadata(), streams: [{ ...metadata().streams[0], start_time: '1.000000' }] },
    { ...metadata(), streams: [{ ...metadata().streams[0], codec_type: 'audio' }] },
  ])('rejects source geometry/time/stream budget %j', async (meta) => {
    const runner = new Fake(meta);
    await expect(new FfmpegOfflineMediaAdapter(runner).extract(asset(), [0])).rejects.toMatchObject(
      { code: 'VALIDATION_ERROR' },
    );
    expect(runner.calls).toHaveLength(1);
  });
  it.each([
    { frames: [] },
    { frames: [decoded().frames[1], decoded().frames[0]] },
    { frames: [{ ...decoded().frames[0], pts_time: '0.200000' }] },
    { frames: [{ ...decoded().frames[0], width: 100 }] },
    { frames: Array(MEDIA_FRAME_LIMITS.decodedFrames + 1).fill(decoded().frames[0]) },
  ])('rejects invalid decoded frame PTS/dimensions/count', async (timing) => {
    const runner = new Fake(metadata(), timing);
    await expect(new FfmpegOfflineMediaAdapter(runner).extract(asset(), [0])).rejects.toMatchObject(
      { code: 'VALIDATION_ERROR' },
    );
    expect(runner.calls).toHaveLength(2);
  });
  it.each([Buffer.from('invalid PNG'), png(63)])(
    'rejects generated frame shape %j',
    async (frame) => {
      await expect(
        new FfmpegOfflineMediaAdapter(new Fake(metadata(), decoded(), frame)).extract(asset(), [0]),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    },
  );
  it('rejects missing selected frame rather than inventing index/FPS timing', async () => {
    await expect(
      new FfmpegOfflineMediaAdapter(new Fake()).extract(asset(), [4]),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
  it('rejects oversized and malformed probe output', async () => {
    for (const bytes of [Buffer.from('{'), Buffer.alloc(MEDIA_FRAME_LIMITS.probeBytes + 1)])
      await expect(
        new FfmpegOfflineMediaAdapter({ run: async () => bytes }).extract(asset()),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
  it('snapshots caller bytes and source identity before asynchronous decoding', async () => {
    const source = { ...asset(), bytes: Buffer.from(raw) };
    const runner = new Fake();
    const originalRun = runner.run.bind(runner);
    runner.run = async (command) => {
      source.bytes.fill(0);
      source.sourceVersionId = 'modified';
      return originalRun(command);
    };
    const result = await new FfmpegOfflineMediaAdapter(runner).extract(source, [0]);
    expect(result.source.sourceVersionId).toBe('v1');
    expect(runner.calls[0]!.input).toEqual(raw);
  });
  it('rejects arbitrary CLI flags/filters/network URLs before filesystem access', async () => {
    const runner = new Fake();
    await new FfmpegOfflineMediaAdapter(runner).extract(asset(), [0]);
    const pinned = new PinnedFfmpegOfflineRunner('not-a-runtime');
    for (const args of [
      [...runner.calls[0]!.args, '-show_data'],
      runner.calls[0]!.args.map((part) =>
        part === 'pipe:0' ? 'https://example.com/video.mp4' : part,
      ),
      runner.calls[2]!.args.map((part) =>
        part === 'select=eq(n\\,0)' ? 'movie=https://example.com' : part,
      ),
    ])
      await expect(pinned.run({ ...runner.calls[0]!, args })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
  });
  it('classifies missing owned runtime without exposing filesystem paths', async () => {
    const runner = new Fake();
    await new FfmpegOfflineMediaAdapter(runner).extract(asset());
    await expect(
      new PinnedFfmpegOfflineRunner(
        path.join(os.tmpdir(), `shotgun-no-runtime-offline-prototype-${randomUUID()}`),
      ).run(runner.calls[0]!),
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_REQUIRED',
      safeMessage: 'Pinned offline media runtime unavailable',
      retryable: false,
    });
  });
});
