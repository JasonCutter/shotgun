import type { CanonicalClaim } from './canonical-knowledge.js';
import type { CanonicalSnapshot } from './comparison-review.js';
import type { CompiledTruthProjection, CompiledTruthItem } from './compiled-truth.js';
import type { KnowledgeCandidate, KnowledgeReviewGroup } from './knowledge-model.js';
import {
  semanticRepresentationBuilderV2,
  semanticStableJson,
  type SemanticRepresentationInputV2,
  type SemanticRepresentationV2,
  type SemanticRepresentationV2ResourceType,
  utf16OrdinalCompare,
} from './semantic-representation.js';
import type { SecurityContext } from './types.js';
import { sha256Text } from './document-evidence.js';

export const SEMANTIC_CORPUS_SOURCE_SNAPSHOT_VERSION = 'semantic-corpus-source:v1' as const;

export const SEMANTIC_PRODUCT_RESOURCE_TYPES = [
  'CLAIM',
  'ENTITY',
  'RELATION',
  'EVENT',
  'DECISION',
] as const satisfies readonly SemanticRepresentationV2ResourceType[];

export type SemanticProductResourceType = (typeof SEMANTIC_PRODUCT_RESOURCE_TYPES)[number];
export type SemanticCorpusAuthority = 'CANONICAL' | 'APPROVED_KNOWLEDGE' | 'COMPILED_TRUTH';
export type SemanticSensitivity = SecurityContext['sensitivity'];

export type SemanticApprovedKnowledgeItemIdentity = {
  readonly candidateId: string;
  readonly candidateType: KnowledgeCandidate['candidateType'];
  readonly revisionNumber: number;
  readonly sourceVersionId: string;
  readonly evidenceIds: readonly string[];
};

export type SemanticApprovedKnowledgeSourceIdentity = {
  readonly groupId: string;
  readonly sourceVersionId: string;
  readonly revisionNumber: number;
  readonly status: 'APPROVED';
  readonly contentDigest: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: SemanticSensitivity;
  readonly items: readonly SemanticApprovedKnowledgeItemIdentity[];
};

export type SemanticCorpusCanonicalProvenance = {
  readonly authority: 'CANONICAL';
  readonly resourceBaseId: string;
  readonly resourceRevision: number;
  readonly baseCanonicalVersion: number;
  readonly sourceVersionId: string;
  readonly evidenceIds: readonly string[];
  readonly accessScope: readonly string[];
  readonly sensitivity: SemanticSensitivity;
};

export type SemanticCorpusApprovedKnowledgeProvenance = {
  readonly authority: 'APPROVED_KNOWLEDGE';
  readonly resourceBaseId: string;
  readonly resourceRevision: number;
  readonly knowledgeGroupId: string;
  readonly knowledgeGroupRevision: number;
  readonly sourceVersionId: string;
  readonly evidenceIds: readonly string[];
  readonly accessScope: readonly string[];
  readonly sensitivity: SemanticSensitivity;
};

export type SemanticCorpusCompiledTruthProvenance = {
  readonly authority: 'COMPILED_TRUTH';
  readonly resourceBaseId: string;
  readonly resourceRevision: number;
  readonly baseAuthority: 'CANONICAL' | 'APPROVED_KNOWLEDGE';
  readonly baseResourceRevision: number;
  readonly baseCanonicalVersion: number;
  readonly sourceVersionId?: string;
  readonly evidenceIds: readonly string[];
  readonly accessScope: readonly string[];
  readonly sensitivity: SemanticSensitivity;
  readonly projectionCanonicalVersion: number;
  readonly sourceProjectionDigest: string;
  readonly projectionLogicalDigest: string;
};

export type SemanticCorpusResourceProvenance =
  | SemanticCorpusCanonicalProvenance
  | SemanticCorpusApprovedKnowledgeProvenance
  | SemanticCorpusCompiledTruthProvenance;

export type SemanticCorpusSourceResource = {
  readonly resourceType: SemanticProductResourceType;
  readonly resourceId: string;
  readonly authority: SemanticCorpusAuthority;
  readonly provenance: SemanticCorpusResourceProvenance;
  readonly semanticInput: SemanticRepresentationInputV2;
  readonly representation: SemanticRepresentationV2;
};

export type SemanticCorpusSourceSnapshot = {
  readonly projectId: string;
  readonly canonicalVersion: number;
  readonly canonicalSnapshotDigest: string;
  readonly approvedKnowledgeDigest: string;
  readonly sourceSnapshotDigest: string;
  readonly effectiveAt: string;
  readonly resources: readonly SemanticCorpusSourceResource[];
};

export type SemanticCorpusSourceWatermark = {
  readonly projectId: string;
  readonly canonicalVersion: number;
  readonly canonicalSnapshotDigest: string;
  readonly approvedKnowledgeDigest: string;
  readonly sourceSnapshotDigest: string;
};

export type SemanticCorpusProjectionEnrichment = {
  readonly status: 'READY';
  readonly projection: CompiledTruthProjection;
};

export type SemanticCorpusSourceSnapshotReaderPort = {
  readSnapshot(projectId: string): Promise<SemanticCorpusSourceSnapshot>;
  readWatermark(projectId: string): Promise<SemanticCorpusSourceWatermark>;
};

const sortedStrings = (values: readonly string[]): readonly string[] =>
  Object.freeze(
    [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(utf16OrdinalCompare),
  );

const normalizeApprovedIdentity = (
  group: SemanticApprovedKnowledgeSourceIdentity,
): SemanticApprovedKnowledgeSourceIdentity => ({
  ...group,
  accessScope: sortedStrings(group.accessScope),
  items: group.items,
});

export const approvedKnowledgeSourceIdentity = (
  group: KnowledgeReviewGroup,
): SemanticApprovedKnowledgeSourceIdentity => ({
  groupId: group.groupId,
  sourceVersionId: group.sourceVersionId,
  revisionNumber: group.revisionNumber,
  status: 'APPROVED',
  contentDigest: group.contentDigest,
  accessScope: group.accessScope,
  sensitivity: group.sensitivity,
  items: group.items.map((item) => ({
    candidateId: item.candidateId,
    candidateType: item.candidateType,
    revisionNumber: item.revisionNumber,
    sourceVersionId: item.sourceVersionId,
    evidenceIds: item.evidenceIds,
  })),
});

export const approvedKnowledgeDigest = (
  groups: readonly SemanticApprovedKnowledgeSourceIdentity[],
): string =>
  sha256Text(
    semanticStableJson(
      [...groups]
        .map(normalizeApprovedIdentity)
        .map(
          ({
            groupId,
            sourceVersionId,
            revisionNumber,
            status,
            contentDigest,
            accessScope,
            sensitivity,
          }) => ({
            groupId,
            sourceVersionId,
            revisionNumber,
            status,
            contentDigest,
            accessScope,
            sensitivity,
          }),
        )
        .sort((left, right) => utf16OrdinalCompare(left.groupId, right.groupId)),
    ),
  );

export const semanticCorpusSourceSnapshotDigest = (input: {
  readonly projectId: string;
  readonly canonicalVersion: number;
  readonly canonicalSnapshotDigest: string;
  readonly approvedKnowledgeDigest: string;
}): string =>
  sha256Text(
    semanticStableJson({
      schemaVersion: SEMANTIC_CORPUS_SOURCE_SNAPSHOT_VERSION,
      projectId: input.projectId,
      canonicalVersion: input.canonicalVersion,
      canonicalSnapshotDigest: input.canonicalSnapshotDigest,
      approvedKnowledgeDigest: input.approvedKnowledgeDigest,
    }),
  );

export const semanticCorpusWatermarkFromSource = (input: {
  readonly projectId: string;
  readonly canonicalVersion: number;
  readonly canonicalSnapshotDigest: string;
  readonly approvedGroups: readonly SemanticApprovedKnowledgeSourceIdentity[];
}): SemanticCorpusSourceWatermark => {
  const approvedDigest = approvedKnowledgeDigest(input.approvedGroups);
  return Object.freeze({
    projectId: input.projectId,
    canonicalVersion: input.canonicalVersion,
    canonicalSnapshotDigest: input.canonicalSnapshotDigest,
    approvedKnowledgeDigest: approvedDigest,
    sourceSnapshotDigest: semanticCorpusSourceSnapshotDigest({
      projectId: input.projectId,
      canonicalVersion: input.canonicalVersion,
      canonicalSnapshotDigest: input.canonicalSnapshotDigest,
      approvedKnowledgeDigest: approvedDigest,
    }),
  });
};

export const isSemanticProductResourceType = (
  value: string,
): value is SemanticProductResourceType =>
  (SEMANTIC_PRODUCT_RESOURCE_TYPES as readonly string[]).includes(value);

export const compiledTruthItemAuthority = (
  item: CompiledTruthItem,
): 'CANONICAL' | 'APPROVED_KNOWLEDGE' | undefined => {
  if (!isSemanticProductResourceType(item.type)) return undefined;
  return item.source === 'CANONICAL_CLAIM' ? 'CANONICAL' : 'APPROVED_KNOWLEDGE';
};

export const buildSemanticRepresentationV2 = (
  input: SemanticRepresentationInputV2,
): SemanticRepresentationV2 => semanticRepresentationBuilderV2.build(input);

export type SemanticCorpusBuildInputs = {
  readonly projectId: string;
  readonly canonical: CanonicalSnapshot;
  readonly claims: readonly CanonicalClaim[];
  readonly approvedGroups: readonly KnowledgeReviewGroup[];
  readonly compiledTruth?: SemanticCorpusProjectionEnrichment;
};
