import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import type {
  MediaFrameManifestEntryV1,
  MediaSourceBindingV1,
} from '../../../packages/contracts/src/media-alignment.js';
import pin from '../runtime.lock.json';

export const MEDIA_FRAME_LIMITS = Object.freeze({
  inputBytes: 10 * 1024 * 1024,
  durationMs: 120_000,
  decodedFrames: 4096,
  sampledFrames: 16,
  pixels: 4_194_304,
  dimension: 4096,
  probeBytes: 1024 * 1024,
  frameBytes: 8 * 1024 * 1024,
  aggregateFrameBytes: 32 * 1024 * 1024,
  stderrBytes: 64 * 1024,
  timeoutMs: 15_000,
});

type Tool = 'ffprobe' | 'ffmpeg';
export type OfflineMediaCommand = {
  readonly tool: Tool;
  readonly args: readonly string[];
  readonly input: Uint8Array;
  readonly maxOutputBytes: number;
};
/** Replaceable CLI transport. Implementations must enforce the same process limits. */
export interface OfflineMediaRunner {
  run(command: OfflineMediaCommand): Promise<Buffer>;
}
export type OfflineMediaAsset = Omit<MediaSourceBindingV1, 'durationMs' | 'frameCount'> & {
  readonly originalAssetId: string;
  readonly byteLength: number;
  readonly bytes: Uint8Array;
};
export type OfflineFrame = MediaFrameManifestEntryV1 & {
  readonly presentationTimestamp: string;
  readonly timeBase: string;
  readonly bytes: Uint8Array;
};
export type OfflineMediaManifest = {
  readonly schemaVersion: 'offline-media-manifest/1.0.0';
  readonly source: MediaSourceBindingV1;
  readonly originalAssetId: string;
  readonly originalByteLength: number;
  readonly generator: {
    readonly id: 'ffmpeg-offline';
    readonly version: '9.0.2';
    readonly commit: string;
  };
  readonly derivation: 'generated-frames-and-metadata';
  readonly semanticStatus: 'UNVERIFIED';
  readonly coverage: {
    readonly kind: 'SAMPLED' | 'METADATA_ONLY';
    readonly sampledFrameIndices: readonly number[];
    readonly unsampledFrameCount: number;
    readonly audioTranscribed: false;
    readonly fullMediaMeaningVerified: false;
  };
  readonly video?: {
    readonly widthPx: number;
    readonly heightPx: number;
    readonly timeBase: string;
  };
  readonly frames: readonly OfflineFrame[];
};

function reject(message: string): never {
  throw new ShotgunError({
    code: 'VALIDATION_ERROR',
    safeMessage: message,
    module: 'media-frame-ffmpeg-offline',
    operation: 'offline-extract',
    retryable: false,
  });
}
export const mediaBytesHash = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const integer = (value: unknown, minimum: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum)
    reject('Media integer outside allowed bounds');
  return value as number;
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject('Invalid probe object');
  return value as Record<string, unknown>;
};
const seconds = (value: unknown): number => {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,9})?$/u.test(value))
    reject('Invalid media time');
  const result = Number(value);
  if (!Number.isFinite(result) || result > MEDIA_FRAME_LIMITS.durationMs / 1000)
    reject('Media time exceeds budget');
  return result;
};
const json = (bytes: Buffer): Record<string, unknown> => {
  if (bytes.length > MEDIA_FRAME_LIMITS.probeBytes) reject('Probe output exceeds budget');
  try {
    return object(JSON.parse(bytes.toString('utf8')));
  } catch {
    return reject('Malformed probe JSON');
  }
};
const container = (asset: OfflineMediaAsset, bytes: Buffer): string => {
  switch (asset.mediaType) {
    case 'audio/wav':
      if (bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WAVE')
        reject('WAV signature mismatch');
      return 'wav';
    case 'audio/mpeg':
      if (
        bytes.subarray(0, 3).toString() !== 'ID3' &&
        !(bytes[0] === 255 && ((bytes[1] ?? 0) & 224) === 224)
      )
        reject('MP3 signature mismatch');
      return 'mp3';
    case 'video/mp4':
      if (bytes.subarray(4, 8).toString() !== 'ftyp') reject('MP4 signature mismatch');
      return 'mov';
    case 'video/webm':
      if (bytes.subarray(0, 4).toString('hex') !== '1a45dfa3') reject('WebM signature mismatch');
      return 'matroska';
    default:
      return reject('Unsupported MIME type');
  }
};
const inputArgs = (format: string): string[] => [
  '-protocol_whitelist',
  'pipe',
  '-format_whitelist',
  format,
  '-f',
  format,
  ...(format === 'mov' ? ['-enable_drefs', '0', '-use_absolute_path', '0'] : []),
  '-probesize',
  '1048576',
  '-analyzeduration',
  '2000000',
  '-max_alloc',
  '16777216',
  '-threads',
  '1',
  '-i',
  'pipe:0',
];
const metadataArgs = (format: string): string[] => [
  '-v',
  'error',
  ...inputArgs(format),
  '-show_entries',
  'format=duration:stream=index,codec_type,width,height,time_base,duration,start_time,sample_rate',
  '-of',
  'json',
];
const frameProbeArgs = (format: string, video: boolean): string[] => [
  '-v',
  'error',
  ...inputArgs(format),
  '-select_streams',
  video ? 'v:0' : 'a:0',
  '-show_frames',
  '-show_entries',
  video ? 'frame=pts,pts_time,width,height' : 'frame=nb_samples,pts_time',
  '-of',
  'json',
];
const extractionArgs = (format: string, index: number): string[] => [
  '-v',
  'error',
  '-nostdin',
  '-noautorotate',
  ...inputArgs(format),
  '-map',
  '0:v:0',
  '-an',
  '-sn',
  '-dn',
  '-vf',
  `select=eq(n\\,${index})`,
  '-frames:v',
  '1',
  '-fps_mode',
  'passthrough',
  '-threads',
  '1',
  '-f',
  'image2pipe',
  '-vcodec',
  'png',
  'pipe:1',
];
const validateCommand = (command: OfflineMediaCommand): void => {
  const format = command.args[command.args.indexOf('-format_whitelist') + 1];
  if (!format || !['wav', 'mp3', 'mov', 'matroska'].includes(format))
    reject('CLI demuxer not allowed');
  const patterns: string[][] =
    command.tool === 'ffprobe'
      ? [metadataArgs(format), frameProbeArgs(format, true), frameProbeArgs(format, false)]
      : [];
  if (command.tool === 'ffmpeg') {
    const selector = command.args[command.args.indexOf('-vf') + 1];
    const match = selector?.match(/^select=eq\(n\\,(\d{1,4})\)$/u);
    if (!match) reject('CLI frame selector not allowed');
    const index = integer(Number(match[1]), 0, MEDIA_FRAME_LIMITS.decodedFrames - 1);
    patterns.push(extractionArgs(format, index));
  }
  if (
    !patterns.some(
      (pattern) =>
        pattern.length === command.args.length &&
        pattern.every((argument, index) => argument === command.args[index]),
    )
  )
    reject('CLI arguments not allowed');
};
const pngSize = (bytes: Buffer): readonly [number, number] => {
  if (
    bytes.length < 33 ||
    bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.subarray(12, 16).toString() !== 'IHDR'
  )
    reject('Invalid generated PNG header');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};

/** Inactive, offline structural producer. No SourceMap, EvidenceSpan or Fact writes. */
export class FfmpegOfflineMediaAdapter {
  constructor(private readonly runner: OfflineMediaRunner) {}

  async extract(
    asset: OfflineMediaAsset,
    frameIndices: readonly number[] = [],
  ): Promise<OfflineMediaManifest> {
    asset = { ...asset };
    for (const identity of [
      asset.projectId,
      asset.sourceId,
      asset.sourceVersionId,
      asset.originalAssetId,
    ])
      if (typeof identity !== 'string' || !identity.trim() || identity.length > 256)
        reject('Invalid asset identity');
    integer(asset.byteLength, 12, MEDIA_FRAME_LIMITS.inputBytes);
    if (!(asset.bytes instanceof Uint8Array) || asset.bytes.byteLength !== asset.byteLength)
      reject('Asset byte length mismatch');
    const bytes = Buffer.from(asset.bytes); // Immutable snapshot before the first asynchronous operation.
    if (asset.sourceContentHash !== mediaBytesHash(bytes)) reject('Original asset hash mismatch');
    if (!Array.isArray(frameIndices) || frameIndices.length > MEDIA_FRAME_LIMITS.sampledFrames)
      reject('Frame sampling exceeds budget');
    const indices = [...frameIndices];
    for (let i = 0; i < indices.length; i++) {
      integer(indices[i], 0, MEDIA_FRAME_LIMITS.decodedFrames - 1);
      if (i && indices[i]! <= indices[i - 1]!)
        reject('Sampling indices must be unique and increasing');
    }
    const format = container(asset, bytes);
    const run = (tool: Tool, args: readonly string[], maxOutputBytes: number) =>
      this.runner.run({ tool, args, input: bytes, maxOutputBytes });
    const metadata = json(
      await run('ffprobe', metadataArgs(format), MEDIA_FRAME_LIMITS.probeBytes),
    );
    if (
      !Array.isArray(metadata['streams']) ||
      metadata['streams'].length === 0 ||
      metadata['streams'].length > 8
    )
      reject('Invalid stream cardinality');
    const streams = metadata['streams'].map(object);
    const videos = streams.filter((stream) => stream['codec_type'] === 'video');
    const audio = streams.filter((stream) => stream['codec_type'] === 'audio');
    const video = asset.mediaType.startsWith('video/');
    if (
      videos.length !== (video ? 1 : 0) ||
      (!video && audio.length !== 1) ||
      streams.some((stream) => !['video', 'audio'].includes(String(stream['codec_type'])))
    )
      reject('MIME/stream mismatch or unsupported stream layout');
    const declaredDuration = object(metadata['format'])['duration'];
    let durationMs: number;
    if (!video && declaredDuration === undefined) {
      const sampleRate = audio[0]!['sample_rate'];
      if (typeof sampleRate !== 'string' || !/^\d{4,6}$/u.test(sampleRate))
        reject('Invalid audio sample rate');
      const rate = integer(Number(sampleRate), 8000, 192000);
      const decoded = json(
        await run('ffprobe', frameProbeArgs(format, false), MEDIA_FRAME_LIMITS.probeBytes),
      )['frames'];
      if (
        !Array.isArray(decoded) ||
        !decoded.length ||
        decoded.length > MEDIA_FRAME_LIMITS.decodedFrames
      )
        reject('Decoded audio frame count exceeds budget');
      let samples = 0;
      for (const raw of decoded) {
        const frame = object(raw);
        if (Math.abs(seconds(frame['pts_time']) - samples / rate) > 1 / rate)
          reject('Audio sample timing is discontinuous');
        samples += integer(frame['nb_samples'], 1, 65536);
        if (samples / rate > MEDIA_FRAME_LIMITS.durationMs / 1000)
          reject('Audio duration exceeds budget');
      }
      durationMs = integer(Math.ceil((samples * 1000) / rate), 1, MEDIA_FRAME_LIMITS.durationMs);
    } else {
      durationMs = integer(
        Math.ceil(seconds(declaredDuration) * 1000),
        1,
        MEDIA_FRAME_LIMITS.durationMs,
      );
    }
    const frames: OfflineFrame[] = [];
    let frameCount = 0;
    let videoShape: OfflineMediaManifest['video'];
    if (video) {
      const stream = videos[0]!;
      const widthPx = integer(stream['width'], 1, MEDIA_FRAME_LIMITS.dimension);
      const heightPx = integer(stream['height'], 1, MEDIA_FRAME_LIMITS.dimension);
      if (widthPx * heightPx > MEDIA_FRAME_LIMITS.pixels) reject('Video dimensions exceed budget');
      const timeBase = stream['time_base'];
      if (typeof timeBase !== 'string' || !/^1\/[1-9]\d{0,8}$/u.test(timeBase))
        reject('Unsupported time base');
      if (stream['start_time'] !== undefined && seconds(stream['start_time']) !== 0)
        reject('Nonzero start time requires an explicit normalization contract');
      videoShape = { widthPx, heightPx, timeBase };
      const decoded = json(
        await run('ffprobe', frameProbeArgs(format, true), MEDIA_FRAME_LIMITS.probeBytes),
      )['frames'];
      if (
        !Array.isArray(decoded) ||
        !decoded.length ||
        decoded.length > MEDIA_FRAME_LIMITS.decodedFrames
      )
        reject('Decoded frame count exceeds budget');
      frameCount = decoded.length;
      const timing = decoded.map((raw) => {
        const frame = object(raw);
        const pts = integer(frame['pts'], 0, Number.MAX_SAFE_INTEGER);
        const timestampSeconds = seconds(frame['pts_time']);
        if (Math.abs(pts / Number(timeBase.slice(2)) - timestampSeconds) > 0.0000011)
          reject('PTS and time base disagree');
        const timestampMs = Math.round(timestampSeconds * 1000);
        if (timestampMs >= durationMs || frame['width'] !== widthPx || frame['height'] !== heightPx)
          reject('Frame timing/dimensions disagree with original stream');
        return { pts, timestampMs };
      });
      for (let i = 1; i < timing.length; i++)
        if (
          timing[i]!.pts <= timing[i - 1]!.pts ||
          timing[i]!.timestampMs <= timing[i - 1]!.timestampMs
        )
          reject('Non-increasing or sub-millisecond frame timing unsupported');
      let totalBytes = 0;
      for (const frameIndex of indices) {
        const time = timing[frameIndex];
        if (!time) reject('Sample index outside decoded frame count');
        const png = await run(
          'ffmpeg',
          extractionArgs(format, frameIndex),
          MEDIA_FRAME_LIMITS.frameBytes,
        );
        totalBytes += png.length;
        if (
          png.length > MEDIA_FRAME_LIMITS.frameBytes ||
          totalBytes > MEDIA_FRAME_LIMITS.aggregateFrameBytes
        )
          reject('Generated frame bytes exceed budget');
        const [width, height] = pngSize(png);
        if (width !== widthPx || height !== heightPx) reject('Generated PNG dimensions mismatch');
        frames.push(
          Object.freeze({
            frameIndex,
            timestampMs: time!.timestampMs,
            presentationTimestamp: String(time!.pts),
            timeBase,
            frameContentHash: mediaBytesHash(png),
            widthPx,
            heightPx,
            bytes: new Uint8Array(png),
          }),
        );
      }
    } else if (indices.length) reject('Audio cannot declare sampled video frames');
    return Object.freeze({
      schemaVersion: 'offline-media-manifest/1.0.0',
      source: Object.freeze({
        projectId: asset.projectId,
        sourceId: asset.sourceId,
        sourceVersionId: asset.sourceVersionId,
        sourceContentHash: asset.sourceContentHash,
        mediaType: asset.mediaType,
        durationMs,
        ...(video ? { frameCount } : {}),
      }),
      originalAssetId: asset.originalAssetId,
      originalByteLength: asset.byteLength,
      generator: Object.freeze({ id: 'ffmpeg-offline', version: '9.0.2', commit: pin.commit }),
      derivation: 'generated-frames-and-metadata',
      semanticStatus: 'UNVERIFIED',
      coverage: Object.freeze({
        kind: frames.length ? 'SAMPLED' : 'METADATA_ONLY',
        sampledFrameIndices: Object.freeze(indices),
        unsampledFrameCount: frameCount - frames.length,
        audioTranscribed: false,
        fullMediaMeaningVerified: false,
      }),
      ...(videoShape ? { video: Object.freeze(videoShape) } : {}),
      frames: Object.freeze(frames),
    });
  }
}

/** Owned-directory exact-binary CLI runner; media input/output is pipe-only. */
export class PinnedFfmpegOfflineRunner implements OfflineMediaRunner {
  constructor(private readonly ownedRuntimeDirectory: string) {}
  async run(command: OfflineMediaCommand): Promise<Buffer> {
    if (
      !Array.isArray(command.args) ||
      command.args.length > 64 ||
      command.args.some((argument) => typeof argument !== 'string' || argument.length > 256) ||
      !(command.input instanceof Uint8Array) ||
      command.input.length > MEDIA_FRAME_LIMITS.inputBytes
    )
      reject('Invalid or unbounded CLI request');
    command = { ...command, args: [...command.args], input: Buffer.from(command.input) };
    validateCommand(command);
    const root = this.ownedRuntimeDirectory;
    if (!isAbsolute(root) || root.startsWith('\\\\') || root.startsWith('//'))
      reject('Local owned runtime required');
    const executable = join(root, `${command.tool}.exe`);
    let canonical: string;
    try {
      canonical = await realpath(root);
      if ((await lstat(root)).isSymbolicLink()) reject('Runtime symlink prohibited');
      const canonicalExe = await realpath(executable);
      const executableStat = await lstat(executable);
      if (
        relative(canonical, canonicalExe).startsWith('..') ||
        executableStat.isSymbolicLink() ||
        !executableStat.isFile() ||
        executableStat.size > 256 * 1024 * 1024
      )
        reject('Runtime executable escapes owned directory');
      const digest = mediaBytesHash(await readFile(executable));
      if (digest !== `sha256:${command.tool === 'ffmpeg' ? pin.ffmpegSha256 : pin.ffprobeSha256}`)
        reject('Runtime executable digest mismatch');
    } catch (error) {
      if (error instanceof ShotgunError) throw error;
      throw new ShotgunError({
        code: 'CONFIGURATION_REQUIRED',
        safeMessage: 'Pinned offline media runtime unavailable',
        module: 'media-frame-ffmpeg-offline',
        operation: 'offline-cli',
        retryable: false,
      });
    }
    integer(command.maxOutputBytes, 1, MEDIA_FRAME_LIMITS.frameBytes);
    if (command.input.length > MEDIA_FRAME_LIMITS.inputBytes) reject('CLI input exceeds budget');
    const env: NodeJS.ProcessEnv = {};
    for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'])
      if (process.env[key]) env[key] = process.env[key];
    return new Promise((resolve, rejectPromise) => {
      const child = spawn(executable, [...command.args], {
        cwd: canonical,
        env,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const output: Buffer[] = [];
      let outputBytes = 0;
      let stderrBytes = 0;
      let failure: ShotgunError | undefined;
      const stop = (message: string) => {
        failure ??= new ShotgunError({
          code: 'VALIDATION_ERROR',
          safeMessage: message,
          module: 'media-frame-ffmpeg-offline',
          operation: 'offline-cli',
          retryable: false,
        });
        child.kill();
      };
      const timer = setTimeout(
        () => stop('Offline media process timed out'),
        MEDIA_FRAME_LIMITS.timeoutMs,
      );
      child.stdout.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > command.maxOutputBytes) stop('Offline media stdout exceeds budget');
        else output.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > MEDIA_FRAME_LIMITS.stderrBytes)
          stop('Offline media stderr exceeds budget');
      });
      child.stdin.on('error', () => stop('Offline media stdin failed'));
      child.on('error', () => stop('Offline media process failed to start'));
      child.on('close', (code) => {
        clearTimeout(timer);
        if (failure || code !== 0)
          rejectPromise(
            failure ??
              new ShotgunError({
                code: 'FORMAT_CORRUPT',
                safeMessage: 'Offline media decode failed',
                module: 'media-frame-ffmpeg-offline',
                operation: 'offline-cli',
                retryable: false,
              }),
          );
        else resolve(Buffer.concat(output));
      });
      child.stdin.end(command.input);
    });
  }
}
