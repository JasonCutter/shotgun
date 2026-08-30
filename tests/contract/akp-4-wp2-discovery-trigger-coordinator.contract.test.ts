import { describe, expect, it } from 'vitest';

import type {
  DiscoveryCanonicalCommittedEventEnvelopeV1,
  DiscoveryCanonicalCommittedSourcePort,
  DiscoveryProjectionReadinessPort,
  CompiledTruthProjection,
  SemanticProjectionGeneration,
} from '../../packages/contracts/src/index.js';
import {
  aggregateDiscoveryProjectionReadinessV1,
  createDefaultDiscoveryTriggerPolicyV1,
  DiscoveryTriggerCoordinator,
  StaticDiscoveryTriggerPolicy,
} from '../../modules/discovery-trigger-coordinator/src/index.js';
import { InMemoryDiscoveryRuntimeRepository } from '../../adapters/discovery-trigger-coordinator/src/index.js';
import { PostgresDiscoveryProjectionReadinessAdapter } from '../../adapters/discovery-trigger-coordinator/src/index.js';

const base = {
  schemaVersion: '1.0.0' as const,
  projectionRevision: 'semantic-corpus-source:v1:12',
  projectionDigest: 'sha256:source-12',
};

const envelope = (
  overrides: Partial<DiscoveryCanonicalCommittedEventEnvelopeV1> = {},
): DiscoveryCanonicalCommittedEventEnvelopeV1 => ({
  messageId: 'delivery-1',
  messageType: 'CanonicalCommitted',
  messageKind: 'event',
  schemaVersion: '1.0.0',
  producerModule: 'stage6.canonical-knowledge',
  producerVersion: '1.0.0',
  correlationId: 'correlation-1',
  projectId: 'project-1',
  actor: { type: 'service', id: 'canonical' },
  security: { accessScope: ['owner'], sensitivity: 'private', dataClassification: 'canonical' },
  payload: {
    commitId: 'commit-12',
    manifestId: 'manifest-12',
    changeSetId: 'changeset-12',
    operation: 'ADD_CLAIM',
    status: 'COMMITTED',
    canonicalVersion: 12,
    snapshotDigest: 'sha256:canonical-12',
    actorId: 'owner',
    accessScope: ['owner'],
    sensitivity: 'private',
  },
  createdAt: '2026-08-30T00:00:00.000Z',
  traceId: 'trace-1',
  idempotencyKey: 'delivery-key-1',
  ...overrides,
});

const source: DiscoveryCanonicalCommittedSourcePort = {
  async resolve(event) {
    return {
      projectId: 'project-1',
      eventIdentity: {
        eventId: event.payload.commitId,
        eventRevision: String(event.payload.canonicalVersion),
      },
      canonicalBase: {
        schemaVersion: '1.0.0',
        canonicalVersion: event.payload.canonicalVersion,
        snapshotDigest: event.payload.snapshotDigest,
      },
      requiredDiscoveryBase: base,
      createdAt: event.createdAt,
      correlationId: event.correlationId,
    };
  },
};

const readinessPort = (
  state: 'READY' | 'BEHIND' | 'UNAVAILABLE' = 'BEHIND',
): DiscoveryProjectionReadinessPort => ({
  async read(input) {
    return aggregateDiscoveryProjectionReadinessV1({
      requiredBase: input.requiredBase,
      observedAt: input.observedAt,
      observations: input.projectionKinds.map((projectionKind) => ({
        projectionKind,
        requiredIdentity: input.requiredBase,
        status: state,
        ...(state === 'READY' ? { observedIdentity: input.requiredBase } : {}),
      })),
    });
  },
});

const coordinator = (
  state: 'READY' | 'BEHIND' | 'UNAVAILABLE',
  now = '2026-08-30T00:00:00.000Z',
) => {
  const clock = { now: () => now };
  const runtime = new InMemoryDiscoveryRuntimeRepository();
  const policy = new StaticDiscoveryTriggerPolicy({
    ...createDefaultDiscoveryTriggerPolicyV1(),
    waitTimeoutMs: 60_000,
  });
  let jobSequence = 0;
  return {
    runtime,
    service: new DiscoveryTriggerCoordinator(source, readinessPort(state), runtime, policy, clock, {
      jobId: () => `job-${++jobSequence}`,
    }),
  };
};

describe('AKP-4 WP2 Discovery trigger coordination contracts', () => {
  it('normalizes CanonicalCommitted to server-owned incremental work', async () => {
    const { service } = coordinator('READY');
    const result = await service.coordinateCanonicalCommitted(envelope());
    expect(result.disposition).toBe('CREATED');
    expect(result.lifecycleState).toBe('QUEUED');
    expect(result.readiness.status).toBe('READY');
  });

  it('requires every applicable projection and keeps deterministic observation order', () => {
    const result = aggregateDiscoveryProjectionReadinessV1({
      requiredBase: base,
      observedAt: '2026-08-30T00:00:00.000Z',
      observations: [
        { projectionKind: 'SEMANTIC_INDEX', requiredIdentity: base, status: 'READY' },
        { projectionKind: 'COMPILED_TRUTH', requiredIdentity: base, status: 'READY' },
        { projectionKind: 'GRAPH_PROJECTION', requiredIdentity: base, status: 'BEHIND' },
      ],
    });
    expect(result.status).toBe('BEHIND');
    expect(result.observations.map((item) => item.projectionKind)).toEqual([
      'COMPILED_TRUTH',
      'GRAPH_PROJECTION',
      'SEMANTIC_INDEX',
    ]);
    expect(
      aggregateDiscoveryProjectionReadinessV1({
        requiredBase: base,
        observedAt: result.observedAt,
        observations: result.observations.map((item) => ({
          ...item,
          status: 'UNAVAILABLE' as const,
        })),
      }).status,
    ).toBe('UNAVAILABLE');
  });

  it('derives one logical Job across physical redelivery and concurrent duplicates', async () => {
    const { service } = coordinator('BEHIND');
    const first = await service.coordinateCanonicalCommitted(envelope());
    const redelivery = await service.coordinateCanonicalCommitted(
      envelope({ messageId: 'delivery-2', idempotencyKey: 'delivery-key-2' }),
    );
    const concurrent = await Promise.all(
      [1, 2].map((index) =>
        service.coordinateCanonicalCommitted(
          envelope({ messageId: `delivery-concurrent-${index}` }),
        ),
      ),
    );
    expect(first.disposition).toBe('CREATED');
    expect(redelivery.disposition).toBe('ALREADY_EXISTS');
    expect(new Set(concurrent.map((item) => item.jobId))).toEqual(new Set(['job-1']));
    expect(new Set(concurrent.map((item) => item.logicalJobIdentity.value))).toHaveLength(1);
  });

  it('uses the first durable projection base on redelivery even after the source watermark changes', async () => {
    let sourceBase = base;
    let initialBaseReads = 0;
    const redeliverySource: DiscoveryCanonicalCommittedSourcePort = {
      async resolve(event) {
        return {
          projectId: 'project-1',
          eventIdentity: {
            eventId: event.payload.commitId,
            eventRevision: String(event.payload.canonicalVersion),
          },
          canonicalBase: {
            schemaVersion: '1.0.0',
            canonicalVersion: event.payload.canonicalVersion,
            snapshotDigest: event.payload.snapshotDigest,
          },
          createdAt: event.createdAt,
        };
      },
      async resolveInitialProjectionBase() {
        initialBaseReads += 1;
        return sourceBase;
      },
    };
    const runtime = new InMemoryDiscoveryRuntimeRepository();
    const policy = new StaticDiscoveryTriggerPolicy({
      ...createDefaultDiscoveryTriggerPolicyV1(),
      waitTimeoutMs: 60_000,
    });
    const service = new DiscoveryTriggerCoordinator(
      redeliverySource,
      readinessPort('READY'),
      runtime,
      policy,
      { now: () => '2026-08-30T00:00:00.000Z' },
      { jobId: () => 'job-redelivery' },
    );

    const first = await service.coordinateCanonicalCommitted(envelope());
    const storedFirst = await runtime.findJob({ projectId: 'project-1', jobId: first.jobId });
    sourceBase = {
      ...base,
      projectionRevision: 'semantic-corpus-source:v1:13',
      projectionDigest: 'sha256:source-13',
    };
    const replay = await service.coordinateCanonicalCommitted(
      envelope({ messageId: 'delivery-2', idempotencyKey: 'delivery-key-2' }),
    );
    const storedReplay = await runtime.findJob({ projectId: 'project-1', jobId: first.jobId });

    expect(replay).toMatchObject({
      disposition: 'ALREADY_EXISTS',
      jobId: first.jobId,
      logicalJobIdentity: first.logicalJobIdentity,
    });
    expect(initialBaseReads).toBe(1);
    expect(storedReplay?.requiredDiscoveryBase).toEqual(storedFirst?.requiredDiscoveryBase);
    expect(storedReplay?.budget).toEqual(storedFirst?.budget);
    expect(storedReplay?.projectionWait).toEqual(storedFirst?.projectionWait);
  });

  it('keeps distinct Canonical event identities and rejects Project override', async () => {
    const { service } = coordinator('READY');
    const first = await service.coordinateCanonicalCommitted(envelope());
    const different = await service.coordinateCanonicalCommitted(
      envelope({
        messageId: 'delivery-3',
        payload: { ...envelope().payload, commitId: 'commit-13', canonicalVersion: 13 },
      }),
    );
    expect(different.logicalJobIdentity.value).not.toBe(first.logicalJobIdentity.value);
    await expect(
      service.coordinateCanonicalCommitted(envelope({ projectId: 'browser-project-override' })),
    ).rejects.toThrow(/project/i);
  });

  it('persists an exact projection wait and re-evaluates READY before deadline failure', async () => {
    let state: 'READY' | 'BEHIND' = 'BEHIND';
    const runtime = new InMemoryDiscoveryRuntimeRepository();
    let now = '2026-08-30T00:00:00.000Z';
    const policy = new StaticDiscoveryTriggerPolicy({
      ...createDefaultDiscoveryTriggerPolicyV1(),
      waitTimeoutMs: 60_000,
    });
    const service = new DiscoveryTriggerCoordinator(
      source,
      {
        read: async (input) =>
          aggregateDiscoveryProjectionReadinessV1({
            requiredBase: input.requiredBase,
            observedAt: input.observedAt,
            observations: input.projectionKinds.map((projectionKind) => ({
              projectionKind,
              requiredIdentity: input.requiredBase,
              status: state,
            })),
          }),
      },
      runtime,
      policy,
      { now: () => now },
      { jobId: () => 'job-waiting' },
    );
    const created = await service.coordinateCanonicalCommitted(envelope());
    const waiting = await runtime.findJob({ projectId: 'project-1', jobId: created.jobId });
    expect(waiting).toMatchObject({
      lifecycleState: 'WAITING_FOR_PROJECTION',
      requiredDiscoveryBase: base,
      projectionWait: {
        requiredDiscoveryBase: base,
        waitDeadlineAt: '2026-08-30T00:01:00.000Z',
        fallbackPolicyRevision: 'projection-wait-policy:v1',
      },
    });

    now = '2026-08-30T00:01:00.000Z';
    state = 'READY';
    const ready = await service.reEvaluateCanonicalDiscoveryProjectionReadiness({
      projectId: 'project-1',
      jobId: created.jobId,
    });
    expect(ready.disposition).toBe('READY_FOR_EXECUTION');
    expect(
      (await runtime.findJob({ projectId: 'project-1', jobId: created.jobId }))?.lifecycleState,
    ).toBe('WAITING_FOR_PROJECTION');

    state = 'BEHIND';
    const failed = await service.reEvaluateCanonicalDiscoveryProjectionReadiness({
      projectId: 'project-1',
      jobId: created.jobId,
    });
    expect(failed.disposition).toBe('FAILED_RETRYABLE');
    expect(failed.job.lifecycleState).toBe('FAILED_RETRYABLE');
    expect(failed.job.projectionWait).toBeUndefined();
  });

  it('uses explicit identities for Compiled Truth, graph, and semantic generation readiness', async () => {
    const projection: CompiledTruthProjection = {
      projectId: 'project-1',
      projectorVersion: 'compiled-truth:v1',
      sourceSnapshotDigest: base.projectionDigest,
      logicalDigest: 'sha256:logical',
      canonicalVersion: 12,
      items: [],
      graph: { nodes: [], edges: [], fallback: { available: true, modes: ['LIST', 'TABLE'] } },
      projectedAt: '2026-08-30T00:00:00.000Z',
      buildMode: 'FULL_REBUILD',
    };
    const generation: SemanticProjectionGeneration = {
      projectId: 'project-1',
      generationId: 'generation-12',
      sourceProjectionDigest: base.projectionDigest,
      canonicalBaseVersion: 12,
      credentialId: 'credential-identity-only',
      credentialRevision: 1,
      providerPolicyFingerprint: 'sha256:policy',
      providerId: 'provider',
      embeddingModelId: 'model',
      embeddingProfileId: 'profile',
      embeddingProfileRevision: 1,
      providerRegistryRevision: 'providers:v1',
      capabilityCatalogRevision: 'capabilities:v1',
      representationVersion: 'representation:v1',
      dimension: 1,
      distanceMetric: 'cosine',
      normalizationPolicy: 'none',
      buildStatus: 'READY',
      createdAt: '2026-08-30T00:00:00.000Z',
    };
    const adapter = new PostgresDiscoveryProjectionReadinessAdapter(
      { findProjection: async () => projection },
      {
        getActiveGenerationPointer: async () => ({
          projectId: 'project-1',
          activeGenerationId: generation.generationId,
          pointerRevision: 2,
          sourceProjectionDigest: base.projectionDigest,
          canonicalBaseVersion: 12,
        }),
        getGeneration: async () => generation,
      },
    );
    await expect(
      adapter.read({
        projectId: 'project-1',
        requiredBase: base,
        projectionKinds: ['COMPILED_TRUTH', 'GRAPH_PROJECTION', 'SEMANTIC_INDEX'],
        observedAt: '2026-08-30T00:00:00.000Z',
      }),
    ).resolves.toMatchObject({
      status: 'READY',
      observations: [
        { projectionKind: 'COMPILED_TRUTH', status: 'READY' },
        { projectionKind: 'GRAPH_PROJECTION', status: 'READY' },
        { projectionKind: 'SEMANTIC_INDEX', status: 'READY' },
      ],
    });
    await expect(
      new PostgresDiscoveryProjectionReadinessAdapter({
        findProjection: async () => projection,
      }).read({
        projectId: 'project-1',
        requiredBase: base,
        projectionKinds: ['COMPILED_TRUTH', 'GRAPH_PROJECTION', 'SEMANTIC_INDEX'],
        observedAt: '2026-08-30T00:00:00.000Z',
      }),
    ).resolves.toMatchObject({ status: 'UNAVAILABLE' });
  });
});
