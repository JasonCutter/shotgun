import { describe, expect, it } from 'vitest';

import { decideActionRisk } from '../../packages/policy/src/index.js';

describe('Stage 11 deterministic Action risk policy', () => {
  it('maps the complete R0-R4 scale without model discretion', () => {
    const operations = [
      'PREVIEW_ONLY',
      'CREATE_DRAFT',
      'UPDATE_REVERSIBLE',
      'PUBLISH_OR_DELETE',
      'FINANCIAL_OR_LEGAL',
    ] as const;
    expect(
      operations
        .map((operation) =>
          decideActionRisk({ operation, sensitivity: 'private', compensation: false }),
        )
        .map((decision) => decision.level),
    ).toEqual(['R0', 'R1', 'R2', 'R3', 'R4']);
  });

  it('raises restricted and compensation work to conservative minimums', () => {
    expect(
      decideActionRisk({
        operation: 'CREATE_DRAFT',
        sensitivity: 'restricted',
        compensation: false,
      }).level,
    ).toBe('R3');
    expect(
      decideActionRisk({ operation: 'CREATE_DRAFT', sensitivity: 'private', compensation: true })
        .level,
    ).toBe('R2');
  });
});
