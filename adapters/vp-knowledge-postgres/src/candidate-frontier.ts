import { createHash } from 'node:crypto';
import type { VPCurrentAssertion } from '../../../modules/vp-knowledge-ledger/src/index.js';

/** Selective reuse of local VP snapshot/config/membership identities. This
 * bounded blocking revision is new; its semantic pruning recall is UNVERIFIED. */
export const FRONTIER_CONFIG = Object.freeze({
  revision: 'vp-candidate-gen-v2-bounded-postings',
  normalization: 'nfc-lowercase-collapse-whitespace',
  topK: 20,
  maxFeatures: 64,
  maxPosting: 128,
  maxPool: 128,
  neighborWindow: 8,
  maxAssertions: 50_000,
});
export const frontierDigest = (value: unknown): string =>
  `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
export const FRONTIER_CONFIG_DIGEST = frontierDigest(FRONTIER_CONFIG);
export const normalizeClaimText = (text: string): string =>
  text.normalize('NFC').trim().toLowerCase().replace(/\s+/gu, ' ');
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
export const assertionSnapshotDigest = (input: readonly VPCurrentAssertion[]): string =>
  frontierDigest(
    [...input]
      .sort((a, b) => compare(a.assertionId, b.assertionId))
      .map((a) => [
        a.assertionId,
        a.sourceVersionId,
        a.evidenceId,
        a.claimText,
        a.accessScope,
        a.sensitivity,
      ]),
  );
export type FrontierPair = { readonly left: string; readonly right: string; readonly rank: number };

export function generateCandidateFrontier(
  input: readonly VPCurrentAssertion[],
): readonly FrontierPair[] {
  if (input.length > FRONTIER_CONFIG.maxAssertions)
    throw new Error('FRONTIER_ASSERTION_LIMIT_EXCEEDED');
  const partitions = new Map<string, VPCurrentAssertion[]>();
  for (const a of input) {
    // Keep PostgreSQL's exact array-order partition semantics; never merge ACLs.
    const key = JSON.stringify([a.projectId, a.accessScope, a.sensitivity]);
    const values = partitions.get(key) ?? [];
    values.push(a);
    partitions.set(key, values);
  }
  const pairs = new Map<string, { left: string; right: string; score: number }>();
  for (const values of partitions.values()) {
    values.sort((a, b) => compare(a.assertionId, b.assertionId));
    const features = values.map(
      (a) =>
        new Set(
          (normalizeClaimText(a.claimText).match(/[\p{L}\p{N}]+/gu) ?? [])
            .filter((t) => t.length > 1)
            .slice(0, FRONTIER_CONFIG.maxFeatures),
        ),
    );
    const postings = new Map<string, number[]>();
    features.forEach((tokens, index) => {
      for (const t of tokens) {
        const posting = postings.get(t) ?? [];
        if (posting.length < FRONTIER_CONFIG.maxPosting) posting.push(index);
        postings.set(t, posting);
      }
    });
    values.forEach((a, index) => {
      const pool = new Set<number>();
      const keys = [...features[index]!].sort(
        (x, y) => postings.get(x)!.length - postings.get(y)!.length || compare(x, y),
      );
      for (const key of keys) {
        for (const candidate of postings.get(key)!) {
          if (candidate !== index) pool.add(candidate);
          if (pool.size >= FRONTIER_CONFIG.maxPool) break;
        }
        if (pool.size >= FRONTIER_CONFIG.maxPool) break;
      }
      for (
        let offset = 1;
        offset <= FRONTIER_CONFIG.neighborWindow && pool.size < FRONTIER_CONFIG.maxPool;
        offset++
      ) {
        if (index - offset >= 0) pool.add(index - offset);
        if (index + offset < values.length && pool.size < FRONTIER_CONFIG.maxPool)
          pool.add(index + offset);
      }
      const selected = [...pool]
        .filter((j) => values[j]!.claimText !== a.claimText)
        .map((j) => ({
          j,
          score:
            [...features[index]!].filter((t) => features[j]!.has(t)).length * 3 +
            (a.sourceId !== values[j]!.sourceId ? 1 : 0),
        }))
        .sort(
          (x, y) =>
            y.score - x.score || compare(values[x.j]!.assertionId, values[y.j]!.assertionId),
        )
        .slice(0, FRONTIER_CONFIG.topK);
      for (const c of selected) {
        const b = values[c.j]!;
        const [left, right] = [a.assertionId, b.assertionId].sort(compare);
        const key = JSON.stringify([left, right]);
        const prior = pairs.get(key);
        if (!prior || prior.score < c.score)
          pairs.set(key, { left: left!, right: right!, score: c.score });
      }
    });
  }
  return [...pairs.values()]
    .sort((a, b) => b.score - a.score || compare(a.left, b.left) || compare(a.right, b.right))
    .map((pair, index) => ({ left: pair.left, right: pair.right, rank: index + 1 }));
}
