import { describe, expect, it } from 'vitest';

import {
  assertDiscoveryLifecycleTransitionV1,
  decodeDiscoveryReconciliationObservationV1,
  DiscoveryFindingLifecycleService,
} from '../../modules/discovery-finding-lifecycle/src/index.js';
import type { DiscoveryFindingEnvelopeV1 } from '../../packages/contracts/src/index.js';
import type {
  DiscoveryFindingIdentityV1,
  DiscoveryFindingLifecycleCurrentV1,
  DiscoveryFindingLifecycleHistoryV1,
  DiscoveryFindingLifecycleRepositoryPort,
  DiscoveryLifecycleTransitionInputV1,
  DiscoveryLifecycleTransitionResultV1,
} from '../../modules/discovery-finding-lifecycle/src/index.js';

const identity: DiscoveryFindingIdentityV1 = {
  projectId: 'project-lifecycle',
  findingId: 'finding-1',
  findingRevision: 1,
};

const timestamp = '2026-08-29T00:00:00.000Z';

const current = (state: DiscoveryFindingLifecycleCurrentV1['lifecycleState'] = 'NEW') => ({
  ...identity,
  lifecycleState: state,
  lifecycleRevision: 1,
  updatedAt: timestamp,
});

class MemoryLifecycleRepository implements DiscoveryFindingLifecycleRepositoryPort {
  currentState: DiscoveryFindingLifecycleCurrentV1 = current();
  history: DiscoveryFindingLifecycleHistoryV1[] = [
    {
      ...identity,
      lifecycleRevision: 1,
      toState: 'NEW',
      cause: 'MATERIALIZATION',
      reasonCode: 'FINDING_MATERIALIZED',
      occurredAt: timestamp,
    },
  ];
  transitionCalls = 0;

  async findLifecycle(request: DiscoveryFindingIdentityV1) {
    return request.projectId === this.currentState.projectId &&
      request.findingId === this.currentState.findingId &&
      request.findingRevision === this.currentState.findingRevision
      ? this.currentState
      : undefined;
  }

  async listLifecycleHistory() {
    return this.history;
  }

  async transitionLifecycle(
    input: DiscoveryLifecycleTransitionInputV1,
  ): Promise<DiscoveryLifecycleTransitionResultV1> {
    this.transitionCalls += 1;
    if (input.expectedLifecycleRevision !== this.currentState.lifecycleRevision) {
      return { status: 'CONFLICT', current: this.currentState };
    }
    assertDiscoveryLifecycleTransitionV1(
      this.currentState.lifecycleState,
      input.targetState,
      input.cause,
      input.reasonCode,
    );
    const next: DiscoveryFindingLifecycleCurrentV1 = {
      ...this.currentState,
      lifecycleState: input.targetState,
      lifecycleRevision: this.currentState.lifecycleRevision + 1,
      updatedAt: input.occurredAt,
    };
    const event: DiscoveryFindingLifecycleHistoryV1 = {
      ...identity,
      lifecycleRevision: next.lifecycleRevision,
      fromState: this.currentState.lifecycleState,
      toState: input.targetState,
      cause: input.cause,
      reasonCode: input.reasonCode,
      ...input.context,
      occurredAt: input.occurredAt,
    };
    this.currentState = next;
    this.history.push(event);
    return { status: 'APPLIED', lifecycle: next, history: event };
  }
}

const finding = (): DiscoveryFindingEnvelopeV1 =>
  ({
    schemaVersion: '1.0.0',
    findingId: identity.findingId,
    findingRevision: identity.findingRevision,
    projectId: identity.projectId,
    findingType: 'KNOWLEDGE_GAP',
    status: 'DERIVED_INFERENCE',
    generationMethod: 'DETERMINISTIC',
    lifecycleState: 'NEW',
    payload: {},
  }) as unknown as DiscoveryFindingEnvelopeV1;

describe('AKP-2 WP3 lifecycle and bounded reconciliation', () => {
  it('enforces the frozen workflow graph and terminal boundary', () => {
    expect(() =>
      assertDiscoveryLifecycleTransitionV1(
        'NEW',
        'REVIEW_READY',
        'GOVERNED_WORKFLOW',
        'REVIEW_READY',
      ),
    ).toThrow('not allowed');
    expect(() =>
      assertDiscoveryLifecycleTransitionV1(
        'RESOLVED',
        'STALE',
        'SYSTEM_RECONCILIATION',
        'RELEVANT_INPUT_CHANGED',
      ),
    ).toThrow('cannot be reopened');
    expect(() =>
      assertDiscoveryLifecycleTransitionV1(
        'VALIDATING',
        'SUPPRESSED',
        'GOVERNED_WORKFLOW',
        'SUPPRESSED',
      ),
    ).not.toThrow();
  });

  it('advances lifecycle revisions and appends exactly one event per success', async () => {
    const repository = new MemoryLifecycleRepository();
    const service = new DiscoveryFindingLifecycleService(repository);
    expect(
      await service.transition({
        ...identity,
        expectedLifecycleRevision: 1,
        targetState: 'VALIDATING',
        cause: 'GOVERNED_WORKFLOW',
        reasonCode: 'VALIDATION_STARTED',
        occurredAt: timestamp,
      }),
    ).toMatchObject({ status: 'APPLIED', lifecycle: { lifecycleRevision: 2 } });
    expect(repository.history).toHaveLength(2);
    expect(repository.history[1]).toMatchObject({ fromState: 'NEW', toState: 'VALIDATING' });
  });

  it('returns a typed stale conflict without appending history', async () => {
    const repository = new MemoryLifecycleRepository();
    const service = new DiscoveryFindingLifecycleService(repository);
    await service.transition({
      ...identity,
      expectedLifecycleRevision: 1,
      targetState: 'VALIDATING',
      cause: 'GOVERNED_WORKFLOW',
      reasonCode: 'VALIDATION_STARTED',
      occurredAt: timestamp,
    });
    const count = repository.history.length;
    const result = await service.transition({
      ...identity,
      expectedLifecycleRevision: 1,
      targetState: 'REVIEW_READY',
      cause: 'GOVERNED_WORKFLOW',
      reasonCode: 'REVIEW_READY',
      occurredAt: timestamp,
    });
    expect(result.status).toBe('CONFLICT');
    expect(repository.history).toHaveLength(count);
  });

  it('maps reconciliation dispositions, records caller context, and makes unchanged a no-op', async () => {
    const repository = new MemoryLifecycleRepository();
    const service = new DiscoveryFindingLifecycleService(repository);
    const unchanged = await service.reconcile({
      finding: finding(),
      expectedLifecycleRevision: 1,
      observation: { ...identity, disposition: 'UNCHANGED' },
      occurredAt: timestamp,
    });
    expect(unchanged.status).toBe('UNCHANGED');
    expect(repository.transitionCalls).toBe(0);
    const resolved = await service.reconcile({
      finding: finding(),
      expectedLifecycleRevision: 1,
      observation: {
        ...identity,
        disposition: 'CANONICAL_EQUIVALENT_ACCEPTED',
        canonicalBase: {
          schemaVersion: '1.0.0',
          canonicalVersion: 9,
          snapshotDigest: 'sha256:canonical',
        },
        discoveryBase: {
          schemaVersion: '1.0.0',
          projectionRevision: 'projection-9',
          projectionDigest: 'sha256:projection',
        },
      },
      occurredAt: timestamp,
    });
    expect(resolved.status).toBe('TRANSITIONED');
    expect(repository.history[1]).toMatchObject({
      toState: 'RESOLVED',
      reasonCode: 'CANONICAL_EQUIVALENT_ACCEPTED',
      canonicalBase: { canonicalVersion: 9 },
      discoveryBase: { projectionRevision: 'projection-9' },
    });
  });

  it('rejects malformed observations and cross-project observations', async () => {
    expect(() =>
      decodeDiscoveryReconciliationObservationV1({
        ...identity,
        disposition: 'UNCHANGED',
        secretToken: 'must-not-be-accepted',
      }),
    ).toThrow('unknown field');
    const service = new DiscoveryFindingLifecycleService(new MemoryLifecycleRepository());
    await expect(
      service.reconcile({
        finding: finding(),
        expectedLifecycleRevision: 1,
        observation: { ...identity, projectId: 'other-project', disposition: 'UNCHANGED' },
        occurredAt: timestamp,
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_PROJECT_MISMATCH' });
  });
});
