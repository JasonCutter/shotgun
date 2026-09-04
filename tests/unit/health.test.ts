import { describe, expect, it } from 'vitest';

import {
  ApplicationRecoveryRegistry,
  RECOVERY_RUNNER_IDS,
  aiRecoveryFailureStatus,
  aiRecoveryStatusFromResult,
  createApplication,
  type RecoveryStatus,
} from '../../assemblies/shotgun-app/src/server.js';
import { InMemoryCanonicalKnowledgeRepository } from '../../adapters/stage6-in-memory/src/index.js';

describe('Shotgun application', () => {
  it('loads the completed Stage modules and exposes their capabilities', async () => {
    const { server } = await createApplication();

    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      modules: [
        'stage1.ping',
        'stage1.pong',
        'stage2.intake',
        'stage2.original-asset',
        'stage3.transformation',
        'stage3.evidence',
        'stage4.ai-provider',
        'stage4.candidate-generation',
        'stage4.validation',
        'stage5.comparison',
        'stage5.change-set-review',
        'stage6.canonical-knowledge',
        'stage7.projection-search',
        'stage7.cited-answer',
        'stage9.knowledge-model',
        'stage10.compiled-truth',
        'akp-4.discovery-trigger-coordinator',
        'stage11.action-execution',
        'stage7.hybrid-retrieval',
      ],
      capabilities: [
        'ping-command',
        'pong-query',
        'intake-submit',
        'original-asset-store',
        'asset-resolver',
        'plain-text-transformation',
        'document-format-transformation',
        'document-revision-provider',
        'evidence-index',
        'evidence-resolver',
        'structured-ai-provider',
        'claim-candidate-provider',
        'candidate-validation-provider',
        'claim-comparison-provider',
        'change-set-review-provider',
        'canonical-knowledge-provider',
        'canonical-snapshot-provider',
        'canonical-search-provider',
        'cited-answer-provider',
        'rich-knowledge-review-provider',
        'compiled-truth-projector',
        'risk-controlled-external-action',
        'hybrid-retrieval-provider',
      ],
      readiness: 'READY',
      recoveries: expect.arrayContaining([
        expect.objectContaining({
          runnerId: RECOVERY_RUNNER_IDS.AI_DURABLE_MATERIALIZATION,
          executionStatus: 'COMPLETED',
          outcome: 'HEALTHY',
          freshness: 'CURRENT',
          readinessImpact: 'NONE',
          scannedCount: 0,
          succeededCount: 0,
          retryableCount: 0,
          terminalCount: 0,
          outcomeUnknownCount: 0,
          safeCodes: [],
        }),
        expect.objectContaining({
          runnerId: RECOVERY_RUNNER_IDS.CANONICAL_PROJECTION,
          executionStatus: 'COMPLETED',
          outcome: 'HEALTHY',
          freshness: 'CURRENT',
          readinessImpact: 'NONE',
          scannedCount: 0,
          succeededCount: 0,
          retryableCount: 0,
          terminalCount: 0,
          outcomeUnknownCount: 0,
          safeCodes: [],
        }),
      ]),
    });

    await server.close();
  });

  it('composes deterministic readiness from active recovery statuses', () => {
    const registry = new ApplicationRecoveryRegistry();
    const status = (overrides: Partial<RecoveryStatus>): RecoveryStatus => ({
      runnerId: 'test-runner',
      executionStatus: 'COMPLETED',
      outcome: 'HEALTHY',
      freshness: 'CURRENT',
      readinessImpact: 'NONE',
      scannedCount: 0,
      succeededCount: 0,
      retryableCount: 0,
      terminalCount: 0,
      outcomeUnknownCount: 0,
      safeCodes: [],
      ...overrides,
    });

    registry.record(status({}));
    expect(registry.readiness()).toBe('READY');
    registry.record(status({ outcome: 'DEGRADED', readinessImpact: 'DEGRADED' }));
    expect(registry.readiness()).toBe('DEGRADED');
    registry.record(
      status({
        executionStatus: 'FAILED_TO_RUN',
        outcome: 'FAILED',
        freshness: 'STALE',
        readinessImpact: 'NOT_READY',
      }),
    );
    expect(registry.readiness()).toBe('NOT_READY');
    registry.record(status({ freshness: 'STALE' }));
    expect(registry.readiness()).toBe('READY');
  });

  it('maps completed, degraded and failed-to-run executions without leaking exceptions', () => {
    const healthy = aiRecoveryStatusFromResult(
      { attempted: 2, resumed: 2, failed: 0 },
      '2026-09-04T00:00:00.000Z',
      '2026-09-04T00:01:00.000Z',
    );
    expect(healthy).toMatchObject({
      executionStatus: 'COMPLETED',
      outcome: 'HEALTHY',
      freshness: 'CURRENT',
      readinessImpact: 'NONE',
      lastSuccessAt: '2026-09-04T00:01:00.000Z',
      scannedCount: 2,
      succeededCount: 2,
      retryableCount: 0,
      safeCodes: [],
    });

    const degraded = aiRecoveryStatusFromResult(
      { attempted: 2, resumed: 1, failed: 1 },
      '2026-09-04T00:02:00.000Z',
      '2026-09-04T00:03:00.000Z',
      healthy,
    );
    expect(degraded).toMatchObject({
      executionStatus: 'COMPLETED',
      outcome: 'DEGRADED',
      freshness: 'CURRENT',
      readinessImpact: 'DEGRADED',
      lastSuccessAt: healthy.lastSuccessAt,
      retryableCount: 1,
      safeCodes: ['AI_DURABLE_MATERIALIZATION_RECOVERY_DEGRADED'],
    });

    const failed = aiRecoveryFailureStatus(
      '2026-09-04T00:04:00.000Z',
      '2026-09-04T00:05:00.000Z',
      degraded,
    );
    expect(failed).toMatchObject({
      executionStatus: 'FAILED_TO_RUN',
      outcome: 'FAILED',
      freshness: 'STALE',
      readinessImpact: 'NOT_READY',
      lastSuccessAt: healthy.lastSuccessAt,
      safeCodes: ['AI_DURABLE_MATERIALIZATION_RECOVERY_FAILED'],
    });
    expect(JSON.stringify(failed)).not.toContain('exception');
  });

  it('keeps health available and redacts recovery failure details', async () => {
    const repository = new InMemoryCanonicalKnowledgeRepository();
    repository.listProjectIds = async () => {
      throw new Error('postgres://private-host/shotgun project-secret prompt evidence stack');
    };
    const { server } = await createApplication({
      canonicalKnowledgeRepository: repository,
      canonicalProjectionRecoveryIntervalMs: false,
    });

    const response = await server.inject({ method: 'GET', url: '/health' });
    const serialized = JSON.stringify(response.json());
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      readiness: 'NOT_READY',
      recoveries: expect.arrayContaining([
        expect.objectContaining({
          runnerId: RECOVERY_RUNNER_IDS.CANONICAL_PROJECTION,
          executionStatus: 'FAILED_TO_RUN',
          outcome: 'FAILED',
          freshness: 'STALE',
          readinessImpact: 'NOT_READY',
          safeCodes: ['CANONICAL_PROJECTION_RECOVERY_FAILED'],
        }),
      ]),
    });
    const publicCanonical = response
      .json()
      .recoveries.find(
        (recovery: { runnerId: string }) =>
          recovery.runnerId === RECOVERY_RUNNER_IDS.CANONICAL_PROJECTION,
      );
    expect(publicCanonical).toBeDefined();
    expect(publicCanonical).not.toHaveProperty('startedAt');
    expect(publicCanonical).not.toHaveProperty('completedAt');
    expect(publicCanonical).not.toHaveProperty('lastSuccessAt');
    expect(publicCanonical).not.toHaveProperty('nextScheduledAt');
    expect(Object.keys(publicCanonical).sort()).toEqual(
      [
        'runnerId',
        'executionStatus',
        'outcome',
        'freshness',
        'readinessImpact',
        'scannedCount',
        'succeededCount',
        'retryableCount',
        'terminalCount',
        'outcomeUnknownCount',
        'safeCodes',
      ].sort(),
    );
    expect(serialized).not.toContain('postgres://');
    expect(serialized).not.toContain('project-secret');
    expect(serialized).not.toContain('prompt evidence');
    expect(serialized).not.toContain('startedAt');
    expect(serialized).not.toContain('completedAt');
    expect(serialized).not.toContain('lastSuccessAt');
    expect(serialized).not.toContain('nextScheduledAt');
    await server.close();
  });

  it('stores and resolves direct text only through an Asset Reference', async () => {
    const { server } = await createApplication();

    const intake = await server.inject({
      method: 'POST',
      url: '/intake',
      payload: {
        submissionId: 'http-intake-1',
        input: {
          kind: 'direct_text',
          text: 'HTTP original\r\nunchanged',
        },
      },
    });
    expect(intake.statusCode).toBe(200);
    const body = intake.json();
    expect(body.stored.assetReference.storageUri).toMatch(/^asset:\/\//);
    expect(body.document.documentIR.blocks).toHaveLength(1);
    expect(body.evidence.items.length).toBeGreaterThan(1);
    expect(body.trace.map((record: { messageType: string }) => record.messageType)).toContain(
      'OriginalAssetStored',
    );

    const resolved = await server.inject({
      method: 'POST',
      url: '/assets/resolve',
      payload: {
        assetReference: body.stored.assetReference,
      },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().resolved.text).toBe('HTTP original\r\nunchanged');

    const evidence = await server.inject({
      method: 'POST',
      url: '/evidence/resolve',
      payload: {
        evidenceId: body.evidence.items[0].evidenceId,
      },
    });
    expect(evidence.statusCode).toBe(200);
    expect(evidence.json().evidence.quote.exact).toBe('HTTP original\r\nunchanged');

    await server.close();
  });

  it('rejects an invalid sensitivity header before Intake', async () => {
    const { server } = await createApplication();

    const response = await server.inject({
      method: 'POST',
      url: '/intake',
      headers: {
        'x-sensitivity': 'unknown',
      },
      payload: {
        submissionId: 'invalid-sensitivity',
        input: {
          kind: 'direct_text',
          text: 'must be rejected',
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'LEGACY_SECURITY_HEADER_FORBIDDEN' });

    await server.close();
  });

  it('demonstrates PingCommand to PongEvent to QueryResult through the API', async () => {
    const { server } = await createApplication();

    const response = await server.inject({
      method: 'POST',
      url: '/demo/ping',
      payload: {
        requestId: 'demo-1',
        message: 'hello',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      commandStatus: 'processed',
      pong: {
        requestId: 'demo-1',
        reply: 'pong:hello',
        receivedCount: 1,
      },
    });
    expect(
      response
        .json()
        .trace.filter((record: { status: string }) => record.status === 'succeeded')
        .map((record: { messageType: string }) => record.messageType),
    ).toEqual(['PongEvent', 'PingCommand', 'GetPongResult']);

    await server.close();
  });
});
