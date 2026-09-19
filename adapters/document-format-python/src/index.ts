import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  type SourceSelector,
  sha256Text,
  stableJson,
  ShotgunError,
} from '../../../packages/contracts/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../plain-text-lucas-augmented/src/index.js';
import type {
  DocumentTransformationInput,
  PlainTextTransformationOutput,
  PlainTextTransformerPort,
} from '../../../modules/transformation/src/index.js';

type WorkerBlock = {
  readonly text: string;
  readonly selectors: readonly SourceSelector[];
  readonly segments?: readonly WorkerSegment[];
};

type WorkerSegment = {
  readonly start: number;
  readonly end: number;
  readonly selectors: readonly SourceSelector[];
};

type WorkerResult =
  | { readonly status: 'OK'; readonly blocks: readonly WorkerBlock[] }
  | {
      readonly status: 'IMAGE_PREFLIGHT';
      readonly format: 'PNG' | 'JPEG';
      readonly width: number;
      readonly height: number;
      readonly pixels: number;
      readonly contentHash: string;
    }
  | {
      readonly status:
        | 'FORMAT_CORRUPT'
        | 'FORMAT_ENCRYPTED'
        | 'FORMAT_UNSUPPORTED'
        | 'MULTIMODAL_VALIDATION_REQUIRED'
        | 'VALIDATION_ERROR'
        | 'TERMINAL_FAILURE'
        | 'TIMEOUT';
      readonly message: string;
    };

type WorkerFailureStatus = Exclude<WorkerResult['status'], 'OK' | 'IMAGE_PREFLIGHT'>;

export type WorkerProcessTerminator = (child: ChildProcessWithoutNullStreams) => Promise<void>;

export type WorkerRunnerOptions = {
  readonly spawn?: typeof spawn;
  readonly terminateProcessTree?: WorkerProcessTerminator;
  readonly timeoutMs?: number;
  readonly maxStdoutBytes?: number;
  readonly maxStderrBytes?: number;
  readonly signal?: AbortSignal;
};

export const WORKER_DEADLINE_MS = 30_000;
export const CLEANUP_GRACE_MS = 250;
export const CLEANUP_DEADLINE_MS = 2_000;

const execFileAsync = promisify(execFile);

const defaultTerminateProcessTree: WorkerProcessTerminator = async (child) => {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === 'win32') {
    await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
};

const terminateDirectChild = (child: ChildProcessWithoutNullStreams): void => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill('SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSafePositiveInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1;

const isWorkerSourceSelector = (value: unknown): value is SourceSelector => {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'PageSelector':
      return isSafePositiveInteger(value.page);
    case 'BoundingBoxSelector':
      return (
        (value.page === undefined || isSafePositiveInteger(value.page)) &&
        typeof value.x === 'number' &&
        Number.isFinite(value.x) &&
        typeof value.y === 'number' &&
        Number.isFinite(value.y) &&
        typeof value.width === 'number' &&
        Number.isFinite(value.width) &&
        typeof value.height === 'number' &&
        Number.isFinite(value.height) &&
        (value.unit === 'pt' || value.unit === 'px')
      );
    case 'CellSelector':
      return (
        typeof value.sheet === 'string' &&
        typeof value.cell === 'string' &&
        isSafePositiveInteger(value.row) &&
        isSafePositiveInteger(value.column)
      );
    case 'ShapeSelector':
      return isSafePositiveInteger(value.slide) && typeof value.shapeId === 'string';
    case 'CssSelector':
      return typeof value.value === 'string';
    default:
      return false;
  }
};

const validateWorkerResult = (value: unknown): WorkerResult => {
  if (!isRecord(value) || typeof value.status !== 'string') {
    throw new Error('worker result is not a discriminated object');
  }
  if (value.status === 'IMAGE_PREFLIGHT') {
    if (
      (value.format !== 'PNG' && value.format !== 'JPEG') ||
      !Number.isSafeInteger(value.width) ||
      !Number.isSafeInteger(value.height) ||
      !Number.isSafeInteger(value.pixels) ||
      typeof value.contentHash !== 'string'
    ) {
      throw new Error('worker image preflight result has an invalid shape');
    }
    return value as WorkerResult;
  }
  if (value.status === 'OK') {
    if (!Array.isArray(value.blocks)) throw new Error('worker blocks are not an array');
    let totalSelectorCount = 0;
    const blocks = value.blocks.map((candidate) => {
      if (!isRecord(candidate) || typeof candidate.text !== 'string' || !candidate.text) {
        throw new Error('worker block has an invalid text');
      }
      const selectors = candidate.selectors;
      if (!Array.isArray(selectors)) throw new Error('worker selectors are not an array');
      if (selectors.length > 256) throw new Error('worker block selector budget exceeded');
      selectors.forEach((selector) => {
        if (!isWorkerSourceSelector(selector))
          throw new Error('worker selector has an invalid shape');
      });
      totalSelectorCount += selectors.length;
      let segments: readonly WorkerSegment[] | undefined;
      if (candidate.segments !== undefined) {
        if (!Array.isArray(candidate.segments)) throw new Error('worker segments are not an array');
        if (candidate.segments.length > 128) throw new Error('worker segment budget exceeded');
        const textLength = [...candidate.text].length;
        segments = candidate.segments.map((segment) => {
          if (
            !isRecord(segment) ||
            !Number.isSafeInteger(segment.start) ||
            !Number.isSafeInteger(segment.end) ||
            (segment.start as number) < 0 ||
            (segment.end as number) <= (segment.start as number) ||
            (segment.end as number) > textLength ||
            !Array.isArray(segment.selectors) ||
            segment.selectors.length > 4
          ) {
            throw new Error('worker segment has an invalid shape');
          }
          segment.selectors.forEach((selector) => {
            if (!isWorkerSourceSelector(selector)) {
              throw new Error('worker segment selector has an invalid shape');
            }
          });
          totalSelectorCount += segment.selectors.length;
          return segment as unknown as WorkerSegment;
        });
      }
      return { text: candidate.text, selectors, ...(segments ? { segments } : {}) };
    });
    if (totalSelectorCount > 16_384) throw new Error('worker selector budget exceeded');
    return { status: 'OK', blocks };
  }
  const errorStatuses: readonly WorkerFailureStatus[] = [
    'FORMAT_CORRUPT',
    'FORMAT_ENCRYPTED',
    'FORMAT_UNSUPPORTED',
    'MULTIMODAL_VALIDATION_REQUIRED',
    'VALIDATION_ERROR',
    'TERMINAL_FAILURE',
    'TIMEOUT',
  ];
  if (
    !errorStatuses.includes(value.status as WorkerFailureStatus) ||
    typeof value.message !== 'string'
  ) {
    throw new Error('worker error result has an invalid shape');
  }
  return value as WorkerResult;
};

export type MultimodalValidationPort = {
  describe(input: {
    readonly mediaType: 'image/png' | 'image/jpeg';
    readonly contentBase64: string;
  }): Promise<string>;
};

const runWorker = (
  pythonExecutable: string,
  workerPath: string,
  request: object,
  options: WorkerRunnerOptions = {},
): Promise<WorkerResult> =>
  new Promise((resolve, reject) => {
    const spawnWorker = options.spawn ?? spawn;
    const child = spawnWorker(pythonExecutable, [workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    const maxStdoutBytes = options.maxStdoutBytes ?? 8 * 1024 * 1024;
    const maxStderrBytes = options.maxStderrBytes ?? 1 * 1024 * 1024;
    const timeoutMs = options.timeoutMs ?? WORKER_DEADLINE_MS;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let closeSeen = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let terminalFailure: ShotgunError | undefined;
    let cleanupPromise: Promise<void> | undefined;
    let cleanupStarted = false;

    const waitForClose = (timeoutMs: number): Promise<boolean> =>
      new Promise((resolve) => {
        if (closeSeen || child.exitCode !== null || child.signalCode !== null) {
          resolve(true);
          return;
        }
        const waitTimer = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
        child.once('close', () => {
          clearTimeout(waitTimer);
          resolve(true);
        });
      });

    const withDeadline = async <T>(task: Promise<T>, deadline: number): Promise<T> => {
      const remaining = Math.max(0, deadline - Date.now());
      return await Promise.race([
        task,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error('worker cleanup deadline exceeded')), remaining),
        ),
      ]);
    };

    const settle = (error?: unknown, value?: WorkerResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abortHandler);
      if (error) reject(error);
      else resolve(value!);
    };

    const beginCleanup = (error: ShotgunError) => {
      if (cleanupStarted || closeSeen) return;
      cleanupStarted = true;
      terminalFailure = error;
      const cleanupDeadline = Date.now() + CLEANUP_DEADLINE_MS;
      cleanupPromise = (async () => {
        let cleanupError: unknown;
        try {
          await withDeadline(
            (options.terminateProcessTree ?? defaultTerminateProcessTree)(child),
            cleanupDeadline,
          );
          await waitForClose(Math.min(CLEANUP_GRACE_MS, Math.max(0, cleanupDeadline - Date.now())));
        } catch (error) {
          cleanupError = error;
        }
        if (!closeSeen) {
          try {
            terminateDirectChild(child);
            await waitForClose(Math.max(0, cleanupDeadline - Date.now()));
          } catch (error) {
            cleanupError ??= error;
          }
        }
        if (!closeSeen) {
          cleanupError ??= new Error('worker did not exit before cleanup deadline');
        }
        if (cleanupError) {
          terminalFailure = new ShotgunError({
            code: 'TERMINAL_FAILURE',
            safeMessage: 'The format worker process tree could not be cleaned up.',
            module: 'stage8.document-format-python',
            operation: 'cleanup-format-worker',
            retryable: false,
            cause: cleanupError,
          });
        }
      })().finally(() => {
        if (!closeSeen) settle(terminalFailure);
      });
    };

    const timer = setTimeout(() => {
      beginCleanup(
        new ShotgunError({
          code: 'TIMEOUT',
          safeMessage: 'The format worker exceeded its execution budget.',
          module: 'stage8.document-format-python',
          operation: 'run-format-worker',
          retryable: false,
        }),
      );
    }, timeoutMs);
    const abortHandler = () =>
      beginCleanup(
        new ShotgunError({
          code: 'TIMEOUT',
          safeMessage: 'The format worker was cancelled.',
          module: 'stage8.document-format-python',
          operation: 'cancel-format-worker',
          retryable: false,
        }),
      );
    if (options.signal) {
      if (options.signal.aborted) abortHandler();
      else options.signal.addEventListener('abort', abortHandler, { once: true });
    }
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > maxStdoutBytes) {
        beginCleanup(
          new ShotgunError({
            code: 'VALIDATION_ERROR',
            safeMessage: 'The format worker exceeded its stdout budget.',
            module: 'stage8.document-format-python',
            operation: 'read-worker-output',
            retryable: false,
          }),
        );
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > maxStderrBytes) {
        beginCleanup(
          new ShotgunError({
            code: 'VALIDATION_ERROR',
            safeMessage: 'The format worker exceeded its stderr budget.',
            module: 'stage8.document-format-python',
            operation: 'read-worker-error',
            retryable: false,
          }),
        );
        return;
      }
      stderr.push(chunk);
    });
    child.once('error', (error) =>
      settle(
        new ShotgunError({
          code: 'TERMINAL_FAILURE',
          safeMessage: 'The format worker could not start.',
          module: 'stage8.document-format-python',
          operation: 'start-format-worker',
          retryable: false,
          cause: error,
        }),
      ),
    );
    child.once('close', async (code) => {
      closeSeen = true;
      if (cleanupPromise) await cleanupPromise;
      if (settled) return;
      if (terminalFailure) {
        settle(terminalFailure);
        return;
      }
      const stdoutText = Buffer.concat(stdout).toString('utf8');
      const stderrText = Buffer.concat(stderr).toString('utf8');
      if (code !== 0 || !stdoutText) {
        settle(
          new ShotgunError({
            code: 'TERMINAL_FAILURE',
            safeMessage: stderrText || `format worker exited with code ${code ?? 'unknown'}`,
            module: 'stage8.document-format-python',
            operation: 'run-format-worker',
            retryable: false,
          }),
        );
        return;
      }
      try {
        settle(undefined, validateWorkerResult(JSON.parse(stdoutText)));
      } catch (error) {
        settle(
          new ShotgunError({
            code: 'TERMINAL_FAILURE',
            safeMessage: 'The format worker returned invalid JSON.',
            module: 'stage8.document-format-python',
            operation: 'parse-worker-output',
            retryable: false,
            cause: error,
          }),
        );
      }
    });
    child.stdin.once('error', (error) =>
      beginCleanup(
        new ShotgunError({
          code: 'TERMINAL_FAILURE',
          safeMessage: 'The format worker input pipe failed.',
          module: 'stage8.document-format-python',
          operation: 'write-format-worker-request',
          retryable: false,
          cause: error,
        }),
      ),
    );
    child.stdin.end(JSON.stringify(request));
  });

const errorFor = (
  result: Exclude<WorkerResult, { readonly status: 'OK' | 'IMAGE_PREFLIGHT' }>,
): ShotgunError =>
  new ShotgunError({
    code: result.status,
    safeMessage: result.message || result.status,
    module: 'stage8.document-format-python',
    operation: 'extract-document',
  });

export class PythonDocumentFormatAdapter implements PlainTextTransformerPort {
  readonly identity = { id: 'shotgun.document-formats', version: '1.1.0' } as const;
  readonly #plainText = new LucasAugmentedPlainTextAdapter();
  readonly #pythonExecutable: string;
  readonly #workerPath: string;
  readonly #multimodal?: MultimodalValidationPort;
  readonly #workerOptions: WorkerRunnerOptions;

  constructor(
    options: {
      readonly pythonExecutable?: string;
      readonly workerPath?: string;
      readonly multimodal?: MultimodalValidationPort;
      readonly workerOptions?: WorkerRunnerOptions;
    } = {},
  ) {
    this.#pythonExecutable = options.pythonExecutable ?? process.env.PYTHON ?? 'python';
    this.#workerPath =
      options.workerPath ?? path.resolve('adapters/document-format-python/worker.py');
    this.#multimodal = options.multimodal;
    this.#workerOptions = options.workerOptions ?? {};
  }

  async transform(input: DocumentTransformationInput): Promise<PlainTextTransformationOutput> {
    if (['text/plain', 'text/markdown'].includes(input.mediaType)) {
      return this.#plainText.transform(input);
    }
    if (!input.contentBase64) {
      throw new ShotgunError({
        code: 'FORMAT_CORRUPT',
        safeMessage: 'The immutable source bytes are missing.',
        module: 'stage8.document-format-python',
        operation: 'extract-document',
      });
    }
    let rawBytes: Buffer;
    try {
      rawBytes = Buffer.from(input.contentBase64, 'base64');
      if (
        !input.contentBase64 ||
        rawBytes.toString('base64').replace(/=+$/, '') !== input.contentBase64.replace(/=+$/, '')
      ) {
        throw new Error('invalid base64');
      }
    } catch (error) {
      throw new ShotgunError({
        code: 'FORMAT_CORRUPT',
        safeMessage: 'The immutable source bytes are not valid base64.',
        module: 'stage8.document-format-python',
        operation: 'validate-document-bytes',
        retryable: false,
        cause: error,
      });
    }
    if (rawBytes.byteLength > 10 * 1024 * 1024) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'The raw document exceeds the 10 MiB intake limit.',
        module: 'stage8.document-format-python',
        operation: 'validate-document-size',
        retryable: false,
      });
    }
    const isImage = input.mediaType === 'image/png' || input.mediaType === 'image/jpeg';
    if (isImage) {
      const preflight = await runWorker(
        this.#pythonExecutable,
        this.#workerPath,
        {
          operation: 'image-preflight',
          mediaType: input.mediaType,
          contentBase64: input.contentBase64,
          expectedContentHash: input.sourceContentHash,
        },
        this.#workerOptions,
      );
      if (preflight.status !== 'IMAGE_PREFLIGHT') {
        if (preflight.status === 'OK') {
          throw new ShotgunError({
            code: 'TERMINAL_FAILURE',
            safeMessage: 'The image preflight returned an unexpected result.',
            module: 'stage8.document-format-python',
            operation: 'preflight-image',
            retryable: false,
          });
        }
        throw errorFor(preflight as Extract<WorkerResult, { readonly message: string }>);
      }
    }
    const imageDescription =
      isImage && this.#multimodal
        ? await this.#multimodal.describe({
            mediaType: input.mediaType as 'image/png' | 'image/jpeg',
            contentBase64: input.contentBase64,
          })
        : undefined;
    if (imageDescription !== undefined && [...imageDescription].length > 128_000) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'The image description exceeds the 128000 code point budget.',
        module: 'stage8.document-format-python',
        operation: 'validate-image-description',
        retryable: false,
      });
    }
    const result = await runWorker(
      this.#pythonExecutable,
      this.#workerPath,
      {
        operation: 'extract',
        mediaType: input.mediaType,
        contentBase64: input.contentBase64,
        expectedContentHash: input.sourceContentHash,
        ...(imageDescription ? { imageDescription } : {}),
      },
      this.#workerOptions,
    );
    if (result.status !== 'OK') {
      if (result.status === 'IMAGE_PREFLIGHT') {
        throw new ShotgunError({
          code: 'TERMINAL_FAILURE',
          safeMessage: 'The format worker returned image preflight metadata during extraction.',
          module: 'stage8.document-format-python',
          operation: 'extract-document',
          retryable: false,
        });
      }
      throw errorFor(result as Extract<WorkerResult, { readonly message: string }>);
    }
    const normalizedText = result.blocks.map((item) => item.text).join('\n\n');
    if (Buffer.byteLength(normalizedText, 'utf8') > 4 * 1024 * 1024) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'The normalized document exceeds the 4 MiB budget.',
        module: 'stage8.document-format-python',
        operation: 'validate-normalized-document',
        retryable: false,
      });
    }
    const selectorCount = result.blocks.reduce((sum, item) => sum + item.selectors.length, 0);
    if (selectorCount > 16_384) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'The document exceeds the Source selector budget.',
        module: 'stage8.document-format-python',
        operation: 'validate-source-selectors',
        retryable: false,
      });
    }
    const output = this.#plainText.transform({ ...input, text: normalizedText });
    if (output.sourceMap.entries.length > 200_000) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'The SourceMap exceeds the 200000-entry budget.',
        module: 'stage8.document-format-python',
        operation: 'validate-source-map',
        retryable: false,
      });
    }
    const paragraphEntries = output.sourceMap.entries.filter(
      (entry) => entry.nodeKind === 'paragraph',
    );
    if (paragraphEntries.length !== result.blocks.length) {
      throw new ShotgunError({
        code: 'FORMAT_CORRUPT',
        safeMessage: 'Extracted blocks could not be mapped deterministically.',
        module: 'stage8.document-format-python',
        operation: 'map-source-selectors',
      });
    }
    const blockStarts: number[] = [];
    let blockStart = 0;
    for (const block of result.blocks) {
      blockStarts.push(blockStart);
      blockStart += Array.from(block.text).length + 2;
    }
    const paragraphByPointer = new Map(
      paragraphEntries.map((entry, index) => [entry.pointer, { entry, index }]),
    );
    const dedupeSelectors = (selectors: readonly SourceSelector[]): readonly SourceSelector[] => {
      const seen = new Set<string>();
      return selectors.filter((selector) => {
        const key = stableJson(selector);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
    const paragraphFor = (pointer: string) =>
      [...paragraphByPointer.entries()]
        .filter(
          ([paragraphPointer]) =>
            pointer === paragraphPointer || pointer.startsWith(`${paragraphPointer}/`),
        )
        .sort((left, right) => right[0].length - left[0].length)[0]?.[1];
    const selectorsFor = (
      entry: (typeof output.sourceMap.entries)[number],
    ): readonly SourceSelector[] => {
      if (entry.nodeKind === 'document') return [];
      const paragraph = paragraphFor(entry.pointer);
      if (!paragraph) return [];
      const workerBlock = result.blocks[paragraph.index]!;
      const segments = workerBlock.segments;
      if (!segments) return workerBlock.selectors;
      const localStart = entry.position.start - blockStarts[paragraph.index]!;
      const localEnd = entry.position.end - blockStarts[paragraph.index]!;
      return dedupeSelectors(
        segments
          .filter((segment) => segment.end > localStart && segment.start < localEnd)
          .flatMap((segment) => segment.selectors),
      );
    };
    const sourceMap = {
      ...output.sourceMap,
      entries: output.sourceMap.entries.map((entry) => ({
        ...entry,
        selectors: selectorsFor(entry),
      })),
    };
    return {
      ...output,
      sourceMap,
      sourceMapHash: sha256Text(stableJson(sourceMap)),
    };
  }
}
