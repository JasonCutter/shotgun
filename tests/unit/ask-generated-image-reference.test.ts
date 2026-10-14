import { describe, expect, it } from 'vitest';
import {
  askGeneratedImageObservationReferenceFor,
  decodeAskGeneratedImageObservationReference,
} from '../../packages/contracts/src/frontend-ask-image-observation.js';
import { imageObservationFixture } from '../helpers/vp-image-observation.js';

describe('Ask references preserve generated image observation boundaries', () => {
  it('binds the actual VP observation and derivation without leaking credential or source quote fields', () => {
    const observation = imageObservationFixture();
    const reference = askGeneratedImageObservationReferenceFor(observation, 'observation-ref');
    expect(reference).toMatchObject({
      kind: 'GENERATED_IMAGE_OBSERVATION',
      semanticStatus: 'UNVERIFIED',
      observationId: observation.observationId,
      sourceVersionId: observation.sourceVersionId,
      sourceContentHash: observation.sourceContentHash,
      observationText: observation.text,
      providerExecutionId: observation.derivation.callId,
      derivationId: observation.derivation.transformationRevisionId,
    });
    expect(reference.derivationDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    for (const key of [
      'evidenceId',
      'exactQuote',
      'confidence',
      'credentialFingerprint',
      'executionIdentity',
    ])
      expect(Object.hasOwn(reference, key)).toBe(false);
    expect(Object.isFrozen(reference)).toBe(true);
    expect(Object.isFrozen(reference.region)).toBe(true);
    expect(decodeAskGeneratedImageObservationReference(reference)).toEqual(reference);
  });

  it.each([
    { kind: 'EVIDENCE' },
    { semanticStatus: 'FACT' },
    { evidenceId: 'invented' },
    { exactQuote: 'This is not a literal quote.' },
    { confidence: 0.99 },
    { sourceContentHash: 'unbound' },
    { imageWidth: 0 },
    { observationText: ' ' },
    { region: { x: 9999, y: 0, width: 1, height: 1, unit: 'px' } },
  ])('rejects a forged or out-of-bounds observation reference %j', (change) => {
    const reference = askGeneratedImageObservationReferenceFor(imageObservationFixture(), 'ref');
    expect(() =>
      decodeAskGeneratedImageObservationReference({ ...reference, ...change }),
    ).toThrow();
  });
});
