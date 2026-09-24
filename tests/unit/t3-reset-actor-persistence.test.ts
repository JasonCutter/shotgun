import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

import { PostgresKnowledgeResetPersistence } from '../../adapters/source-knowledge-reset-postgres/src/index.js';

describe('PostgreSQL T3 reset actor readback', () => {
  it('returns the approved actor identity for maintenance Activity scope', async () => {
    const query = vi.fn(async () => ({ rows: [{ actor_principal_id: 'principal-owner' }] }));
    const persistence = new PostgresKnowledgeResetPersistence({ query } as unknown as Pool);

    await expect(
      persistence.readResetActorPrincipalId('project-t3-reset', 'request-1'),
    ).resolves.toBe('principal-owner');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT project_admin.t3_read_reset_actor'),
      ['project-t3-reset', 'request-1'],
    );
  });

  it('returns null when an approved request has no runtime-visible actor row', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const persistence = new PostgresKnowledgeResetPersistence({ query } as unknown as Pool);

    await expect(
      persistence.readResetActorPrincipalId('project-t3-reset', 'missing-request'),
    ).resolves.toBeNull();
  });
});
