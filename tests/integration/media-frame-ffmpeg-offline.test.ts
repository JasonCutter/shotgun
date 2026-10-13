import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  FfmpegOfflineMediaAdapter,
  PinnedFfmpegOfflineRunner,
  mediaBytesHash,
  type OfflineMediaAsset,
  type OfflineMediaCommand,
} from '../../adapters/media-frame-ffmpeg-offline/src/index.js';

// Optional owned developer runtime. Never searches PATH, downloads or installs a binary.
const runtime =
  'C:/dev/artifacts/vp-full-completion-2026-10-12/media-frame-runtime/ffmpeg-9.0.2-essentials_build/bin';
const suite =
  existsSync(runtime + '/ffmpeg.exe') && existsSync(runtime + '/ffprobe.exe')
    ? describe
    : describe.skip;
const proofDirectory = runtime + '/../proof';
const source = (
  bytes: Uint8Array,
  mediaType: OfflineMediaAsset['mediaType'],
): OfflineMediaAsset => ({
  projectId: 'synthetic-project',
  sourceId: 'synthetic-source',
  sourceVersionId: 'synthetic-v1',
  originalAssetId: 'synthetic-original',
  mediaType,
  bytes,
  byteLength: bytes.length,
  sourceContentHash: mediaBytesHash(bytes),
});
const generateFixture = async (args: readonly string[]): Promise<Buffer> => {
  const binary = runtime + '/ffmpeg.exe';
  expect(mediaBytesHash(await readFile(binary))).toBe(
    'sha256:3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec',
  );
  const result = await promisify(execFile)(binary, [...args], {
    cwd: runtime,
    encoding: 'buffer',
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
    env: { SystemRoot: process.env['SystemRoot'] },
  });
  return result.stdout;
};
suite('exact pinned owned offline FFmpeg synthetic proof', () => {
  const runner = new PinnedFfmpegOfflineRunner(runtime);
  it('decodes synthetic variable-rate MP4 and hashes exact generated PNGs', async () => {
    const bytes = await generateFixture([
      '-v',
      'error',
      '-nostdin',
      '-threads',
      '1',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=64x48:rate=4:duration=1',
      '-vf',
      'settb=1/1000,setpts=N*N*100',
      '-fps_mode',
      'passthrough',
      '-enc_time_base',
      '1/1000',
      '-c:v',
      'mpeg4',
      '-bf',
      '0',
      '-threads',
      '1',
      '-video_track_timescale',
      '1000',
      '-movflags',
      'frag_keyframe+empty_moov',
      '-f',
      'mp4',
      'pipe:1',
    ]);
    const adapter = new FfmpegOfflineMediaAdapter(runner);
    const result = await adapter.extract(source(bytes, 'video/mp4'), [0, 1, 3]);
    expect(result.source.frameCount).toBe(4);
    expect(result.frames.map((frame) => frame.timestampMs)).toEqual([0, 100, 900]);
    expect(result.frames.map((frame) => frame.presentationTimestamp)).toEqual(['0', '100', '900']);
    expect(result.source.durationMs).toBeGreaterThan(900);
    expect(result.frames.every((frame) => frame.widthPx === 64 && frame.heightPx === 48)).toBe(
      true,
    );
    expect(
      result.frames.every((frame) => frame.frameContentHash === mediaBytesHash(frame.bytes)),
    ).toBe(true);
    const repeated = await adapter.extract(source(bytes, 'video/mp4'), [0, 1, 3]);
    expect(repeated).toEqual(result);
    expect(result.coverage).toMatchObject({
      unsampledFrameCount: 1,
      fullMediaMeaningVerified: false,
    });
    await mkdir(proofDirectory, { recursive: true });
    await writeFile(proofDirectory + '/synthetic-vfr.mp4', bytes);
    for (const frame of result.frames)
      await writeFile(proofDirectory + `/frame-${frame.frameIndex}.png`, frame.bytes);
    await writeFile(
      proofDirectory + '/synthetic-vfr-manifest.json',
      JSON.stringify(
        {
          ...result,
          frames: result.frames.map(({ bytes: frameBytes, ...frame }) => ({
            ...frame,
            byteLength: frameBytes.length,
            artifact: `frame-${frame.frameIndex}.png`,
          })),
        },
        null,
        2,
      ),
    );
  }, 60_000);
  it('decodes a synthetic WAV duration without asserting transcription', async () => {
    const bytes = await generateFixture([
      '-v',
      'error',
      '-nostdin',
      '-threads',
      '1',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1.25',
      '-c:a',
      'pcm_s16le',
      '-f',
      'wav',
      'pipe:1',
    ]);
    const result = await new FfmpegOfflineMediaAdapter(runner).extract(source(bytes, 'audio/wav'));
    expect(result.source.durationMs).toBe(1250);
    expect(result.source.frameCount).toBeUndefined();
    expect(result.frames).toEqual([]);
    expect(result.coverage.audioTranscribed).toBe(false);
    await mkdir(proofDirectory, { recursive: true });
    await writeFile(proofDirectory + '/synthetic.wav', bytes);
    await writeFile(
      proofDirectory + '/synthetic-wav-manifest.json',
      JSON.stringify(result, null, 2),
    );
  }, 30_000);
  it('rejects corrupt self-contained media through the real decoder', async () => {
    const bytes = Buffer.concat([
      Buffer.from([0, 0, 0, 16]),
      Buffer.from('ftypisom'),
      Buffer.alloc(8),
    ]);
    await expect(
      new FfmpegOfflineMediaAdapter(runner).extract(source(bytes, 'video/mp4')),
    ).rejects.toMatchObject({ code: 'FORMAT_CORRUPT', retryable: false });
  }, 30_000);
  it('enforces stdout budget against the actual pinned process', async () => {
    const bytes = await generateFixture([
      '-v',
      'error',
      '-nostdin',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=0.1',
      '-c:a',
      'pcm_s16le',
      '-f',
      'wav',
      'pipe:1',
    ]);
    const commands: OfflineMediaCommand[] = [];
    await new FfmpegOfflineMediaAdapter({
      run: async (command) => {
        commands.push(command);
        return runner.run(command);
      },
    }).extract(source(bytes, 'audio/wav'));
    await expect(runner.run({ ...commands[0]!, maxOutputBytes: 1 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      safeMessage: 'Offline media stdout exceeds budget',
      retryable: false,
    });
  }, 30_000);
});
