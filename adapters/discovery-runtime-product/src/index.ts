import {
  computeDiscoveryFingerprintV1,
  createDiscoveryFindingEnvelopeV1,
  deriveAuthorizedSensitivities,
  sha256Text,
  semanticStableJson,
  utf16OrdinalCompare,
} from '../../../packages/contracts/src/index.js';
import type {
  CompiledTruthProjection,
  DiscoveryCanonicalBaseIdentityV1,
  DiscoveryFindingEnvelopeV1,
  DiscoveryProjectionBaseIdentityV1,
  DiscoveryResourceKind,
  DiscoveryResourceRefV1,
  DiscoveryServerSecurityInputV1,
  DiscoveryQualifiedAIGenerationContextV1,
  SemanticRetrieverPort,
} from '../../../packages/contracts/src/index.js';
import {
  createDiscoveryEngine,
  createDiscoverySignalFacade,
  createWp1DiscoveryStrategyRegistry,
  createDiscoveryNeighborhoodSignalFacade,
  createWp2DiscoveryNeighborhoodStrategyRegistry,
  selectDiscoveryNeighborhood,
  type DiscoveryEngineV1,
  type DiscoverySignalReadContextV1,
  type DiscoverySignalResourceV1,
} from '../../../modules/discovery-finding-fingerprint/src/index.js';
import type {
  DiscoveryAIGenerationService,
  DiscoveryHypothesisCandidateV1,
} from '../../../modules/discovery-ai-generation/src/index.js';
import {
  DiscoveryQualityGateV1,
  DiscoveryWorkBudgetLedgerV1,
  type DiscoveryQualityGateContextV1,
  type DiscoveryWorkBudgetV1,
} from '../../../modules/discovery-quality-gate/src/index.js';
import type { CompiledTruthRepositoryPort } from '../../../modules/compiled-truth/src/index.js';
import type { EvidenceRepositoryPort } from '../../../modules/evidence/src/index.js';
import type {
  DiscoveryFindingPageCursorV1,
  DiscoveryFindingRepositoryPort,
} from '../../../modules/discovery-finding-persistence/src/index.js';
import {
  DiscoveryFindingLifecycleService,
  type DiscoveryFindingLifecycleRepositoryPort,
  type DiscoveryReconciliationDispositionV1,
} from '../../../modules/discovery-finding-lifecycle/src/index.js';
import type {
  DiscoveryExecutionContextV1,
  DiscoveryExecutionPortV1,
  DiscoveryExecutionStageResultV1,
} from '../../../modules/discovery-runtime/src/worker.js';
import type { DiscoveryRuntimeExecutionRepositoryPort } from '../../../modules/discovery-runtime/src/index.js';

type ProductFindingRepository = DiscoveryFindingRepositoryPort &
  DiscoveryFindingLifecycleRepositoryPort;

export const DISCOVERY_PRODUCT_STRATEGY_REVISION_V1 = 'discovery-trigger-strategy:v1' as const;

const sensitivityRank = {
  public: 0,
  internal: 1,
  private: 2,
  restricted: 3,
} as const;

export type DiscoveryProductExecutionDependenciesV1 = {
  readonly compiledTruthRepository: Pick<CompiledTruthRepositoryPort, 'findProjection'>;
  readonly findingRepository: ProductFindingRepository;
  readonly runtimeRepository: DiscoveryRuntimeExecutionRepositoryPort;
  /** Server-owned security context. No browser/request value is accepted. */
  readonly resolveSecurity: (input: {
    readonly projectId: string;
    readonly projection: CompiledTruthProjection;
  }) => Promise<DiscoveryServerSecurityInputV1 | undefined>;
  /** Server-owned authoritative-equivalence lookup. */
  readonly findAuthoritativeEquivalent: (input: {
    readonly projectId: string;
    readonly candidate: DiscoveryFindingEnvelopeV1;
  }) => Promise<boolean>;
  readonly evidenceRepository: Pick<EvidenceRepositoryPort, 'findById'>;
  /** Accepted AKP-1 semantic authority; no projection-array rank fallback. */
  readonly semanticRetriever: SemanticRetrieverPort;
  /** Factory keeps the hydrated durable budget attached to the AI controller. */
  readonly createGenerationService: (
    budget: DiscoveryWorkBudgetLedgerV1,
    context: DiscoveryExecutionContextV1,
  ) => DiscoveryAIGenerationService;
  /** Server-owned observation of the current Canonical/Source state. */
  readonly observeReconciliation: (input: {
    readonly finding: DiscoveryFindingEnvelopeV1;
    readonly projection: CompiledTruthProjection;
    readonly canonicalBase: DiscoveryCanonicalBaseIdentityV1;
  }) => Promise<DiscoveryReconciliationDispositionV1>;
};

type ProductSignalsV1 = {
  readonly projection: CompiledTruthProjection;
  readonly signalContext: DiscoverySignalReadContextV1;
  readonly budget: DiscoveryWorkBudgetLedgerV1;
};

const resourceKindFor = (
  type: CompiledTruthProjection['items'][number]['type'],
): DiscoveryResourceKind => {
  switch (type) {
    case 'CLAIM':
      return 'CANONICAL_CLAIM';
    case 'ENTITY':
      return 'CANONICAL_ENTITY';
    case 'EVENT':
      return 'CANONICAL_EVENT';
    case 'RELATION':
      return 'CANONICAL_RELATION';
    case 'DECISION':
      return 'CANONICAL_DECISION';
    case 'CONFLICT':
      return 'CANONICAL_CONFLICT';
    default:
      return 'COMPILED_TRUTH_ITEM';
  }
};

const resourceFor = (
  projectId: string,
  item: CompiledTruthProjection['items'][number],
): DiscoverySignalResourceV1 => ({
  resource: {
    schemaVersion: '1.0.0',
    resourceKind: resourceKindFor(item.type),
    resourceId: item.id,
    projectId,
    resourceState: item.source === 'APPROVED_KNOWLEDGE' ? 'APPROVED' : 'CURRENT',
  },
  label: item.label,
  evidenceIds: item.evidenceIds,
  security: {
    projectId,
    accessScope: item.accessScope,
    sensitivity: item.sensitivity,
  },
});

const resourcesFor = (
  projectId: string,
  projection: CompiledTruthProjection,
): readonly DiscoverySignalResourceV1[] =>
  projection.items.map((item) => resourceFor(projectId, item));

const projectionBaseFor = (
  jobBase: DiscoveryProjectionBaseIdentityV1 | undefined,
  projection: CompiledTruthProjection,
): DiscoveryProjectionBaseIdentityV1 =>
  jobBase ?? {
    schemaVersion: '1.0.0',
    projectionRevision: `compiled-truth:${projection.projectorVersion}:${projection.canonicalVersion}`,
    projectionDigest: projection.sourceSnapshotDigest,
  };

const resourceKey = (resource: DiscoveryResourceRefV1): string =>
  [
    resource.projectId,
    resource.resourceKind,
    resource.resourceId,
    resource.resourceState,
    resource.resourceRevision ?? '',
  ].join('\u0000');

const gapEssence = (finding: DiscoveryFindingEnvelopeV1): string | undefined => {
  if (finding.findingType === 'KNOWLEDGE_GAP') {
    return finding.relatedResourceRefs.length === 1
      ? `isolated-entity:${resourceKey(finding.relatedResourceRefs[0]!)}`
      : undefined;
  }
  if (finding.findingType === 'EVIDENCE_GAP') {
    return finding.relatedResourceRefs.length === 1
      ? `absent-evidence:${resourceKey(finding.relatedResourceRefs[0]!)}`
      : undefined;
  }
  return undefined;
};

const deterministicFindingId = (input: {
  readonly runId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly candidateIndex: number;
  readonly fingerprint: string;
}): string =>
  `discovery-finding:${sha256Text(
    semanticStableJson({ schemaVersion: 'discovery-finding-id:v1', ...input }),
  )}`;

type DiscoveryReconciliationProgressV1 = {
  readonly schemaVersion: '1.0.0';
  readonly completed: boolean;
  readonly processed: number;
  readonly cursor?: DiscoveryFindingPageCursorV1;
};

const decodeReconciliationProgress = (value: unknown): DiscoveryReconciliationProgressV1 => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Discovery reconciliation progress is invalid.');
  }
  const record = value as Record<string, unknown>;
  const cursorValue = record.cursor;
  let cursor: DiscoveryFindingPageCursorV1 | undefined;
  if (cursorValue !== undefined) {
    if (typeof cursorValue !== 'object' || cursorValue === null || Array.isArray(cursorValue)) {
      throw new Error('Discovery reconciliation cursor is invalid.');
    }
    const cursorRecord = cursorValue as Record<string, unknown>;
    if (
      typeof cursorRecord.findingId !== 'string' ||
      typeof cursorRecord.findingRevision !== 'number' ||
      !Number.isSafeInteger(cursorRecord.findingRevision) ||
      cursorRecord.findingRevision < 1
    ) {
      throw new Error('Discovery reconciliation cursor is invalid.');
    }
    cursor = {
      findingId: cursorRecord.findingId,
      findingRevision:
        cursorRecord.findingRevision as DiscoveryFindingPageCursorV1['findingRevision'],
    };
  }
  if (
    record.schemaVersion !== '1.0.0' ||
    typeof record.completed !== 'boolean' ||
    !Number.isSafeInteger(record.processed) ||
    (record.processed as number) < 0
  ) {
    throw new Error('Discovery reconciliation progress is invalid.');
  }
  return {
    schemaVersion: '1.0.0',
    completed: record.completed,
    processed: record.processed as number,
    ...(cursor === undefined ? {} : { cursor }),
  };
};

const commonSecurity = async (
  input: DiscoveryProductExecutionDependenciesV1,
  projectId: string,
  projection: CompiledTruthProjection,
): Promise<DiscoveryServerSecurityInputV1 | undefined> => {
  return input.resolveSecurity({ projectId, projection });
};

const materializeAIGeneration = (
  proposal: Awaited<ReturnType<DiscoveryAIGenerationService['interpretHypothesis']>>,
  candidate: DiscoveryHypothesisCandidateV1,
  runId: string,
): DiscoveryFindingEnvelopeV1 => {
  const fingerprint = computeDiscoveryFingerprintV1({
    findingType: proposal.findingType,
    relatedResourceRefs: proposal.relatedResourceRefs,
    semanticEssence: semanticStableJson(proposal.payload),
  });
  return createDiscoveryFindingEnvelopeV1({
    schemaVersion: '1.0.0',
    findingId: deterministicFindingId({
      runId,
      strategyId: candidate.provenance.selectorId,
      strategyVersion: candidate.provenance.selectorVersion,
      candidateIndex: 0,
      fingerprint: fingerprint.fingerprint,
    }),
    findingRevision: 1,
    projectId: proposal.projectId,
    findingType: proposal.findingType,
    generationMethod: proposal.generationMethod,
    lifecycleState: 'NEW',
    payload: proposal.payload,
    relatedResourceRefs: proposal.relatedResourceRefs,
    evidenceIds: proposal.evidenceIds,
    sourceProjectionDigest: proposal.sourceProjectionDigest,
    canonicalBase: proposal.canonicalBase,
    discoveryBase: proposal.discoveryBase,
    runId: proposal.runId,
    signalSummary: proposal.signalSummary,
    rationale: proposal.rationale,
    derivationSummary: proposal.derivationSummary,
    provenance: proposal.provenance,
    accessScope: proposal.security.accessScope,
    sensitivity: proposal.security.sensitivity,
    fingerprint: fingerprint.fingerprint,
    fingerprintVersion: fingerprint.fingerprintVersion,
    retentionClass: 'DURABLE_DERIVED_RECORD',
    createdAt: new Date().toISOString(),
  } as Parameters<typeof createDiscoveryFindingEnvelopeV1>[0]);
};

const qualifiedContextFor = (
  state: ProductSignalsV1,
  candidate: DiscoveryHypothesisCandidateV1,
): DiscoveryQualifiedAIGenerationContextV1 => ({
  projectId: state.projection.projectId,
  accessScope: candidate.security.accessScope,
  sensitivity: candidate.security.sensitivity,
  sourceProjectionDigest: candidate.sourceProjectionDigest,
  canonicalBase: candidate.canonicalBase,
  discoveryBase: candidate.discoveryBase,
  originatingFindingType: candidate.targetFindingType,
  boundedRationale: 'Interpret only this server-selected, bounded Discovery neighborhood.',
  items: candidate.memberResourceRefs.map((resource) => {
    const item = state.projection.items.find((entry) => entry.id === resource.resourceId);
    return {
      resourceRef: resource,
      deterministicRepresentation: item?.label ?? resource.resourceId,
      evidenceIds: item?.evidenceIds ?? [],
    };
  }),
});

const createNeighborhoodFacade = (
  input: DiscoveryProductExecutionDependenciesV1,
  state: ProductSignalsV1,
) => {
  const base = (semanticGenerationId: string) => ({
    sourceProjectionDigest: state.signalContext.sourceProjectionDigest,
    canonicalBase: state.signalContext.canonicalBase,
    discoveryBase: state.signalContext.discoveryBase,
    semanticGenerationId: semanticGenerationId || 'semantic-generation:unavailable',
  });
  const refsFor = (resourceRefs: readonly DiscoveryResourceRefV1[]) =>
    resourceRefs.filter((resource) => resource.projectId === state.projection.projectId);
  const itemsFor = (resourceRefs: readonly DiscoveryResourceRefV1[]) =>
    refsFor(resourceRefs)
      .map((resource) => state.projection.items.find((item) => item.id === resource.resourceId))
      .filter((item): item is CompiledTruthProjection['items'][number] => item !== undefined);
  const semanticNeighborhood = {
    read: async ({
      context,
      anchor,
      limit,
    }: {
      readonly context: DiscoverySignalReadContextV1;
      readonly anchor: DiscoverySignalResourceV1;
      readonly limit: number;
    }) => {
      const results = await input.semanticRetriever.retrieve({
        projectId: context.projectId,
        query: anchor.label,
        accessScopes: context.accessScope,
        allowedSensitivities: deriveAuthorizedSensitivities(context.sensitivity),
        limit,
      });
      const semanticGenerationId = results[0]?.generationId ?? 'semantic-generation:unavailable';
      const neighbors = results
        .map((result, index) => {
          const item = state.projection.items.find((entry) => entry.id === result.resourceId);
          if (
            !item ||
            item.id === anchor.resource.resourceId ||
            result.projectId !== context.projectId ||
            !result.accessScope.some((scope) => context.accessScope.includes(scope)) ||
            sensitivityRank[result.sensitivity] > sensitivityRank[context.sensitivity]
          )
            return undefined;
          return {
            ...base(semanticGenerationId),
            resource: resourceFor(context.projectId, item),
            semanticRank: index + 1,
            semanticDistance: result.distance,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
      return {
        ...base(semanticGenerationId),
        anchor,
        neighbors,
        completeness: 'COMPLETE' as const,
      };
    },
  };
  const graphRelation = {
    read: async ({
      resourceRefs,
    }: {
      readonly context: DiscoverySignalReadContextV1;
      readonly resourceRefs: readonly DiscoveryResourceRefV1[];
    }) => {
      const keys = new Set(refsFor(resourceRefs).map(resourceKey));
      const nodes = new Map(
        state.projection.items.map((item) => [
          item.id,
          resourceFor(state.projection.projectId, item),
        ]),
      );
      const relations = state.projection.graph.edges.flatMap((edge) => {
        const from = nodes.get(edge.from);
        const to = nodes.get(edge.to);
        return from &&
          to &&
          keys.has(resourceKey(from.resource)) &&
          keys.has(resourceKey(to.resource))
          ? [{ from: from.resource, to: to.resource, relationType: edge.relationType }]
          : [];
      });
      return {
        ...base('semantic-generation:compiled-truth'),
        relations,
        completeness: 'COMPLETE' as const,
      };
    },
  };
  const temporalCompatibility = {
    read: async ({
      resourceRefs,
    }: {
      readonly context: DiscoverySignalReadContextV1;
      readonly resourceRefs: readonly DiscoveryResourceRefV1[];
    }) => {
      const refs = refsFor(resourceRefs);
      const compatibilities = refs.flatMap((left, index) =>
        refs.slice(index + 1).map((right) => ({
          left,
          right,
          compatible:
            (state.projection.items.find((item) => item.id === left.resourceId)?.state ??
              'CURRENT') !== 'CONFLICT' &&
            (state.projection.items.find((item) => item.id === right.resourceId)?.state ??
              'CURRENT') !== 'CONFLICT',
          temporalEvidenceId: `compiled-truth-temporal:${sha256Text(`${left.resourceId}:${right.resourceId}`)}`,
        })),
      );
      return {
        ...base('semantic-generation:compiled-truth'),
        compatibilities,
        completeness: 'COMPLETE' as const,
      };
    },
  };
  const competingResource = {
    read: async ({
      resourceRefs,
    }: {
      readonly context: DiscoverySignalReadContextV1;
      readonly resourceRefs: readonly DiscoveryResourceRefV1[];
    }) => {
      const refs = refsFor(resourceRefs);
      const conflicted = new Set(
        itemsFor(refs)
          .filter((item) => item.state === 'CONFLICT')
          .map((item) => item.id),
      );
      const competitions = refs.flatMap((left, index) =>
        refs.slice(index + 1).flatMap((right) =>
          conflicted.has(left.resourceId) || conflicted.has(right.resourceId)
            ? [
                {
                  left,
                  right,
                  kind: 'MODEL_DISAGREEMENT' as const,
                  source: 'EXPLICIT_CONFLICT_SIGNAL' as const,
                  signalId: `compiled-truth-conflict:${sha256Text(`${left.resourceId}:${right.resourceId}`)}`,
                },
              ]
            : [],
        ),
      );
      return {
        ...base('semantic-generation:compiled-truth'),
        competitions,
        completeness: 'COMPLETE' as const,
      };
    },
  };
  const existingCanonicalConflict = {
    read: async ({
      resourceRefs,
    }: {
      readonly context: DiscoverySignalReadContextV1;
      readonly resourceRefs: readonly DiscoveryResourceRefV1[];
    }) => {
      const refs = refsFor(resourceRefs);
      const conflicts =
        itemsFor(refs).some((item) => item.state === 'CONFLICT') && refs.length >= 2
          ? [
              {
                participantResourceRefs: refs.slice(0, 2) as [
                  DiscoveryResourceRefV1,
                  DiscoveryResourceRefV1,
                ],
              },
            ]
          : [];
      return {
        ...base('semantic-generation:compiled-truth'),
        conflicts,
        completeness: 'COMPLETE' as const,
      };
    },
  };
  return createDiscoveryNeighborhoodSignalFacade({
    semanticNeighborhood,
    graphRelation,
    temporalCompatibility,
    competingResource,
    existingCanonicalConflict,
  });
};

export const createProductDiscoveryExecution = (
  input: DiscoveryProductExecutionDependenciesV1,
): DiscoveryExecutionPortV1 => {
  const registry = createWp1DiscoveryStrategyRegistry();
  const createEngine = (projection: CompiledTruthProjection): DiscoveryEngineV1 => {
    const nodes = new Map(
      projection.items.map((item) => [item.id, resourceFor(projection.projectId, item)]),
    );
    const resources = resourcesFor(projection.projectId, projection);
    const signalFacade = createDiscoverySignalFacade({
      compiledTruth: {
        read: async () => ({
          resources,
          sourceProjectionDigest: projection.sourceSnapshotDigest,
          completeness: 'COMPLETE' as const,
        }),
      },
      hybridRetrieval: {
        read: async (context) => {
          const query = projection.items
            .slice(0, context.bounds.maxResourcesRead)
            .map((item) => item.label.trim())
            .filter((label) => label.length > 0)
            .join('\n');
          if (!query) {
            return { resources: [], ranks: {}, completeness: 'COMPLETE' as const };
          }
          const results = await input.semanticRetriever.retrieve({
            projectId: context.projectId,
            query,
            accessScopes: context.accessScope,
            allowedSensitivities: deriveAuthorizedSensitivities(context.sensitivity),
            limit: Math.min(context.bounds.maxResourcesRead, 100),
          });
          const authorized = results.filter(
            (result) =>
              result.projectId === context.projectId &&
              result.accessScope.some((scope) => context.accessScope.includes(scope)) &&
              sensitivityRank[result.sensitivity] <= sensitivityRank[context.sensitivity],
          );
          const retrieved = authorized.flatMap((result) => {
            const item = projection.items.find((candidate) => candidate.id === result.resourceId);
            return item ? [resourceFor(context.projectId, item)] : [];
          });
          return {
            resources: retrieved,
            ranks: Object.fromEntries(
              authorized.map((result, index) => [result.resourceId, index + 1]),
            ),
            completeness: 'COMPLETE' as const,
          };
        },
      },
      graph: {
        read: async () => ({
          edges: projection.graph.edges.flatMap((edge) => {
            const from = nodes.get(edge.from);
            const to = nodes.get(edge.to);
            return from && to
              ? [{ edgeId: edge.id, from, to, relationType: edge.relationType }]
              : [];
          }),
          completeness: 'COMPLETE' as const,
        }),
      },
      temporalConflict: {
        read: async () => ({
          observations: resources.map((entry) => ({
            resource: entry,
            conflictState:
              projection.items.find((item) => item.id === entry.resource.resourceId)?.state ===
              'CONFLICT'
                ? ('KNOWN_CONFLICT' as const)
                : ('NONE' as const),
          })),
          completeness: 'COMPLETE' as const,
        }),
      },
      evidenceCoverage: {
        read: async () => ({ resources, completeness: 'COMPLETE' as const }),
      },
    });
    return createDiscoveryEngine({ facade: signalFacade, registry });
  };

  const load = async (context: DiscoveryExecutionContextV1): Promise<ProductSignalsV1> => {
    if (context.claim.job.strategyRevision !== DISCOVERY_PRODUCT_STRATEGY_REVISION_V1) {
      throw new Error('Discovery strategy revision is not supported by the Product adapter.');
    }
    const projection = await input.compiledTruthRepository.findProjection(context.claim.projectId);
    if (!projection || projection.projectId !== context.claim.projectId) {
      throw new Error('Discovery projection is not ready.');
    }
    if (
      context.claim.job.requiredDiscoveryBase &&
      context.claim.job.requiredDiscoveryBase.projectionDigest !== projection.sourceSnapshotDigest
    ) {
      throw new Error('Discovery projection and Canonical base are inconsistent.');
    }
    const security = await commonSecurity(input, context.claim.projectId, projection);
    if (
      !security ||
      security.projectId !== context.claim.projectId ||
      security.accessScope.length === 0
    ) {
      throw new Error('Background Discovery security context is unavailable.');
    }
    const budget = new DiscoveryWorkBudgetLedgerV1(
      context.claim.job.budget as DiscoveryWorkBudgetV1,
      () => Date.now(),
      context.budgetSnapshot,
    );
    const signalContext: DiscoverySignalReadContextV1 = {
      schemaVersion: '1.0.0',
      projectId: context.claim.projectId,
      accessScope: security.accessScope,
      sensitivity: security.sensitivity,
      sourceProjectionDigest: projection.sourceSnapshotDigest,
      canonicalBase: context.claim.job.canonicalBase as DiscoveryCanonicalBaseIdentityV1,
      discoveryBase: projectionBaseFor(context.claim.job.requiredDiscoveryBase, projection),
      bounds: {
        maxResourcesRead: context.claim.job.budget.maxResources,
        maxObservationsReturned: context.claim.job.budget.maxCandidateGroups,
        maxFindingsEmitted: context.claim.job.budget.maxFindings,
      },
      budget,
    };
    return { projection, signalContext, budget };
  };

  return {
    loadSignals: async (context) => ({ value: await load(context) }),
    generateFindings: async (context, signals) => {
      const state = (signals as ProductSignalsV1 | undefined) ?? (await load(context));
      const result = await createEngine(state.projection).generateBudgeted({
        context: state.signalContext,
        budget: state.budget,
        dependencies: {
          runId: context.claim.runId,
          clock: { now: () => new Date().toISOString() },
          findingIdFactory: (identity) =>
            deterministicFindingId({ runId: context.claim.runId, ...identity }),
        },
      });
      const generated: DiscoveryFindingEnvelopeV1[] = [...result.findings];
      const neighborhoodFacade = createNeighborhoodFacade(input, state);
      const neighborhoodRegistry = createWp2DiscoveryNeighborhoodStrategyRegistry();
      const generationService = input.createGenerationService(state.budget, context);
      let completion = result.completion;
      aiStrategyLoop: for (const strategy of neighborhoodRegistry.list()) {
        if (state.budget.isExpired()) {
          completion = 'PARTIAL';
          break;
        }
        const signals = await neighborhoodFacade.readForStrategy({
          context: state.signalContext,
          anchors: resourcesFor(state.projection.projectId, state.projection),
          strategy,
        });
        const selection = selectDiscoveryNeighborhood(strategy, signals);
        if (selection.completeness === 'TRUNCATED' || selection.budget !== undefined) {
          completion = 'PARTIAL';
        }
        for (const selected of selection.candidates) {
          const findingAdmission = state.budget.admitWork('findings');
          if (findingAdmission.status === 'BUDGET_EXHAUSTED') {
            completion = 'PARTIAL';
            break aiStrategyLoop;
          }
          const candidate = selected as unknown as DiscoveryHypothesisCandidateV1;
          const proposal = await generationService.interpretHypothesis({
            projectId: context.claim.projectId,
            runId: context.claim.runId,
            candidate,
            context: qualifiedContextFor(state, candidate),
            maxOutputTokens: state.budget.maxOutputTokensPerCall(),
          });
          generated.push(materializeAIGeneration(proposal, candidate, context.claim.runId));
        }
      }
      return {
        value: generated,
        completion,
        budgetSnapshot: state.budget.snapshot(),
      } satisfies DiscoveryExecutionStageResultV1<readonly DiscoveryFindingEnvelopeV1[]>;
    },
    qualityGate: async (context, candidates) => {
      const state = await load(context);
      const qualityGate = new DiscoveryQualityGateV1({
        revalidateResource: async ({ projectId, resource }) => {
          const item = state.projection.items.find(
            (candidate) =>
              candidate.id === resource.resourceId &&
              resource.projectId === projectId &&
              resource.resourceKind === resourceKindFor(candidate.type),
          );
          return item
            ? {
                exists: true,
                eligible: item.state !== 'CONFLICT',
                projectId,
                accessScope: item.accessScope,
                sensitivity: item.sensitivity,
              }
            : undefined;
        },
        findByFingerprint: async ({ projectId, fingerprintVersion, fingerprint }) => {
          const existing = await input.findingRepository.listByProject(projectId);
          const matches = existing.filter(
            (finding) =>
              finding.fingerprintVersion === fingerprintVersion &&
              finding.fingerprint === fingerprint,
          );
          return Promise.all(
            matches.map(async (finding) => ({
              findingId: finding.findingId,
              findingRevision: finding.findingRevision,
              lifecycleState:
                (await input.findingRepository.findLifecycle(finding))?.lifecycleState ??
                finding.lifecycleState,
            })),
          );
        },
        findAuthoritativeEquivalent: input.findAuthoritativeEquivalent,
        revalidateEvidence: async ({ projectId, evidenceId, context }) => {
          const evidence = await input.evidenceRepository.findById(projectId, evidenceId);
          if (!evidence) {
            return {
              exists: false,
              eligible: false,
              projectId,
              identityValid: false,
            };
          }
          const sensitivityRank = { public: 0, internal: 1, private: 2, restricted: 3 } as const;
          return {
            exists: true,
            eligible:
              evidence.projectId === projectId &&
              evidence.accessScope.length > 0 &&
              evidence.accessScope.some((scope) => context.accessScope.includes(scope)) &&
              sensitivityRank[evidence.sensitivity] <= sensitivityRank[context.sensitivity],
            projectId: evidence.projectId,
            identityValid: evidence.projectId === projectId,
          };
        },
      });
      const accepted: DiscoveryFindingEnvelopeV1[] = [];
      let completion: 'COMPLETE' | 'PARTIAL' = 'COMPLETE';
      for (const candidate of candidates) {
        const finding = candidate as DiscoveryFindingEnvelopeV1;
        const semanticEssence =
          gapEssence(finding) ??
          (() => {
            try {
              return semanticStableJson(finding.payload);
            } catch {
              return '';
            }
          })();
        const result = await qualityGate.evaluate({
          candidate: finding,
          fingerprintInput: {
            findingType: finding.findingType,
            relatedResourceRefs: finding.relatedResourceRefs,
            semanticEssence,
          },
          context: {
            projectId: context.claim.projectId,
            accessScope: state.signalContext.accessScope,
            sensitivity: state.signalContext.sensitivity,
            sourceProjectionDigest: state.signalContext.sourceProjectionDigest,
            canonicalBase: state.signalContext.canonicalBase,
            discoveryBase: state.signalContext.discoveryBase,
          } satisfies DiscoveryQualityGateContextV1,
        });
        if (result.disposition === 'ACCEPTED') accepted.push(result.candidate);
        if (result.disposition === 'BUDGET_EXHAUSTED') completion = 'PARTIAL';
      }
      return { value: accepted, completion };
    },
    persistFindings: async (context, findings) => {
      const persisted: DiscoveryFindingEnvelopeV1[] = [];
      for (const finding of findings) {
        if (!input.findingRepository.saveFenced) {
          throw new Error('Fenced Discovery finding persistence is unavailable.');
        }
        const result = await input.findingRepository.saveFenced(finding, {
          ...context.claim,
          now: new Date().toISOString(),
        });
        if (result === 'STALE' || result === 'NOT_FOUND') {
          throw new Error('Discovery finding persistence lease is stale.');
        }
        if (result === 'CREATED') persisted.push(finding);
        else {
          const existing = await input.findingRepository.findRevision(finding);
          if (!existing || semanticStableJson(existing) !== semanticStableJson(finding)) {
            throw new Error('Discovery finding persistence conflicted.');
          }
          persisted.push(existing);
        }
      }
      return { value: persisted };
    },
    loadPersistedFindings: async (context) =>
      (await input.findingRepository.listByProject(context.claim.projectId)).filter(
        (finding) => finding.runId === context.claim.runId,
      ),
    publishFindingReady: async (context, finding) => {
      const result = await input.runtimeRepository.publishFindingReady({
        ...context.claim,
        publication: {
          schemaVersion: '1.0.0',
          publicationId: `finding-ready:${sha256Text(`${finding.projectId}:${finding.findingId}:${finding.findingRevision}`)}`,
          projectId: finding.projectId,
          findingId: finding.findingId,
          findingRevision: finding.findingRevision,
          fingerprint: finding.fingerprint,
          fingerprintVersion: finding.fingerprintVersion,
          jobId: context.claim.jobId,
          runId: context.claim.runId,
          attemptId: context.claim.attemptId,
          canonicalBase: finding.canonicalBase,
          requiredDiscoveryBase: finding.discoveryBase,
          occurredAt: new Date().toISOString(),
        },
      });
      if (result === 'STALE' || result === 'NOT_FOUND') {
        throw new Error('FindingReady publication lease is stale.');
      }
    },
    reconcileFindings: async (context) => {
      if (context.claim.job.trigger.triggerClass !== 'CANONICAL_COMMITTED') return;
      const stage = context.stage;
      const readStageOutput = input.runtimeRepository.readStageOutput;
      const writeStageOutput = input.runtimeRepository.writeStageOutput;
      if (
        !stage ||
        stage.stageType !== 'RECONCILE_FINDINGS' ||
        readStageOutput === undefined ||
        writeStageOutput === undefined
      ) {
        throw new Error('Restartable Discovery reconciliation storage is unavailable.');
      }
      const projection = await input.compiledTruthRepository.findProjection(
        context.claim.projectId,
      );
      if (!projection) throw new Error('Discovery reconciliation projection is unavailable.');
      const stored = await readStageOutput({
        projectId: context.claim.projectId,
        runId: context.claim.runId,
        attemptId: context.claim.attemptId,
        stageId: stage.stageId,
      });
      if (stored && stored.stageType !== 'RECONCILE_FINDINGS') {
        throw new Error('Discovery reconciliation progress belongs to another stage.');
      }
      const progress = stored
        ? decodeReconciliationProgress(stored.output)
        : { schemaVersion: '1.0.0' as const, completed: false, processed: 0 };
      if (progress.completed) return;
      let cursor = progress.cursor;
      let processed = progress.processed;
      let progressRevision = Math.max(stage.stageRevision, stored?.stageRevision ?? 0);
      const pageSize = 50;
      let fallbackAll: readonly DiscoveryFindingEnvelopeV1[] | undefined;
      const afterCursor = (finding: DiscoveryFindingEnvelopeV1): boolean =>
        cursor === undefined ||
        utf16OrdinalCompare(finding.findingId, cursor.findingId) > 0 ||
        (finding.findingId === cursor.findingId &&
          finding.findingRevision > cursor.findingRevision);
      const readPage = async (): Promise<readonly DiscoveryFindingEnvelopeV1[]> => {
        if (input.findingRepository.listByProjectPage) {
          return input.findingRepository.listByProjectPage(
            context.claim.projectId,
            cursor,
            pageSize,
          );
        }
        fallbackAll ??= await input.findingRepository.listByProject(context.claim.projectId);
        return [...fallbackAll]
          .filter(afterCursor)
          .sort(
            (left, right) =>
              utf16OrdinalCompare(left.findingId, right.findingId) ||
              left.findingRevision - right.findingRevision,
          )
          .slice(0, pageSize);
      };
      const writeProgress = async (completed: boolean): Promise<void> => {
        const nextRevision = Math.max(progressRevision, stage.stageRevision) + 1;
        const result = await writeStageOutput({
          ...context.claim,
          output: {
            schemaVersion: '1.0.0',
            projectId: context.claim.projectId,
            jobId: context.claim.jobId,
            runId: context.claim.runId,
            attemptId: context.claim.attemptId,
            stageId: stage.stageId,
            stageType: 'RECONCILE_FINDINGS',
            stageRevision: nextRevision,
            output: {
              schemaVersion: '1.0.0',
              completed,
              processed,
              ...(cursor === undefined ? {} : { cursor }),
            } satisfies DiscoveryReconciliationProgressV1,
            updatedAt: new Date().toISOString(),
          },
        });
        if (result !== 'SAVED') {
          throw new Error('Discovery reconciliation progress could not be durably fenced.');
        }
        progressRevision = nextRevision;
      };
      const lifecycleService = new DiscoveryFindingLifecycleService(input.findingRepository);
      for (;;) {
        const page = await readPage();
        if (page.length === 0) {
          await writeProgress(true);
          return;
        }
        for (const finding of page) {
          if (!afterCursor(finding)) continue;
          const lifecycle = await input.findingRepository.findLifecycle(finding);
          if (
            lifecycle &&
            !['DISMISSED', 'SUPPRESSED', 'RESOLVED', 'STALE', 'SUPERSEDED'].includes(
              lifecycle.lifecycleState,
            )
          ) {
            const disposition = await input.observeReconciliation({
              finding,
              projection,
              canonicalBase: context.claim.job.canonicalBase,
            });
            const reconciled = await lifecycleService.reconcile(
              {
                finding,
                expectedLifecycleRevision: lifecycle.lifecycleRevision,
                observation: {
                  projectId: finding.projectId,
                  findingId: finding.findingId,
                  findingRevision: finding.findingRevision,
                  disposition,
                  canonicalBase: context.claim.job.canonicalBase,
                  discoveryBase: projectionBaseFor(
                    context.claim.job.requiredDiscoveryBase,
                    projection,
                  ),
                },
                occurredAt: new Date().toISOString(),
              },
              {
                projectId: context.claim.projectId,
                jobId: context.claim.jobId,
                runId: context.claim.runId,
                attemptId: context.claim.attemptId,
                workerId: context.claim.workerId,
                fencingToken: context.claim.fencingToken,
                now: new Date().toISOString(),
              },
            );
            if (reconciled.status === 'CONFLICT') {
              throw new Error('Discovery reconciliation lifecycle fence conflicted.');
            }
          }
          cursor = { findingId: finding.findingId, findingRevision: finding.findingRevision };
          processed += 1;
          await writeProgress(false);
        }
      }
    },
  };
};
