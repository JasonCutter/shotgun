import { describe, expect, it } from 'vitest';
import {
  parseVPImageObservationV1,
  imageObservationDerivationProof,
} from '../../packages/contracts/src/vp-image-observation.js';
import { imageObservationFixture } from '../helpers/vp-image-observation.js';

describe('typed generated image observation validation', () => {
  it('detaches and freezes pins while explicitly retaining unverified generated status', () => {
    const source = imageObservationFixture();
    const parsed = parseVPImageObservationV1(source);
    expect(parsed).toEqual(source);
    expect(Object.isFrozen(parsed.image.region)).toBe(true);
    expect(Object.isFrozen(parsed.derivation.executionIdentity)).toBe(true);
    (source.image.region as { width: number }).width = 1;
    (source.accessScope as string[]).push('other');
    expect(parsed.image.region.width).toBe(320);
    expect(parsed.accessScope).toEqual(['owner']);
    expect(imageObservationDerivationProof(parsed)).not.toHaveProperty('observationId');
    expect(parsed).not.toHaveProperty('evidenceId');
  });
  it.each([
    (v: Record<string, unknown>) => ({ ...v, epistemicStatus: 'FACT' }),
    (v: Record<string, unknown>) => ({ ...v, evidenceId: 'invented' }),
    (v: Record<string, unknown>) => ({ ...v, confidence: 0.99 }),
    (v: Record<string, unknown>) => ({ ...v, text: '' }),
    (v: Record<string, unknown>) => ({ ...v, text: 'x'.repeat(128001) }),
    (v: Record<string, unknown>) => ({ ...v, sourceContentHash: 'bad' }),
    (v: Record<string, unknown>) => ({ ...v, sourceVersionId: 'wrong' }),
    (v: Record<string, unknown>) => ({ ...v, sensitivity: 'secret' }),
    (v: Record<string, unknown>) => ({ ...v, accessScope: [] }),
    (v: Record<string, unknown>) => ({ ...v, accessScope: ['owner', 'owner'] }),
    (v: Record<string, unknown>) => ({ ...v, createdAt: 'not-a-date' }),
    (v: Record<string, unknown>) => ({ ...v, createdAt: '2026-02-30T00:00:00.000Z' }),
  ])('rejects unsafe or unsupported publication %$', (mutate) => {
    expect(() =>
      parseVPImageObservationV1(
        mutate(imageObservationFixture() as unknown as Record<string, unknown>),
      ),
    ).toThrow();
  });
  it.each([
    { mediaType: 'video/mp4' },
    { width: 0 },
    { width: 30001 },
    { width: 30000, height: 30000 },
    { region: { x: -1, y: 0, width: 1, height: 1, unit: 'px' } },
    { region: { x: 319, y: 0, width: 2, height: 1, unit: 'px' } },
    { region: { x: 0, y: 0, width: 1, height: 1, unit: 'pt' } },
  ])('rejects invalid original image geometry %j', (change) => {
    const source = imageObservationFixture();
    expect(() =>
      parseVPImageObservationV1({ ...source, image: { ...source.image, ...change } }),
    ).toThrow();
  });
  it('rejects claimed provenance that changes execution model or drops required call identity', () => {
    const source = imageObservationFixture();
    expect(() =>
      parseVPImageObservationV1({
        ...source,
        derivation: { ...source.derivation, modelId: 'other' },
      }),
    ).toThrow();
    expect(() =>
      parseVPImageObservationV1({
        ...source,
        derivation: { ...source.derivation, callId: undefined },
      }),
    ).toThrow();
    expect(() =>
      parseVPImageObservationV1({
        ...source,
        derivation: { ...source.derivation, transportRequestDigest: 'bad' },
      }),
    ).toThrow();
  });
});
