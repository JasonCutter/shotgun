import { describe, expect, it } from 'vitest';

import {
  decodeDiscoveryFeedbackProductCommandRequestV1,
  decodeDiscoveryFeedbackProductStateRequestV1,
} from '../../packages/contracts/src/index.js';

const base = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: '1.0.0',
  clientRequestId: 'feedback-client-1',
  idempotencyKey: 'feedback-key-1',
  findingId: 'finding-1',
  findingRevision: 2,
  feedbackClass: 'UTILITY',
  feedbackKind: 'USEFUL',
  ...overrides,
});

describe('AKP-7 WP2 Discovery feedback Product contract', () => {
  it('accepts frozen feedback kinds and rejects unknown browser authority fields', () => {
    expect(
      decodeDiscoveryFeedbackProductCommandRequestV1(
        base({ feedbackClass: 'EPISTEMIC', feedbackKind: 'WRONG_ENTITY' }),
      ).feedbackKind,
    ).toBe('WRONG_ENTITY');
    expect(
      decodeDiscoveryFeedbackProductCommandRequestV1(
        base({ feedbackKind: 'SUPPRESS_EXACT', scope: 'PROJECT' }),
      ).scope,
    ).toBe('PROJECT');
    expect(() =>
      decodeDiscoveryFeedbackProductCommandRequestV1(
        base({ projectId: 'browser-project', fingerprint: 'sha256:forged' }),
      ),
    ).toThrow(/unsupported fields/);
  });

  it('rejects class mismatch and invalid suppression intent', () => {
    expect(() =>
      decodeDiscoveryFeedbackProductCommandRequestV1(
        base({ feedbackClass: 'UTILITY', feedbackKind: 'WRONG_ENTITY' }),
      ),
    ).toThrow(/incompatible/);
    expect(() =>
      decodeDiscoveryFeedbackProductCommandRequestV1(
        base({ feedbackKind: 'USEFUL', snoozeUntil: '2999-01-01T00:00:00.000Z' }),
      ),
    ).toThrow(/only allowed/);
    expect(() =>
      decodeDiscoveryFeedbackProductCommandRequestV1(base({ feedbackKind: 'SNOOZE' })),
    ).toThrow(/required/);
    expect(() =>
      decodeDiscoveryFeedbackProductCommandRequestV1(
        base({ feedbackKind: 'SNOOZE', snoozeUntil: '2026-08-31T00:00:01.000Z' }),
        'feedback',
        Date.parse('2026-08-31T00:00:02.000Z'),
      ),
    ).toThrow(/future/);
  });

  it('keeps the Product reason bound identical to the durable feedback contract', () => {
    const accepted = decodeDiscoveryFeedbackProductCommandRequestV1(
      base({ reason: 'r'.repeat(500) }),
    );
    expect(accepted.reason).toHaveLength(500);
    expect(() =>
      decodeDiscoveryFeedbackProductCommandRequestV1(base({ reason: 'r'.repeat(501) })),
    ).toThrow(/at most 500 characters/);
  });

  it('keeps the state request principal/project-free and strict', () => {
    expect(
      decodeDiscoveryFeedbackProductStateRequestV1({
        schemaVersion: '1.0.0',
        findingId: 'finding-1',
        findingRevision: 2,
      }),
    ).toMatchObject({ findingId: 'finding-1', findingRevision: 2 });
    expect(() =>
      decodeDiscoveryFeedbackProductStateRequestV1({
        schemaVersion: '1.0.0',
        findingId: 'finding-1',
        findingRevision: 2,
        principalId: 'forged-principal',
      }),
    ).toThrow(/unsupported fields/);
  });
});
