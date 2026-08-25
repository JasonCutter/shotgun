import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import type { SemanticEmbeddingExecutionPin } from '../../packages/contracts/src/index.js';

const semanticEmbeddingContractSource = await readFile(
  new URL('../../packages/contracts/src/semantic-embedding.ts', import.meta.url),
  'utf8',
);

describe('AKP-1R semantic embedding shared contract', () => {
  it('contains no plaintext credential field', () => {
    expect(semanticEmbeddingContractSource).not.toMatch(
      /\b(?:apiKey|secret|credentialSecret|authHeader|token)\s*\??\s*:/,
    );
  });

  it('pins the exact provider execution dimension', () => {
    const pin: Pick<SemanticEmbeddingExecutionPin, 'dimension'> = { dimension: 512 };
    expect(pin.dimension).toBe(512);
    expect(semanticEmbeddingContractSource).toMatch(
      /export type SemanticEmbeddingExecutionPin[\s\S]*?readonly dimension: number;/,
    );
  });
});
