import { describe, expect, it } from 'vitest';
import { sha256Text, stableJson } from '../../packages/contracts/src/index.js';
import {
  parseVPImageObservationV1,
  imageObservationDerivationProof,
} from '../../packages/contracts/src/vp-image-observation.js';
import { imageObservationFixture } from '../helpers/vp-image-observation.js';

describe('VP image observation authority contract', () => {
  it('a different provider adapter retains source/provenance semantics without creating Evidence or Fact', () => {
    const current = imageObservationFixture();
    const replacement = parseVPImageObservationV1({
      ...current,
      derivation: { ...current.derivation, adapterVersion: 'isolated-fake-replacement-v2' },
    });
    expect(replacement.image).toEqual(current.image);
    expect(replacement.sourceVersionId).toBe(current.sourceVersionId);
    expect(replacement.epistemicStatus).toBe('GENERATED_UNVERIFIED');
    expect(replacement).not.toHaveProperty('claimText');
    expect(replacement).not.toHaveProperty('evidenceId');
    expect(replacement).not.toHaveProperty('factId');
  });
  it('semantic changes and exact call/response bindings change derivation identity', () => {
    const original = imageObservationFixture();
    const identity = sha256Text(stableJson(imageObservationDerivationProof(original)));
    for (const change of [
      { text: 'Different interpretation' },
      { sourceContentHash: sha256Text('new bytes') },
      { derivation: { ...original.derivation, responseDigest: sha256Text('new response') } },
    ]) {
      expect(
        sha256Text(stableJson(imageObservationDerivationProof({ ...original, ...change }))),
      ).not.toBe(identity);
    }
  });
});
