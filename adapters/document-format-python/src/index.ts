import { spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import path from 'node:path';

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
};

type WorkerResult =
  | { readonly status: 'OK'; readonly blocks: readonly WorkerBlock[] }
  | {
      readonly status:
        | 'FORMAT_CORRUPT'
        | 'FORMAT_ENCRYPTED'
        | 'FORMAT_UNSUPPORTED'
        | 'MULTIMODAL_VALIDATION_REQUIRED';
      readonly message: string;
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
): Promise<WorkerResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(pythonExecutable, [workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0 || !stdout) {
        reject(new Error(stderr || `format worker exited with code ${code ?? 'unknown'}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as WorkerResult);
      } catch (error) {
        reject(new Error('format worker returned invalid JSON', { cause: error }));
      }
    });
    child.stdin.end(JSON.stringify(request));
  });

const errorFor = (result: Exclude<WorkerResult, { readonly status: 'OK' }>): ShotgunError =>
  new ShotgunError({
    code: result.status,
    safeMessage: result.message || result.status,
    module: 'stage8.document-format-python',
    operation: 'extract-document',
  });

export class PythonDocumentFormatAdapter implements PlainTextTransformerPort {
  readonly identity = { id: 'shotgun.document-formats', version: '1.0.0' } as const;
  readonly #plainText = new LucasAugmentedPlainTextAdapter();
  readonly #pythonExecutable: string;
  readonly #workerPath: string;
  readonly #multimodal?: MultimodalValidationPort;

  constructor(
    options: {
      readonly pythonExecutable?: string;
      readonly workerPath?: string;
      readonly multimodal?: MultimodalValidationPort;
    } = {},
  ) {
    this.#pythonExecutable = options.pythonExecutable ?? process.env.PYTHON ?? 'python';
    this.#workerPath =
      options.workerPath ?? path.resolve('adapters/document-format-python/worker.py');
    this.#multimodal = options.multimodal;
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
    const isImage = input.mediaType === 'image/png' || input.mediaType === 'image/jpeg';
    const imageDescription =
      isImage && this.#multimodal
        ? await this.#multimodal.describe({
            mediaType: input.mediaType as 'image/png' | 'image/jpeg',
            contentBase64: input.contentBase64,
          })
        : undefined;
    const result = await runWorker(this.#pythonExecutable, this.#workerPath, {
      mediaType: input.mediaType,
      contentBase64: input.contentBase64,
      ...(imageDescription ? { imageDescription } : {}),
    });
    if (result.status !== 'OK') {
      throw errorFor(result);
    }
    const normalizedText = result.blocks.map((item) => item.text).join('\n\n');
    const output = this.#plainText.transform({ ...input, text: normalizedText });
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
    const byPointer = new Map(
      paragraphEntries.map((entry, index) => [entry.pointer, result.blocks[index]!.selectors]),
    );
    const sourceMap = {
      ...output.sourceMap,
      entries: output.sourceMap.entries.map((entry) => ({
        ...entry,
        selectors: byPointer.get(entry.pointer) ?? [],
      })),
    };
    return {
      ...output,
      sourceMap,
      sourceMapHash: sha256Text(stableJson(sourceMap)),
    };
  }
}

export type SafeUrlFetchPort = {
  fetch(url: URL): Promise<{ readonly mediaType: 'text/html'; readonly contentBase64: string }>;
};

type Address = { readonly address: string; readonly family: number };
type AddressResolver = (hostname: string) => Promise<readonly Address[]>;
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const isPrivateAddress = (address: string): boolean => {
  const normalized = address.toLowerCase();
  if (isIP(normalized) === 4) {
    const octets = normalized.split('.').map(Number);
    const [first = 0, second = 0] = octets;
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      first >= 224
    );
  }
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:192.168.')
  );
};

const assertPublicHttpsUrl = (value: string): URL => {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const privateIpv4 =
    /^(127\.|10\.|0\.)/.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (
    url.protocol !== 'https:' ||
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.local') ||
    privateIpv4
  ) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'URL intake allows only public HTTPS pages.',
      module: 'stage8.safe-url',
      operation: 'validate-url',
    });
  }
  return url;
};

export class NodeSafeUrlFetchAdapter implements SafeUrlFetchPort {
  readonly #resolve: AddressResolver;
  readonly #fetch: FetchLike;
  readonly #maxBytes: number;
  readonly #timeoutMs: number;

  constructor(
    options: {
      readonly resolve?: AddressResolver;
      readonly fetch?: FetchLike;
      readonly maxBytes?: number;
      readonly timeoutMs?: number;
    } = {},
  ) {
    this.#resolve =
      options.resolve ?? (async (hostname) => lookup(hostname, { all: true, verbatim: true }));
    this.#fetch = options.fetch ?? fetch;
    this.#maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  async fetch(
    initialUrl: URL,
  ): Promise<{ readonly mediaType: 'text/html'; readonly contentBase64: string }> {
    let current = assertPublicHttpsUrl(initialUrl.toString());
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const addresses = await this.#resolve(current.hostname);
      if (addresses.length === 0 || addresses.some((item) => isPrivateAddress(item.address))) {
        throw new ShotgunError({
          code: 'POLICY_DENIED',
          safeMessage: 'URL resolved to a private or unavailable network address.',
          module: 'stage8.safe-url',
          operation: 'resolve-url',
        });
      }
      const response = await this.#fetch(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        signal: AbortSignal.timeout(this.#timeoutMs),
        headers: { accept: 'text/html', 'user-agent': 'Shotgun/0.1 format-intake' },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || redirects === 5) {
          throw new ShotgunError({
            code: 'FORMAT_UNSUPPORTED',
            safeMessage: 'URL redirect policy could not produce a public HTML page.',
            module: 'stage8.safe-url',
            operation: 'follow-redirect',
          });
        }
        current = assertPublicHttpsUrl(new URL(location, current).toString());
        continue;
      }
      if (!response.ok || !response.body) {
        throw new ShotgunError({
          code: 'RETRYABLE_DEPENDENCY',
          safeMessage: `URL returned HTTP ${response.status}.`,
          module: 'stage8.safe-url',
          operation: 'fetch-url',
          retryable: response.status >= 500,
        });
      }
      const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
      if (mediaType !== 'text/html') {
        throw new ShotgunError({
          code: 'FORMAT_UNSUPPORTED',
          safeMessage: 'URL intake supports only HTML pages.',
          module: 'stage8.safe-url',
          operation: 'validate-url-media-type',
        });
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > this.#maxBytes) {
          await reader.cancel();
          throw new ShotgunError({
            code: 'FORMAT_UNSUPPORTED',
            safeMessage: 'URL page exceeds the 10 MiB intake limit.',
            module: 'stage8.safe-url',
            operation: 'limit-url-size',
          });
        }
        chunks.push(value);
      }
      return {
        mediaType: 'text/html',
        contentBase64: Buffer.concat(chunks).toString('base64'),
      };
    }
    throw new ShotgunError({
      code: 'FORMAT_UNSUPPORTED',
      safeMessage: 'URL redirect limit exceeded.',
      module: 'stage8.safe-url',
      operation: 'follow-redirect',
    });
  }
}

export class SafeUrlTextAdapter {
  readonly #fetcher: SafeUrlFetchPort;
  readonly #transformer: PythonDocumentFormatAdapter;

  constructor(fetcher: SafeUrlFetchPort, transformer: PythonDocumentFormatAdapter) {
    this.#fetcher = fetcher;
    this.#transformer = transformer;
  }

  async transform(input: {
    readonly url: string;
    readonly sourceId: string;
    readonly sourceVersionId: string;
    readonly sourceContentHash: string;
  }): Promise<PlainTextTransformationOutput> {
    const fetched = await this.#fetcher.fetch(assertPublicHttpsUrl(input.url));
    return this.#transformer.transform({
      ...input,
      mediaType: fetched.mediaType,
      contentBase64: fetched.contentBase64,
    });
  }
}
