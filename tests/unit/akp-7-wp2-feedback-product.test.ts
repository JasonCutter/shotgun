import { describe, expect, it } from 'vitest';

import { InMemoryDiscoveryFeedbackRepository } from '../../adapters/discovery-feedback-in-memory/src/index.js';
import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import {
  decodeDiscoveryFeedbackProductCommandRequestV1,
  ShotgunError,
} from '../../packages/contracts/src/index.js';
import { DiscoveryFeedbackProductCoordinator } from '../../modules/discovery-feedback/src/index.js';

const scope = {
  principalId: 'principal-1',
  projectId: 'project-1',
  accessRevision: 'project-1:owner',
  policyContextRevision: '7',
} as const;

const finding = {
  projectId: 'project-1',
  findingId: 'finding-1',
  findingRevision: 2,
  fingerprint: 'sha256:authoritative-fingerprint',
  fingerprintVersion: 'discovery-fingerprint:v1',
} as const;

const request = (
  feedbackKind: string,
  feedbackClass: 'EPISTEMIC' | 'UTILITY' = 'UTILITY',
  overrides: Record<string, unknown> = {},
) =>
  decodeDiscoveryFeedbackProductCommandRequestV1(
    {
      schemaVersion: '1.0.0',
      clientRequestId: `client-${feedbackKind}`,
      idempotencyKey: `key-${feedbackKind}`,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
      feedbackClass,
      feedbackKind,
      ...overrides,
    },
    'feedback',
    Date.parse('2026-08-31T00:00:00.000Z'),
  );

describe('AKP-7 WP2 Discovery feedback Product coordinator', () => {
  it('persists one feedback event without suppression for ordinary and epistemic feedback', async () => {
    const repository = new InMemoryDiscoveryFeedbackRepository();
    const coordinator = new DiscoveryFeedbackProductCoordinator(
      repository,
      () => '2026-08-31T00:00:00.000Z',
    );
    const gateway = new InMemoryFrontendCommandGateway();
    const ordinaryCases = [
      ['USEFUL', 'UTILITY'],
      ['NOT_RELEVANT', 'UTILITY'],
      ['INSUFFICIENT_EVIDENCE', 'EPISTEMIC'],
    ] as const;
    for (const [index, [feedbackKind, feedbackClass]] of ordinaryCases.entries()) {
      const decoded = request(feedbackKind, feedbackClass, {
        clientRequestId: `ordinary-${index}`,
        idempotencyKey: `ordinary-key-${index}`,
      });
      const result = await coordinator.submit({ scope, request: decoded, finding, gateway });
      expect(result.outcome.outcomeState).toBe('COMPLETED');
    }
    const state = await coordinator.readState(scope, finding);
    expect(state.feedbackHistory.map((entry) => entry.feedbackKind)).toEqual(
      expect.arrayContaining(['USEFUL', 'NOT_RELEVANT', 'INSUFFICIENT_EVIDENCE']),
    );
    expect(state.feedbackHistory).toHaveLength(3);
    expect(state.suppressionHistory).toEqual([]);
    expect(
      state.feedbackHistory.find((entry) => entry.feedbackKind === 'INSUFFICIENT_EVIDENCE')
        ?.feedbackClass,
    ).toBe('EPISTEMIC');
    expect(repository.getEpistemicReentryTriggers()).toHaveLength(1);
    expect(repository.getEpistemicReentryTriggers()[0]).toMatchObject({
      feedbackId: expect.stringContaining('feedback:'),
      projectId: scope.projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
      feedbackClass: 'EPISTEMIC',
      feedbackKind: 'INSUFFICIENT_EVIDENCE',
    });
    expect('reason' in repository.getEpistemicReentryTriggers()[0]!).toBe(false);
  });

  it('constructs server-owned exact, semantic-family, and snooze directives', async () => {
    const repository = new InMemoryDiscoveryFeedbackRepository();
    const coordinator = new DiscoveryFeedbackProductCoordinator(
      repository,
      () => '2026-08-31T00:00:00.000Z',
    );
    for (const [kind, overrides] of [
      ['SUPPRESS_EXACT', { scope: 'PROJECT' }],
      ['SUPPRESS_SIMILAR', { scope: 'PROJECT' }],
      ['SNOOZE', { snoozeUntil: '2026-09-01T00:00:00.000Z' }],
    ] as const) {
      const gateway = new InMemoryFrontendCommandGateway();
      await coordinator.submit({
        scope,
        request: request(kind, 'UTILITY', {
          clientRequestId: `directive-${kind}`,
          idempotencyKey: `directive-key-${kind}`,
          ...overrides,
        }),
        finding,
        gateway,
      });
    }
    const state = await coordinator.readState(scope, finding);
    expect(state.feedbackHistory).toHaveLength(3);
    expect(state.suppressionHistory).toHaveLength(3);
    expect(state.suppressionHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          suppressionKind: 'SUPPRESS_EXACT',
          matcherKind: 'EXACT_FINGERPRINT',
          fingerprint: finding.fingerprint,
          fingerprintVersion: finding.fingerprintVersion,
          matcherVersion: finding.fingerprintVersion,
        }),
        expect.objectContaining({
          suppressionKind: 'SUPPRESS_SIMILAR',
          matcherKind: 'SEMANTIC_FAMILY',
          matcherVersion: 'semantic-family:v1',
        }),
        expect.objectContaining({
          suppressionKind: 'SNOOZE',
          matcherKind: 'NONE',
          expiresAt: '2026-09-01T00:00:00.000Z',
        }),
      ]),
    );
  });

  it('keeps every utility feedback kind out of EPISTEMIC re-entry', async () => {
    const repository = new InMemoryDiscoveryFeedbackRepository();
    const coordinator = new DiscoveryFeedbackProductCoordinator(
      repository,
      () => '2026-08-31T00:00:00.000Z',
    );
    const gateway = new InMemoryFrontendCommandGateway();
    const cases = [
      ['USEFUL', {}],
      ['NOT_RELEVANT', {}],
      ['ALREADY_KNOWN', {}],
      ['TOO_FREQUENT', {}],
      ['SNOOZE', { snoozeUntil: '2026-09-02T00:00:00.000Z' }],
      ['SUPPRESS_EXACT', {}],
      ['SUPPRESS_SIMILAR', {}],
    ] as const;
    for (const [index, [feedbackKind, overrides]] of cases.entries()) {
      await coordinator.submit({
        scope,
        request: request(feedbackKind, 'UTILITY', {
          ...overrides,
          clientRequestId: `utility-${index}`,
          idempotencyKey: `utility-key-${index}`,
        }),
        finding,
        gateway,
      });
    }
    expect(repository.getEpistemicReentryTriggers()).toEqual([]);
  });

  it('replays a completed command without appending duplicate records', async () => {
    const repository = new InMemoryDiscoveryFeedbackRepository();
    const coordinator = new DiscoveryFeedbackProductCoordinator(
      repository,
      () => '2026-08-31T00:00:00.000Z',
    );
    const gateway = new InMemoryFrontendCommandGateway();
    const decoded = request('SUPPRESS_EXACT', 'UTILITY', {
      clientRequestId: 'replay-client',
      idempotencyKey: 'replay-key',
    });
    const first = await coordinator.submit({ scope, request: decoded, finding, gateway });
    const replay = await coordinator.submit({ scope, request: decoded, finding, gateway });
    const state = await coordinator.readState(scope, finding);
    expect(first.outcome.outcomeState).toBe('COMPLETED');
    expect(replay.outcome.commandId).toBe(first.outcome.commandId);
    expect(state.feedbackHistory).toHaveLength(1);
    expect(state.suppressionHistory).toHaveLength(1);
  });

  it('rolls back both records when directive persistence fails', async () => {
    class FailingRepository extends InMemoryDiscoveryFeedbackRepository {
      override async appendSuppression(): Promise<'CREATED' | 'CONFLICT'> {
        throw new Error('directive write failed');
      }
    }
    const repository = new FailingRepository();
    const coordinator = new DiscoveryFeedbackProductCoordinator(
      repository,
      () => '2026-08-31T00:00:00.000Z',
    );
    const gateway = new InMemoryFrontendCommandGateway();
    const decoded = request('SUPPRESS_EXACT', 'UTILITY', {
      clientRequestId: 'atomic-client',
      idempotencyKey: 'atomic-key',
    });
    await expect(
      coordinator.submit({ scope, request: decoded, finding, gateway }),
    ).rejects.toMatchObject({
      code: 'INTERNAL_UNCLASSIFIED',
    });
    expect((await coordinator.readState(scope, finding)).feedbackHistory).toEqual([]);
    await expect(
      gateway.findByClientRequestId(scope.principalId, decoded.clientRequestId),
    ).resolves.toMatchObject({ outcomeState: 'REJECTED' });
  });

  it('rejects deterministic materialization failure after acceptance without stranding the command', async () => {
    const repository = new InMemoryDiscoveryFeedbackRepository();
    const coordinator = new DiscoveryFeedbackProductCoordinator(
      repository,
      () => '2026-08-31T00:00:00.000Z',
    );
    const gateway = new InMemoryFrontendCommandGateway();
    const decoded = request('SUPPRESS_EXACT', 'UTILITY', {
      clientRequestId: 'materialization-client',
      idempotencyKey: 'materialization-key',
    });
    const invalidFinding = { ...finding, fingerprintVersion: '' };

    await expect(
      coordinator.submit({ scope, request: decoded, finding: invalidFinding, gateway }),
    ).rejects.toMatchObject({ code: 'INTERNAL_UNCLASSIFIED' });
    await expect(
      gateway.findByClientRequestId(scope.principalId, decoded.clientRequestId),
    ).resolves.toMatchObject({ outcomeState: 'REJECTED' });
    const state = await coordinator.readState(scope, finding);
    expect(state.feedbackHistory).toEqual([]);
    expect(state.suppressionHistory).toEqual([]);
  });

  it('marks completion uncertainty as OUTCOME_UNKNOWN and never replays it as a new command', async () => {
    class UnknownGateway extends InMemoryFrontendCommandGateway {
      override async completeInTransaction(): Promise<never> {
        throw new ShotgunError({
          code: 'OUTCOME_UNKNOWN',
          safeMessage: 'commit acknowledgement lost',
          module: 'test',
          operation: 'complete',
        });
      }
    }
    const repository = new InMemoryDiscoveryFeedbackRepository();
    const coordinator = new DiscoveryFeedbackProductCoordinator(
      repository,
      () => '2026-08-31T00:00:00.000Z',
    );
    const gateway = new UnknownGateway();
    const decoded = request('USEFUL', 'UTILITY', {
      clientRequestId: 'unknown-client',
      idempotencyKey: 'unknown-key',
    });
    await expect(
      coordinator.submit({ scope, request: decoded, finding, gateway }),
    ).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
    await expect(
      coordinator.submit({ scope, request: decoded, finding, gateway }),
    ).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
    expect((await coordinator.readState(scope, finding)).feedbackHistory).toEqual([]);
    await expect(
      gateway.findByClientRequestId(scope.principalId, decoded.clientRequestId),
    ).resolves.toMatchObject({ outcomeState: 'OUTCOME_UNKNOWN' });
  });
});
