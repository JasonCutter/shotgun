import { afterEach, describe, expect, it, vi } from 'vitest';

import { KNOWLEDGE_RESET_OWNER_ORDER } from '../../modules/source-knowledge-reset/src/index.js';
import { composePostgresKnowledgeResetOwners } from '../../adapters/source-knowledge-reset-postgres/src/maintenance-composition.js';

describe('PostgreSQL T3 maintenance composition', () => {
  afterEach(() => vi.restoreAllMocks());

  it('registers every ADR-171 owner exactly once in the frozen execution order', () => {
    const pool = {} as never;
    const rebuilders = {
      activity: { rebuildProjectActivity: vi.fn() },
      history: { rebuildProjectHistory: vi.fn() },
      projection: { rebuildProjectProjections: vi.fn() },
    };

    const owners = composePostgresKnowledgeResetOwners(pool, rebuilders);

    expect(owners.map((owner) => owner.ownerId)).toEqual(KNOWLEDGE_RESET_OWNER_ORDER);
    expect(new Set(owners.map((owner) => owner.ownerId)).size).toBe(25);
  });
});
