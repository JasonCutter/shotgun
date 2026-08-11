import { describe, expect, it } from 'vitest';

import { assertSameContextDigest } from '../../adapters/frontend-ask-execution-postgres/src/index.js';
import { askExecutionContextDigest } from '../../modules/frontend-ask-execution/src/index.js';

const digestFor = (text: string): string =>
  askExecutionContextDigest({
    queryPlanRevision: 'ask-query-plan-v3',
    projectId: 'project-1',
    mode: 'SOURCE_EXPLORATION',
    question: 'What does the source say?',
    context: [
      {
        kind: 'SOURCE_VERSION',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        contentHash: `sha256:${'1'.repeat(64)}`,
        mediaType: 'text/plain',
        text,
        sensitivity: 'internal',
      },
    ],
  });

describe('Ask same-context digest', () => {
  it('accepts the identical immutable representation and rejects a re-resolved mismatch', () => {
    const accepted = digestFor('Accepted immutable Direct Text.');

    expect(() => assertSameContextDigest(accepted, accepted)).not.toThrow();
    expect(() =>
      assertSameContextDigest(accepted, digestFor('Changed representation.')),
    ).toThrowError(
      expect.objectContaining({
        code: 'STALE_VERSION',
      }),
    );
  });
});
