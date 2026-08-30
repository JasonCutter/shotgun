import { sha256Text, semanticStableJson } from '../../../packages/contracts/src/index.js';
import type {
  CompiledTruthProjection,
  DiscoveryCanonicalBaseIdentityV1,
  DiscoveryFindingEnvelopeV1,
  DiscoveryProjectionBaseIdentityV1,
  DiscoveryResourceKind,
  DiscoveryResourceRefV1,
  DiscoveryServerSecurityInputV1,
} from '../../../packages/contracts/src/index.js';
import {
  createDiscoveryEngine,
  createDiscoverySignalFacade,
  createWp1DiscoveryStrategyRegistry,
  type DiscoveryEngineV1,
  type DiscoverySignalReadContextV1,
  type DiscoverySignalResourceV1,
} from '../../../modules/discovery-finding-fingerprint/src/index.js';
import {
  DiscoveryQualityGateV1,
  DiscoveryWorkBudgetLedgerV1,
  type DiscoveryQualityGateContextV1,
  type DiscoveryWorkBudgetV1,
} from '../../../modules/discovery-quality-gate/src/index.js';
import type { CompiledTruthRepositoryPort } from '../../../modules/compiled-truth/src/index.js';
import type { DiscoveryFindingRepositoryPort } from '../../../modules/discovery-finding-persistence/src/index.js';
import {
  DiscoveryFindingLifecycleService,
  type DiscoveryFindingLifecycleRepositoryPort,
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

export type DiscoveryProductExecutionDependenciesV1 = {
  readonly compiledTruthRepository: Pick<CompiledTruthRepositoryPort, 'findProjection'>;
  readonly findingRepository: ProductFindingRepository;
  readonly runtimeRepository: DiscoveryRuntimeExecutionRepositoryPort;
  /** Server-owned security context. No browser/request value is accepted. */
  readonly resolveSecurity?: (input: {
    readonly projectId: string;
    readonly projection: CompiledTruthProjection;
  }) => Promise<DiscoveryServerSecurityInputV1 | undefined>;
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

const commonSecurity = async (
  input: DiscoveryProductExecutionDependenciesV1,
  projectId: string,
  projection: CompiledTruthProjection,
): Promise<DiscoveryServerSecurityInputV1 | undefined> => {
  if (input.resolveSecurity) return input.resolveSecurity({ projectId, projection });
  const scopes = projection.items.map((item) => new Set(item.accessScope));
  const intersection = scopes.reduce<Set<string> | undefined>((current, value) => {
    if (current === undefined) return new Set(value);
    return new Set([...current].filter((scope) => value.has(scope)));
  }, undefined);
  const sensitivity = projection.items.reduce<DiscoveryServerSecurityInputV1['sensitivity']>(
    (highest, item) => {
      const rank = { public: 0, internal: 1, private: 2, restricted: 3 } as const;
      return rank[item.sensitivity] > rank[highest] ? item.sensitivity : highest;
    },
    'public',
  );
  if (projection.items.length > 0 && (intersection === undefined || intersection.size === 0)) {
    return undefined;
  }
  return {
    projectId,
    accessScope: [...(intersection ?? new Set(['owner']))],
    sensitivity,
  };
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
        read: async () => ({
          resources,
          ranks: Object.fromEntries(
            resources.map((entry, index) => [entry.resource.resourceId, index + 1]),
          ),
          completeness: 'COMPLETE' as const,
        }),
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
      return {
        value: result.findings,
        completion: result.completion,
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
        findAuthoritativeEquivalent: async () => false,
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
      const current = await input.findingRepository.listByProject(context.claim.projectId);
      for (const finding of current.slice(0, context.claim.job.budget.maxFindings)) {
        const lifecycle = await input.findingRepository.findLifecycle(finding);
        if (
          !lifecycle ||
          ['DISMISSED', 'SUPPRESSED', 'RESOLVED', 'STALE', 'SUPERSEDED'].includes(
            lifecycle.lifecycleState,
          )
        ) {
          continue;
        }
        const changed =
          finding.canonicalBase.canonicalVersion !==
            context.claim.job.canonicalBase.canonicalVersion ||
          finding.canonicalBase.snapshotDigest !== context.claim.job.canonicalBase.snapshotDigest;
        await new DiscoveryFindingLifecycleService(input.findingRepository).reconcile({
          finding,
          expectedLifecycleRevision: lifecycle.lifecycleRevision,
          observation: {
            projectId: finding.projectId,
            findingId: finding.findingId,
            findingRevision: finding.findingRevision,
            disposition: changed ? 'RELEVANT_INPUT_CHANGED' : 'UNCHANGED',
            canonicalBase: context.claim.job.canonicalBase,
          },
          occurredAt: new Date().toISOString(),
        });
      }
    },
  };
};
