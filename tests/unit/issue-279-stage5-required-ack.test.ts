import { describe, expect, it } from 'vitest';

import type { ClaimCandidate } from '../../packages/contracts/src/index.js';
import {
  createComparisonV2Runtime,
} from '../../assemblies/shotgun-app/src/comparison-v2-runtime.js';
import {
  createComparisonModule,
  type ComparisonV2OrchestrationOutcome,
  type ComparisonV2OrchestratorPort,
} from '../../modules/comparison/src/index.js';

const candidate = (): ClaimCandidate =>
  ({
    candidateId: 'candidate-279',
    batchId: 'batch-279',
    revisionNumber: 1,
    projectId: 'project-279',
    sourceVersionId: 'source-279',
    claimText: 'Orion 서비스는 매일 02:30에 백업을 시작한다.',
    evidenceIds: ['evidence-279'],
    evidenceMode: 'DIRECT_EVIDENCE',
    extractionProfile: 'direct-only',
    status: 'READY',
    providerCall: {} as ClaimCandidate['providerCall'],
    accessScope: ['owner'],
    sensitivity: 'private',
    createdAt: '2026-09-12T14:20:56.791Z',
  }) as ClaimCandidate;

const actor = { type: 'user' as const, id: 'owner-279' };
const security = {
  accessScope: ['owner'],
  sensitivity: 'private' as const,
  dataClassification: 'knowledge',
};

const settings = {
  getProjectSettingValue: async () => 'V2_ACTIVE',
};

const completed = (): ComparisonV2OrchestrationOutcome =>
  ({
    status: 'COMPLETED',
    aggregate: {
      comparison: {
        comparisonId: 'comparison-279',
        canonicalSnapshot: { version: 3, digest: 'digest-279' },
      },
    },
    event: {
      eventType: 'ComparisonCompletedV2',
      contractVersion: '2.0',
      comparison: { comparisonId: 'comparison-279' },
      analysisRevisionIds: [],
      emittedAt: '2026-09-12T14:21:00.000Z',
    },
  }) as unknown as ComparisonV2OrchestrationOutcome;

const moduleFor = (orchestrator: ComparisonV2OrchestratorPort, reviewBridge?: unknown) => {
  const runtime = createComparisonV2Runtime({
    candidate: { findById: async () => candidate() },
    settings,
    orchestrator,
    ...(reviewBridge === undefined
      ? {}
      : {
          reviewBridge: reviewBridge as never,
          freshness: {} as never,
        }),
  });
  return createComparisonModule(
    {
      save: async (result) => result,
      findById: async () => undefined,
      findByCandidateAndSnapshot: async () => undefined,
    },
    {
      getSnapshot: async () => ({
        snapshotId: 'snapshot-279',
        projectId: 'project-279',
        version: 3,
        digest: 'unused-by-v2-active',
        claims: [],
        createdAt: '2026-09-12T14:00:00.000Z',
      }),
    },
    { identity: { id: 'diff', version: '1' }, diff: () => [] },
    runtime,
  );
};

const event = {
  messageType: 'CandidateValidated',
  schemaVersion: '1.0.0',
  correlationId: 'correlation-279',
  idempotencyKey: 'candidate-validation:project-279:validation-279',
  createdAt: '2026-09-12T14:20:56.791Z',
  projectId: 'project-279',
  actor,
  security,
  payload: { candidateId: 'candidate-279' },
} as never;

const context = {
  query: async () => ({ payload: candidate() }),
  publish: async () => undefined,
} as never;

describe('Issue #279 Stage 5 V2 REQUIRED_ACK terminalization', () => {
  it('rejects CandidateValidated when V2_ACTIVE is blocked instead of silently succeeding', async () => {
    const module = moduleFor({
      compare: async () => ({ status: 'BLOCKED', reason: 'SHORTLIST_BLOCKED' }),
    } as ComparisonV2OrchestratorPort);

    await expect(module.handlers.events[0]!.handle(event, context)).rejects.toThrow(
      'Stage 5 V2 did not reach an authoritative Review terminal state',
    );
  });

  it('rejects CandidateValidated when Comparison completed but Review draft did not materialize', async () => {
    const module = moduleFor(
      { compare: async () => completed() } as ComparisonV2OrchestratorPort,
      {
        materializeDraft: async () => ({ status: 'BLOCKED', reason: 'FRESHNESS_UNAVAILABLE' }),
      },
    );

    await expect(module.handlers.events[0]!.handle(event, context)).rejects.toThrow(
      'Stage 5 V2 did not reach an authoritative Review terminal state',
    );
  });

  it('acknowledges V2_ACTIVE only after completed Comparison and Review draft creation', async () => {
    const module = moduleFor(
      { compare: async () => completed() } as ComparisonV2OrchestratorPort,
      { materializeDraft: async () => ({ status: 'DRAFT_CREATED', draft: {} }) },
    );

    await expect(module.handlers.events[0]!.handle(event, context)).resolves.toBeUndefined();
  });
});
