import { describe, expect, it, vi } from 'vitest';
import {
  FRONTIER_CONFIG,
  FRONTIER_CONFIG_DIGEST,
  assertionSnapshotDigest,
  generateCandidateFrontier,
} from '../../adapters/vp-knowledge-postgres/src/candidate-frontier.js';
import {
  VPRelationJobWorker,
  type VPCurrentAssertion,
  type VPRelationJobStorePort,
} from '../../modules/vp-knowledge-ledger/src/index.js';
const claim = (
  index: number,
  text = `shared archive count ${index}`,
  scope: readonly string[] = ['owner'],
): VPCurrentAssertion => ({
  assertionId: index.toString().padStart(36, '0'),
  projectId: 'p',
  sourceId: 's' + index,
  sourceVersionId: 'v' + index,
  evidenceId: 'e' + index,
  claimText: text,
  accessScope: scope,
  sensitivity: 'private',
});
describe('bounded candidate discovery (not semantic certification)', () => {
  it('is deterministic across input order, unique, and bounded rather than N squared', () => {
    const input = Array.from({ length: 2000 }, (_, i) => claim(i));
    const result = generateCandidateFrontier(input);
    expect(generateCandidateFrontier([...input].reverse())).toEqual(result);
    expect(result.length).toBeLessThanOrEqual(input.length * FRONTIER_CONFIG.topK);
    expect(new Set(result.map((p) => p.left + ':' + p.right)).size).toBe(result.length);
    expect(result.length).toBeLessThan((input.length * (input.length - 1)) / 2);
    expect(FRONTIER_CONFIG_DIGEST).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
  it('preserves exact ACL array partitions and never crosses project or sensitivity', () => {
    const input = [
      claim(1, 'scope A', ['owner', 'reader']),
      claim(2, 'scope B', ['reader', 'owner']),
      { ...claim(3), projectId: 'other' },
      { ...claim(4), sensitivity: 'public' as const },
    ];
    expect(generateCandidateFrontier(input)).toEqual([]);
  });
  it('keeps numeric/condition contrasts as candidates without declaring their meaning', () => {
    const input = [
      claim(1, 'At 300 K the pressure is 42 kPa.'),
      claim(2, 'At 300 K the pressure is 43 kPa.'),
      claim(3, 'Only licensed users have access.'),
    ];
    expect(
      generateCandidateFrontier(input).some(
        (p) => p.left === input[0]!.assertionId && p.right === input[1]!.assertionId,
      ),
    ).toBe(true);
    expect(assertionSnapshotDigest(input)).not.toBe(
      assertionSnapshotDigest([{ ...input[0]!, evidenceId: 'changed' }, ...input.slice(1)]),
    );
  });
  it('handles an empty snapshot and exact text equivalence without AI candidate jobs', () => {
    expect(generateCandidateFrontier([])).toEqual([]);
    expect(generateCandidateFrontier([claim(1, 'same'), claim(2, 'same')])).toEqual([]);
  });
  it('fails closed when normal worker lacks the frontier port', async () => {
    const jobs = {
      enqueueCurrentPairs: vi.fn(),
      claimNext: vi.fn(),
    } as unknown as VPRelationJobStorePort;
    const worker = new VPRelationJobWorker(
      jobs,
      { resolve: vi.fn() },
      async () => true,
      'v6',
      1000,
      1,
      'FRONTIER',
    );
    await expect(worker.dispatchOnce()).rejects.toThrow('FRONTIER_STORE_REQUIRED');
    expect(jobs.claimNext).not.toHaveBeenCalled();
    expect(jobs.enqueueCurrentPairs).not.toHaveBeenCalled();
  });
});
