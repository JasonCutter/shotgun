import {
  approvedKnowledgeDigest,
  approvedKnowledgeSourceIdentity,
  buildSemanticRepresentationV2,
  compiledTruthItemAuthority,
  isSemanticProductResourceType,
  semanticCorpusSourceSnapshotDigest,
  semanticCorpusWatermarkFromSource,
  type CanonicalClaim,
  type CompiledTruthProjection,
  type KnowledgeCandidate,
  type KnowledgeReviewGroup,
  type SemanticCorpusBuildInputs,
  type SemanticCorpusSourceResource,
  type SemanticCorpusSourceSnapshot,
  type SemanticCorpusSourceWatermark,
  type SemanticProductResourceType,
  type SemanticRepresentationInputV2,
  utf16OrdinalCompare,
} from '../../../packages/contracts/src/index.js';

const compare = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
const sortedStrings = (values: readonly string[]): readonly string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(utf16OrdinalCompare);

const eligibleCandidate = (
  candidate: KnowledgeCandidate,
): candidate is Extract<KnowledgeCandidate, { candidateType: SemanticProductResourceType }> =>
  isSemanticProductResourceType(candidate.candidateType);

const entityLabels = (groups: readonly KnowledgeReviewGroup[]): ReadonlyMap<string, string> => {
  const labels = new Map<string, string>();
  const orderedGroups = [...groups].sort(
    (left, right) =>
      compare(left.groupId, right.groupId) || right.revisionNumber - left.revisionNumber,
  );
  for (const group of orderedGroups) {
    for (const candidate of [...group.items].sort(
      (left, right) =>
        compare(left.candidateId, right.candidateId) ||
        compare(left.candidateType, right.candidateType),
    )) {
      if (candidate.candidateType === 'ENTITY' && !labels.has(candidate.candidateId)) {
        labels.set(candidate.candidateId, candidate.name.trim());
      }
    }
  }
  return labels;
};

const labelFor = (labels: ReadonlyMap<string, string>, reference: string): string =>
  labels.get(reference)?.trim() || reference.trim();

const semanticInputForCandidate = (
  candidate: Extract<KnowledgeCandidate, { candidateType: SemanticProductResourceType }>,
  labels: ReadonlyMap<string, string>,
): SemanticRepresentationInputV2 => {
  switch (candidate.candidateType) {
    case 'ENTITY':
      return {
        resourceType: 'ENTITY',
        resourceId: candidate.candidateId,
        entityType: candidate.entityKind,
        name: candidate.name,
        aliases: candidate.aliases,
      };
    case 'RELATION':
      return {
        resourceType: 'RELATION',
        resourceId: candidate.candidateId,
        relationType: candidate.relationType,
        fromName: labelFor(labels, candidate.fromCandidateId),
        toName: labelFor(labels, candidate.toCandidateId),
        stableFromRef: candidate.fromCandidateId,
        stableToRef: candidate.toCandidateId,
        direction: candidate.direction,
        ...(candidate.validFrom === undefined ? {} : { validFrom: candidate.validFrom }),
        ...(candidate.validTo === undefined ? {} : { validTo: candidate.validTo }),
      };
    case 'EVENT':
      return {
        resourceType: 'EVENT',
        resourceId: candidate.candidateId,
        eventType: 'EVENT',
        title: candidate.title,
        participants: candidate.participantCandidateIds.map((stableRef) => ({
          stableRef,
          name: labelFor(labels, stableRef),
        })),
        ...(candidate.occurredAt === undefined ? {} : { occurredAt: candidate.occurredAt }),
      };
    case 'DECISION': {
      const stableActorRef = candidate.actorCandidateId;
      return {
        resourceType: 'DECISION',
        resourceId: candidate.candidateId,
        decisionType: 'DECISION',
        decision: candidate.decisionText,
        ...(stableActorRef === undefined
          ? {}
          : { stableActorRef, actorName: labelFor(labels, stableActorRef) }),
      };
    }
  }
};

const canonicalResource = (
  claim: CanonicalClaim,
  canonicalVersion: number,
): SemanticCorpusSourceResource => {
  const semanticInput: SemanticRepresentationInputV2 = {
    resourceType: 'CLAIM',
    resourceId: claim.claimId,
    statement: claim.claimText,
  };
  return {
    resourceType: 'CLAIM',
    resourceId: claim.claimId,
    authority: 'CANONICAL',
    provenance: {
      authority: 'CANONICAL',
      resourceBaseId: claim.claimId,
      resourceRevision: claim.revisionNumber,
      baseCanonicalVersion: canonicalVersion,
      sourceVersionId: claim.sourceVersionId,
      evidenceIds: sortedStrings(claim.evidenceIds),
      accessScope: sortedStrings(claim.accessScope),
      sensitivity: claim.sensitivity,
    },
    semanticInput,
    representation: buildSemanticRepresentationV2(semanticInput),
  };
};

const approvedResource = (
  group: KnowledgeReviewGroup,
  candidate: Extract<KnowledgeCandidate, { candidateType: SemanticProductResourceType }>,
  labels: ReadonlyMap<string, string>,
): SemanticCorpusSourceResource => {
  const semanticInput = semanticInputForCandidate(candidate, labels);
  return {
    resourceType: candidate.candidateType,
    resourceId: candidate.candidateId,
    authority: 'APPROVED_KNOWLEDGE',
    provenance: {
      authority: 'APPROVED_KNOWLEDGE',
      resourceBaseId: candidate.candidateId,
      resourceRevision: candidate.revisionNumber,
      knowledgeGroupId: group.groupId,
      knowledgeGroupRevision: group.revisionNumber,
      sourceVersionId: candidate.sourceVersionId,
      evidenceIds: sortedStrings(candidate.evidenceIds),
      accessScope: sortedStrings(group.accessScope),
      sensitivity: group.sensitivity,
    },
    semanticInput,
    representation: buildSemanticRepresentationV2(semanticInput),
  };
};

const baseResourceKey = (resourceType: string, resourceId: string): string =>
  `${resourceType}\u0000${resourceId}`;

const compiledTruthEnrichment = (
  status: 'READY',
  projection: CompiledTruthProjection,
  baseResources: readonly SemanticCorpusSourceResource[],
  canonicalVersion: number,
  sourceSnapshotDigest: string,
): readonly SemanticCorpusSourceResource[] => {
  if (status !== 'READY') return [];
  if (
    projection.canonicalVersion !== canonicalVersion ||
    projection.sourceSnapshotDigest !== sourceSnapshotDigest
  ) {
    return [];
  }

  const base = new Map(
    baseResources.map((resource) => [
      baseResourceKey(resource.resourceType, resource.resourceId),
      resource,
    ]),
  );
  const enriched: SemanticCorpusSourceResource[] = [];
  for (const item of projection.items) {
    const authority = compiledTruthItemAuthority(item);
    if (!authority) continue;
    const underlying = base.get(baseResourceKey(item.type, item.id));
    if (!underlying || underlying.authority !== authority) continue;
    const provenance = underlying.provenance;
    const baseRevision = provenance.resourceRevision;
    enriched.push({
      ...underlying,
      authority: 'COMPILED_TRUTH',
      provenance: {
        authority: 'COMPILED_TRUTH',
        resourceBaseId: underlying.resourceId,
        resourceRevision: baseRevision,
        baseAuthority: authority,
        baseResourceRevision: baseRevision,
        baseCanonicalVersion: canonicalVersion,
        ...(provenance.authority === 'CANONICAL' || provenance.authority === 'APPROVED_KNOWLEDGE'
          ? { sourceVersionId: provenance.sourceVersionId }
          : {}),
        evidenceIds: [...underlying.provenance.evidenceIds],
        accessScope: [...underlying.provenance.accessScope],
        sensitivity: underlying.provenance.sensitivity,
        projectionCanonicalVersion: projection.canonicalVersion,
        sourceProjectionDigest: projection.sourceSnapshotDigest,
        projectionLogicalDigest: projection.logicalDigest,
      },
    });
  }
  return enriched;
};

const sourceIdentityOrder = (
  left: SemanticCorpusSourceResource,
  right: SemanticCorpusSourceResource,
) =>
  compare(left.authority, right.authority) ||
  compare(left.resourceType, right.resourceType) ||
  compare(left.resourceId, right.resourceId);

export const buildSemanticCorpusSourceSnapshot = (
  input: SemanticCorpusBuildInputs,
): SemanticCorpusSourceSnapshot => {
  const projectClaims = new Map(
    input.claims
      .filter((claim) => claim.projectId === input.projectId)
      .map((claim) => [claim.claimId, claim]),
  );
  const canonicalClaimIds = new Set(input.canonical.claims.map((claim) => claim.claimId));
  const approvedGroups = input.approvedGroups.filter(
    (group) => group.projectId === input.projectId && group.status === 'APPROVED',
  );
  const labels = entityLabels(approvedGroups);
  const canonicalResources = [...canonicalClaimIds]
    .map((claimId) => projectClaims.get(claimId))
    .filter((claim): claim is CanonicalClaim => claim !== undefined)
    .map((claim) => canonicalResource(claim, input.canonical.version));
  const approvedResources = approvedGroups.flatMap((group) =>
    group.items
      .filter(eligibleCandidate)
      .map((candidate) => approvedResource(group, candidate, labels)),
  );
  const baseResources = [...canonicalResources, ...approvedResources].sort(sourceIdentityOrder);
  const approvedDigest = approvedKnowledgeDigest(
    approvedGroups.map(approvedKnowledgeSourceIdentity),
  );
  const sourceDigest = semanticCorpusSourceSnapshotDigest({
    projectId: input.projectId,
    canonicalVersion: input.canonical.version,
    canonicalSnapshotDigest: input.canonical.digest,
    approvedKnowledgeDigest: approvedDigest,
  });
  const compiledResources = input.compiledTruth
    ? compiledTruthEnrichment(
        input.compiledTruth.status,
        input.compiledTruth.projection,
        baseResources,
        input.canonical.version,
        sourceDigest,
      )
    : [];
  const effectiveAt =
    [
      input.canonical.createdAt,
      ...canonicalResources.map(
        (resource) => projectClaims.get(resource.resourceId)?.createdAt ?? '',
      ),
      ...approvedGroups.map((group) => group.updatedAt),
    ]
      .filter(Boolean)
      .sort(compare)
      .at(-1) ?? '1970-01-01T00:00:00.000Z';
  return Object.freeze({
    projectId: input.projectId,
    canonicalVersion: input.canonical.version,
    canonicalSnapshotDigest: input.canonical.digest,
    approvedKnowledgeDigest: approvedDigest,
    sourceSnapshotDigest: sourceDigest,
    effectiveAt,
    resources: Object.freeze([...baseResources, ...compiledResources].sort(sourceIdentityOrder)),
  });
};

export const buildSemanticCorpusWatermark = (input: {
  readonly projectId: string;
  readonly canonicalVersion: number;
  readonly canonicalSnapshotDigest: string;
  readonly approvedGroups: readonly KnowledgeReviewGroup[];
}): SemanticCorpusSourceWatermark =>
  semanticCorpusWatermarkFromSource({
    projectId: input.projectId,
    canonicalVersion: input.canonicalVersion,
    canonicalSnapshotDigest: input.canonicalSnapshotDigest,
    approvedGroups: input.approvedGroups
      .filter((group) => group.status === 'APPROVED')
      .map(approvedKnowledgeSourceIdentity),
  });
