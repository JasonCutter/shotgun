import {
  DISCOVERY_RESOURCE_KINDS,
  DISCOVERY_RESOURCE_STATES,
  composeDiscoveryFindingSecurityV1,
  semanticStableJson,
  sha256Text,
  utf16OrdinalCompare,
} from '../../../packages/contracts/src/index.js';
import type {
  DiscoveryCanonicalBaseIdentityV1,
  DiscoveryProjectionBaseIdentityV1,
  DiscoveryResourceKind,
  DiscoveryResourceRefV1,
  DiscoverySecurityCompositionSuccessV1,
  DiscoveryServerSecurityInputV1,
} from '../../../packages/contracts/src/index.js';
import type {
  DiscoverySignalReadContextV1,
  DiscoverySignalResourceV1,
  DiscoverySignalCompletenessV1,
} from './active-discovery.js';

/**
 * AKP-3 WP2 is the bounded, pre-AI candidate-space boundary. Its values are
 * intentionally ephemeral and are not DiscoveryFinding envelopes.
 */
export const DISCOVERY_HYPOTHESIS_TARGET_FINDING_TYPES_V1 = [
  'RELATION_HYPOTHESIS',
  'PATTERN_HYPOTHESIS',
  'CONFLICT_HYPOTHESIS',
] as const;
export type DiscoveryHypothesisTargetFindingTypeV1 =
  (typeof DISCOVERY_HYPOTHESIS_TARGET_FINDING_TYPES_V1)[number];

export const DISCOVERY_NEIGHBORHOOD_SIGNAL_KINDS_V1 = [
  'ANCHORED_SEMANTIC_NEIGHBORHOOD',
  'EXISTING_GRAPH_RELATION',
  'TEMPORAL_COMPATIBILITY',
  'COMPETING_RESOURCE',
  'EXISTING_CANONICAL_CONFLICT',
] as const;
export type DiscoveryNeighborhoodSignalKindV1 =
  (typeof DISCOVERY_NEIGHBORHOOD_SIGNAL_KINDS_V1)[number];

export const DISCOVERY_NEIGHBORHOOD_AI_REQUIREMENT_V1 = 'NONE' as const;
export const DISCOVERY_NEIGHBORHOOD_RETENTION_CLASS_V1 = 'EPHEMERAL_PRE_MATERIALIZATION' as const;

export type DiscoveryNeighborhoodBoundsV1 = {
  readonly maxAnchors: number;
  readonly maxNeighborsPerAnchor: number;
  readonly maxCandidatePairs: number;
  readonly maxCandidateGroups: number;
  readonly maxMembersPerGroup: number;
};

export type DiscoveryNeighborhoodCompletenessV1 = DiscoverySignalCompletenessV1;

export type DiscoveryNeighborhoodBaseIdentityV1 = {
  readonly sourceProjectionDigest: string;
  readonly canonicalBase: DiscoveryCanonicalBaseIdentityV1;
  readonly discoveryBase: DiscoveryProjectionBaseIdentityV1;
  readonly semanticGenerationId: string;
};

export type DiscoveryAnchoredSemanticNeighborV1 = DiscoveryNeighborhoodBaseIdentityV1 & {
  readonly resource: DiscoverySignalResourceV1;
  readonly semanticRank: number;
  readonly semanticDistance?: number;
  readonly semanticSimilarity?: number;
  readonly lexicalRank?: number;
  readonly fusionRank?: number;
};

export type DiscoveryAnchoredSemanticNeighborhoodV1 = DiscoveryNeighborhoodBaseIdentityV1 & {
  readonly anchor: DiscoverySignalResourceV1;
  readonly neighbors: readonly DiscoveryAnchoredSemanticNeighborV1[];
  readonly completeness: DiscoveryNeighborhoodCompletenessV1;
};

export type DiscoveryExistingGraphRelationV1 = {
  readonly from: DiscoveryResourceRefV1;
  readonly to: DiscoveryResourceRefV1;
  readonly relationType: string;
};

export type DiscoveryExistingGraphRelationSignalV1 = DiscoveryNeighborhoodBaseIdentityV1 & {
  readonly relations: readonly DiscoveryExistingGraphRelationV1[];
  readonly completeness: DiscoveryNeighborhoodCompletenessV1;
};

export type DiscoveryTemporalCompatibilityV1 = {
  readonly left: DiscoveryResourceRefV1;
  readonly right: DiscoveryResourceRefV1;
  readonly compatible: boolean;
  readonly temporalEvidenceId: string;
};

export type DiscoveryTemporalCompatibilitySignalV1 = DiscoveryNeighborhoodBaseIdentityV1 & {
  readonly compatibilities: readonly DiscoveryTemporalCompatibilityV1[];
  readonly completeness: DiscoveryNeighborhoodCompletenessV1;
};

export const DISCOVERY_INCOMPATIBILITY_KINDS_V1 = [
  'FACTUAL',
  'TEMPORAL',
  'IDENTITY',
  'MODEL_DISAGREEMENT',
] as const;
export type DiscoveryIncompatibilityKindV1 = (typeof DISCOVERY_INCOMPATIBILITY_KINDS_V1)[number];

export const DISCOVERY_INCOMPATIBILITY_SOURCES_V1 = [
  'TYPED_PROPOSITION',
  'TEMPORAL_QUALIFICATION',
  'IDENTITY_ASSIGNMENT',
  'EXPLICIT_CONFLICT_SIGNAL',
] as const;
export type DiscoveryIncompatibilitySourceV1 =
  (typeof DISCOVERY_INCOMPATIBILITY_SOURCES_V1)[number];

export type DiscoveryCompetingResourceV1 = {
  readonly left: DiscoveryResourceRefV1;
  readonly right: DiscoveryResourceRefV1;
  readonly kind: DiscoveryIncompatibilityKindV1;
  readonly source: DiscoveryIncompatibilitySourceV1;
  readonly signalId: string;
  /** Required for temporal incompatibility; free-text temporal reasoning is not accepted. */
  readonly temporalOverlap?: boolean;
};

export type DiscoveryCompetingResourceSignalV1 = DiscoveryNeighborhoodBaseIdentityV1 & {
  readonly competitions: readonly DiscoveryCompetingResourceV1[];
  readonly completeness: DiscoveryNeighborhoodCompletenessV1;
};

export type DiscoveryExistingCanonicalConflictV1 = {
  readonly participantResourceRefs: readonly [
    DiscoveryResourceRefV1,
    DiscoveryResourceRefV1,
    ...DiscoveryResourceRefV1[],
  ];
};

export type DiscoveryExistingCanonicalConflictSignalV1 = DiscoveryNeighborhoodBaseIdentityV1 & {
  readonly conflicts: readonly DiscoveryExistingCanonicalConflictV1[];
  readonly completeness: DiscoveryNeighborhoodCompletenessV1;
};

export type DiscoveryAnchoredSemanticNeighborhoodReadInputV1 = {
  readonly context: DiscoverySignalReadContextV1;
  readonly anchor: DiscoverySignalResourceV1;
  readonly limit: number;
};

export type DiscoveryAnchoredSemanticNeighborhoodPortV1 = {
  read(
    input: DiscoveryAnchoredSemanticNeighborhoodReadInputV1,
  ): Promise<DiscoveryAnchoredSemanticNeighborhoodV1>;
};

export type DiscoveryExistingGraphRelationReadInputV1 = {
  readonly context: DiscoverySignalReadContextV1;
  readonly resourceRefs: readonly DiscoveryResourceRefV1[];
};

export type DiscoveryExistingGraphRelationPortV1 = {
  read(
    input: DiscoveryExistingGraphRelationReadInputV1,
  ): Promise<DiscoveryExistingGraphRelationSignalV1>;
};

export type DiscoveryTemporalCompatibilityReadInputV1 = {
  readonly context: DiscoverySignalReadContextV1;
  readonly resourceRefs: readonly DiscoveryResourceRefV1[];
};

export type DiscoveryTemporalCompatibilityPortV1 = {
  read(
    input: DiscoveryTemporalCompatibilityReadInputV1,
  ): Promise<DiscoveryTemporalCompatibilitySignalV1>;
};

export type DiscoveryCompetingResourceReadInputV1 = {
  readonly context: DiscoverySignalReadContextV1;
  readonly resourceRefs: readonly DiscoveryResourceRefV1[];
};

export type DiscoveryCompetingResourcePortV1 = {
  read(input: DiscoveryCompetingResourceReadInputV1): Promise<DiscoveryCompetingResourceSignalV1>;
};

export type DiscoveryExistingCanonicalConflictReadInputV1 = {
  readonly context: DiscoverySignalReadContextV1;
  readonly resourceRefs: readonly DiscoveryResourceRefV1[];
};

export type DiscoveryExistingCanonicalConflictPortV1 = {
  read(
    input: DiscoveryExistingCanonicalConflictReadInputV1,
  ): Promise<DiscoveryExistingCanonicalConflictSignalV1>;
};

export type DiscoveryNeighborhoodSignalPortsV1 = {
  readonly semanticNeighborhood: DiscoveryAnchoredSemanticNeighborhoodPortV1;
  readonly graphRelation?: DiscoveryExistingGraphRelationPortV1;
  readonly temporalCompatibility?: DiscoveryTemporalCompatibilityPortV1;
  readonly competingResource?: DiscoveryCompetingResourcePortV1;
  readonly existingCanonicalConflict?: DiscoveryExistingCanonicalConflictPortV1;
};

export type DiscoveryNeighborhoodSignalBundleV1 = {
  readonly context: DiscoverySignalReadContextV1;
  readonly anchors: readonly DiscoverySignalResourceV1[];
  readonly semanticNeighborhoods: readonly DiscoveryAnchoredSemanticNeighborhoodV1[];
  readonly graphRelation?: DiscoveryExistingGraphRelationSignalV1;
  readonly temporalCompatibility?: DiscoveryTemporalCompatibilitySignalV1;
  readonly competingResource?: DiscoveryCompetingResourceSignalV1;
  readonly existingCanonicalConflict?: DiscoveryExistingCanonicalConflictSignalV1;
  readonly completeness: DiscoveryNeighborhoodCompletenessV1;
};

export type DiscoveryNeighborhoodSelectionSignalV1 =
  | {
      readonly kind: 'SEMANTIC_NEIGHBOR';
      readonly semanticRank: number;
      readonly semanticDistance?: number;
      readonly semanticSimilarity?: number;
      readonly lexicalRank?: number;
      readonly fusionRank?: number;
    }
  | { readonly kind: 'GRAPH_ABSENCE'; readonly graphCompleteness: 'COMPLETE' }
  | {
      readonly kind: 'TEMPORAL_COMPATIBILITY';
      readonly temporalEvidenceId: string;
    }
  | {
      readonly kind: 'ANCHOR_MEMBERSHIP';
      readonly memberCount: number;
    }
  | {
      readonly kind: 'EXPLICIT_INCOMPATIBILITY';
      readonly incompatibilityKind: DiscoveryIncompatibilityKindV1;
      readonly source: DiscoveryIncompatibilitySourceV1;
      readonly signalId: string;
    };

export type DiscoveryHypothesisCandidateV1 = {
  readonly retentionClass: typeof DISCOVERY_NEIGHBORHOOD_RETENTION_CLASS_V1;
  readonly targetFindingType: DiscoveryHypothesisTargetFindingTypeV1;
  readonly anchor: DiscoveryResourceRefV1;
  readonly memberResourceRefs: readonly [
    DiscoveryResourceRefV1,
    DiscoveryResourceRefV1,
    ...DiscoveryResourceRefV1[],
  ];
  readonly security: DiscoverySecurityCompositionSuccessV1;
  readonly sourceProjectionDigest: string;
  readonly canonicalBase: DiscoveryCanonicalBaseIdentityV1;
  readonly discoveryBase: DiscoveryProjectionBaseIdentityV1;
  readonly semanticGenerationId: string;
  readonly selectionSignals: readonly DiscoveryNeighborhoodSelectionSignalV1[];
  readonly provenance: {
    readonly selectorId: string;
    readonly selectorVersion: string;
    readonly inputDigest: string;
    readonly anchorResourceKey: string;
    readonly selectionSignals: readonly DiscoveryNeighborhoodSelectionSignalV1[];
  };
};

export type DiscoveryNeighborhoodSelectionResultV1 = {
  readonly retentionClass: typeof DISCOVERY_NEIGHBORHOOD_RETENTION_CLASS_V1;
  readonly selectorId: string;
  readonly selectorVersion: string;
  readonly candidates: readonly DiscoveryHypothesisCandidateV1[];
  readonly completeness: DiscoveryNeighborhoodCompletenessV1;
};

export type DiscoveryNeighborhoodSelectionInputV1 = {
  readonly signals: DiscoveryNeighborhoodSignalBundleV1;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly bounds: DiscoveryNeighborhoodBoundsV1;
};

export type DiscoveryNeighborhoodStrategyDeclarationV1 = {
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly targetFindingType: DiscoveryHypothesisTargetFindingTypeV1;
  readonly requiredSignalKinds: readonly DiscoveryNeighborhoodSignalKindV1[];
  readonly aiRequirement: typeof DISCOVERY_NEIGHBORHOOD_AI_REQUIREMENT_V1;
  readonly work: DiscoveryNeighborhoodBoundsV1;
};

export type DiscoveryNeighborhoodStrategyV1 = DiscoveryNeighborhoodStrategyDeclarationV1 & {
  select(input: DiscoveryNeighborhoodSelectionInputV1): DiscoveryNeighborhoodSelectionResultV1;
};

const resourceKinds = new Set<DiscoveryResourceKind>(DISCOVERY_RESOURCE_KINDS);
const resourceStates = new Set<(typeof DISCOVERY_RESOURCE_STATES)[number]>(
  DISCOVERY_RESOURCE_STATES,
);
const targetFindingTypes = new Set<DiscoveryHypothesisTargetFindingTypeV1>(
  DISCOVERY_HYPOTHESIS_TARGET_FINDING_TYPES_V1,
);
const signalKinds = new Set<DiscoveryNeighborhoodSignalKindV1>(
  DISCOVERY_NEIGHBORHOOD_SIGNAL_KINDS_V1,
);

const text = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${field} must be a non-empty string`);
  return normalized;
};

const positiveBound = (value: number, field: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive finite integer`);
  }
  return value;
};

const validateBounds = (bounds: DiscoveryNeighborhoodBoundsV1, field = 'bounds'): void => {
  positiveBound(bounds.maxAnchors, `${field}.maxAnchors`);
  positiveBound(bounds.maxNeighborsPerAnchor, `${field}.maxNeighborsPerAnchor`);
  positiveBound(bounds.maxCandidatePairs, `${field}.maxCandidatePairs`);
  positiveBound(bounds.maxCandidateGroups, `${field}.maxCandidateGroups`);
  positiveBound(bounds.maxMembersPerGroup, `${field}.maxMembersPerGroup`);
};

const resourceKey = (resource: DiscoveryResourceRefV1): string =>
  [
    resource.projectId,
    resource.resourceKind,
    resource.resourceId,
    resource.resourceState,
    resource.resourceRevision ?? '',
  ].join('\u0000');

const orderedPairKey = (left: DiscoveryResourceRefV1, right: DiscoveryResourceRefV1): string => {
  const keys = [resourceKey(left), resourceKey(right)].sort(utf16OrdinalCompare);
  return `${keys[0] ?? ''}\u0000${keys[1] ?? ''}`;
};

const memberSetKey = (members: readonly DiscoveryResourceRefV1[]): string =>
  [...members].map(resourceKey).sort(utf16OrdinalCompare).join('\u0000');

const contextSecurity = (
  context: DiscoverySignalReadContextV1,
): DiscoveryServerSecurityInputV1 => ({
  projectId: context.projectId,
  accessScope: context.accessScope,
  sensitivity: context.sensitivity,
});

const assertResourceRef = (resource: DiscoveryResourceRefV1, field: string): void => {
  if (resource.schemaVersion !== '1.0.0')
    throw new TypeError(`${field}.schemaVersion is unsupported`);
  text(resource.projectId, `${field}.projectId`);
  text(resource.resourceId, `${field}.resourceId`);
  if (!resourceKinds.has(resource.resourceKind)) {
    throw new TypeError(`${field}.resourceKind is unsupported`);
  }
  if (!resourceStates.has(resource.resourceState)) {
    throw new TypeError(`${field}.resourceState is unsupported`);
  }
  if (resource.resourceRevision !== undefined)
    text(resource.resourceRevision, `${field}.resourceRevision`);
};

const assertContext = (context: DiscoverySignalReadContextV1): void => {
  if (context.schemaVersion !== '1.0.0')
    throw new TypeError('Unsupported neighborhood context schema');
  text(context.projectId, 'neighborhood context projectId');
  if (context.accessScope.length === 0)
    throw new TypeError('neighborhood context accessScope is empty');
  context.accessScope.forEach((scope, index) =>
    text(scope, `neighborhood context accessScope[${index}]`),
  );
  text(context.sourceProjectionDigest, 'neighborhood context sourceProjectionDigest');
  if (
    !Number.isSafeInteger(context.canonicalBase.canonicalVersion) ||
    context.canonicalBase.canonicalVersion < 0
  ) {
    throw new TypeError('neighborhood canonical base version must be non-negative');
  }
  text(context.canonicalBase.snapshotDigest, 'neighborhood canonical snapshotDigest');
  text(context.discoveryBase.projectionRevision, 'neighborhood projectionRevision');
  text(context.discoveryBase.projectionDigest, 'neighborhood projectionDigest');
  positiveBound(context.bounds.maxResourcesRead, 'context.bounds.maxResourcesRead');
  positiveBound(context.bounds.maxObservationsReturned, 'context.bounds.maxObservationsReturned');
  positiveBound(context.bounds.maxFindingsEmitted, 'context.bounds.maxFindingsEmitted');
};

const assertSignalResource = (
  context: DiscoverySignalReadContextV1,
  entry: DiscoverySignalResourceV1,
  field: string,
): void => {
  assertResourceRef(entry.resource, `${field}.resource`);
  if (
    entry.resource.projectId !== context.projectId ||
    entry.security.projectId !== context.projectId
  ) {
    throw new TypeError(`${field} is outside the authorized project`);
  }
  text(entry.label, `${field}.label`);
  entry.evidenceIds.forEach((id, index) => text(id, `${field}.evidenceIds[${index}]`));
};

const baseForContext = (context: DiscoverySignalReadContextV1, semanticGenerationId: string) => ({
  sourceProjectionDigest: context.sourceProjectionDigest,
  canonicalBase: context.canonicalBase,
  discoveryBase: context.discoveryBase,
  semanticGenerationId: text(semanticGenerationId, 'semanticGenerationId'),
});

const baseMatchesContext = (
  context: DiscoverySignalReadContextV1,
  base: DiscoveryNeighborhoodBaseIdentityV1,
): boolean =>
  base.sourceProjectionDigest === context.sourceProjectionDigest &&
  semanticStableJson(base.canonicalBase) === semanticStableJson(context.canonicalBase) &&
  semanticStableJson(base.discoveryBase) === semanticStableJson(context.discoveryBase) &&
  text(base.semanticGenerationId, 'semanticGenerationId').length > 0;

const completeness = (
  values: readonly DiscoveryNeighborhoodCompletenessV1[],
): DiscoveryNeighborhoodCompletenessV1 =>
  values.some((value) => value === 'TRUNCATED') ? 'TRUNCATED' : 'COMPLETE';

const normalizeUniqueResources = (
  context: DiscoverySignalReadContextV1,
  entries: readonly DiscoverySignalResourceV1[],
  field: string,
): readonly DiscoverySignalResourceV1[] => {
  const unique = new Map<string, DiscoverySignalResourceV1>();
  for (const [index, entry] of entries.entries()) {
    assertSignalResource(context, entry, `${field}[${index}]`);
    unique.set(resourceKey(entry.resource), entry);
  }
  return [...unique.values()].sort((left, right) =>
    utf16OrdinalCompare(resourceKey(left.resource), resourceKey(right.resource)),
  );
};

const compatibleRef = (
  context: DiscoverySignalReadContextV1,
  resource: DiscoveryResourceRefV1,
): boolean =>
  resource.projectId === context.projectId &&
  (resource.resourceState === 'CURRENT' || resource.resourceState === 'APPROVED');

const securityFor = (
  context: DiscoverySignalReadContextV1,
  resources: readonly DiscoverySignalResourceV1[],
): DiscoverySecurityCompositionSuccessV1 | undefined => {
  const result = composeDiscoveryFindingSecurityV1({
    findingProjectId: context.projectId,
    resources: resources.map((entry) => entry.security),
    executionContext: contextSecurity(context),
  });
  return result.materializable ? result : undefined;
};

const signalResourceMap = (
  neighborhoods: readonly DiscoveryAnchoredSemanticNeighborhoodV1[],
): ReadonlyMap<string, DiscoverySignalResourceV1> => {
  const resources = new Map<string, DiscoverySignalResourceV1>();
  for (const neighborhood of neighborhoods) {
    resources.set(resourceKey(neighborhood.anchor.resource), neighborhood.anchor);
    for (const neighbor of neighborhood.neighbors) {
      resources.set(resourceKey(neighbor.resource.resource), neighbor.resource);
    }
  }
  return resources;
};

const orderedNeighborhoods = (
  neighborhoods: readonly DiscoveryAnchoredSemanticNeighborhoodV1[],
): readonly DiscoveryAnchoredSemanticNeighborhoodV1[] =>
  [...neighborhoods].sort((left, right) =>
    utf16OrdinalCompare(resourceKey(left.anchor.resource), resourceKey(right.anchor.resource)),
  );

const orderedNeighbors = (
  neighbors: readonly DiscoveryAnchoredSemanticNeighborV1[],
): readonly DiscoveryAnchoredSemanticNeighborV1[] =>
  [...neighbors].sort((left, right) =>
    utf16OrdinalCompare(
      `${String(left.semanticRank).padStart(12, '0')}\u0000${resourceKey(left.resource.resource)}`,
      `${String(right.semanticRank).padStart(12, '0')}\u0000${resourceKey(right.resource.resource)}`,
    ),
  );

const refsFromResources = (
  resources: ReadonlyMap<string, DiscoverySignalResourceV1>,
): readonly DiscoveryResourceRefV1[] =>
  [...resources.values()]
    .map((entry) => entry.resource)
    .sort((left, right) => utf16OrdinalCompare(resourceKey(left), resourceKey(right)));

const normalizeNeighborhood = (
  context: DiscoverySignalReadContextV1,
  anchor: DiscoverySignalResourceV1,
  result: DiscoveryAnchoredSemanticNeighborhoodV1,
  limit: number,
): {
  readonly neighborhood: DiscoveryAnchoredSemanticNeighborhoodV1;
  readonly truncated: boolean;
} => {
  assertSignalResource(context, anchor, 'anchor');
  assertSignalResource(context, result.anchor, 'semantic neighborhood anchor');
  if (
    resourceKey(result.anchor.resource) !== resourceKey(anchor.resource) ||
    !baseMatchesContext(context, result)
  ) {
    return {
      neighborhood: {
        ...baseForContext(context, result.semanticGenerationId),
        anchor,
        neighbors: [],
        completeness: 'TRUNCATED',
      },
      truncated: true,
    };
  }
  const unique = new Map<string, DiscoveryAnchoredSemanticNeighborV1>();
  for (const [index, neighbor] of result.neighbors.entries()) {
    assertSignalResource(context, neighbor.resource, `semantic neighbor[${index}]`);
    if (
      !baseMatchesContext(context, neighbor) ||
      neighbor.semanticGenerationId !== result.semanticGenerationId
    )
      continue;
    if (!Number.isSafeInteger(neighbor.semanticRank) || neighbor.semanticRank < 1) continue;
    if (neighbor.semanticDistance !== undefined && !Number.isFinite(neighbor.semanticDistance))
      continue;
    if (
      neighbor.semanticSimilarity !== undefined &&
      (!Number.isFinite(neighbor.semanticSimilarity) ||
        neighbor.semanticSimilarity < 0 ||
        neighbor.semanticSimilarity > 1)
    )
      continue;
    if (
      neighbor.lexicalRank !== undefined &&
      (!Number.isSafeInteger(neighbor.lexicalRank) || neighbor.lexicalRank < 0)
    )
      continue;
    if (
      neighbor.fusionRank !== undefined &&
      (!Number.isSafeInteger(neighbor.fusionRank) || neighbor.fusionRank < 0)
    )
      continue;
    if (
      !compatibleRef(context, neighbor.resource.resource) ||
      resourceKey(neighbor.resource.resource) === resourceKey(anchor.resource)
    )
      continue;
    unique.set(resourceKey(neighbor.resource.resource), neighbor);
  }
  const ordered = [...unique.values()].sort((left, right) =>
    utf16OrdinalCompare(
      `${String(left.semanticRank).padStart(12, '0')}\u0000${resourceKey(left.resource.resource)}`,
      `${String(right.semanticRank).padStart(12, '0')}\u0000${resourceKey(right.resource.resource)}`,
    ),
  );
  return {
    neighborhood: {
      ...baseForContext(context, result.semanticGenerationId),
      anchor,
      neighbors: ordered.slice(0, limit),
      completeness:
        result.completeness === 'TRUNCATED' || ordered.length > limit ? 'TRUNCATED' : 'COMPLETE',
    },
    truncated: result.completeness === 'TRUNCATED' || ordered.length > limit,
  };
};

const compatibleSignalBase = (
  context: DiscoverySignalReadContextV1,
  signal: DiscoveryNeighborhoodBaseIdentityV1,
): boolean => baseMatchesContext(context, signal);

const normalizeGraphSignal = (
  context: DiscoverySignalReadContextV1,
  signal: DiscoveryExistingGraphRelationSignalV1,
): DiscoveryExistingGraphRelationSignalV1 => ({
  ...baseForContext(context, signal.semanticGenerationId),
  relations: signal.relations
    .filter((relation) => {
      assertResourceRef(relation.from, 'graph relation.from');
      assertResourceRef(relation.to, 'graph relation.to');
      return (
        compatibleRef(context, relation.from) &&
        compatibleRef(context, relation.to) &&
        text(relation.relationType, 'graph relationType').length > 0
      );
    })
    .sort((left, right) =>
      utf16OrdinalCompare(orderedPairKey(left.from, left.to), orderedPairKey(right.from, right.to)),
    ),
  completeness: signal.completeness,
});

const selectionResource = (
  resources: ReadonlyMap<string, DiscoverySignalResourceV1>,
  reference: DiscoveryResourceRefV1,
): DiscoverySignalResourceV1 | undefined => resources.get(resourceKey(reference));

const candidateInputDigest = (input: {
  readonly selectorId: string;
  readonly selectorVersion: string;
  readonly targetFindingType: DiscoveryHypothesisTargetFindingTypeV1;
  readonly context: DiscoverySignalReadContextV1;
  readonly anchor: DiscoveryResourceRefV1;
  readonly members: readonly DiscoveryResourceRefV1[];
  readonly selectionSignals: readonly DiscoveryNeighborhoodSelectionSignalV1[];
}): string =>
  sha256Text(
    semanticStableJson({
      schemaVersion: 'akp-3-wp2-neighborhood-candidate:v1',
      selectorId: input.selectorId,
      selectorVersion: input.selectorVersion,
      targetFindingType: input.targetFindingType,
      anchor: input.anchor,
      members: input.members,
      selectionSignals: input.selectionSignals,
      sourceProjectionDigest: input.context.sourceProjectionDigest,
      canonicalBase: input.context.canonicalBase,
      discoveryBase: input.context.discoveryBase,
    }),
  );

const makeCandidate = (input: {
  readonly selectorId: string;
  readonly selectorVersion: string;
  readonly targetFindingType: DiscoveryHypothesisTargetFindingTypeV1;
  readonly context: DiscoverySignalReadContextV1;
  readonly semanticGenerationId: string;
  readonly anchor: DiscoverySignalResourceV1;
  readonly members: readonly [
    DiscoverySignalResourceV1,
    DiscoverySignalResourceV1,
    ...DiscoverySignalResourceV1[],
  ];
  readonly selectionSignals: readonly DiscoveryNeighborhoodSelectionSignalV1[];
}): DiscoveryHypothesisCandidateV1 | undefined => {
  const security = securityFor(input.context, input.members);
  if (!security) return undefined;
  const memberResourceRefs = input.members
    .map((entry) => entry.resource)
    .sort((left, right) =>
      utf16OrdinalCompare(resourceKey(left), resourceKey(right)),
    ) as unknown as DiscoveryHypothesisCandidateV1['memberResourceRefs'];
  const inputDigest = candidateInputDigest({
    selectorId: input.selectorId,
    selectorVersion: input.selectorVersion,
    targetFindingType: input.targetFindingType,
    context: input.context,
    anchor: input.anchor.resource,
    members: memberResourceRefs,
    selectionSignals: input.selectionSignals,
  });
  return {
    retentionClass: DISCOVERY_NEIGHBORHOOD_RETENTION_CLASS_V1,
    targetFindingType: input.targetFindingType,
    anchor: input.anchor.resource,
    memberResourceRefs,
    security,
    sourceProjectionDigest: input.context.sourceProjectionDigest,
    canonicalBase: input.context.canonicalBase,
    discoveryBase: input.context.discoveryBase,
    semanticGenerationId: input.semanticGenerationId,
    selectionSignals: input.selectionSignals,
    provenance: {
      selectorId: input.selectorId,
      selectorVersion: input.selectorVersion,
      inputDigest,
      anchorResourceKey: resourceKey(input.anchor.resource),
      selectionSignals: input.selectionSignals,
    },
  };
};

const baseSelectionResult = (
  input: DiscoveryNeighborhoodSelectionInputV1,
  candidates: readonly DiscoveryHypothesisCandidateV1[],
  resultCompleteness: DiscoveryNeighborhoodCompletenessV1,
): DiscoveryNeighborhoodSelectionResultV1 => ({
  retentionClass: DISCOVERY_NEIGHBORHOOD_RETENTION_CLASS_V1,
  selectorId: input.strategyId,
  selectorVersion: input.strategyVersion,
  candidates: [...candidates].sort((left, right) =>
    utf16OrdinalCompare(
      [
        left.targetFindingType,
        resourceKey(left.anchor),
        memberSetKey(left.memberResourceRefs),
        input.strategyId,
        input.strategyVersion,
      ].join('\u0000'),
      [
        right.targetFindingType,
        resourceKey(right.anchor),
        memberSetKey(right.memberResourceRefs),
        input.strategyId,
        input.strategyVersion,
      ].join('\u0000'),
    ),
  ),
  completeness: resultCompleteness,
});

const relationSelection = (
  input: DiscoveryNeighborhoodSelectionInputV1,
): DiscoveryNeighborhoodSelectionResultV1 => {
  const { signals, bounds } = input;
  const candidateLimit = Math.min(bounds.maxCandidatePairs, bounds.maxCandidateGroups);
  if (bounds.maxMembersPerGroup < 2 || candidateLimit < 1) {
    return baseSelectionResult(input, [], 'TRUNCATED');
  }
  const resources = signalResourceMap(signals.semanticNeighborhoods);
  const graph = signals.graphRelation;
  const temporal = signals.temporalCompatibility;
  if (
    !graph ||
    !temporal ||
    !compatibleSignalBase(signals.context, graph) ||
    !compatibleSignalBase(signals.context, temporal)
  ) {
    return baseSelectionResult(input, [], 'TRUNCATED');
  }
  if (graph.completeness !== 'COMPLETE') {
    return baseSelectionResult(input, [], 'TRUNCATED');
  }
  const existingPairs = new Set(
    graph.relations.map((relation) => orderedPairKey(relation.from, relation.to)),
  );
  const temporalByPair = new Map(
    temporal.compatibilities.map((entry) => [orderedPairKey(entry.left, entry.right), entry]),
  );
  const candidates: DiscoveryHypothesisCandidateV1[] = [];
  const seenPairs = new Set<string>();
  for (const neighborhood of orderedNeighborhoods(signals.semanticNeighborhoods)) {
    const anchor = resources.get(resourceKey(neighborhood.anchor.resource));
    if (!anchor || !compatibleRef(signals.context, anchor.resource)) continue;
    if (
      graph.semanticGenerationId !== neighborhood.semanticGenerationId ||
      temporal.semanticGenerationId !== neighborhood.semanticGenerationId
    )
      continue;
    for (const neighbor of orderedNeighbors(neighborhood.neighbors)) {
      const pairKey = orderedPairKey(anchor.resource, neighbor.resource.resource);
      if (seenPairs.has(pairKey) || existingPairs.has(pairKey)) continue;
      const temporalEntry = temporalByPair.get(pairKey);
      if (!temporalEntry?.compatible) continue;
      const neighborResource = resources.get(resourceKey(neighbor.resource.resource));
      if (!neighborResource || !compatibleRef(signals.context, neighborResource.resource)) continue;
      const selectionSignals: DiscoveryNeighborhoodSelectionSignalV1[] = [
        {
          kind: 'SEMANTIC_NEIGHBOR',
          semanticRank: neighbor.semanticRank,
          ...(neighbor.semanticDistance === undefined
            ? {}
            : { semanticDistance: neighbor.semanticDistance }),
          ...(neighbor.semanticSimilarity === undefined
            ? {}
            : { semanticSimilarity: neighbor.semanticSimilarity }),
          ...(neighbor.lexicalRank === undefined ? {} : { lexicalRank: neighbor.lexicalRank }),
          ...(neighbor.fusionRank === undefined ? {} : { fusionRank: neighbor.fusionRank }),
        },
        { kind: 'GRAPH_ABSENCE', graphCompleteness: 'COMPLETE' },
        { kind: 'TEMPORAL_COMPATIBILITY', temporalEvidenceId: temporalEntry.temporalEvidenceId },
      ];
      const candidate = makeCandidate({
        selectorId: input.strategyId,
        selectorVersion: input.strategyVersion,
        targetFindingType: 'RELATION_HYPOTHESIS',
        context: signals.context,
        semanticGenerationId: neighborhood.semanticGenerationId,
        anchor,
        members: [anchor, neighborResource],
        selectionSignals,
      });
      if (!candidate) continue;
      seenPairs.add(pairKey);
      candidates.push(candidate);
      if (candidates.length >= candidateLimit) {
        return baseSelectionResult(input, candidates, 'TRUNCATED');
      }
    }
  }
  return baseSelectionResult(
    input,
    candidates,
    completeness([
      signals.completeness,
      ...signals.semanticNeighborhoods.map((entry) => entry.completeness),
      graph.completeness,
      temporal.completeness,
    ]),
  );
};

const patternSelection = (
  input: DiscoveryNeighborhoodSelectionInputV1,
): DiscoveryNeighborhoodSelectionResultV1 => {
  const { signals, bounds } = input;
  const groupLimit = Math.min(bounds.maxCandidateGroups, bounds.maxCandidatePairs);
  const resources = signalResourceMap(signals.semanticNeighborhoods);
  const candidates: DiscoveryHypothesisCandidateV1[] = [];
  const seenGroups = new Set<string>();
  let truncated = signals.completeness === 'TRUNCATED';
  for (const neighborhood of orderedNeighborhoods(signals.semanticNeighborhoods)) {
    const anchor = resources.get(resourceKey(neighborhood.anchor.resource));
    if (!anchor || !compatibleRef(signals.context, anchor.resource)) continue;
    const members = [anchor];
    const seenMembers = new Set([resourceKey(anchor.resource)]);
    for (const neighbor of orderedNeighbors(neighborhood.neighbors)) {
      const entry = resources.get(resourceKey(neighbor.resource.resource));
      if (
        !entry ||
        !compatibleRef(signals.context, entry.resource) ||
        seenMembers.has(resourceKey(entry.resource))
      )
        continue;
      if (members.length >= bounds.maxMembersPerGroup) {
        truncated = true;
        break;
      }
      members.push(entry);
      seenMembers.add(resourceKey(entry.resource));
    }
    if (neighborhood.completeness === 'TRUNCATED') truncated = true;
    if (members.length < 2) continue;
    const groupKey = memberSetKey(members.map((entry) => entry.resource));
    if (seenGroups.has(groupKey)) continue;
    if (candidates.length >= groupLimit) {
      truncated = true;
      break;
    }
    const selectionSignals: DiscoveryNeighborhoodSelectionSignalV1[] = [
      { kind: 'ANCHOR_MEMBERSHIP', memberCount: members.length },
    ];
    const candidate = makeCandidate({
      selectorId: input.strategyId,
      selectorVersion: input.strategyVersion,
      targetFindingType: 'PATTERN_HYPOTHESIS',
      context: signals.context,
      semanticGenerationId: neighborhood.semanticGenerationId,
      anchor,
      members: members as [
        DiscoverySignalResourceV1,
        DiscoverySignalResourceV1,
        ...DiscoverySignalResourceV1[],
      ],
      selectionSignals,
    });
    if (!candidate) continue;
    seenGroups.add(groupKey);
    candidates.push(candidate);
  }
  return baseSelectionResult(input, candidates, truncated ? 'TRUNCATED' : 'COMPLETE');
};

const conflictSelection = (
  input: DiscoveryNeighborhoodSelectionInputV1,
): DiscoveryNeighborhoodSelectionResultV1 => {
  const { signals, bounds } = input;
  const candidateLimit = Math.min(bounds.maxCandidatePairs, bounds.maxCandidateGroups);
  if (bounds.maxMembersPerGroup < 2 || candidateLimit < 1) {
    return baseSelectionResult(input, [], 'TRUNCATED');
  }
  const resources = signalResourceMap(signals.semanticNeighborhoods);
  const competition = signals.competingResource;
  const existingConflict = signals.existingCanonicalConflict;
  if (
    !competition ||
    !existingConflict ||
    !compatibleSignalBase(signals.context, competition) ||
    !compatibleSignalBase(signals.context, existingConflict)
  ) {
    return baseSelectionResult(input, [], 'TRUNCATED');
  }
  const existingPairs = new Set(
    existingConflict.conflicts.map((conflict) =>
      conflict.participantResourceRefs.length === 2
        ? orderedPairKey(conflict.participantResourceRefs[0], conflict.participantResourceRefs[1])
        : memberSetKey(conflict.participantResourceRefs),
    ),
  );
  const semanticPairs = new Set(
    orderedNeighborhoods(signals.semanticNeighborhoods).flatMap((neighborhood) =>
      orderedNeighbors(neighborhood.neighbors).map((neighbor) =>
        orderedPairKey(neighborhood.anchor.resource, neighbor.resource.resource),
      ),
    ),
  );
  const candidates: DiscoveryHypothesisCandidateV1[] = [];
  const seenPairs = new Set<string>();
  let truncated =
    signals.completeness === 'TRUNCATED' ||
    competition.completeness === 'TRUNCATED' ||
    existingConflict.completeness === 'TRUNCATED';
  for (const signal of [...competition.competitions].sort((left, right) =>
    utf16OrdinalCompare(
      `${orderedPairKey(left.left, left.right)}\u0000${left.signalId}`,
      `${orderedPairKey(right.left, right.right)}\u0000${right.signalId}`,
    ),
  )) {
    assertResourceRef(signal.left, 'competition.left');
    assertResourceRef(signal.right, 'competition.right');
    if (!semanticPairs.has(orderedPairKey(signal.left, signal.right))) continue;
    if (signal.kind === 'TEMPORAL' && signal.temporalOverlap !== true) continue;
    const pairKey = orderedPairKey(signal.left, signal.right);
    if (
      seenPairs.has(pairKey) ||
      existingPairs.has(pairKey) ||
      pairKey.split('\u0000').some((entry) => entry.length === 0)
    )
      continue;
    const left = selectionResource(resources, signal.left);
    const right = selectionResource(resources, signal.right);
    if (
      !left ||
      !right ||
      !compatibleRef(signals.context, left.resource) ||
      !compatibleRef(signals.context, right.resource)
    )
      continue;
    const sourceNeighborhood = signals.semanticNeighborhoods.find((neighborhood) =>
      neighborhood.neighbors.some(
        (neighbor) =>
          orderedPairKey(neighborhood.anchor.resource, neighbor.resource.resource) === pairKey,
      ),
    );
    if (
      !sourceNeighborhood ||
      sourceNeighborhood.semanticGenerationId !== competition.semanticGenerationId
    )
      continue;
    if (candidates.length >= candidateLimit) {
      truncated = true;
      break;
    }
    const anchor = resourceKey(left.resource) === resourceKey(signal.left) ? left : right;
    const selectionSignals: DiscoveryNeighborhoodSelectionSignalV1[] = [
      {
        kind: 'EXPLICIT_INCOMPATIBILITY',
        incompatibilityKind: signal.kind,
        source: signal.source,
        signalId: signal.signalId,
      },
    ];
    const candidate = makeCandidate({
      selectorId: input.strategyId,
      selectorVersion: input.strategyVersion,
      targetFindingType: 'CONFLICT_HYPOTHESIS',
      context: signals.context,
      semanticGenerationId: competition.semanticGenerationId,
      anchor,
      members: [left, right],
      selectionSignals,
    });
    if (!candidate) continue;
    seenPairs.add(pairKey);
    candidates.push(candidate);
  }
  if (signals.semanticNeighborhoods.some((entry) => entry.completeness === 'TRUNCATED'))
    truncated = true;
  return baseSelectionResult(input, candidates, truncated ? 'TRUNCATED' : 'COMPLETE');
};

const validateStrategy = (strategy: DiscoveryNeighborhoodStrategyV1): void => {
  text(strategy.strategyId, 'strategyId');
  text(strategy.strategyVersion, 'strategyVersion');
  if (!targetFindingTypes.has(strategy.targetFindingType))
    throw new TypeError('unsupported WP2 target finding type');
  if (strategy.aiRequirement !== 'NONE') throw new TypeError('WP2 selectors cannot require AI');
  validateBounds(strategy.work, `${strategy.strategyId}.work`);
  if (strategy.requiredSignalKinds.some((kind) => !signalKinds.has(kind)))
    throw new TypeError('unknown WP2 signal kind');
  if (new Set(strategy.requiredSignalKinds).size !== strategy.requiredSignalKinds.length)
    throw new TypeError('duplicate WP2 signal kind');
};

export class DiscoveryNeighborhoodSignalFacade {
  public constructor(private readonly ports: DiscoveryNeighborhoodSignalPortsV1) {}

  public async readForStrategy(input: {
    readonly context: DiscoverySignalReadContextV1;
    readonly anchors: readonly DiscoverySignalResourceV1[];
    readonly strategy: DiscoveryNeighborhoodStrategyDeclarationV1;
  }): Promise<DiscoveryNeighborhoodSignalBundleV1> {
    assertContext(input.context);
    validateBounds(input.strategy.work, `${input.strategy.strategyId}.work`);
    const anchors = normalizeUniqueResources(input.context, input.anchors, 'anchors');
    const boundedAnchors = anchors.slice(0, input.strategy.work.maxAnchors);
    let truncated = anchors.length > boundedAnchors.length;
    const semanticNeighborhoods: DiscoveryAnchoredSemanticNeighborhoodV1[] = [];
    for (const anchor of boundedAnchors) {
      const result = await this.ports.semanticNeighborhood.read({
        context: input.context,
        anchor,
        limit: input.strategy.work.maxNeighborsPerAnchor,
      });
      const normalized = normalizeNeighborhood(
        input.context,
        anchor,
        result,
        input.strategy.work.maxNeighborsPerAnchor,
      );
      semanticNeighborhoods.push(normalized.neighborhood);
      truncated ||= normalized.truncated;
    }
    const resources = signalResourceMap(semanticNeighborhoods);
    const resourceRefs = refsFromResources(resources);
    const optional: {
      graphRelation?: DiscoveryExistingGraphRelationSignalV1;
      temporalCompatibility?: DiscoveryTemporalCompatibilitySignalV1;
      competingResource?: DiscoveryCompetingResourceSignalV1;
      existingCanonicalConflict?: DiscoveryExistingCanonicalConflictSignalV1;
    } = {};
    for (const kind of input.strategy.requiredSignalKinds) {
      switch (kind) {
        case 'ANCHORED_SEMANTIC_NEIGHBORHOOD':
          break;
        case 'EXISTING_GRAPH_RELATION':
          if (!this.ports.graphRelation)
            return {
              context: input.context,
              anchors: boundedAnchors,
              semanticNeighborhoods,
              completeness: 'TRUNCATED',
            };
          {
            const result = await this.ports.graphRelation.read({
              context: input.context,
              resourceRefs,
            });
            optional.graphRelation = compatibleSignalBase(input.context, result)
              ? normalizeGraphSignal(input.context, result)
              : {
                  ...baseForContext(input.context, result.semanticGenerationId),
                  relations: [],
                  completeness: 'TRUNCATED',
                };
            truncated ||= optional.graphRelation.completeness === 'TRUNCATED';
          }
          break;
        case 'TEMPORAL_COMPATIBILITY':
          if (!this.ports.temporalCompatibility)
            return {
              context: input.context,
              anchors: boundedAnchors,
              semanticNeighborhoods,
              completeness: 'TRUNCATED',
            };
          {
            const result = await this.ports.temporalCompatibility.read({
              context: input.context,
              resourceRefs,
            });
            optional.temporalCompatibility = compatibleSignalBase(input.context, result)
              ? result
              : {
                  ...baseForContext(input.context, result.semanticGenerationId),
                  compatibilities: [],
                  completeness: 'TRUNCATED',
                };
            truncated ||= optional.temporalCompatibility.completeness === 'TRUNCATED';
          }
          break;
        case 'COMPETING_RESOURCE':
          if (!this.ports.competingResource)
            return {
              context: input.context,
              anchors: boundedAnchors,
              semanticNeighborhoods,
              completeness: 'TRUNCATED',
            };
          {
            const result = await this.ports.competingResource.read({
              context: input.context,
              resourceRefs,
            });
            optional.competingResource = compatibleSignalBase(input.context, result)
              ? result
              : {
                  ...baseForContext(input.context, result.semanticGenerationId),
                  competitions: [],
                  completeness: 'TRUNCATED',
                };
            truncated ||= optional.competingResource.completeness === 'TRUNCATED';
          }
          break;
        case 'EXISTING_CANONICAL_CONFLICT':
          if (!this.ports.existingCanonicalConflict)
            return {
              context: input.context,
              anchors: boundedAnchors,
              semanticNeighborhoods,
              completeness: 'TRUNCATED',
            };
          {
            const result = await this.ports.existingCanonicalConflict.read({
              context: input.context,
              resourceRefs,
            });
            optional.existingCanonicalConflict = compatibleSignalBase(input.context, result)
              ? result
              : {
                  ...baseForContext(input.context, result.semanticGenerationId),
                  conflicts: [],
                  completeness: 'TRUNCATED',
                };
            truncated ||= optional.existingCanonicalConflict.completeness === 'TRUNCATED';
          }
          break;
      }
    }
    return {
      context: input.context,
      anchors: boundedAnchors,
      semanticNeighborhoods,
      ...optional,
      completeness: truncated
        ? 'TRUNCATED'
        : completeness([
            ...semanticNeighborhoods.map((entry) => entry.completeness),
            ...(optional.graphRelation ? [optional.graphRelation.completeness] : []),
            ...(optional.temporalCompatibility
              ? [optional.temporalCompatibility.completeness]
              : []),
            ...(optional.competingResource ? [optional.competingResource.completeness] : []),
            ...(optional.existingCanonicalConflict
              ? [optional.existingCanonicalConflict.completeness]
              : []),
          ]),
    };
  }
}

export const createDiscoveryNeighborhoodSignalFacade = (
  ports: DiscoveryNeighborhoodSignalPortsV1,
): DiscoveryNeighborhoodSignalFacade => new DiscoveryNeighborhoodSignalFacade(ports);

const relationStrategy = (): DiscoveryNeighborhoodStrategyV1 => ({
  strategyId: 'akp-3.relation.semantic-neighbor-graph-absence@1.0.0',
  strategyVersion: '1.0.0',
  targetFindingType: 'RELATION_HYPOTHESIS',
  requiredSignalKinds: [
    'ANCHORED_SEMANTIC_NEIGHBORHOOD',
    'EXISTING_GRAPH_RELATION',
    'TEMPORAL_COMPATIBILITY',
  ],
  aiRequirement: 'NONE',
  work: {
    maxAnchors: 100,
    maxNeighborsPerAnchor: 20,
    maxCandidatePairs: 100,
    maxCandidateGroups: 100,
    maxMembersPerGroup: 2,
  },
  select: relationSelection,
});

const patternStrategy = (): DiscoveryNeighborhoodStrategyV1 => ({
  strategyId: 'akp-3.pattern.bounded-typed-neighborhood@1.0.0',
  strategyVersion: '1.0.0',
  targetFindingType: 'PATTERN_HYPOTHESIS',
  requiredSignalKinds: ['ANCHORED_SEMANTIC_NEIGHBORHOOD'],
  aiRequirement: 'NONE',
  work: {
    maxAnchors: 100,
    maxNeighborsPerAnchor: 20,
    maxCandidatePairs: 100,
    maxCandidateGroups: 100,
    maxMembersPerGroup: 10,
  },
  select: patternSelection,
});

const conflictStrategy = (): DiscoveryNeighborhoodStrategyV1 => ({
  strategyId: 'akp-3.conflict.competing-current-resources@1.0.0',
  strategyVersion: '1.0.0',
  targetFindingType: 'CONFLICT_HYPOTHESIS',
  requiredSignalKinds: [
    'ANCHORED_SEMANTIC_NEIGHBORHOOD',
    'COMPETING_RESOURCE',
    'EXISTING_CANONICAL_CONFLICT',
  ],
  aiRequirement: 'NONE',
  work: {
    maxAnchors: 100,
    maxNeighborsPerAnchor: 20,
    maxCandidatePairs: 100,
    maxCandidateGroups: 100,
    maxMembersPerGroup: 2,
  },
  select: conflictSelection,
});

const strategyKey = (strategy: DiscoveryNeighborhoodStrategyDeclarationV1): string =>
  `${strategy.strategyId}\u0000${strategy.strategyVersion}`;

export class DiscoveryNeighborhoodStrategyRegistry {
  private readonly strategies: ReadonlyMap<string, DiscoveryNeighborhoodStrategyV1>;

  public constructor(strategies: readonly DiscoveryNeighborhoodStrategyV1[]) {
    const entries = new Map<string, DiscoveryNeighborhoodStrategyV1>();
    for (const strategy of strategies) {
      validateStrategy(strategy);
      const key = strategyKey(strategy);
      if (entries.has(key)) throw new TypeError(`Duplicate WP2 strategy: ${key}`);
      entries.set(key, strategy);
    }
    this.strategies = new Map(
      [...entries.entries()].sort(([, left], [, right]) =>
        utf16OrdinalCompare(strategyKey(left), strategyKey(right)),
      ),
    );
  }

  public list(): readonly DiscoveryNeighborhoodStrategyV1[] {
    return [...this.strategies.values()];
  }

  public get(
    strategyId: string,
    strategyVersion = '1.0.0',
  ): DiscoveryNeighborhoodStrategyV1 | undefined {
    return this.strategies.get(`${strategyId}\u0000${strategyVersion}`);
  }
}

export const createWp2DiscoveryNeighborhoodStrategyRegistry =
  (): DiscoveryNeighborhoodStrategyRegistry =>
    new DiscoveryNeighborhoodStrategyRegistry([
      relationStrategy(),
      patternStrategy(),
      conflictStrategy(),
    ]);

export const selectDiscoveryNeighborhood = (
  strategy: DiscoveryNeighborhoodStrategyV1,
  signals: DiscoveryNeighborhoodSignalBundleV1,
): DiscoveryNeighborhoodSelectionResultV1 => {
  validateStrategy(strategy);
  validateBounds(strategy.work, `${strategy.strategyId}.work`);
  if (signals.context.projectId.trim().length === 0)
    throw new TypeError('selection context projectId is empty');
  return strategy.select({
    signals,
    strategyId: strategy.strategyId,
    strategyVersion: strategy.strategyVersion,
    bounds: strategy.work,
  });
};
