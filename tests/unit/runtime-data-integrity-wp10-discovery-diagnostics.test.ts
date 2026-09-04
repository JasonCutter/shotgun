import { describe, expect, it, vi } from 'vitest';

import {
  DISCOVERY_PRODUCT_STRATEGY_REVISION_V1,
  createProductDiscoveryExecution,
} from '../../adapters/discovery-runtime-product/src/index.js';
import type {
  CompiledTruthProjection,
  DiscoveryFindingEnvelopeV1,
} from '../../packages/contracts/src/index.js';
import { computeDiscoveryFingerprintV1 } from '../../packages/contracts/src/index.js';
import type { DiscoveryExecutionContextV1 } from '../../modules/discovery-runtime/src/worker.js';
import type { DiscoverySemanticEssenceDiagnosticInputV1 } from '../../modules/discovery-runtime/src/index.js';

describe('WP-10 Discovery diagnostic safety contract', () => {
  it('defines a bounded, digest-only diagnostic shape', () => {
    const input: DiscoverySemanticEssenceDiagnosticInputV1 = {
      projectId: 'project-a',
      jobId: 'job-1',
      runId: 'run-1',
      attemptId: 'attempt-1',
      findingIdentity: ('sha256:' + 'a'.repeat(64)) as `sha256:${string}`,
      attemptNumber: 1,
      occurredAt: '2026-09-04T00:00:00.000Z',
      excludedCount: 1,
      candidateCount: 2,
    };
    expect(input.findingIdentity).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(input).not.toHaveProperty('prompt');
    expect(input).not.toHaveProperty('sourceText');
    expect(input).not.toHaveProperty('rawError');
  });

  it('keeps candidate exclusion and healthy run progress when diagnostic storage fails', async () => {
    const projectId = 'project-wp10-diagnostics';
    const projection = {
      projectId,
      projectorVersion: 'compiled-truth:v1',
      sourceSnapshotDigest: 'sha256:' + 'b'.repeat(64),
      logicalDigest: 'sha256:' + 'c'.repeat(64),
      canonicalVersion: 1,
      items: [
        {
          id: 'entity-wp10',
          type: 'ENTITY',
          label: 'Safe entity',
          state: 'CURRENT',
          source: 'CANONICAL_CLAIM',
          evidenceIds: [],
          accessScope: ['owner'],
          sensitivity: 'internal',
        },
      ],
      graph: { nodes: [], edges: [], fallback: { available: true, modes: ['LIST', 'TABLE'] } },
      projectedAt: '2026-09-04T00:00:00.000Z',
      buildMode: 'FULL_REBUILD',
    } as unknown as CompiledTruthProjection;
    const context = {
      claim: {
        projectId,
        jobId: 'job-wp10',
        runId: 'run-wp10',
        attemptId: 'attempt-wp10',
        workerId: 'worker-wp10',
        fencingToken: 1,
        acquiredAt: '2026-09-04T00:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
        job: {
          strategyRevision: DISCOVERY_PRODUCT_STRATEGY_REVISION_V1,
          canonicalBase: {
            schemaVersion: '1.0.0',
            canonicalVersion: 1,
            snapshotDigest: 'sha256:' + 'd'.repeat(64),
          },
          requiredDiscoveryBase: {
            schemaVersion: '1.0.0',
            projectionRevision: 'compiled-truth:v1:1',
            projectionDigest: projection.sourceSnapshotDigest,
          },
          budget: {
            schemaVersion: '1.0.0',
            budgetVersion: 'discovery-work-budget:v1',
            budgetId: 'budget-wp10',
            budgetRevision: 'budget-wp10:1',
            maxResources: 10,
            maxSemanticNeighbors: 10,
            maxCandidatePairs: 10,
            maxCandidateGroups: 10,
            maxFindings: 10,
            maxProviderCalls: 1,
            maxInputTokens: 100,
            maxOutputTokens: 100,
            maxOutputTokensPerCall: 100,
            maxEstimatedCostMicros: 100,
            maxConcurrentProviderCalls: 1,
            deadlineAt: '2099-01-01T00:00:00.000Z',
          },
          trigger: { triggerClass: 'CANONICAL_COMMITTED' },
        },
        run: {},
        attempt: { attemptNumber: 1 },
      },
      signal: new AbortController().signal,
      budgetSnapshot: {
        resources: 0,
        semanticNeighbors: 0,
        candidatePairs: 0,
        candidateGroups: 0,
        findings: 0,
        providerCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostMicros: 0,
        activeProviderCalls: 0,
      },
      checkpointRevision: 0,
      saveBudgetSnapshot: vi.fn(async () => 'SAVED' as const),
    } as unknown as DiscoveryExecutionContextV1;
    const diagnostic = vi.fn(async (input: DiscoverySemanticEssenceDiagnosticInputV1) => {
      void input;
      throw new Error('diagnostic store unavailable');
    });
    const input = {
      compiledTruthRepository: { findProjection: vi.fn(async () => projection) },
      findingRepository: {
        listByProject: vi.fn(async () => []),
        findLifecycle: vi.fn(async () => undefined),
      },
      runtimeRepository: { recordSemanticEssenceDiagnostic: diagnostic },
      resolveSecurity: vi.fn(async () => ({
        projectId,
        accessScope: ['owner'],
        sensitivity: 'internal' as const,
      })),
      findAuthoritativeEquivalent: vi.fn(async () => false),
      evidenceRepository: { findById: vi.fn(async () => undefined) },
      semanticRetriever: { retrieve: vi.fn(async () => []) },
      createGenerationService: vi.fn(),
      observeReconciliation: vi.fn(),
    };
    const invalid = {
      schemaVersion: '1.0.0',
      findingId: 'finding-invalid-wp10',
      findingRevision: 1,
      projectId,
      status: 'DERIVED_INFERENCE',
      findingType: 'KNOWLEDGE_GAP',
      generationMethod: 'DETERMINISTIC',
      lifecycleState: 'NEW',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'KNOWLEDGE_GAP',
        gapKind: 'MISSING_FACT',
        subject: 'HOSTILE_SENTINEL',
        missingFact: 'HOSTILE_SENTINEL',
        question: 'HOSTILE_SENTINEL',
      },
      relatedResourceRefs: [],
      evidenceIds: [],
      sourceProjectionDigest: projection.sourceSnapshotDigest,
      canonicalBase: context.claim.job.canonicalBase,
      discoveryBase: context.claim.job.requiredDiscoveryBase,
      runId: context.claim.runId,
      signalSummary: {},
      rationale: 'HOSTILE_SENTINEL',
      derivationSummary: 'HOSTILE_SENTINEL',
      provenance: {
        schemaVersion: '1.0.0',
        kind: 'DETERMINISTIC',
        ruleId: 'wp10-test',
        ruleVersion: '1',
        inputDigest: 'sha256:' + 'e'.repeat(64),
      },
      accessScope: ['owner'],
      sensitivity: 'internal',
      fingerprint: 'sha256:' + 'f'.repeat(64),
      fingerprintVersion: 'discovery-fingerprint:v1',
      retentionClass: 'DURABLE_DERIVED_RECORD',
      createdAt: '2026-09-04T00:00:00.000Z',
    } as unknown as DiscoveryFindingEnvelopeV1;
    const relatedResource = {
      schemaVersion: '1.0.0' as const,
      projectId,
      resourceKind: 'CANONICAL_ENTITY' as const,
      resourceId: 'entity-wp10',
      resourceState: 'CURRENT' as const,
      resourceRevision: '1',
    };
    const healthyEssence = `isolated-entity:${[
      projectId,
      relatedResource.resourceKind,
      relatedResource.resourceId,
      relatedResource.resourceState,
      relatedResource.resourceRevision,
    ].join('\u0000')}`;
    const healthyFingerprint = computeDiscoveryFingerprintV1({
      findingType: 'KNOWLEDGE_GAP',
      relatedResourceRefs: [relatedResource],
      semanticEssence: healthyEssence,
    }).fingerprint;
    const healthy = {
      ...invalid,
      findingId: 'finding-healthy-wp10',
      relatedResourceRefs: [relatedResource],
      payload: {
        ...invalid.payload,
        subject: 'Safe subject',
        missingFact: 'Safe missing fact',
        question: 'What safe fact is missing?',
      },
      rationale: 'Safe rationale',
      derivationSummary: 'Safe derivation',
      fingerprint: healthyFingerprint,
    } as unknown as DiscoveryFindingEnvelopeV1;

    const execution = createProductDiscoveryExecution(
      input as unknown as Parameters<typeof createProductDiscoveryExecution>[0],
    );
    const result = await execution.qualityGate(context, [invalid, healthy]);
    expect(result.completion).toBe('PARTIAL');
    expect(result.value.map((finding) => finding.findingId)).toEqual(['finding-healthy-wp10']);
    expect(diagnostic).toHaveBeenCalledOnce();
    const persistedInput = diagnostic.mock.calls[0]![0]!;
    expect(JSON.stringify(persistedInput)).not.toContain('HOSTILE_SENTINEL');
    expect(persistedInput.findingIdentity).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });
});
