import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

type GoldenRow = {
  stableBoundaryId: string;
  mechanism: 'SAFE_HELPER' | 'RAW';
  finalPhaseBDisposition: string;
};

const corpus = JSON.parse(
  readFileSync(
    path.join(process.cwd(), 'artifacts', 'ts6-phase-b-review', 'golden-corpus.json'),
    'utf8',
  ),
) as { total: number; rows: GoldenRow[] };

describe('TS-6 transaction boundary Golden Corpus', () => {
  it('covers all 112 Product semantic boundaries with final dispositions', () => {
    expect(corpus.total).toBe(112);
    expect(corpus.rows).toHaveLength(112);
    expect(new Set(corpus.rows.map((row) => row.stableBoundaryId)).size).toBe(112);
    expect(corpus.rows.some((row) => row.mechanism === 'RAW')).toBe(true);
    expect(corpus.rows.some((row) => row.mechanism === 'SAFE_HELPER')).toBe(true);
    expect(
      corpus.rows.every((row) => row.finalPhaseBDisposition !== 'ARCHITECTURE_REVIEW_BEFORE_FIX'),
    ).toBe(true);
  });
});
