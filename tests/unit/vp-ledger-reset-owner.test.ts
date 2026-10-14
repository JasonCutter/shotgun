import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PostgresVPKnowledgeResetOwner } from '../../adapters/source-knowledge-reset-postgres/src/vp-ledger-owner.js';

const context = {
  projectId: 'isolated-project',
  requestId: '00000000-0000-4000-8000-000000000001',
  knowledgeEpoch: 1,
  manifestDigest: `sha256:${'a'.repeat(64)}` as `sha256:${string}`,
};
const empty = {
  frontiers: 0,
  frontier_members: 0,
  jobs: 0,
  provider_calls: 0,
  assertions: 0,
  relations: 0,
  decisions: 0,
  events: 0,
  epochs: 0,
  image_observations: 0,
};
const owner = (status: unknown) =>
  new PostgresVPKnowledgeResetOwner({
    query: vi.fn(async () => ({ rows: [{ status }] })),
  } as unknown as Pool);

describe('VP reset owner includes the current Frontier journal', () => {
  it('accepts every owner count and verifies an empty journal', async () => {
    const resetOwner = owner(empty);
    await expect(resetOwner.fence(context)).resolves.toBeUndefined();
    await expect(resetOwner.verify(context)).resolves.toEqual({
      verified: true,
      blockerCodes: [],
    });
  });

  it.each(['frontiers', 'frontier_members', 'image_observations'] as const)(
    'does not verify erased knowledge while %s remains',
    async (key) => {
      await expect(owner({ ...empty, [key]: 1 }).verify(context)).resolves.toEqual({
        verified: false,
        blockerCodes: ['UNCLASSIFIED_CONTENT'],
      });
    },
  );

  it.each(['frontiers', 'frontier_members', 'image_observations'] as const)(
    'rejects a missing %s count rather than assuming it is zero',
    async (key) => {
      const incomplete: Record<string, number> = { ...empty };
      delete incomplete[key];
      await expect(owner(incomplete).fence(context)).rejects.toThrow('malformed counts');
      await expect(owner(incomplete).verify(context)).rejects.toThrow('malformed counts');
    },
  );

  it('retains strict validation for unclassified and malformed counts', async () => {
    for (const status of [
      { ...empty, unclassified: 0 },
      { ...empty, frontiers: -1 },
      { ...empty, frontier_members: '0' },
    ]) {
      await expect(owner(status).verify(context)).rejects.toThrow('malformed counts');
    }
  });
});
