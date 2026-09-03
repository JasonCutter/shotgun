import { describe, expect, it } from 'vitest';

import { knowledgeCandidateDigest } from '../../packages/contracts/src/index.js';
import {
  DISCOVERY_AI_OUTPUT_SCHEMA_VERSION_V1,
  DISCOVERY_AI_PROMPT_VERSION_V1,
  DiscoveryAIGenerationService,
} from '../../modules/discovery-ai-generation/src/index.js';
import {
  DISCOVERY_PRODUCT_STRATEGY_REVISION_V1,
  createProductDiscoveryExecution,
} from '../../adapters/discovery-runtime-product/src/index.js';
import { InMemoryDiscoveryRuntimeRepository } from '../../adapters/discovery-trigger-coordinator/src/index.js';
import { createTypedPropositionConflictDiscoveryPort } from '../../assemblies/shotgun-app/src/application.js';
import { InMemoryKnowledgeModelRepository } from '../../adapters/stage9-in-memory/src/index.js';
import {
  InMemoryTypedPropositionConflictAssertionRepository,
  InMemoryTypedPropositionConflictRuleRepository,
  TypedPropositionConflictRuleService,
} from '../../modules/knowledge-model/src/index.js';
import type {
  DiscoveryCanonicalCommittedEventEnvelopeV1,
  DiscoveryAIExecutionResolverPort,
  DiscoveryModelProfileServicePort,
  DiscoveryStructuredProviderPort,
  DiscoveryStructuredProviderRouterPort,
  SemanticCandidateResult,
  CompiledTruthProjection,
  KnowledgeReviewGroup,
  RelationCandidate,
} from '../../packages/contracts/src/index.js';
import {
  aggregateDiscoveryProjectionReadinessV1,
  createDefaultDiscoveryTriggerPolicyV1,
  DiscoveryTriggerCoordinator,
  StaticDiscoveryTriggerPolicy,
} from '../../modules/discovery-trigger-coordinator/src/index.js';
import type {
  DiscoveryCompetingResourcePortV1,
  DiscoveryTemporalCompatibilityPortV1,
} from '../../modules/discovery-finding-fingerprint/src/index.js';
import type {
  DiscoveryRuntimeClaimV1,
  DiscoveryRuntimeGeneratedFindingsStageValueV1,
  DiscoveryRuntimeBudgetSnapshotV1,
} from '../../modules/discovery-runtime/src/index.js';
import type { DiscoveryExecutionContextV1 } from '../../modules/discovery-runtime/src/worker.js';
import { DiscoveryBudgetControllerV1 } from '../../modules/discovery-quality-gate/src/index.js';

const projectId = 'akp-8-wp2-cross-section-contract';
const sourceProjectionDigest = 'sha256:akp8-wp2-contract-projection';

const canonicalBase = {
  schemaVersion: '1.0.0' as const,
  canonicalVersion: 7,
  snapshotDigest: 'sha256:akp8-wp2-contract-canonical',
};

const discoveryBase = {
  schemaVersion: '1.0.0' as const,
  projectionRevision: 'compiled-truth:v1:7',
  projectionDigest: sourceProjectionDigest,
};

const canonicalCommittedEnvelope = (
  overrides: Partial<DiscoveryCanonicalCommittedEventEnvelopeV1> = {},
): DiscoveryCanonicalCommittedEventEnvelopeV1 => ({
  messageId: 'delivery-p-1',
  messageType: 'CanonicalCommitted',
  messageKind: 'event',
  schemaVersion: '1.0.0',
  producerModule: 'stage6.canonical-knowledge',
  producerVersion: '1.0.0',
  correlationId: 'correlation-p',
  projectId,
  actor: { type: 'service', id: 'canonical' },
  security: { accessScope: ['owner'], sensitivity: 'private', dataClassification: 'canonical' },
  payload: {
    commitId: 'commit-p-1',
    manifestId: 'manifest-p-1',
    changeSetId: 'changeset-p-1',
    operation: 'ADD_CLAIM',
    status: 'COMMITTED',
    canonicalVersion: 7,
    snapshotDigest: canonicalBase.snapshotDigest,
    actorId: 'owner',
    accessScope: ['owner'],
    sensitivity: 'private',
  },
  createdAt: '2026-09-01T00:00:00.000Z',
  traceId: 'trace-p',
  idempotencyKey: 'canonical-outbox:commit-p-1',
  ...overrides,
});

const relationCandidates: readonly RelationCandidate[] = [
  {
    candidateId: 'relation-supports',
    candidateType: 'RELATION',
    revisionNumber: 1,
    sourceVersionId: 'source:contract',
    evidenceIds: ['evidence-a'],
    modelOutputs: [],
    fromCandidateId: 'entity-a',
    toCandidateId: 'entity-b',
    relationType: 'supports',
    direction: 'DIRECTED',
  },
  {
    candidateId: 'relation-contradicts',
    candidateType: 'RELATION',
    revisionNumber: 1,
    sourceVersionId: 'source:contract',
    evidenceIds: ['evidence-b'],
    modelOutputs: [],
    fromCandidateId: 'entity-a',
    toCandidateId: 'entity-b',
    relationType: 'contradicts',
    direction: 'DIRECTED',
  },
];

const items = [
  {
    id: 'entity-a',
    type: 'ENTITY' as const,
    label: 'Alpha service',
    state: 'CURRENT' as const,
    source: 'APPROVED_KNOWLEDGE' as const,
    revisionNumber: 1,
    evidenceIds: ['evidence-a'],
    accessScope: ['owner'],
    sensitivity: 'private' as const,
  },
  {
    id: 'entity-b',
    type: 'ENTITY' as const,
    label: 'Beta database',
    state: 'CURRENT' as const,
    source: 'APPROVED_KNOWLEDGE' as const,
    revisionNumber: 1,
    evidenceIds: ['evidence-b'],
    accessScope: ['owner'],
    sensitivity: 'private' as const,
  },
  ...relationCandidates.map((relation) => ({
    id: relation.candidateId,
    type: 'RELATION' as const,
    label: `${relation.fromCandidateId} ${relation.relationType} ${relation.toCandidateId}`,
    state: 'CURRENT' as const,
    source: 'APPROVED_KNOWLEDGE' as const,
    revisionNumber: relation.revisionNumber,
    evidenceIds: relation.evidenceIds,
    accessScope: ['owner'],
    sensitivity: 'private' as const,
  })),
];

const projection: CompiledTruthProjection = {
  projectId,
  projectorVersion: 'compiled-truth:v1',
  sourceSnapshotDigest: sourceProjectionDigest,
  logicalDigest: 'sha256:akp8-wp2-contract-logical',
  canonicalVersion: canonicalBase.canonicalVersion,
  items,
  graph: {
    nodes: items,
    edges: [],
    fallback: { available: true, modes: ['LIST', 'TABLE'] },
  },
  projectedAt: '2026-09-01T00:00:00.000Z',
  buildMode: 'FULL_REBUILD',
};

const budget = {
  schemaVersion: '1.0.0' as const,
  budgetVersion: 'discovery-work-budget:v1' as const,
  maxResources: 20,
  maxSemanticNeighbors: 20,
  maxCandidatePairs: 10,
  maxCandidateGroups: 10,
  maxFindings: 20,
  maxProviderCalls: 20,
  maxInputTokens: 100_000,
  maxOutputTokens: 100_000,
  maxOutputTokensPerCall: 1_000,
  maxEstimatedCostMicros: 100_000,
  maxConcurrentProviderCalls: 2,
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

const semanticResult = (resourceId: string): SemanticCandidateResult => ({
  semanticItemId: `semantic:${resourceId}`,
  projectId,
  generationId: 'semantic-generation:akp8-wp2-contract',
  resourceType: resourceId.startsWith('relation-') ? 'RELATION' : 'ENTITY',
  resourceId,
  sourceProjectionDigest,
  canonicalVersion: canonicalBase.canonicalVersion,
  semanticTextDigest: `sha256:text:${resourceId}`,
  embeddingProfileId: 'profile:contract',
  embeddingProfileRevision: 1,
  representationVersion: 'semantic-representation:v2',
  distance: resourceId === 'entity-a' ? 0.05 : 0.08,
  dimension: 512,
  evidenceIds: [`evidence-${resourceId.slice(-1)}`],
  accessScope: ['owner'],
  sensitivity: 'private',
  indexedAt: '2026-09-01T00:00:00.000Z',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
});

const provider: DiscoveryStructuredProviderPort = {
  identity: {
    provider: 'contract-external-ai-double',
    model: 'contract-discovery-model',
    adapterVersion: 'contract-provider:v1',
    dataPolicyVersion: 'contract-policy:v1',
    supportsOutputTokenLimit: true,
    supportsCancellation: true,
  },
  async generateStructured(request) {
    const task = (JSON.parse(request.prompt) as { readonly task: string }).task;
    const output =
      task === 'RELATION_HYPOTHESIS'
        ? { proposedRelationType: 'related-to', orientation: 'UNDIRECTED' }
        : task === 'PATTERN_HYPOTHESIS'
          ? {
              patternKind: 'CLUSTER',
              patternIdentity: 'akp8-bounded-cluster',
              patternStatement: 'The approved resources form a bounded candidate cluster.',
            }
          : task === 'CONFLICT_HYPOTHESIS'
            ? { possibleContradiction: 'The typed propositions may be incompatible.' }
            : task === 'CLARIFICATION_QUESTION'
              ? {
                  question: 'Are these approved resources intended to be related?',
                  context: 'The bounded discovery candidate links two approved resources.',
                  proposedNextStep: 'Review the candidate and confirm the intended relation.',
                }
              : {
                  suggestedAction: 'Review the bounded candidate with an approver.',
                  rationale: 'The candidate remains derived until Canonical approval.',
                  riskContext: 'No side effect is authorized by this candidate.',
                };
    return {
      rawText: JSON.stringify(output),
      providerResponseId: `contract-response:${task}`,
      modelVersion: 'contract-discovery-model:v1',
      inputTokens: 10,
      outputTokens: 10,
      totalTokens: 20,
    };
  },
  async generateStructuredWithSignal(request) {
    return this.generateStructured(request);
  },
};

const profileService = {
  getActive: async () => ({
    schemaVersion: '1.0.0' as const,
    profileId: 'profile:contract',
    projectId,
    profileRevision: 1,
    aiConfigurationRevision: 1,
    providerId: 'contract-external-ai-double',
    modelId: 'contract-discovery-model',
    providerRegistryRevision: 'provider-registry:contract-v1',
    modelCapabilityRevision: 'model-capability:contract-v1',
    promptVersion: DISCOVERY_AI_PROMPT_VERSION_V1,
    outputSchemaVersion: DISCOVERY_AI_OUTPUT_SCHEMA_VERSION_V1,
    status: 'ACTIVE' as const,
    createdBy: 'contract-owner',
    createdAt: '2026-09-01T00:00:00.000Z',
    activatedAt: '2026-09-01T00:00:00.000Z',
  }),
} as unknown as DiscoveryModelProfileServicePort;

const createGenerationService = (
  ledger: ConstructorParameters<typeof DiscoveryBudgetControllerV1>[0],
) =>
  new DiscoveryAIGenerationService(
    profileService,
    {
      resolve: async () => ({
        pin: {
          projectId,
          profileId: 'profile:contract',
          profileRevision: 1,
          providerId: 'contract-external-ai-double',
          modelId: 'contract-discovery-model',
          modelCapabilityRevision: 'model-capability:contract-v1',
          aiConfigurationRevision: 1,
          credentialId: 'credential:contract',
          credentialRevision: 1,
          providerPolicyFingerprint: 'sha256:contract-policy',
          privacyPolicyRevision: 'privacy-policy:contract-v1',
          dataPolicyRevision: 'contract-policy:v1',
          promptVersion: DISCOVERY_AI_PROMPT_VERSION_V1,
          outputSchemaVersion: DISCOVERY_AI_OUTPUT_SCHEMA_VERSION_V1,
        },
        modelVersion: 'contract-discovery-model:v1',
      }),
    } as unknown as DiscoveryAIExecutionResolverPort,
    { resolve: async () => provider } as unknown as DiscoveryStructuredProviderRouterPort,
    new DiscoveryBudgetControllerV1(
      ledger,
      { revision: 'contract-token-estimator:v1', estimateUpperBound: () => 100 },
      { revision: 'contract-cost-estimator:v1', estimate: () => 1 },
    ),
  );

const context = (): DiscoveryExecutionContextV1 => ({
  claim: {
    projectId,
    jobId: 'job:akp8-wp2-contract',
    runId: 'run:akp8-wp2-contract',
    attemptId: 'attempt:akp8-wp2-contract',
    workerId: 'worker:akp8-wp2-contract',
    fencingToken: 1,
    acquiredAt: '2026-09-01T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    job: {
      strategyRevision: DISCOVERY_PRODUCT_STRATEGY_REVISION_V1,
      canonicalBase,
      requiredDiscoveryBase: discoveryBase,
      budget,
      trigger: { triggerClass: 'CANONICAL_COMMITTED' },
    },
  } as unknown as DiscoveryRuntimeClaimV1,
  signal: new AbortController().signal,
  budgetSnapshot: emptySnapshot,
  checkpointRevision: 0,
  saveBudgetSnapshot: async () => 'SAVED',
});

const execute = async (withConflict: boolean) => {
  const temporalCompatibility: DiscoveryTemporalCompatibilityPortV1 = {
    read: async (input) => ({
      sourceProjectionDigest: input.context.sourceProjectionDigest,
      canonicalBase: input.context.canonicalBase,
      discoveryBase: input.context.discoveryBase,
      semanticGenerationId: 'semantic-generation:akp8-wp2-contract',
      compatibilities:
        input.resourceRefs.length < 2
          ? []
          : [
              {
                left: input.resourceRefs[0]!,
                right: input.resourceRefs[1]!,
                compatible: true,
                temporalEvidenceId: 'temporal-authority:contract',
              },
            ],
      completeness: 'COMPLETE',
    }),
  };
  let competingResource: DiscoveryCompetingResourcePortV1 | undefined;
  if (withConflict) {
    const ruleRepository = new InMemoryTypedPropositionConflictRuleRepository();
    const assertionRepository = new InMemoryTypedPropositionConflictAssertionRepository();
    const knowledgeModelRepository = new InMemoryKnowledgeModelRepository();
    for (const relation of relationCandidates) {
      const group: KnowledgeReviewGroup = {
        groupId: `group:${relation.candidateId}`,
        projectId,
        sourceVersionId: relation.sourceVersionId,
        revisionNumber: 1,
        status: 'APPROVED',
        contentDigest: knowledgeCandidateDigest([relation]),
        items: [relation],
        decisions: [],
        accessScope: ['owner'],
        sensitivity: 'private',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      };
      await knowledgeModelRepository.saveGroup(group);
    }
    await new TypedPropositionConflictRuleService(ruleRepository).execute({
      projectId,
      actorId: 'contract-owner',
      payload: {
        operation: 'CREATE',
        leftRelationType: 'supports',
        rightRelationType: 'contradicts',
        directionSemantics: 'DIRECTED_SAME_ORIENTATION',
      },
      now: '2026-09-01T00:00:00.000Z',
    });
    competingResource = createTypedPropositionConflictDiscoveryPort({
      ruleRepository,
      assertionRepository,
      knowledgeModelRepository,
    });
  }

  const execution = createProductDiscoveryExecution({
    compiledTruthRepository: { findProjection: async () => projection },
    findingRepository: {
      listByProject: async () => [],
      findLifecycle: async () => undefined,
    } as never,
    runtimeRepository: {} as never,
    resolveSecurity: async () => ({ projectId, accessScope: ['owner'], sensitivity: 'private' }),
    findAuthoritativeEquivalent: async () => false,
    evidenceRepository: {
      findById: async (_projectId: string, evidenceId: string) => ({
        evidenceId,
        revisionId: 'revision:contract',
        projectId,
        sourceId: 'source:contract',
        sourceVersionId: 'source-version:contract',
        pointer: '/text',
        nodeKind: 'paragraph',
        origin: 'source',
        position: { type: 'TextPositionSelector', start: 0, end: 10, unit: 'unicode-code-point' },
        quote: { type: 'TextQuoteSelector', exact: 'approved evidence' },
        exactHash: 'sha256:contract-evidence',
        accessScope: ['owner'],
        sensitivity: 'private',
        createdAt: '2026-09-01T00:00:00.000Z',
      }),
    },
    semanticRetriever: {
      retrieve: async () =>
        withConflict
          ? [semanticResult('relation-supports'), semanticResult('relation-contradicts')]
          : [semanticResult('entity-a'), semanticResult('entity-b')],
    },
    temporalCompatibility,
    ...(competingResource === undefined ? {} : { competingResource }),
    createGenerationService: (workBudget) => createGenerationService(workBudget),
    observeReconciliation: async () => 'UNCHANGED',
  });
  const currentContext = context();
  const generated = await execution.generateFindings(currentContext, undefined);
  const durable = generated.value as DiscoveryRuntimeGeneratedFindingsStageValueV1;
  const qualityInputs = Object.fromEntries(
    durable.candidates.flatMap((candidate) =>
      candidate.proof === undefined ? [] : [[candidate.finding.findingId, candidate.proof]],
    ),
  );
  const quality = await execution.qualityGate(
    currentContext,
    durable.candidates.map((candidate) => candidate.finding),
    qualityInputs,
  );
  return quality.value;
};

describe('AKP-8 WP2 cross-section causal acceptance contracts', () => {
  it('E2E-A slice: Canonical-bound derived relation remains Review/Draft input, not Canonical', async () => {
    const findings = await execute(false);
    const relation = findings.find((finding) => finding.findingType === 'RELATION_HYPOTHESIS');
    expect(relation).toBeDefined();
    expect(relation?.canonicalBase).toEqual(canonicalBase);
    expect(relation?.discoveryBase).toEqual(discoveryBase);
    expect(relation?.provenance.kind).toBe('HYBRID');
    expect(relation?.payload.payloadType).toBe('RELATION_HYPOTHESIS');
  });

  it('E2E-M slice: typed conflict authority produces a derived conflict hypothesis', async () => {
    const findings = await execute(true);
    const conflict = findings.find((finding) => finding.findingType === 'CONFLICT_HYPOTHESIS');
    expect(conflict).toBeDefined();
    expect(conflict?.canonicalBase).toEqual(canonicalBase);
    expect(conflict?.provenance.kind).toBe('HYBRID');
    expect(conflict?.payload.payloadType).toBe('CONFLICT_HYPOTHESIS');
    expect(conflict?.relatedResourceRefs).toHaveLength(2);
  });

  it('E2E-P slice: projection wait reaches typed deadline disposition before a later Canonical event', async () => {
    let now = '2026-09-01T00:00:00.000Z';
    let projectionState: 'UNAVAILABLE' | 'READY' = 'UNAVAILABLE';
    let nextJobNumber = 0;
    const runtime = new InMemoryDiscoveryRuntimeRepository();
    const source = {
      resolve: async (event: DiscoveryCanonicalCommittedEventEnvelopeV1) => ({
        projectId,
        eventIdentity: {
          eventId: event.payload.commitId,
          eventRevision: String(event.payload.canonicalVersion),
        },
        canonicalBase: {
          schemaVersion: '1.0.0' as const,
          canonicalVersion: event.payload.canonicalVersion,
          snapshotDigest: event.payload.snapshotDigest,
        },
        requiredDiscoveryBase: discoveryBase,
        createdAt: event.createdAt,
      }),
    };
    const coordinator = new DiscoveryTriggerCoordinator(
      source,
      {
        read: async (input) =>
          aggregateDiscoveryProjectionReadinessV1({
            requiredBase: input.requiredBase,
            observedAt: now,
            observations: input.projectionKinds.map((projectionKind) => ({
              projectionKind,
              requiredIdentity: input.requiredBase,
              status: projectionState,
            })),
          }),
      },
      runtime,
      new StaticDiscoveryTriggerPolicy({
        ...createDefaultDiscoveryTriggerPolicyV1(),
        waitTimeoutMs: 60_000,
      }),
      { now: () => now },
      { jobId: () => `job:akp8-wp2-p-${++nextJobNumber}` },
    );
    const first = await coordinator.coordinateCanonicalCommitted(
      canonicalCommittedEnvelope({
        payload: {
          ...canonicalCommittedEnvelope().payload,
          commitId: 'commit-p-1',
          canonicalVersion: 8,
        },
        idempotencyKey: 'canonical-outbox:commit-p-1',
      }),
    );
    expect(first.lifecycleState).toBe('WAITING_FOR_PROJECTION');
    now = '2026-09-01T00:01:00.000Z';
    const expired = await coordinator.reEvaluateCanonicalDiscoveryProjectionReadiness({
      projectId,
      jobId: first.jobId,
    });
    expect(expired).toMatchObject({
      disposition: 'FAILED_RETRYABLE',
      job: { lifecycleState: 'FAILED_RETRYABLE' },
    });
    projectionState = 'READY';
    const later = await coordinator.coordinateCanonicalCommitted(
      canonicalCommittedEnvelope({
        messageId: 'delivery-p-2',
        payload: {
          ...canonicalCommittedEnvelope().payload,
          commitId: 'commit-p-2',
          canonicalVersion: 9,
        },
        idempotencyKey: 'canonical-outbox:commit-p-2',
      }),
    );
    expect(later.disposition).toBe('CREATED');
    expect(later.lifecycleState).toBe('QUEUED');
    expect((await runtime.findJob({ projectId, jobId: first.jobId }))?.lifecycleState).toBe(
      'FAILED_RETRYABLE',
    );
  });
});
