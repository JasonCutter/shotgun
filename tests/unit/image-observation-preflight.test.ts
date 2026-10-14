import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { PythonDocumentFormatAdapter } from '../../adapters/document-format-python/src/index.js';
const ownedPython =
  'C:/dev/artifacts/vp-full-completion-2026-10-12/fresh-document-python-20261013/Scripts/python.exe';
const pythonExecutable = existsSync(ownedPython) ? ownedPython : (process.env.PYTHON ?? 'python');
const hash = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

describe('local image preflight before execution authority', () => {
  it('returns immutable decoded original pixel/hash pins without asking a model', async () => {
    const bytes = await readFile(new URL('../fixtures/stage-8/golden.png', import.meta.url));
    const describeImage = vi.fn(async () => 'must not execute');
    const adapter = new PythonDocumentFormatAdapter({
      pythonExecutable,
      multimodal: { describe: describeImage },
    });
    const result = await adapter.preflightImage({
      mediaType: 'image/png',
      contentBase64: bytes.toString('base64'),
      sourceContentHash: hash(bytes),
    });
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.pixels).toBe(result.width * result.height);
    expect(result.contentHash).toBe(hash(bytes));
    expect(Object.isFrozen(result)).toBe(true);
    expect(describeImage).not.toHaveBeenCalled();
  });

  it('rejects corrupt originals, wrong hash and MIME without asking a model', async () => {
    const original = await readFile(new URL('../fixtures/stage-8/golden.png', import.meta.url));
    const describeImage = vi.fn(async () => 'must not execute');
    const adapter = new PythonDocumentFormatAdapter({
      pythonExecutable,
      multimodal: { describe: describeImage },
    });
    for (const input of [
      {
        mediaType: 'image/png' as const,
        contentBase64: original.subarray(0, 40).toString('base64'),
        sourceContentHash: hash(original.subarray(0, 40)),
      },
      {
        mediaType: 'image/png' as const,
        contentBase64: original.toString('base64'),
        sourceContentHash: hash(Buffer.from('other original')),
      },
      {
        mediaType: 'image/jpeg' as const,
        contentBase64: original.toString('base64'),
        sourceContentHash: hash(original),
      },
    ])
      await expect(adapter.preflightImage(input)).rejects.toMatchObject({
        code: expect.stringMatching(/FORMAT_CORRUPT|VALIDATION_ERROR/u),
      });
    expect(describeImage).not.toHaveBeenCalled();
  });
});
