import {
  type CanonicalClaim,
  type CanonicalSnapshot,
  type CompiledTruthProjection,
  type KnowledgeReviewGroup,
  type SemanticCorpusItem,
  type SemanticCorpusReaderPort,
  type SemanticCorpusSnapshot,
  type SemanticResourceType,
  semanticRepresentationBuilder,
  sha256Text,
  stableJson,
} from '../../../packages/contracts/src/index.js';

export type CanonicalKnowledgeReaderPort = {
  getSnapshot(projectId: string): Promise<CanonicalSnapshot>;
  findClaim(projectId: string, claimId: string): Promise<CanonicalClaim | undefined>;
};

export type KnowledgeModelReaderPort = {
  listGroups(projectId: string): Promise<readonly KnowledgeReviewGroup[]>;
};

export type CompiledTruthReaderPort = {
  findProjection(projectId: string): Promise<CompiledTruthProjection | undefined>;
};

const compareOrdinal = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const AKP1_PRODUCT_ELIGIBLE_RESOURCE_TYPES: readonly SemanticResourceType[] = Object.freeze([
  'CLAIM',
  'ENTITY',
  'RELATION',
  'EVENT',
  'DECISION',
]);

export class ProductSemanticCorpusReader implements SemanticCorpusReaderPort {
  constructor(
    private readonly canonicalKnowledge: CanonicalKnowledgeReaderPort,
    private readonly knowledgeModel?: KnowledgeModelReaderPort,
    private readonly compiledTruth?: CompiledTruthReaderPort,
  ) {}

  async readCorpus(projectId: string): Promise<SemanticCorpusSnapshot> {
    const canonicalSnapshot = await this.canonicalKnowledge.getSnapshot(projectId);
    const snapshotVersion = canonicalSnapshot?.version ?? 0;
    const snapshotDigest = canonicalSnapshot?.digest ?? sha256Text('empty-snapshot');

    const itemsMap = new Map<string, SemanticCorpusItem>();

    // 1. Stage 6: Canonical Claims (Sole Claim Authority)
    if (canonicalSnapshot?.claims) {
      for (const snapClaim of canonicalSnapshot.claims) {
        const fullClaim = await this.canonicalKnowledge.findClaim(projectId, snapClaim.claimId);
        if (!fullClaim) continue;

        const repr = semanticRepresentationBuilder.buildClaim({
          resourceType: 'CLAIM',
          resourceId: fullClaim.claimId,
          statement: fullClaim.claimText,
        });

        const key = `CLAIM:${fullClaim.claimId}`;
        itemsMap.set(key, {
          resourceType: 'CLAIM',
          resourceId: fullClaim.claimId,
          canonicalVersion: snapshotVersion,
          representationInput: {
            resourceType: 'CLAIM',
            resourceId: fullClaim.claimId,
            statement: fullClaim.claimText,
          },
          semanticText: repr.semanticText,
          semanticTextDigest: repr.semanticTextDigest,
          representationVersion: repr.representationVersion,
          evidenceIds: Object.freeze([...fullClaim.evidenceIds]),
          accessScope: Object.freeze([...fullClaim.accessScope]),
          sensitivity: fullClaim.sensitivity,
          sourceVersionId: fullClaim.sourceVersionId,
        });
      }
    }

    // 2. Stage 9: Approved Knowledge Model candidates (ENTITY, RELATION, EVENT, DECISION)
    if (this.knowledgeModel) {
      const groups = await this.knowledgeModel.listGroups(projectId);
      for (const group of groups) {
        if (group.status !== 'APPROVED') continue;

        for (const candidate of group.items) {
          switch (candidate.candidateType) {
            case 'ENTITY': {
              const repr = semanticRepresentationBuilder.buildEntity({
                resourceType: 'ENTITY',
                resourceId: candidate.candidateId,
                entityType: candidate.entityKind,
                displayName: candidate.name,
                aliases: candidate.aliases,
              });
              const key = `ENTITY:${candidate.candidateId}`;
              itemsMap.set(key, {
                resourceType: 'ENTITY',
                resourceId: candidate.candidateId,
                canonicalVersion: snapshotVersion,
                representationInput: {
                  resourceType: 'ENTITY',
                  resourceId: candidate.candidateId,
                  entityType: candidate.entityKind,
                  displayName: candidate.name,
                  aliases: candidate.aliases,
                },
                semanticText: repr.semanticText,
                semanticTextDigest: repr.semanticTextDigest,
                representationVersion: repr.representationVersion,
                evidenceIds: Object.freeze([...candidate.evidenceIds]),
                accessScope: Object.freeze([...group.accessScope]),
                sensitivity: group.sensitivity,
                sourceVersionId: candidate.sourceVersionId,
              });
              break;
            }

            case 'RELATION': {
              const repr = semanticRepresentationBuilder.buildRelation({
                resourceType: 'RELATION',
                resourceId: candidate.candidateId,
                relationType: candidate.relationType,
                fromEntityRef: candidate.fromCandidateId,
                toEntityRef: candidate.toCandidateId,
                direction: candidate.direction,
                validFrom: candidate.validFrom,
                validTo: candidate.validTo,
              });
              const key = `RELATION:${candidate.candidateId}`;
              itemsMap.set(key, {
                resourceType: 'RELATION',
                resourceId: candidate.candidateId,
                canonicalVersion: snapshotVersion,
                representationInput: {
                  resourceType: 'RELATION',
                  resourceId: candidate.candidateId,
                  relationType: candidate.relationType,
                  fromEntityRef: candidate.fromCandidateId,
                  toEntityRef: candidate.toCandidateId,
                  direction: candidate.direction,
                  validFrom: candidate.validFrom,
                  validTo: candidate.validTo,
                },
                semanticText: repr.semanticText,
                semanticTextDigest: repr.semanticTextDigest,
                representationVersion: repr.representationVersion,
                evidenceIds: Object.freeze([...candidate.evidenceIds]),
                accessScope: Object.freeze([...group.accessScope]),
                sensitivity: group.sensitivity,
                sourceVersionId: candidate.sourceVersionId,
              });
              break;
            }

            case 'EVENT': {
              const repr = semanticRepresentationBuilder.buildEvent({
                resourceType: 'EVENT',
                resourceId: candidate.candidateId,
                eventType: 'EVENT',
                title: candidate.title,
                participantRefs: candidate.participantCandidateIds,
                occurredAt: candidate.occurredAt,
              });
              const key = `EVENT:${candidate.candidateId}`;
              itemsMap.set(key, {
                resourceType: 'EVENT',
                resourceId: candidate.candidateId,
                canonicalVersion: snapshotVersion,
                representationInput: {
                  resourceType: 'EVENT',
                  resourceId: candidate.candidateId,
                  eventType: 'EVENT',
                  title: candidate.title,
                  participantRefs: candidate.participantCandidateIds,
                  occurredAt: candidate.occurredAt,
                },
                semanticText: repr.semanticText,
                semanticTextDigest: repr.semanticTextDigest,
                representationVersion: repr.representationVersion,
                evidenceIds: Object.freeze([...candidate.evidenceIds]),
                accessScope: Object.freeze([...group.accessScope]),
                sensitivity: group.sensitivity,
                sourceVersionId: candidate.sourceVersionId,
              });
              break;
            }

            case 'DECISION': {
              const repr = semanticRepresentationBuilder.buildDecision({
                resourceType: 'DECISION',
                resourceId: candidate.candidateId,
                decisionType: 'DECISION',
                decision: candidate.decisionText,
                actorRef: candidate.actorCandidateId,
              });
              const key = `DECISION:${candidate.candidateId}`;
              itemsMap.set(key, {
                resourceType: 'DECISION',
                resourceId: candidate.candidateId,
                canonicalVersion: snapshotVersion,
                representationInput: {
                  resourceType: 'DECISION',
                  resourceId: candidate.candidateId,
                  decisionType: 'DECISION',
                  decision: candidate.decisionText,
                  actorRef: candidate.actorCandidateId,
                },
                semanticText: repr.semanticText,
                semanticTextDigest: repr.semanticTextDigest,
                representationVersion: repr.representationVersion,
                evidenceIds: Object.freeze([...candidate.evidenceIds]),
                accessScope: Object.freeze([...group.accessScope]),
                sensitivity: group.sensitivity,
                sourceVersionId: candidate.sourceVersionId,
              });
              break;
            }

            default:
              // Non-product-eligible (e.g. FACT, ACTION, CONFLICT, KNOWLEDGE_GAP) are excluded
              break;
          }
        }
      }
    }

    // 3. Stage 10: Compiled Truth (Fallback for non-claim items if not present in knowledgeModel)
    if (this.compiledTruth) {
      const truthProj = await this.compiledTruth.findProjection(projectId);
      if (truthProj?.items) {
        for (const item of truthProj.items) {
          if (item.type === 'CLAIM') {
            // Missing Canonical Claim must NEVER be resurrected from Compiled Truth!
            continue;
          }
          const key = `${item.type}:${item.id}`;
          if (
            !itemsMap.has(key) &&
            AKP1_PRODUCT_ELIGIBLE_RESOURCE_TYPES.includes(item.type as SemanticResourceType)
          ) {
            let reprText: string;
            let reprDigest: string;
            if (item.type === 'ENTITY') {
              const r = semanticRepresentationBuilder.buildEntity({
                resourceType: 'ENTITY',
                resourceId: item.id,
                entityType: 'CONCEPT',
                displayName: item.label,
              });
              reprText = r.semanticText;
              reprDigest = r.semanticTextDigest;
            } else if (item.type === 'DECISION') {
              const r = semanticRepresentationBuilder.buildDecision({
                resourceType: 'DECISION',
                resourceId: item.id,
                decisionType: 'DECISION',
                decision: item.label,
              });
              reprText = r.semanticText;
              reprDigest = r.semanticTextDigest;
            } else {
              reprText = `resource_type: ${item.type}\nstatement: ${item.label}`;
              reprDigest = sha256Text(
                stableJson({
                  version: 'semantic-representation:v1',
                  resourceType: item.type,
                  semanticText: reprText,
                }),
              );
            }

            itemsMap.set(key, {
              resourceType: item.type as SemanticResourceType,
              resourceId: item.id,
              canonicalVersion: truthProj.canonicalVersion ?? snapshotVersion,
              representationInput: {
                resourceType: 'CLAIM',
                resourceId: item.id,
                statement: item.label,
              },
              semanticText: reprText,
              semanticTextDigest: reprDigest,
              representationVersion: 'semantic-representation:v1',
              evidenceIds: Object.freeze([...item.evidenceIds]),
              accessScope: Object.freeze([...item.accessScope]),
              sensitivity: item.sensitivity,
            });
          }
        }
      }
    }

    // Filter out any unexpected non-product-eligible resource types (e.g. FACT)
    const items = Array.from(itemsMap.values()).filter((item) =>
      AKP1_PRODUCT_ELIGIBLE_RESOURCE_TYPES.includes(item.resourceType),
    );

    // Deterministic ordinal sorting: resourceType ASC, resourceId ASC
    items.sort((a, b) => {
      const typeCmp = compareOrdinal(a.resourceType, b.resourceType);
      if (typeCmp !== 0) return typeCmp;
      return compareOrdinal(a.resourceId, b.resourceId);
    });

    const corpusDigest = sha256Text(
      stableJson(
        items.map((item) => ({
          resourceType: item.resourceType,
          resourceId: item.resourceId,
          canonicalVersion: item.canonicalVersion,
          semanticTextDigest: item.semanticTextDigest,
          representationVersion: item.representationVersion,
          evidenceIds: [...item.evidenceIds].sort(compareOrdinal),
          accessScope: [...item.accessScope].sort(compareOrdinal),
          sensitivity: item.sensitivity,
        })),
      ),
    );

    const sourceProjectionDigest = sha256Text(
      stableJson({
        canonicalSnapshotDigest: snapshotDigest,
        corpusDigest,
      }),
    );

    return {
      projectId,
      canonicalBaseVersion: snapshotVersion,
      canonicalSnapshotDigest: snapshotDigest,
      sourceProjectionDigest,
      corpusDigest,
      items: Object.freeze(items),
      totalItems: items.length,
    };
  }
}
