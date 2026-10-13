import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  PythonDocumentFormatAdapter,
  type MultimodalValidationPort,
} from '../../adapters/document-format-python/src/index.js';

const input = async () => {
  const bytes = await readFile(path.resolve('tests/fixtures/stage-8/golden.png'));
  return {
    sourceId: randomUUID(),
    sourceVersionId: randomUUID(),
    mediaType: 'image/png' as const,
    sourceContentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    contentBase64: bytes.toString('base64'),
  };
};

describe('experimental image adapter output validation, without product activation', () => {
  it.each([null, undefined, 42, false, {}, [], '', '  \r\n\t'].map((value) => ({ value })))(
    'rejects invalid fake description $value as safe non-retryable validation failure',
    async ({ value }) => {
      const describeImage = vi
        .fn<MultimodalValidationPort['describe']>()
        .mockResolvedValue(value as string);
      const adapter = new PythonDocumentFormatAdapter({
        pythonExecutable: process.env.PYTHON ?? 'python',
        multimodal: { describe: describeImage },
      });
      await expect(adapter.transform(await input())).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        operation: 'validate-image-description',
        retryable: false,
        safeMessage: 'The multimodal provider returned an invalid image description.',
      });
      expect(describeImage).toHaveBeenCalledOnce();
    },
  );

  it('keeps absent provider explicitly unconfigured; pixel parsing does not certify image meaning', async () => {
    const adapter = new PythonDocumentFormatAdapter({
      pythonExecutable: process.env.PYTHON ?? 'python',
    });
    await expect(adapter.transform(await input())).rejects.toMatchObject({
      code: 'MULTIMODAL_VALIDATION_REQUIRED',
    });
  });
});
