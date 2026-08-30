import { describe, expect, it, vi } from 'vitest';

import {
  DISCOVERY_AI_OUTPUT_SCHEMA_VERSION_V1,
  DISCOVERY_AI_PROMPT_VERSION_V1,
  DiscoveryAIGenerationService,
} from '../../modules/discovery-ai-generation/src/index.js';
import { DiscoveryBudgetControllerV1 } from '../../modules/discovery-quality-gate/src/index.js';
import type { DiscoveryWorkBudgetLedgerV1 } from '../../modules/discovery-quality-gate/src/index.js';
import {
  DISCOVERY_PRODUCT_STRATEGY_REVISION_V1,
  createProductDiscoveryExecution,
} from '../../adapters/discovery-runtime-product/src/index.js';
import type { DiscoveryProductExecutionDependenciesV1 } from '../../adapters/discovery-runtime-product/src/index.js';
import type {
  DiscoveryAIExecutionResolverPort,
  DiscoveryModelProfileV1,
  DiscoveryModelProfileServicePort,
  DiscoveryStructuredProviderPort,
  DiscoveryStructuredProviderRouterPort,
  DiscoveryFindingEnvelopeV1,
  SemanticCandidateResult,
  CompiledTruthProjection,
  DiscoveryResourceRefV1,
} from '../../packages/contracts/src/index.js';
import type {
  DiscoveryCompetingResourcePortV1,
  DiscoveryExistingCanonicalConflictPortV1,
  DiscoveryTemporalCompatibilityPortV1,
} from '../../modules/discovery-finding-fingerprint/src/index.js';
import type { DiscoveryExecutionContextV1 } from '../../modules/discovery-runtime/src/worker.js';
import type {
  DiscoveryRuntimeBudgetSnapshotV1,
  DiscoveryRuntimeClaimV1,
  DiscoveryRuntimeGeneratedFindingsStageValueV1,
} from '../../modules/discovery-runtime/src/index.js';
import {
  computeDiscoveryFingerprintV1,
  deriveDiscoverySemanticEssenceV1,
} from '../../packages/contracts/src/index.js';

const projectId = 'product-wp4-project';
const budget = {
  schemaVersion: '1.0.0' as const,
  budgetVersion: 'discovery-work-budget:v1' as const,
  maxResources: 100,
  maxSemanticNeighbors: 100,
  maxCandidatePairs: 20,
  maxCandidateGroups: 20,
  maxFindings: 20,
  maxProviderCalls: 20,
  maxInputTokens: 100_000,
  maxOutputTokens: 100_000,
  maxOutputTokensPerCall: 1_000,
  maxEstimatedCostMicros: 100_000,
  maxConcurrentProviderCalls: 4,
  deadlineAt: '2099-01-01T00:00:00.000Z',
};

const emptySnapshot: DiscoveryRuntimeBudgetSnapshotV1 = {
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
};

const items = [
  {
    id: 'entity-a',
    type: 'ENTITY' as const,
    label: 'Alpha entity',
    state: 'CURRENT' as const,
    source: 'CANONICAL_CLAIM' as const,
    evidenceIds: ['evidence-a'],
    accessScope: ['project:read'],
    sensitivity: 'internal' as const,
  },
  {
    id: 'entity-b',
    type: 'ENTITY' as const,
    label: 'Beta entity',
    state: 'CURRENT' as const,
    source: 'CANONICAL_CLAIM' as const,
    evidenceIds: ['evidence-b'],
    accessScope: ['project:read'],
    sensitivity: 'internal' as const,
  },
  {
    id: 'entity-c',
    type: 'ENTITY' as const,
    label: 'Gamma entity without evidence',
    state: 'CURRENT' as const,
    source: 'CANONICAL_CLAIM' as const,
    evidenceIds: [],
    accessScope: ['project:read'],
    sensitivity: 'internal' as const,
  },
];

const projection: CompiledTruthProjection = {
  projectId,
  projectorVersion: 'compiled-truth:v1',
  sourceSnapshotDigest: 'projection-source:1',
  logicalDigest: 'projection-logical:1',
  canonicalVersion: 1,
  items,
  graph: {
    nodes: items,
    edges: [],
    fallback: { available: true, modes: ['LIST', 'TABLE'] },
  },
  projectedAt: '2026-08-30T00:00:00.000Z',
  buildMode: 'FULL_REBUILD',
};

const profile: DiscoveryModelProfileV1 = {
  schemaVersion: '1.0.0',
  profileId: 'product-wp4-profile',
  projectId,
  profileRevision: 1,
  aiConfigurationRevision: 1,
  providerId: 'fake-bounded-provider',
  modelId: 'fake-discovery-model',
  providerRegistryRevision: 'provider-registry:test-v1',
  modelCapabilityRevision: 'model-capability:test-v1',
  promptVersion: DISCOVERY_AI_PROMPT_VERSION_V1,
  outputSchemaVersion: DISCOVERY_AI_OUTPUT_SCHEMA_VERSION_V1,
  status: 'ACTIVE',
  createdBy: 'test-owner',
  createdAt: '2026-08-30T00:00:00.000Z',
  activatedAt: '2026-08-30T00:00:00.000Z',
};

const canonicalBase = {
  schemaVersion: '1.0.0' as const,
  canonicalVersion: 1,
  snapshotDigest: 'canonical:1',
};

const discoveryBase = {
  schemaVersion: '1.0.0' as const,
  projectionRevision: 'compiled-truth:v1:1',
  projectionDigest: projection.sourceSnapshotDigest,
};

const createProvider = (): DiscoveryStructuredProviderPort => {
  const generate = vi.fn(async (request: { readonly prompt: string }) => {
    const task = (JSON.parse(request.prompt) as { task: string }).task;
    const output =
      task === 'RELATION_HYPOTHESIS'
        ? { proposedRelationType: 'related-to', orientation: 'UNDIRECTED' }
        : task === 'PATTERN_HYPOTHESIS'
          ? {
              patternKind: 'CLUSTER',
              patternIdentity: 'bounded-entity-cluster',
              patternStatement: 'The bounded entities form a candidate cluster.',
            }
          : task === 'CONFLICT_HYPOTHESIS'
            ? { possibleContradiction: 'The typed propositions may contradict.' }
            : task === 'CLARIFICATION_QUESTION'
              ? {
                  question: 'Which approved context should be recorded?',
                  context: 'The server-qualified entity is isolated in the current projection.',
                  proposedNextStep: 'Confirm the missing context with the owner.',
                }
              : {
                  suggestedAction: 'Review this bounded candidate with an approver.',
                  rationale: 'The current evidence coverage needs an owner review.',
                };
    return {
      rawText: JSON.stringify(output),
      providerResponseId: `fake-response:${task}`,
      modelVersion: 'fake-discovery-model:v1',
      inputTokens: 10,
      outputTokens: 10,
      totalTokens: 20,
    };
  });
  return {
    identity: {
      provider: 'fake-bounded-provider',
      model: 'fake-discovery-model',
      adapterVersion: 'fake-provider:v1',
      dataPolicyVersion: 'fake-policy:v1',
      supportsOutputTokenLimit: true,
      supportsCancellation: true,
    },
    generateStructured: generate,
    generateStructuredWithSignal: generate,
  };
};

const createGenerationService = (ledger: DiscoveryWorkBudgetLedgerV1) => {
  const provider = createProvider();
  const profileService = {
    getActive: vi.fn(async () => profile),
  } as unknown as DiscoveryModelProfileServicePort;
  const executionResolver = {
    resolve: vi.fn(async () => ({
      pin: {
        projectId,
        profileId: profile.profileId,
        profileRevision: profile.profileRevision,
        providerId: profile.providerId,
        modelId: profile.modelId,
        modelCapabilityRevision: profile.modelCapabilityRevision,
        aiConfigurationRevision: profile.aiConfigurationRevision,
        credentialId: 'fake-credential',
        credentialRevision: 1,
        providerPolicyFingerprint: 'fake-provider-policy:v1',
        privacyPolicyRevision: 'fake-privacy:v1',
        dataPolicyRevision: 'fake-data:v1',
        promptVersion: profile.promptVersion,
        outputSchemaVersion: profile.outputSchemaVersion,
      },
      modelVersion: 'fake-discovery-model:v1',
    })),
  } as unknown as DiscoveryAIExecutionResolverPort;
  const providerRouter = {
    resolve: vi.fn(async () => provider),
  } as unknown as DiscoveryStructuredProviderRouterPort;
  return new DiscoveryAIGenerationService(
    profileService,
    executionResolver,
    providerRouter,
    new DiscoveryBudgetControllerV1(
      ledger,
      { revision: 'token-estimator:test-v1', estimateUpperBound: () => 100 },
      { revision: 'cost-estimator:test-v1', estimate: () => 1 },
    ),
  );
};

const createContext = (): DiscoveryExecutionContextV1 => {
  const claim = {
    projectId,
    jobId: 'product-wp4-job',
    runId: 'product-wp4-run',
    attemptId: 'product-wp4-attempt',
    workerId: 'product-wp4-worker',
    fencingToken: 1,
    acquiredAt: '2026-08-30T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    job: {
      strategyRevision: DISCOVERY_PRODUCT_STRATEGY_REVISION_V1,
      canonicalBase,
      requiredDiscoveryBase: discoveryBase,
      budget,
      trigger: { triggerClass: 'CANONICAL_COMMITTED' },
    },
  } as unknown as DiscoveryRuntimeClaimV1;
  return {
    claim,
    budgetSnapshot: emptySnapshot,
    checkpointRevision: 0,
    saveBudgetSnapshot: vi.fn(async () => 'SAVED' as const),
  };
};

const authorityBase = (context: {
  readonly sourceProjectionDigest: string;
  readonly canonicalBase: typeof canonicalBase;
  readonly discoveryBase: typeof discoveryBase;
}) => ({
  sourceProjectionDigest: context.sourceProjectionDigest,
  canonicalBase: context.canonicalBase,
  discoveryBase: context.discoveryBase,
  semanticGenerationId: 'semantic-generation:test-v1',
});

const resultFor = (resourceId: string): SemanticCandidateResult => ({
  semanticItemId: `semantic:${resourceId}`,
  projectId,
  generationId: 'semantic-generation:test-v1',
  resourceType: 'ENTITY',
  resourceId,
  sourceProjectionDigest: projection.sourceSnapshotDigest,
  canonicalVersion: 1,
  semanticTextDigest: `digest:${resourceId}`,
  embeddingProfileId: 'profile',
  embeddingProfileRevision: 1,
  representationVersion: 'representation:v1',
  distance: resourceId === 'entity-a' ? 0.1 : 0.2,
  dimension: 3,
  evidenceIds: [`evidence-${resourceId.slice(-1)}`],
  accessScope: ['project:read'],
  sensitivity: 'internal',
  indexedAt: '2026-08-30T00:00:00.000Z',
  createdAt: '2026-08-30T00:00:00.000Z',
  updatedAt: '2026-08-30T00:00:00.000Z',
});

describe('AKP-4 WP4 Product durable candidate path', () => {
  it('reaches WP1, qualified follow-ups, and typed-authority WP2 hypotheses before the real Quality Gate', async () => {
    const context = createContext();
    const input = {
      compiledTruthRepository: { findProjection: vi.fn(async () => projection) },
      findingRepository: {
        listByProject: vi.fn(async () => []),
        findLifecycle: vi.fn(async () => undefined),
      },
      runtimeRepository: {},
      resolveSecurity: vi.fn(async () => ({
        projectId,
        accessScope: ['project:read'],
        sensitivity: 'internal' as const,
      })),
      findAuthoritativeEquivalent: vi.fn(async () => false),
      evidenceRepository: {
        findById: vi.fn(async () => ({
          projectId,
          accessScope: ['project:read'],
          sensitivity: 'internal' as const,
        })),
      },
      semanticRetriever: {
        retrieve: vi.fn(async () => [resultFor('entity-a'), resultFor('entity-b')]),
      },
      createGenerationService: (ledger: DiscoveryWorkBudgetLedgerV1) =>
        createGenerationService(ledger),
      temporalCompatibility: {
        read: vi.fn(async ({ context: signalContext, resourceRefs }) => ({
          ...authorityBase(signalContext),
          compatibilities:
            resourceRefs.length < 2
              ? []
              : [
                  {
                    left: resourceRefs[0]!,
                    right: resourceRefs[1]!,
                    compatible: true,
                    temporalEvidenceId: 'temporal-authority:test-v1',
                  },
                ],
          completeness: 'COMPLETE' as const,
        })),
      } satisfies DiscoveryTemporalCompatibilityPortV1,
      competingResource: {
        read: vi.fn(async ({ context: signalContext, resourceRefs }) => ({
          ...authorityBase(signalContext),
          competitions: resourceRefs.flatMap((left: DiscoveryResourceRefV1, index: number) =>
            resourceRefs.slice(index + 1).map((right: DiscoveryResourceRefV1) => ({
              left,
              right,
              kind: 'FACTUAL' as const,
              source: 'TYPED_PROPOSITION' as const,
              signalId: `conflict-authority:${left.resourceId}:${right.resourceId}`,
            })),
          ),
          completeness: 'COMPLETE' as const,
        })),
      } satisfies DiscoveryCompetingResourcePortV1,
      existingCanonicalConflict: {
        read: vi.fn(async ({ context: signalContext }) => ({
          ...authorityBase(signalContext),
          conflicts: [],
          completeness: 'COMPLETE' as const,
        })),
      } satisfies DiscoveryExistingCanonicalConflictPortV1,
      observeReconciliation: vi.fn(),
    } as unknown as DiscoveryProductExecutionDependenciesV1;
    const execution = createProductDiscoveryExecution(input);
    const generated = await execution.generateFindings(context, undefined);
    const durable = generated.value as DiscoveryRuntimeGeneratedFindingsStageValueV1;
    const afterRestart = JSON.parse(
      JSON.stringify(durable),
    ) as DiscoveryRuntimeGeneratedFindingsStageValueV1;
    const findings = afterRestart.candidates.map((candidate) => candidate.finding);
    const proofByFindingId = Object.fromEntries(
      afterRestart.candidates.flatMap((candidate) =>
        candidate.proof === undefined ? [] : [[candidate.finding.findingId, candidate.proof]],
      ),
    );

    expect(new Set(findings.map((finding) => finding.findingType))).toEqual(
      new Set([
        'KNOWLEDGE_GAP',
        'EVIDENCE_GAP',
        'CLARIFICATION_QUESTION',
        'ACTION_SUGGESTION',
        'RELATION_HYPOTHESIS',
        'PATTERN_HYPOTHESIS',
        'CONFLICT_HYPOTHESIS',
      ]),
    );
    expect(
      findings
        .filter(
          (finding) =>
            finding.findingType === 'CLARIFICATION_QUESTION' ||
            finding.findingType === 'ACTION_SUGGESTION',
        )
        .every((finding) => proofByFindingId[finding.findingId]?.qualifiedFollowUp !== undefined),
    ).toBe(true);
    expect(
      findings
        .filter((finding) => finding.findingType === 'CONFLICT_HYPOTHESIS')
        .every((finding) => proofByFindingId[finding.findingId]?.selectionSignals?.length === 1),
    ).toBe(true);
    for (const finding of findings.filter(
      (entry) =>
        entry.findingType === 'RELATION_HYPOTHESIS' ||
        entry.findingType === 'PATTERN_HYPOTHESIS' ||
        entry.findingType === 'CONFLICT_HYPOTHESIS',
    )) {
      const semanticEssence = deriveDiscoverySemanticEssenceV1({
        findingType: finding.findingType,
        payload: finding.payload,
      });
      expect(
        computeDiscoveryFingerprintV1({
          findingType: finding.findingType,
          relatedResourceRefs: finding.relatedResourceRefs,
          semanticEssence,
        }).fingerprint,
      ).toBe(finding.fingerprint);
    }

    const quality = await execution.qualityGate(context, findings, proofByFindingId);
    expect(quality.completion).toBe('COMPLETE');
    expect(quality.value.map((finding) => finding.findingType)).toEqual(
      expect.arrayContaining([
        'KNOWLEDGE_GAP',
        'EVIDENCE_GAP',
        'CLARIFICATION_QUESTION',
        'ACTION_SUGGESTION',
        'RELATION_HYPOTHESIS',
        'PATTERN_HYPOTHESIS',
        'CONFLICT_HYPOTHESIS',
      ]),
    );
  });

  it('returns PARTIAL with a durable cursor and resumes reconciliation to completion', async () => {
    const context = createContext();
    const findings = [
      { projectId, findingId: 'reconcile-1', findingRevision: 1 },
      { projectId, findingId: 'reconcile-2', findingRevision: 1 },
    ] as unknown as readonly DiscoveryFindingEnvelopeV1[];
    let stageOutput:
      | {
          readonly stageType: 'RECONCILE_FINDINGS';
          readonly output: unknown;
          readonly stageRevision: number;
        }
      | undefined;
    const input = {
      compiledTruthRepository: { findProjection: vi.fn(async () => projection) },
      findingRepository: {
        listByProject: vi.fn(async () => findings),
        findLifecycle: vi.fn(async () => undefined),
      },
      runtimeRepository: {
        readStageOutput: vi.fn(async () => stageOutput),
        writeStageOutput: vi.fn(async ({ output }: { readonly output: typeof stageOutput }) => {
          stageOutput = output;
          return 'SAVED' as const;
        }),
      },
      resolveSecurity: vi.fn(async () => ({
        projectId,
        accessScope: ['project:read'],
        sensitivity: 'internal' as const,
      })),
      findAuthoritativeEquivalent: vi.fn(async () => false),
      evidenceRepository: { findById: vi.fn(async () => undefined) },
      semanticRetriever: { retrieve: vi.fn(async () => []) },
      observeReconciliation: vi.fn(async () => 'UNCHANGED' as const),
    } as unknown as DiscoveryProductExecutionDependenciesV1;
    const execution = createProductDiscoveryExecution(input);
    const stage = {
      stageId: 'reconcile-stage',
      stageRevision: 1,
      stageType: 'RECONCILE_FINDINGS' as const,
    };
    const limitedClaim = {
      ...context.claim,
      fencingToken: 1,
      job: { ...context.claim.job, budget: { ...context.claim.job.budget, maxResources: 2 } },
    };
    const first = await execution.reconcileFindings!({
      ...context,
      claim: limitedClaim,
      stage,
    });
    expect(first?.completion).toBe('PARTIAL');
    expect(first?.retryStage).toBe(true);
    expect(first?.budgetSnapshot?.resources).toBe(1);
    expect(stageOutput?.output).toMatchObject({
      completed: false,
      processed: 1,
      cursor: { findingId: 'reconcile-1', findingRevision: 1 },
    });

    const second = await execution.reconcileFindings!({
      ...context,
      budgetSnapshot: first!.budgetSnapshot!,
      claim: { ...limitedClaim, fencingToken: 2 },
      stage,
    });
    expect(second?.completion).toBeUndefined();
    expect(second?.retryStage).toBeUndefined();
    expect(second?.budgetSnapshot?.resources).toBe(2);
    expect(stageOutput?.output).toMatchObject({ completed: true, processed: 2 });
  });
});
