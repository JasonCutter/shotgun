import {
  composeDiscoveryFindingSecurityV1,
  createDiscoveryFindingEnvelopeV1,
  semanticStableJson,
  sha256Text,
  utf16OrdinalCompare,
} from '../../../packages/contracts/src/index.js';
import type {
  DiscoveryCanonicalBaseIdentityV1,
  DiscoveryFindingEnvelopeV1,
  DiscoveryFindingType,
  DiscoveryProjectionBaseIdentityV1,
  DiscoveryResourceKind,
  DiscoveryResourceRefV1,
  DiscoverySecurityCompositionSuccessV1,
  DiscoveryServerSecurityInputV1,
  DiscoverySignalSummaryV1,
  DiscoveryWorkBudgetExhaustedV1,
  DiscoveryWorkBudgetPortV1,
  EvidenceGapPayloadV1,
  KnowledgeGapPayloadV1,
} from '../../../packages/contracts/src/index.js';
import { computeDiscoveryFingerprintV1 } from './index.js';

/**
 * AKP-3 WP1 signal facade and deterministic strategy boundary.
 *
 * This file deliberately lives beside the accepted fingerprint implementation
 * so the engine can reuse the existing fingerprint Port without introducing a
 * forbidden module-to-module dependency. It contains no persistence, database,
 * provider, scheduler, Canonical write, or external-action capability.
 */

export const DISCOVERY_SIGNAL_KINDS_V1 = [
  'COMPILED_TRUTH',
  'HYBRID_RETRIEVAL',
  'GRAPH',
  'TEMPORAL_CONFLICT',
  'EVIDENCE_COVERAGE',
] as const;
export type DiscoverySignalKindV1 = (typeof DISCOVERY_SIGNAL_KINDS_V1)[number];

export const DISCOVERY_SIGNAL_COMPLETENESS_V1 = ['COMPLETE', 'TRUNCATED'] as const;
export type DiscoverySignalCompletenessV1 = (typeof DISCOVERY_SIGNAL_COMPLETENESS_V1)[number];

export const WP1_DISCOVERY_FINDING_TYPES = ['KNOWLEDGE_GAP', 'EVIDENCE_GAP'] as const;
export type Wp1DiscoveryFindingType = (typeof WP1_DISCOVERY_FINDING_TYPES)[number];

export type DiscoveryReadBoundsV1 = {
  readonly maxResourcesRead: number;
  readonly maxObservationsReturned: number;
  readonly maxFindingsEmitted: number;
};

export type DiscoverySignalReadContextV1 = {
  readonly schemaVersion: '1.0.0';
  readonly projectId: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: DiscoveryServerSecurityInputV1['sensitivity'];
  readonly canonicalBase: DiscoveryCanonicalBaseIdentityV1;
  readonly discoveryBase: DiscoveryProjectionBaseIdentityV1;
  readonly sourceProjectionDigest: string;
  readonly bounds: DiscoveryReadBoundsV1;
  readonly budget?: DiscoveryWorkBudgetPortV1;
};

export type DiscoverySignalResourceV1 = {
  readonly resource: DiscoveryResourceRefV1;
  readonly label: string;
  readonly evidenceIds: readonly string[];
  readonly security: DiscoveryServerSecurityInputV1;
};

export type DiscoveryCompiledTruthSignalV1 = {
  readonly resources: readonly DiscoverySignalResourceV1[];
  readonly sourceProjectionDigest: string;
  readonly completeness: DiscoverySignalCompletenessV1;
};

export type DiscoveryHybridRetrievalSignalV1 = {
  readonly resources: readonly DiscoverySignalResourceV1[];
  readonly ranks: Readonly<Record<string, number>>;
  readonly completeness: DiscoverySignalCompletenessV1;
};

export type DiscoveryGraphEdgeSignalV1 = {
  readonly edgeId: string;
  readonly from: DiscoverySignalResourceV1;
  readonly to: DiscoverySignalResourceV1;
  readonly relationType: string;
};

export type DiscoveryGraphSignalV1 = {
  readonly edges: readonly DiscoveryGraphEdgeSignalV1[];
  readonly completeness: DiscoverySignalCompletenessV1;
};

export type DiscoveryTemporalConflictObservationV1 = {
  readonly resource: DiscoverySignalResourceV1;
  readonly conflictState: 'NONE' | 'KNOWN_CONFLICT' | 'POSSIBLE_CONFLICT';
};

export type DiscoveryTemporalConflictSignalV1 = {
  readonly observations: readonly DiscoveryTemporalConflictObservationV1[];
  readonly completeness: DiscoverySignalCompletenessV1;
};

export type DiscoveryEvidenceCoverageSignalV1 = {
  readonly resources: readonly DiscoverySignalResourceV1[];
  readonly completeness: DiscoverySignalCompletenessV1;
};

export type DiscoverySignalResultByKindV1 = {
  readonly COMPILED_TRUTH: DiscoveryCompiledTruthSignalV1;
  readonly HYBRID_RETRIEVAL: DiscoveryHybridRetrievalSignalV1;
  readonly GRAPH: DiscoveryGraphSignalV1;
  readonly TEMPORAL_CONFLICT: DiscoveryTemporalConflictSignalV1;
  readonly EVIDENCE_COVERAGE: DiscoveryEvidenceCoverageSignalV1;
};

export type DiscoverySignalBundleV1 = {
  readonly compiledTruth?: DiscoveryCompiledTruthSignalV1;
  readonly hybridRetrieval?: DiscoveryHybridRetrievalSignalV1;
  readonly graph?: DiscoveryGraphSignalV1;
  readonly temporalConflict?: DiscoveryTemporalConflictSignalV1;
  readonly evidenceCoverage?: DiscoveryEvidenceCoverageSignalV1;
  readonly budget?: DiscoveryWorkBudgetExhaustedV1;
};

export type CompiledTruthSignalPort = {
  read(context: DiscoverySignalReadContextV1): Promise<DiscoveryCompiledTruthSignalV1>;
};

export type HybridRetrievalSignalPort = {
  read(context: DiscoverySignalReadContextV1): Promise<DiscoveryHybridRetrievalSignalV1>;
};

export type GraphSignalPort = {
  read(context: DiscoverySignalReadContextV1): Promise<DiscoveryGraphSignalV1>;
};

export type TemporalConflictSignalPort = {
  read(context: DiscoverySignalReadContextV1): Promise<DiscoveryTemporalConflictSignalV1>;
};

export type EvidenceCoverageSignalPort = {
  read(context: DiscoverySignalReadContextV1): Promise<DiscoveryEvidenceCoverageSignalV1>;
};

export type DiscoverySignalPortsV1 = {
  readonly compiledTruth: CompiledTruthSignalPort;
  readonly hybridRetrieval: HybridRetrievalSignalPort;
  readonly graph: GraphSignalPort;
  readonly temporalConflict: TemporalConflictSignalPort;
  readonly evidenceCoverage: EvidenceCoverageSignalPort;
};

export type DiscoveryStrategyWorkBoundV1 = {
  readonly maxResourcesRead: number;
  readonly maxObservationsReturned: number;
  readonly maxFindingsEmitted: number;
};

export type DiscoveryAiRequirementV1 = 'NONE' | 'OPTIONAL' | 'REQUIRED';

export type DiscoveryStrategyDeclarationV1 = {
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly supportedFindingTypes: readonly DiscoveryFindingType[];
  readonly requiredSignalKinds: readonly DiscoverySignalKindV1[];
  readonly aiRequirement: DiscoveryAiRequirementV1;
  readonly requiresAi?: boolean;
  readonly work: DiscoveryStrategyWorkBoundV1;
};

export type DiscoveryStrategyCandidateV1 = {
  readonly findingType: Wp1DiscoveryFindingType;
  readonly payload: KnowledgeGapPayloadV1 | EvidenceGapPayloadV1;
  readonly relatedResourceRefs: readonly DiscoveryResourceRefV1[];
  readonly evidenceIds: readonly string[];
  readonly semanticEssence: string;
  readonly signalSummary: DiscoverySignalSummaryV1;
  readonly rationale: string;
  readonly derivationSummary: string;
  readonly securityResources: readonly DiscoveryServerSecurityInputV1[];
};

export type DiscoveryStrategyGenerateInputV1 = {
  readonly context: DiscoverySignalReadContextV1;
  readonly signals: DiscoverySignalBundleV1;
  readonly maxFindings: number;
};

export type DiscoveryStrategyV1 = DiscoveryStrategyDeclarationV1 & {
  generate(
    input: DiscoveryStrategyGenerateInputV1,
  ): Promise<readonly DiscoveryStrategyCandidateV1[]>;
};

const text = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${field} must be a non-empty string`);
  return normalized;
};

const positiveFiniteInteger = (value: number, field: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive finite integer`);
  }
  return value;
};

const normalizedScope = (scope: readonly string[], field: string): readonly string[] => {
  const values = [...new Set(scope.map((entry) => text(entry, `${field} entry`)))].sort(
    utf16OrdinalCompare,
  );
  if (values.length === 0) throw new TypeError(`${field} must not be empty`);
  return values;
};

const resourceKey = (resource: DiscoveryResourceRefV1): string =>
  [
    resource.projectId,
    resource.resourceKind,
    resource.resourceId,
    resource.resourceState,
    resource.resourceRevision ?? '',
  ].join('\u0000');

const signalResourceKey = (resource: DiscoverySignalResourceV1): string =>
  resourceKey(resource.resource);

const compareSignalResourcesOrdinal = (
  left: DiscoverySignalResourceV1,
  right: DiscoverySignalResourceV1,
): number => utf16OrdinalCompare(signalResourceKey(left), signalResourceKey(right));

const contextSecurity = (
  context: DiscoverySignalReadContextV1,
): DiscoveryServerSecurityInputV1 => ({
  projectId: context.projectId,
  accessScope: context.accessScope,
  sensitivity: context.sensitivity,
});

const materializableResource = (
  context: DiscoverySignalReadContextV1,
  entry: DiscoverySignalResourceV1,
): DiscoverySignalResourceV1 | undefined => {
  if (
    entry.resource.projectId !== context.projectId ||
    entry.security.projectId !== context.projectId ||
    entry.resource.projectId !== entry.security.projectId
  ) {
    return undefined;
  }
  const security = composeDiscoveryFindingSecurityV1({
    findingProjectId: context.projectId,
    resources: [entry.security],
    executionContext: contextSecurity(context),
  });
  if (!security.materializable) return undefined;
  return {
    resource: entry.resource,
    label: text(entry.label, 'signal resource label'),
    evidenceIds: [...new Set(entry.evidenceIds.map((id) => text(id, 'evidence id')))].sort(
      utf16OrdinalCompare,
    ),
    security: entry.security,
  };
};

const boundedResources = (
  context: DiscoverySignalReadContextV1,
  strategy: DiscoveryStrategyDeclarationV1,
  upstreamCompleteness: DiscoverySignalCompletenessV1,
  entries: readonly DiscoverySignalResourceV1[],
): {
  readonly resources: readonly DiscoverySignalResourceV1[];
  readonly completeness: DiscoverySignalCompletenessV1;
  readonly budget?: DiscoveryWorkBudgetExhaustedV1;
} => {
  const limit = Math.min(context.bounds.maxResourcesRead, strategy.work.maxResourcesRead);
  const materializable = entries
    .map((entry) => materializableResource(context, entry))
    .filter((entry): entry is DiscoverySignalResourceV1 => entry !== undefined)
    .sort(compareSignalResourcesOrdinal);
  const unique = new Map<string, DiscoverySignalResourceV1>();
  for (const entry of materializable) unique.set(signalResourceKey(entry), entry);
  const locallyBoundedResources = [...unique.values()].slice(0, limit);
  const admission = context.budget?.admitResources(
    locallyBoundedResources.map((entry) => entry.resource),
  );
  const admittedResourceKeys = admission ? new Set(admission.admittedResourceKeys) : undefined;
  const resources = admittedResourceKeys
    ? locallyBoundedResources.filter((entry) => admittedResourceKeys.has(signalResourceKey(entry)))
    : locallyBoundedResources;
  const budget = admission?.status === 'BUDGET_EXHAUSTED' ? admission : undefined;
  return {
    resources,
    completeness:
      upstreamCompleteness === 'TRUNCATED' ||
      locallyBoundedResources.length > resources.length ||
      unique.size > limit ||
      budget !== undefined
        ? 'TRUNCATED'
        : 'COMPLETE',
    ...(budget === undefined ? {} : { budget }),
  };
};

const boundedObservations = <T>(
  context: DiscoverySignalReadContextV1,
  strategy: DiscoveryStrategyDeclarationV1,
  upstreamCompleteness: DiscoverySignalCompletenessV1,
  entries: readonly T[],
): {
  readonly observations: readonly T[];
  readonly completeness: DiscoverySignalCompletenessV1;
} => {
  const limit = Math.min(
    context.bounds.maxObservationsReturned,
    strategy.work.maxObservationsReturned,
  );
  return {
    observations: entries.slice(0, limit),
    completeness:
      upstreamCompleteness === 'TRUNCATED' || entries.length > limit ? 'TRUNCATED' : 'COMPLETE',
  };
};

const assertContext = (context: DiscoverySignalReadContextV1): void => {
  if (context.schemaVersion !== '1.0.0') throw new TypeError('Unsupported signal context schema');
  text(context.projectId, 'signal context projectId');
  normalizedScope(context.accessScope, 'signal context accessScope');
  text(context.sourceProjectionDigest, 'signal context sourceProjectionDigest');
  if (
    !Number.isSafeInteger(context.canonicalBase.canonicalVersion) ||
    context.canonicalBase.canonicalVersion < 0
  ) {
    throw new TypeError('canonical base canonicalVersion must be a non-negative finite integer');
  }
  text(context.canonicalBase.snapshotDigest, 'canonical base snapshotDigest');
  text(context.discoveryBase.projectionRevision, 'discovery base projectionRevision');
  text(context.discoveryBase.projectionDigest, 'discovery base projectionDigest');
  positiveFiniteInteger(context.bounds.maxResourcesRead, 'bounds.maxResourcesRead');
  positiveFiniteInteger(context.bounds.maxObservationsReturned, 'bounds.maxObservationsReturned');
  positiveFiniteInteger(context.bounds.maxFindingsEmitted, 'bounds.maxFindingsEmitted');
};

export class DiscoverySignalFacade {
  public constructor(private readonly ports: DiscoverySignalPortsV1) {}

  public async readForStrategy(
    context: DiscoverySignalReadContextV1,
    strategy: DiscoveryStrategyDeclarationV1,
  ): Promise<DiscoverySignalBundleV1> {
    assertContext(context);
    const bundle: {
      compiledTruth?: DiscoveryCompiledTruthSignalV1;
      hybridRetrieval?: DiscoveryHybridRetrievalSignalV1;
      graph?: DiscoveryGraphSignalV1;
      temporalConflict?: DiscoveryTemporalConflictSignalV1;
      evidenceCoverage?: DiscoveryEvidenceCoverageSignalV1;
      budget?: DiscoveryWorkBudgetExhaustedV1;
    } = {};
    let budgetExhaustion: DiscoveryWorkBudgetExhaustedV1 | undefined;
    const noteBudget = (budget: DiscoveryWorkBudgetExhaustedV1 | undefined): void => {
      if (budgetExhaustion === undefined && budget !== undefined) budgetExhaustion = budget;
    };
    for (const kind of strategy.requiredSignalKinds) {
      switch (kind) {
        case 'COMPILED_TRUTH': {
          const result = await this.ports.compiledTruth.read(context);
          if (result.sourceProjectionDigest !== context.sourceProjectionDigest) {
            bundle.compiledTruth = {
              sourceProjectionDigest: result.sourceProjectionDigest,
              resources: [],
              completeness: 'TRUNCATED',
            };
            break;
          }
          const bounded = boundedResources(
            context,
            strategy,
            result.completeness,
            result.resources,
          );
          noteBudget(bounded.budget);
          bundle.compiledTruth = {
            sourceProjectionDigest: result.sourceProjectionDigest,
            resources: bounded.resources,
            completeness: bounded.completeness,
          };
          break;
        }
        case 'HYBRID_RETRIEVAL': {
          const result = await this.ports.hybridRetrieval.read(context);
          const bounded = boundedResources(
            context,
            strategy,
            result.completeness,
            result.resources,
          );
          noteBudget(bounded.budget);
          const ranks = Object.fromEntries(
            Object.entries(result.ranks)
              .filter(([resourceId]) =>
                bounded.resources.some((entry) => entry.resource.resourceId === resourceId),
              )
              .sort(([left], [right]) => utf16OrdinalCompare(left, right)),
          );
          bundle.hybridRetrieval = {
            resources: bounded.resources,
            ranks,
            completeness: bounded.completeness,
          };
          break;
        }
        case 'GRAPH': {
          const result = await this.ports.graph.read(context);
          const maxResources = Math.min(
            context.bounds.maxResourcesRead,
            strategy.work.maxResourcesRead,
          );
          const maxObservations = Math.min(
            context.bounds.maxObservationsReturned,
            strategy.work.maxObservationsReturned,
          );
          const ordered = [...result.edges].sort((left, right) =>
            utf16OrdinalCompare(
              [left.edgeId, signalResourceKey(left.from), signalResourceKey(left.to)].join(
                '\u0000',
              ),
              [right.edgeId, signalResourceKey(right.from), signalResourceKey(right.to)].join(
                '\u0000',
              ),
            ),
          );
          const normalizedEdges = ordered.flatMap((edge) => {
            const from = materializableResource(context, edge.from);
            const to = materializableResource(context, edge.to);
            if (!from || !to) return [];
            return [
              {
                edgeId: text(edge.edgeId, 'graph edge edgeId'),
                from,
                to,
                relationType: text(edge.relationType, 'graph edge relationType'),
              },
            ];
          });
          const graphAdmission = context.budget?.admitResources(
            normalizedEdges.flatMap((edge) => [edge.from.resource, edge.to.resource]),
          );
          noteBudget(graphAdmission?.status === 'BUDGET_EXHAUSTED' ? graphAdmission : undefined);
          const admittedGraphResourceKeys = graphAdmission
            ? new Set(graphAdmission.admittedResourceKeys)
            : undefined;
          const admittedEdges = admittedGraphResourceKeys
            ? normalizedEdges.filter(
                (edge) =>
                  admittedGraphResourceKeys.has(signalResourceKey(edge.from)) &&
                  admittedGraphResourceKeys.has(signalResourceKey(edge.to)),
              )
            : normalizedEdges;
          const visibleResources = new Map<string, DiscoverySignalResourceV1>();
          const edges: DiscoveryGraphEdgeSignalV1[] = [];
          for (const edge of admittedEdges) {
            const projectedSize = new Set([
              ...visibleResources.keys(),
              signalResourceKey(edge.from),
              signalResourceKey(edge.to),
            ]).size;
            if (projectedSize > maxResources) continue;
            visibleResources.set(signalResourceKey(edge.from), edge.from);
            visibleResources.set(signalResourceKey(edge.to), edge.to);
            edges.push(edge);
          }
          const locallyTruncated =
            normalizedEdges.length > admittedEdges.length ||
            admittedEdges.length > edges.length ||
            edges.length > maxObservations;
          bundle.graph = {
            edges: edges.slice(0, maxObservations),
            completeness:
              result.completeness === 'TRUNCATED' || locallyTruncated ? 'TRUNCATED' : 'COMPLETE',
          };
          break;
        }
        case 'TEMPORAL_CONFLICT': {
          const result = await this.ports.temporalConflict.read(context);
          const bounded = boundedResources(
            context,
            strategy,
            result.completeness,
            result.observations.map((entry) => entry.resource),
          );
          noteBudget(bounded.budget);
          const resourceKeys = new Set(bounded.resources.map(signalResourceKey));
          const boundedObservationsResult = boundedObservations(
            context,
            strategy,
            bounded.completeness,
            [...result.observations]
              .map((entry) => ({
                ...entry,
                resource: materializableResource(context, entry.resource),
              }))
              .filter(
                (entry): entry is typeof entry & { resource: DiscoverySignalResourceV1 } =>
                  entry.resource !== undefined &&
                  resourceKeys.has(signalResourceKey(entry.resource)),
              )
              .sort((left, right) =>
                utf16OrdinalCompare(
                  signalResourceKey(left.resource),
                  signalResourceKey(right.resource),
                ),
              ),
          );
          bundle.temporalConflict = {
            observations: boundedObservationsResult.observations,
            completeness: boundedObservationsResult.completeness,
          };
          break;
        }
        case 'EVIDENCE_COVERAGE': {
          const result = await this.ports.evidenceCoverage.read(context);
          const bounded = boundedResources(
            context,
            strategy,
            result.completeness,
            result.resources,
          );
          noteBudget(bounded.budget);
          bundle.evidenceCoverage = {
            resources: bounded.resources,
            completeness: bounded.completeness,
          };
          break;
        }
      }
    }
    if (budgetExhaustion !== undefined) bundle.budget = budgetExhaustion;
    return bundle;
  }
}

export const createDiscoverySignalFacade = (ports: DiscoverySignalPortsV1): DiscoverySignalFacade =>
  new DiscoverySignalFacade(ports);

const strategyKey = (strategy: DiscoveryStrategyDeclarationV1): string =>
  `${strategy.strategyId}\u0000${strategy.strategyVersion}`;

const signalKinds = new Set<DiscoverySignalKindV1>(DISCOVERY_SIGNAL_KINDS_V1);
const findingTypes = new Set<Wp1DiscoveryFindingType>(WP1_DISCOVERY_FINDING_TYPES);

const validateWork = (work: DiscoveryStrategyWorkBoundV1, field: string): void => {
  positiveFiniteInteger(work.maxResourcesRead, `${field}.maxResourcesRead`);
  positiveFiniteInteger(work.maxObservationsReturned, `${field}.maxObservationsReturned`);
  positiveFiniteInteger(work.maxFindingsEmitted, `${field}.maxFindingsEmitted`);
};

const validateStrategy = (strategy: DiscoveryStrategyV1): void => {
  text(strategy.strategyId, 'strategyId');
  text(strategy.strategyVersion, 'strategyVersion');
  if (strategy.supportedFindingTypes.length === 0) {
    throw new TypeError(`${strategy.strategyId} must support at least one finding type`);
  }
  if (
    strategy.supportedFindingTypes.some(
      (findingType) => !findingTypes.has(findingType as Wp1DiscoveryFindingType),
    )
  ) {
    throw new TypeError(`${strategy.strategyId} declares an unsupported WP1 finding type`);
  }
  if (new Set(strategy.supportedFindingTypes).size !== strategy.supportedFindingTypes.length) {
    throw new TypeError(`${strategy.strategyId} declares duplicate finding types`);
  }
  if (strategy.requiredSignalKinds.some((kind) => !signalKinds.has(kind))) {
    throw new TypeError(`${strategy.strategyId} declares an unknown signal kind`);
  }
  if (new Set(strategy.requiredSignalKinds).size !== strategy.requiredSignalKinds.length) {
    throw new TypeError(`${strategy.strategyId} declares duplicate signal kinds`);
  }
  if (strategy.aiRequirement !== 'NONE' || strategy.requiresAi === true) {
    throw new TypeError('WP1 registry accepts deterministic strategies only');
  }
  validateWork(strategy.work, strategy.strategyId);
};

export class DiscoveryStrategyRegistry {
  private readonly strategies: ReadonlyMap<string, DiscoveryStrategyV1>;

  public constructor(strategies: readonly DiscoveryStrategyV1[]) {
    const entries = new Map<string, DiscoveryStrategyV1>();
    for (const strategy of strategies) {
      validateStrategy(strategy);
      const key = strategyKey(strategy);
      if (entries.has(key)) throw new TypeError(`Duplicate strategy id/version: ${key}`);
      entries.set(key, strategy);
    }
    this.strategies = new Map(
      [...entries.entries()].sort(([, left], [, right]) =>
        utf16OrdinalCompare(strategyKey(left), strategyKey(right)),
      ),
    );
  }

  public list(): readonly DiscoveryStrategyV1[] {
    return [...this.strategies.values()];
  }

  public get(strategyId: string, strategyVersion: string): DiscoveryStrategyV1 | undefined {
    return this.strategies.get(`${strategyId}\u0000${strategyVersion}`);
  }
}

export const createDiscoveryStrategyRegistry = (
  strategies: readonly DiscoveryStrategyV1[],
): DiscoveryStrategyRegistry => new DiscoveryStrategyRegistry(strategies);

const securityForCandidate = (
  context: DiscoverySignalReadContextV1,
  candidate: DiscoveryStrategyCandidateV1,
): DiscoverySecurityCompositionSuccessV1 | undefined => {
  const security = composeDiscoveryFindingSecurityV1({
    findingProjectId: context.projectId,
    resources: candidate.securityResources,
    executionContext: contextSecurity(context),
  });
  return security.materializable ? security : undefined;
};

const createInputDigest = (input: {
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly context: DiscoverySignalReadContextV1;
  readonly findingType: Wp1DiscoveryFindingType;
  readonly normalizedRelatedResourceRefs: readonly DiscoveryResourceRefV1[];
  readonly semanticEssence: string;
}): string =>
  sha256Text(
    semanticStableJson({
      schemaVersion: 'discovery-deterministic-input:v1',
      strategyId: input.strategyId,
      strategyVersion: input.strategyVersion,
      findingType: input.findingType,
      relatedResourceRefs: input.normalizedRelatedResourceRefs,
      semanticEssence: input.semanticEssence,
      sourceProjectionDigest: input.context.sourceProjectionDigest,
      canonicalBase: input.context.canonicalBase,
      discoveryBase: input.context.discoveryBase,
    }),
  );

export type DiscoveryFindingIdFactoryInputV1 = {
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly candidateIndex: number;
  readonly fingerprint: string;
};

export type DiscoveryGenerationDependenciesV1 = {
  readonly runId: string;
  readonly clock: { now(): string };
  readonly findingIdFactory: (input: DiscoveryFindingIdFactoryInputV1) => string;
};

export type DiscoveryGenerationRequestV1 = {
  readonly context: DiscoverySignalReadContextV1;
  readonly dependencies: DiscoveryGenerationDependenciesV1;
  readonly strategyIds?: readonly string[];
  readonly budget?: DiscoveryWorkBudgetPortV1;
};

const resourceKindsForEvidence = new Set<DiscoveryResourceKind>([
  'CANONICAL_CLAIM',
  'CANONICAL_ENTITY',
  'CANONICAL_EVENT',
  'CANONICAL_RELATION',
  'CANONICAL_CONFLICT',
  'CANONICAL_DECISION',
  'SOURCE',
  'SOURCE_VERSION',
  'COMPILED_TRUTH_ITEM',
]);

const makeKnowledgeGapStrategy = (): DiscoveryStrategyV1 => ({
  strategyId: 'akp-3.knowledge-gap.isolated-entity',
  strategyVersion: '1.0.0',
  supportedFindingTypes: ['KNOWLEDGE_GAP'],
  requiredSignalKinds: ['COMPILED_TRUTH', 'GRAPH'],
  aiRequirement: 'NONE',
  requiresAi: false,
  work: { maxResourcesRead: 100, maxObservationsReturned: 100, maxFindingsEmitted: 100 },
  async generate({ signals, maxFindings }): Promise<readonly DiscoveryStrategyCandidateV1[]> {
    const compiled = signals.compiledTruth;
    const graph = signals.graph;
    if (
      !compiled ||
      !graph ||
      compiled.completeness !== 'COMPLETE' ||
      graph.completeness !== 'COMPLETE'
    ) {
      return [];
    }
    const connectedIds = new Set(
      graph.edges.flatMap((edge) => [
        resourceKey(edge.from.resource),
        resourceKey(edge.to.resource),
      ]),
    );
    const resources = compiled.resources.filter(
      (entry) =>
        entry.resource.resourceKind === 'CANONICAL_ENTITY' &&
        (entry.resource.resourceState === 'CURRENT' ||
          entry.resource.resourceState === 'APPROVED') &&
        !connectedIds.has(resourceKey(entry.resource)),
    );
    return resources.slice(0, maxFindings).map((entry) => {
      const subject = text(entry.label, 'knowledge-gap subject');
      const semanticEssence = `isolated-entity:${resourceKey(entry.resource)}`;
      const question = `What approved relationship or context should be recorded for "${subject}"?`;
      const payload: KnowledgeGapPayloadV1 = {
        schemaVersion: '1.0.0',
        payloadType: 'KNOWLEDGE_GAP',
        gapKind: 'MISSING_FACT',
        subject,
        missingFact: `An approved relationship or context for "${subject}" is not recorded.`,
        question,
      };
      return {
        findingType: 'KNOWLEDGE_GAP',
        payload,
        relatedResourceRefs: [entry.resource],
        evidenceIds: [],
        semanticEssence,
        signalSummary: { graphTopology: 'ISOLATED' },
        rationale: `No approved graph edge was found for "${subject}". This identifies a knowledge gap; it does not assert that the relationship is false.`,
        derivationSummary:
          'Deterministic isolated-entity rule over authorized compiled truth and graph signals.',
        securityResources: [entry.security],
      };
    });
  },
});

const makeEvidenceGapStrategy = (): DiscoveryStrategyV1 => ({
  strategyId: 'akp-3.evidence-gap.absent-lineage',
  strategyVersion: '1.0.0',
  supportedFindingTypes: ['EVIDENCE_GAP'],
  requiredSignalKinds: ['EVIDENCE_COVERAGE'],
  aiRequirement: 'NONE',
  requiresAi: false,
  work: { maxResourcesRead: 100, maxObservationsReturned: 100, maxFindingsEmitted: 100 },
  async generate({ signals, maxFindings }): Promise<readonly DiscoveryStrategyCandidateV1[]> {
    const coverage = signals.evidenceCoverage;
    if (!coverage || coverage.completeness !== 'COMPLETE') return [];
    return coverage.resources
      .filter(
        (entry) =>
          resourceKindsForEvidence.has(entry.resource.resourceKind) &&
          (entry.resource.resourceState === 'CURRENT' ||
            entry.resource.resourceState === 'APPROVED') &&
          entry.evidenceIds.length === 0,
      )
      .slice(0, maxFindings)
      .map((entry) => {
        const subject = text(entry.label, 'evidence-gap subject');
        const semanticEssence = `absent-evidence:${resourceKey(entry.resource)}`;
        const payload: EvidenceGapPayloadV1 = {
          schemaVersion: '1.0.0',
          payloadType: 'EVIDENCE_GAP',
          coverageKind: 'ABSENT',
          affectedResourceRef: entry.resource,
          coverageGap: `No evidence lineage is attached to "${subject}".`,
          requiredEvidence: `Attach at least one EvidenceSpan lineage for "${subject}".`,
        };
        return {
          findingType: 'EVIDENCE_GAP',
          payload,
          relatedResourceRefs: [entry.resource],
          evidenceIds: [],
          semanticEssence,
          signalSummary: { evidenceCoverage: 0 },
          rationale: `Evidence lineage is absent for "${subject}". Absence of evidence is not treated as evidence that the resource proposition is false.`,
          derivationSummary:
            'Deterministic absent-evidence rule over an authorized typed resource.',
          securityResources: [entry.security],
        };
      });
  },
});

export const createWp1DiscoveryStrategyRegistry = (): DiscoveryStrategyRegistry =>
  createDiscoveryStrategyRegistry([makeEvidenceGapStrategy(), makeKnowledgeGapStrategy()]);

export const WP1_DISCOVERY_STRATEGIES = [
  makeEvidenceGapStrategy(),
  makeKnowledgeGapStrategy(),
] as const satisfies readonly DiscoveryStrategyV1[];

export type DiscoveryGenerationResultV1 = {
  readonly findings: readonly DiscoveryFindingEnvelopeV1[];
  readonly completion: 'COMPLETE' | 'PARTIAL';
  readonly truncation:
    | { readonly truncated: false }
    | {
        readonly truncated: true;
        readonly reason: DiscoveryWorkBudgetExhaustedV1['reason'];
      };
};

export type DiscoveryEngineV1 = {
  generate(input: DiscoveryGenerationRequestV1): Promise<readonly DiscoveryFindingEnvelopeV1[]>;
  generateBudgeted(input: DiscoveryGenerationRequestV1): Promise<DiscoveryGenerationResultV1>;
};

const materializeCandidate = (
  strategy: DiscoveryStrategyV1,
  candidate: DiscoveryStrategyCandidateV1,
  context: DiscoverySignalReadContextV1,
  dependencies: DiscoveryGenerationDependenciesV1,
  candidateIndex: number,
): DiscoveryFindingEnvelopeV1 | undefined => {
  if (
    candidate.payload.payloadType !== candidate.findingType ||
    candidate.relatedResourceRefs.some((resource) => resource.projectId !== context.projectId)
  ) {
    return undefined;
  }
  const security = securityForCandidate(context, candidate);
  if (!security) return undefined;
  const fingerprint = computeDiscoveryFingerprintV1({
    findingType: candidate.findingType,
    relatedResourceRefs: candidate.relatedResourceRefs,
    semanticEssence: candidate.semanticEssence,
  });
  const findingId = text(
    dependencies.findingIdFactory({
      strategyId: strategy.strategyId,
      strategyVersion: strategy.strategyVersion,
      candidateIndex,
      fingerprint: fingerprint.fingerprint,
    }),
    'findingIdFactory result',
  );
  const createdAt = text(dependencies.clock.now(), 'clock.now result');
  const inputDigest = createInputDigest({
    strategyId: strategy.strategyId,
    strategyVersion: strategy.strategyVersion,
    context,
    findingType: candidate.findingType,
    normalizedRelatedResourceRefs: fingerprint.normalizedInput.relatedResourceRefs,
    semanticEssence: fingerprint.normalizedInput.semanticEssence,
  });
  const envelopeInput = {
    schemaVersion: '1.0.0',
    findingId,
    findingRevision: 1,
    projectId: context.projectId,
    generationMethod: 'DETERMINISTIC',
    lifecycleState: 'NEW',
    payload: candidate.payload,
    relatedResourceRefs: candidate.relatedResourceRefs,
    evidenceIds: candidate.evidenceIds,
    sourceProjectionDigest: context.sourceProjectionDigest,
    canonicalBase: context.canonicalBase,
    discoveryBase: context.discoveryBase,
    runId: dependencies.runId,
    signalSummary: candidate.signalSummary,
    rationale: candidate.rationale,
    derivationSummary: candidate.derivationSummary,
    provenance: {
      schemaVersion: '1.0.0',
      kind: 'DETERMINISTIC',
      ruleId: strategy.strategyId,
      ruleVersion: strategy.strategyVersion,
      inputDigest,
    },
    accessScope: security.accessScope,
    sensitivity: security.sensitivity,
    fingerprint: fingerprint.fingerprint,
    fingerprintVersion: fingerprint.fingerprintVersion,
    retentionClass: 'DURABLE_DERIVED_RECORD',
    createdAt,
  } as const;
  return candidate.findingType === 'KNOWLEDGE_GAP'
    ? createDiscoveryFindingEnvelopeV1({
        ...envelopeInput,
        findingType: 'KNOWLEDGE_GAP',
        payload: candidate.payload as KnowledgeGapPayloadV1,
      })
    : createDiscoveryFindingEnvelopeV1({
        ...envelopeInput,
        findingType: 'EVIDENCE_GAP',
        payload: candidate.payload as EvidenceGapPayloadV1,
      });
};

export const createDiscoveryEngine = (input: {
  readonly facade: DiscoverySignalFacade;
  readonly registry: DiscoveryStrategyRegistry;
}): DiscoveryEngineV1 => {
  const generateBudgeted = async ({
    context,
    dependencies,
    strategyIds,
    budget,
  }: DiscoveryGenerationRequestV1): Promise<DiscoveryGenerationResultV1> => {
    const effectiveContext =
      context.budget === undefined && budget !== undefined ? { ...context, budget } : context;
    assertContext(effectiveContext);
    text(dependencies.runId, 'runId');
    const requested = strategyIds === undefined ? undefined : new Set(strategyIds);
    const strategies = input.registry
      .list()
      .filter((strategy) => requested === undefined || requested.has(strategy.strategyId));
    const findings: DiscoveryFindingEnvelopeV1[] = [];
    let budgetExhaustion: DiscoveryWorkBudgetExhaustedV1 | undefined;
    strategyLoop: for (const strategy of strategies) {
      const signals = await input.facade.readForStrategy(effectiveContext, strategy);
      if (budgetExhaustion === undefined && signals.budget !== undefined) {
        budgetExhaustion = signals.budget;
      }
      const maxFindings = Math.min(
        effectiveContext.bounds.maxFindingsEmitted,
        strategy.work.maxFindingsEmitted,
      );
      const candidates = await strategy.generate({
        context: effectiveContext,
        signals,
        maxFindings,
      });
      for (const [candidateIndex, candidate] of candidates.slice(0, maxFindings).entries()) {
        const findingAdmission = effectiveContext.budget?.admitWork('findings');
        if (findingAdmission?.status === 'BUDGET_EXHAUSTED') {
          if (budgetExhaustion === undefined) budgetExhaustion = findingAdmission;
          break strategyLoop;
        }
        const finding = materializeCandidate(
          strategy,
          candidate,
          effectiveContext,
          dependencies,
          candidateIndex,
        );
        if (finding) findings.push(finding);
      }
      if (signals.budget !== undefined) break strategyLoop;
    }
    return budgetExhaustion === undefined
      ? { findings, completion: 'COMPLETE', truncation: { truncated: false } }
      : {
          findings,
          completion: 'PARTIAL',
          truncation: { truncated: true, reason: budgetExhaustion.reason },
        };
  };

  return {
    generateBudgeted,
    generate: async (request) => (await generateBudgeted(request)).findings,
  };
};
