import { sha256Text } from './document-evidence.js';
import { semanticStableJson, utf16OrdinalCompare } from './semantic-representation.js';
import type {
  SemanticProjectionGeneration,
  SemanticProjectionItem,
  SemanticGenerationMembershipSummary,
} from './semantic-index.js';

export type SemanticVectorPayloadIdentity = {
  readonly semanticTextDigest: string;
  readonly representationVersion: string;
  readonly providerId: string;
  readonly embeddingModelId: string;
  readonly embeddingProfileId: string;
  readonly embeddingProfileRevision: number;
  readonly dimension: number;
  readonly normalizationPolicy: string;
};

export type SemanticMembershipIdentity = {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly sourceProjectionDigest: string;
  readonly canonicalVersion: number;
  readonly semanticTextDigest: string;
  readonly evidenceIds: readonly string[];
  readonly accessScope: readonly string[];
  readonly sensitivity: string;
  readonly authority: string;
  readonly provenance?: unknown;
};

const sortedStrings = (values: readonly string[]): readonly string[] =>
  Object.freeze(
    [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(utf16OrdinalCompare),
  );

export const semanticVectorPayloadIdentity = (
  item: Pick<
    SemanticProjectionItem,
    | 'semanticTextDigest'
    | 'representationVersion'
    | 'embeddingProfileId'
    | 'embeddingProfileRevision'
    | 'dimension'
  > &
    Partial<
      Pick<SemanticProjectionItem, 'providerId' | 'embeddingModelId' | 'normalizationPolicy'>
    > &
    Record<string, unknown>,
  generation: Pick<
    SemanticProjectionGeneration,
    'providerId' | 'embeddingModelId' | 'normalizationPolicy'
  >,
): SemanticVectorPayloadIdentity => ({
  semanticTextDigest: item.semanticTextDigest,
  representationVersion: item.representationVersion,
  providerId: item.providerId ?? generation.providerId,
  embeddingModelId: item.embeddingModelId ?? generation.embeddingModelId,
  embeddingProfileId: item.embeddingProfileId,
  embeddingProfileRevision: item.embeddingProfileRevision,
  dimension: item.dimension,
  normalizationPolicy: item.normalizationPolicy ?? generation.normalizationPolicy,
});

export const semanticVectorPayloadIdentityDigest = (
  identity: SemanticVectorPayloadIdentity,
): string => sha256Text(semanticStableJson(identity));

export const semanticMembershipIdentity = (
  item: Pick<
    SemanticProjectionItem,
    | 'resourceType'
    | 'resourceId'
    | 'sourceProjectionDigest'
    | 'canonicalVersion'
    | 'semanticTextDigest'
    | 'evidenceIds'
    | 'accessScope'
    | 'sensitivity'
    | 'authority'
    | 'provenance'
  > &
    Record<string, unknown>,
): SemanticMembershipIdentity => {
  const provenance = item.provenance
    ? {
        ...item.provenance,
        evidenceIds: sortedStrings(item.provenance.evidenceIds),
        accessScope: sortedStrings(item.provenance.accessScope),
      }
    : undefined;
  return {
    resourceType: item.resourceType,
    resourceId: item.resourceId,
    sourceProjectionDigest: item.sourceProjectionDigest,
    canonicalVersion: item.canonicalVersion,
    semanticTextDigest: item.semanticTextDigest,
    evidenceIds: sortedStrings(item.evidenceIds),
    accessScope: sortedStrings(item.accessScope),
    sensitivity: item.sensitivity,
    // Legacy R1/R2 rows did not persist authority. They remain readable while
    // every R3-built item persists the explicit authority/provenance pair.
    authority: item.authority ?? item.provenance?.authority ?? 'CANONICAL',
    ...(provenance === undefined ? {} : { provenance }),
  };
};

export const semanticMembershipDigest = (
  items: readonly (Pick<
    SemanticProjectionItem,
    | 'resourceType'
    | 'resourceId'
    | 'sourceProjectionDigest'
    | 'canonicalVersion'
    | 'semanticTextDigest'
    | 'evidenceIds'
    | 'accessScope'
    | 'sensitivity'
    | 'authority'
    | 'provenance'
  > &
    Record<string, unknown>)[],
): string => {
  const identities = items
    .map(semanticMembershipIdentity)
    .sort(
      (left, right) =>
        utf16OrdinalCompare(left.resourceType, right.resourceType) ||
        utf16OrdinalCompare(left.resourceId, right.resourceId),
    );
  return sha256Text(semanticStableJson(identities));
};

export const semanticMembershipSummaryFromItems = (
  projectId: string,
  generationId: string,
  items: readonly SemanticProjectionItem[],
): SemanticGenerationMembershipSummary => ({
  projectId,
  generationId,
  itemCount: items.length,
  membershipDigest: semanticMembershipDigest(items),
});
