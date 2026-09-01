import type { PoolClient } from 'pg';

import {
  assertDiscoveryReviewResourceMatchesCandidateV1,
  canonicalSnapshotDigest,
  composeDiscoveryFindingSecurityV1,
  decodeDerivedKnowledgeCandidateV1,
  decodeDiscoveryReviewResourceV1,
  sha256Text,
  stableJson,
  type ApprovedKnowledgeEntityRefV1,
  type DiscoveryReviewResourceV1,
  type DerivedKnowledgeCandidateV1,
  type DiscoveryResourceRefV1,
  type DiscoveryDraftProvenanceV1,
  type FrontendKnowledgeDraftChangeSetV1,
  type FrontendKnowledgeOperationV1,
  type ReviewContextRevisionV1,
  type RelationDraftValueV2,
} from '../../../packages/contracts/src/index.js';
import {
  createInitialFrontendKnowledgeDraft,
  materializeFrontendKnowledgeDraftOn,
  frontendKnowledgeDraftOperationDigestV1,
  type DraftMaterializationRecordV1,
  type FrontendKnowledgeDraftTransactionRepositoriesV1,
} from '../../../modules/frontend-knowledge-draft/src/index.js';
import {
  reviewFailure,
  type FrontendReviewAcceptedForAuthoringBridgeV1,
  type FrontendReviewScopeV1,
  type ReviewSourceTargetV1,
  type ReviewTransactionRepositoriesV1,
} from '../../../modules/frontend-review/src/index.js';
import type { PostgresFrontendKnowledgeDraftRepository } from '../../frontend-knowledge-draft-postgres/src/index.js';
import type { FrontendKnowledgeDraftDiscoveryRelationAuthorityPort } from '../../../modules/frontend-knowledge-draft/src/product-api.js';

type DiscoveryResourceRow = {
  readonly resource: unknown;
  readonly candidate: unknown;
};

type ApprovedReviewGroupRow = {
  readonly group_id: string;
  readonly access_scope: readonly string[];
  readonly sensitivity: string;
  readonly items: unknown;
};

type CanonicalStateRow = {
  readonly version: number;
  readonly snapshot_digest: string;
};

const parseJson = (value: unknown): unknown =>
  typeof value === 'string' ? JSON.parse(value) : value;

const positiveRevision = (value: string | number, field: string): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    reviewFailure('VALIDATION_FAILED', `${field} is not a valid positive revision.`);
  }
  return parsed;
};

const text = (value: string, field: string): string => {
  if (value.trim().length === 0) reviewFailure('VALIDATION_FAILED', `${field} is required.`);
  return value;
};

const sensitivityRank = (value: string): number =>
  ({ public: 0, internal: 1, private: 2, restricted: 3 })[value] ?? Number.MAX_SAFE_INTEGER;

const failInvalidSource = (): never => {
  reviewFailure('REVIEW_TARGET_CHANGED', 'The Discovery Review source is no longer eligible.');
};

const failEndpoint = (): never => {
  // Do not reveal whether a hidden Entity exists, or which authority check
  // failed. All endpoint authority failures use the same safe response.
  reviewFailure('PROJECT_ACCESS_DENIED', 'The approved Knowledge Entity endpoint is unavailable.');
};

const readRelationMaterial = (
  resource: DiscoveryReviewResourceV1,
): Extract<
  NonNullable<
    NonNullable<DiscoveryReviewResourceV1['content']['normalizedMaterial']>['typeSpecific']
  >,
  { findingType: 'RELATION_HYPOTHESIS' }
> => {
  const material = resource.content.normalizedMaterial?.typeSpecific;
  if (!material || material.findingType !== 'RELATION_HYPOTHESIS') {
    reviewFailure(
      'UNSUPPORTED_OPERATION',
      'Only an authoritative relation hypothesis can be accepted for authoring.',
    );
  }
  return material;
};

const requireApprovedEntityRef = (
  ref: DiscoveryResourceRefV1,
  resourceProjectId: string,
  scope: FrontendReviewScopeV1,
): { readonly ref: DiscoveryResourceRefV1; readonly revision: number } => {
  const revision = ref.resourceRevision;
  if (
    ref.resourceKind !== 'CANONICAL_ENTITY' ||
    ref.resourceState !== 'APPROVED' ||
    ref.projectId !== resourceProjectId ||
    ref.projectId !== scope.activeProjectId ||
    revision === undefined
  ) {
    failEndpoint();
  }
  return { ref, revision: positiveRevision(revision!, 'Entity resourceRevision') };
};

const sourceLineageFromResource = (
  resource: DiscoveryReviewResourceV1,
): FrontendKnowledgeDraftChangeSetV1['base']['sourceLineage'] => {
  if (resource.evidenceLineage.length === 0) {
    reviewFailure('VALIDATION_FAILED', 'Discovery authoring requires Evidence lineage.');
  }
  const lineage = resource.evidenceLineage.map((entry) => {
    if (
      entry.sourceId === undefined ||
      entry.sourceVersionId === undefined ||
      entry.evidenceSpanId === undefined
    ) {
      reviewFailure(
        'VALIDATION_FAILED',
        'Discovery Evidence cannot be represented as Source lineage without authoritative source fields.',
      );
    }
    return {
      sourceId: entry.sourceId,
      sourceVersionId: entry.sourceVersionId,
      evidenceSpanIds: [entry.evidenceSpanId],
    };
  });
  const unique = new Map<string, (typeof lineage)[number]>();
  for (const item of lineage) {
    const key = `${item.sourceId}:${item.sourceVersionId}`;
    const existing = unique.get(key);
    unique.set(
      key,
      existing === undefined
        ? item
        : { ...existing, evidenceSpanIds: [...existing.evidenceSpanIds, ...item.evidenceSpanIds] },
    );
  }
  return [...unique.values()];
};

const decodeSourceRow = (
  row: DiscoveryResourceRow,
):
  | {
      readonly resource: DiscoveryReviewResourceV1;
      readonly candidate: DerivedKnowledgeCandidateV1;
    }
  | undefined => {
  try {
    const resource = decodeDiscoveryReviewResourceV1(parseJson(row.resource));
    const candidate = decodeDerivedKnowledgeCandidateV1(
      parseJson(row.candidate),
      'discoveryCandidate',
    );
    assertDiscoveryReviewResourceMatchesCandidateV1(resource, candidate);
    return { resource, candidate };
  } catch {
    return undefined;
  }
};

type ApprovedEndpointAuthority = {
  readonly endpoint: ApprovedKnowledgeEntityRefV1;
  readonly accessScope: readonly string[];
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
};

const resolveApprovedEndpointAuthority = async (input: {
  readonly transaction: PoolClient;
  readonly ref: DiscoveryResourceRefV1;
  readonly projectId: string;
  readonly actorAccessScope: readonly string[];
  readonly actorSensitivity: string;
}): Promise<ApprovedEndpointAuthority> => {
  const endpoint = requireApprovedEntityRef(input.ref, input.projectId, {
    activeProjectId: input.projectId,
  } as FrontendReviewScopeV1);
  const result = await input.transaction.query<ApprovedReviewGroupRow>(
    `SELECT group_id, access_scope, sensitivity, items
       FROM knowledge.review_groups
      WHERE project_id = $1
        AND status = 'APPROVED'
        AND items @> $2::jsonb
      FOR SHARE`,
    [
      input.projectId,
      JSON.stringify([
        {
          candidateId: endpoint.ref.resourceId,
          candidateType: 'ENTITY',
          revisionNumber: endpoint.revision,
        },
      ]),
    ],
  );
  const matches = result.rows.filter((group) => {
    const items = parseJson(group.items);
    return (
      sensitivityRank(group.sensitivity) !== Number.MAX_SAFE_INTEGER &&
      Array.isArray(items) &&
      items.some(
        (item) =>
          item !== null &&
          typeof item === 'object' &&
          (item as Record<string, unknown>).candidateId === endpoint.ref.resourceId &&
          (item as Record<string, unknown>).candidateType === 'ENTITY' &&
          (item as Record<string, unknown>).revisionNumber === endpoint.revision,
      )
    );
  });
  if (matches.length !== 1) failEndpoint();
  const group = matches[0]!;
  const actorSensitivityRank = sensitivityRank(input.actorSensitivity);
  if (
    actorSensitivityRank === Number.MAX_SAFE_INTEGER ||
    !group.access_scope.every((entry) => input.actorAccessScope.includes(entry)) ||
    sensitivityRank(group.sensitivity) > actorSensitivityRank
  ) {
    failEndpoint();
  }
  return {
    endpoint: {
      projectId: input.projectId,
      authority: 'APPROVED_KNOWLEDGE',
      resourceType: 'ENTITY',
      resourceId: endpoint.ref.resourceId,
      resourceRevision: endpoint.revision,
    },
    accessScope: group.access_scope,
    sensitivity: group.sensitivity as ApprovedEndpointAuthority['sensitivity'],
  };
};

export class PostgresDiscoveryAuthoringBridge
  implements
    FrontendReviewAcceptedForAuthoringBridgeV1,
    FrontendKnowledgeDraftDiscoveryRelationAuthorityPort
{
  constructor(private readonly draftRepository: PostgresFrontendKnowledgeDraftRepository) {}

  async revalidateRelation(input: {
    readonly transaction?: unknown;
    readonly scope: {
      readonly principalId: string;
      readonly sessionId: string;
      readonly activeProjectId: string;
      readonly accessRevision: string;
      readonly policyContextRevision: string;
      readonly sensitivityClearance: 'public' | 'internal' | 'private' | 'restricted';
      readonly accessScope: readonly string[];
    };
    readonly draft: FrontendKnowledgeDraftChangeSetV1;
    readonly operation: Extract<FrontendKnowledgeOperationV1, { readonly kind: 'RELATION_ADD' }>;
  }): Promise<{
    readonly expectedOperation: Extract<
      FrontendKnowledgeOperationV1,
      { readonly kind: 'RELATION_ADD' }
    >;
    readonly provenance: DiscoveryDraftProvenanceV1;
    readonly accessScope: readonly string[];
    readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
  }> {
    const provenance = input.draft.discoveryProvenance;
    if (provenance === undefined) {
      reviewFailure(
        'UNSUPPORTED_OPERATION',
        'A relation commit requires server-owned Discovery provenance.',
      );
    }
    const client = input.transaction;
    if (!client || typeof client !== 'object' || !('query' in client)) {
      reviewFailure(
        'UNSUPPORTED_OPERATION',
        'Final Discovery relation validation requires the PostgreSQL transaction.',
      );
    }
    const transaction = client as PoolClient;
    const reviewRevision = provenance.review.reviewResourceRevision;
    const resourceResult = await transaction.query<DiscoveryResourceRow>(
      `SELECT resource, candidate
         FROM discovery.reentry_review_resources
         JOIN discovery.reentry_candidates candidate
           ON candidate.project_id = discovery.reentry_review_resources.project_id
          AND candidate.candidate_id = discovery.reentry_review_resources.candidate_id
          AND candidate.candidate_revision = discovery.reentry_review_resources.candidate_revision
        WHERE discovery.reentry_review_resources.project_id = $1
          AND discovery.reentry_review_resources.review_resource_id = $2
          AND discovery.reentry_review_resources.resource_revision = $3
          AND discovery.reentry_review_resources.origin = 'DERIVED_DISCOVERY'
          AND discovery.reentry_review_resources.lifecycle_state = 'REVIEW_READY'
          AND discovery.reentry_review_resources.review_eligibility = 'ELIGIBLE_AFTER_VALIDATION'
        FOR SHARE`,
      [input.scope.activeProjectId, provenance.review.reviewResourceId, reviewRevision],
    );
    const row = resourceResult.rows[0];
    const decoded = row === undefined ? undefined : decodeSourceRow(row);
    if (decoded === undefined) return failInvalidSource();
    const { resource, candidate } = decoded;
    if (
      resource.projectId !== input.scope.activeProjectId ||
      resource.reviewResourceId !== provenance.review.reviewResourceId ||
      resource.resourceRevision !== reviewRevision ||
      resource.contentDigest !== provenance.review.resourceDigest ||
      resource.findingId !== provenance.finding.findingId ||
      resource.findingRevision !== provenance.finding.findingRevision ||
      resource.manifestId !== provenance.reentry.manifestId ||
      resource.candidateId !== provenance.reentry.candidateId ||
      resource.candidateRevision !== provenance.reentry.candidateRevision ||
      candidate.candidateId !== provenance.reentry.candidateId ||
      candidate.candidateRevision !== provenance.reentry.candidateRevision ||
      resource.sourceProjectionDigest !== provenance.sourceProjectionDigest ||
      resource.canonicalBase.canonicalVersion !== provenance.canonicalBase.canonicalVersion ||
      resource.canonicalBase.snapshotDigest !== provenance.canonicalBase.snapshotDigest ||
      stableJson(resource.evidenceLineage) !==
        stableJson(
          provenance.evidenceLineage.map((entry) => ({
            schemaVersion: resource.schemaVersion,
            evidenceId: entry.evidenceId,
            ...(entry.sourceId === undefined ? {} : { sourceId: entry.sourceId }),
            ...(entry.sourceVersionId === undefined
              ? {}
              : { sourceVersionId: entry.sourceVersionId }),
            ...(entry.evidenceSpanId === undefined ? {} : { evidenceSpanId: entry.evidenceSpanId }),
          })),
        ) ||
      stableJson(resource.validationResult) !==
        stableJson({
          ...resource.validationResult,
          digest: provenance.validation.digest,
          artifactId: provenance.validation.artifactId,
          artifactRevision: provenance.validation.artifactRevision,
        }) ||
      stableJson(resource.derivationProvenance) !== stableJson(provenance.derivationProvenance)
    ) {
      failInvalidSource();
    }
    const material = readRelationMaterial(resource);
    const from = await resolveApprovedEndpointAuthority({
      transaction,
      ref: material.fromResource,
      projectId: resource.projectId,
      actorAccessScope: input.scope.accessScope,
      actorSensitivity: input.scope.sensitivityClearance,
    });
    const to = await resolveApprovedEndpointAuthority({
      transaction,
      ref: material.toResource,
      projectId: resource.projectId,
      actorAccessScope: input.scope.accessScope,
      actorSensitivity: input.scope.sensitivityClearance,
    });
    if (stableJson(provenance.approvedEntityRefs) !== stableJson([from.endpoint, to.endpoint])) {
      failEndpoint();
    }
    const security = composeDiscoveryFindingSecurityV1({
      findingProjectId: resource.projectId,
      resources: [
        {
          projectId: resource.projectId,
          accessScope: resource.accessScope,
          sensitivity: resource.sensitivity,
        },
        {
          projectId: resource.projectId,
          accessScope: from.accessScope,
          sensitivity: from.sensitivity,
        },
        {
          projectId: resource.projectId,
          accessScope: to.accessScope,
          sensitivity: to.sensitivity,
        },
      ],
      executionContext: {
        projectId: resource.projectId,
        accessScope: resource.accessScope,
        sensitivity: resource.sensitivity,
      },
    });
    if (!security.materializable) return failEndpoint();
    if (
      !security.accessScope.every((entry) => input.scope.accessScope.includes(entry)) ||
      sensitivityRank(security.sensitivity) > sensitivityRank(input.scope.sensitivityClearance)
    ) {
      failEndpoint();
    }
    const stateResult = await transaction.query<CanonicalStateRow>(
      `SELECT version, snapshot_digest
         FROM canonical.project_state
        WHERE project_id = $1
        FOR SHARE`,
      [resource.projectId],
    );
    const state = stateResult.rows[0];
    if (
      state === undefined ||
      state.version !== provenance.canonicalBase.canonicalVersion ||
      state.snapshot_digest !== provenance.canonicalBase.snapshotDigest
    ) {
      reviewFailure('STALE', 'The Discovery canonical base is stale.');
    }
    const temporal = material.temporalQualification;
    const relation: RelationDraftValueV2 = {
      schemaVersion: 'relation.v2',
      relationType: text(material.relationType, 'relationType'),
      fromEndpoint: from.endpoint,
      toEndpoint: to.endpoint,
      direction: material.direction,
      ...(temporal?.validFrom === undefined ? {} : { validFrom: temporal.validFrom }),
      ...(temporal?.validTo === undefined ? {} : { validTo: temporal.validTo }),
      rationale: text(material.rationale, 'relation rationale'),
    };
    const evidenceReferences = resource.evidenceLineage.map((entry) => {
      if (
        entry.sourceId === undefined ||
        entry.sourceVersionId === undefined ||
        entry.evidenceSpanId === undefined
      ) {
        reviewFailure('VALIDATION_FAILED', 'Discovery Evidence lineage is incomplete.');
      }
      return {
        sourceId: entry.sourceId,
        sourceVersionId: entry.sourceVersionId,
        evidenceSpanId: entry.evidenceSpanId,
      };
    });
    const identity = {
      bridgeVersion: 'adr-152.wp2a.v1' as const,
      reviewContextId: provenance.review.reviewContextId,
      contextRevision: provenance.review.contextRevision,
      reviewResourceId: resource.reviewResourceId,
      reviewResourceRevision: resource.resourceRevision,
      candidateId: candidate.candidateId,
      candidateRevision: candidate.candidateRevision,
      canonicalVersion: state.version,
      canonicalSnapshotDigest: state.snapshot_digest,
    };
    const identityDigest = sha256Text(stableJson(identity));
    const expectedMaterializationId = `materialization:discovery-authoring:${identityDigest}`;
    const expectedOperation = {
      operationId: `operation:discovery-relation:${identityDigest}`,
      baseRevision: state.version,
      rationale: relation.rationale,
      evidenceReferences,
      expectedImpact: {
        summary: resource.content.expectedImpact ?? resource.content.summary,
        targetIds: [from.endpoint.resourceId, to.endpoint.resourceId],
      },
      operationRevision: input.operation.operationRevision,
      target: { targetType: 'RELATION' as const, resourceId: resource.reviewResourceId },
      kind: 'RELATION_ADD' as const,
      after: relation,
      contentDigest: '',
    };
    expectedOperation.contentDigest = frontendKnowledgeDraftOperationDigestV1(expectedOperation);
    if (provenance.materializationId !== expectedMaterializationId) failInvalidSource();
    const expectedProvenance: DiscoveryDraftProvenanceV1 = {
      schemaVersion: 'discovery-draft-provenance.v1',
      finding: {
        projectId: resource.projectId,
        findingId: resource.findingId,
        findingRevision: resource.findingRevision,
      },
      reentry: {
        manifestId: resource.manifestId,
        candidateId: candidate.candidateId,
        candidateRevision: candidate.candidateRevision,
      },
      review: {
        reviewContextId: provenance.review.reviewContextId,
        contextRevision: provenance.review.contextRevision,
        reviewResourceId: resource.reviewResourceId,
        reviewResourceRevision: resource.resourceRevision,
        resourceDigest: resource.contentDigest,
      },
      validation: {
        artifactId: resource.validationResult.artifactId,
        artifactRevision: resource.validationResult.artifactRevision,
        digest: resource.validationResult.digest,
      },
      canonicalBase: {
        canonicalVersion: state.version,
        snapshotDigest: state.snapshot_digest,
      },
      sourceProjectionDigest: resource.sourceProjectionDigest,
      evidenceLineage: resource.evidenceLineage,
      approvedEntityRefs: [from.endpoint, to.endpoint],
      derivationProvenance: resource.derivationProvenance,
      bridgeVersion: 'adr-152.wp2a.v1',
      materializationId: expectedMaterializationId,
    };
    if (!security.materializable) return failEndpoint();
    return {
      expectedOperation,
      provenance: expectedProvenance,
      accessScope: security.accessScope,
      sensitivity: security.sensitivity,
    };
  }

  async materialize(input: {
    readonly transaction: unknown;
    readonly repositories: ReviewTransactionRepositoriesV1;
    readonly scope: FrontendReviewScopeV1;
    readonly context: ReviewContextRevisionV1;
    readonly source: ReviewSourceTargetV1;
    readonly approvedItemIds: readonly string[];
    readonly now: string;
  }): Promise<{
    readonly draftId: string;
    readonly draftRevision: number;
    readonly resourceProjectId: string;
    readonly effectiveProjectId: string;
  }> {
    const client = input.transaction;
    if (!client || typeof client !== 'object' || !('query' in client)) {
      throw new TypeError('Discovery authoring requires the Review PostgreSQL transaction.');
    }
    const transaction = client as PoolClient;
    const resourceRevision = positiveRevision(
      input.context.targetRevision,
      'Review targetRevision',
    );
    const resourceResult = await transaction.query<DiscoveryResourceRow>(
      `SELECT resource, candidate
       FROM discovery.reentry_review_resources
       JOIN discovery.reentry_candidates candidate
         ON candidate.project_id = discovery.reentry_review_resources.project_id
        AND candidate.candidate_id = discovery.reentry_review_resources.candidate_id
        AND candidate.candidate_revision = discovery.reentry_review_resources.candidate_revision
       WHERE discovery.reentry_review_resources.project_id = $1
         AND discovery.reentry_review_resources.review_resource_id = $2
         AND discovery.reentry_review_resources.resource_revision = $3
         AND discovery.reentry_review_resources.origin = 'DERIVED_DISCOVERY'
         AND discovery.reentry_review_resources.lifecycle_state = 'REVIEW_READY'
         AND discovery.reentry_review_resources.review_eligibility = 'ELIGIBLE_AFTER_VALIDATION'
       FOR SHARE`,
      [input.scope.activeProjectId, input.source.reviewResourceId, resourceRevision],
    );
    const row = resourceResult.rows[0];
    if (!row) return failInvalidSource();
    const decoded = decodeSourceRow(row);
    if (!decoded) return failInvalidSource();
    const { resource, candidate } = decoded;
    if (
      resource.reviewResourceId !== input.source.reviewResourceId ||
      resource.resourceRevision !== resourceRevision ||
      resource.projectId !== input.scope.activeProjectId ||
      resource.contentDigest !== input.source.targetDigest ||
      resource.contentDigest !== input.context.targetDigest ||
      resource.candidateId !== candidate.candidateId ||
      resource.candidateRevision !== candidate.candidateRevision ||
      input.context.targetKind !== 'DISCOVERY_CANDIDATE' ||
      input.approvedItemIds.length === 0
    ) {
      failInvalidSource();
    }

    const material = readRelationMaterial(resource);
    const from = requireApprovedEntityRef(material.fromResource, resource.projectId, input.scope);
    const to = requireApprovedEntityRef(material.toResource, resource.projectId, input.scope);

    const resolveEndpoint = async (endpoint: {
      readonly ref: DiscoveryResourceRefV1;
      readonly revision: number;
    }): Promise<ApprovedKnowledgeEntityRefV1> => {
      const result = await transaction.query<ApprovedReviewGroupRow>(
        `SELECT group_id, access_scope, sensitivity, items
         FROM knowledge.review_groups
         WHERE project_id = $1
           AND status = 'APPROVED'
           AND items @> $2::jsonb
         FOR SHARE`,
        [
          resource.projectId,
          JSON.stringify([
            {
              candidateId: endpoint.ref.resourceId,
              candidateType: 'ENTITY',
              revisionNumber: endpoint.revision,
            },
          ]),
        ],
      );
      const matches = result.rows.filter((group) => {
        if (
          !group.access_scope.every((entry) => input.scope.accessScope.includes(entry)) ||
          sensitivityRank(group.sensitivity) >
            sensitivityRank(input.scope.sensitivityClearance ?? 'public')
        ) {
          return false;
        }
        const items = parseJson(group.items);
        return (
          Array.isArray(items) &&
          items.some(
            (item) =>
              item !== null &&
              typeof item === 'object' &&
              (item as Record<string, unknown>).candidateId === endpoint.ref.resourceId &&
              (item as Record<string, unknown>).candidateType === 'ENTITY' &&
              (item as Record<string, unknown>).revisionNumber === endpoint.revision,
          )
        );
      });
      if (matches.length !== 1) failEndpoint();
      return {
        projectId: resource.projectId,
        authority: 'APPROVED_KNOWLEDGE',
        resourceType: 'ENTITY',
        resourceId: endpoint.ref.resourceId,
        resourceRevision: endpoint.revision,
      };
    };
    const fromEndpoint = await resolveEndpoint(from);
    const toEndpoint = await resolveEndpoint(to);

    await transaction.query(
      `INSERT INTO canonical.project_state (project_id, version, snapshot_digest, updated_at)
       VALUES ($1, 0, $2, '1970-01-01T00:00:00.000Z')
       ON CONFLICT (project_id) DO NOTHING`,
      [resource.projectId, canonicalSnapshotDigest(resource.projectId, 0, [])],
    );
    const stateResult = await transaction.query<CanonicalStateRow>(
      `SELECT version, snapshot_digest
       FROM canonical.project_state
       WHERE project_id = $1
       FOR UPDATE`,
      [resource.projectId],
    );
    const state = stateResult.rows[0];
    if (!state) return failInvalidSource();
    if (
      state.version !== resource.canonicalBase.canonicalVersion ||
      state.snapshot_digest !== resource.canonicalBase.snapshotDigest
    ) {
      reviewFailure(
        'STALE',
        'The Discovery canonical base is stale and cannot be silently rebased.',
      );
    }

    const identity = {
      bridgeVersion: 'adr-152.wp2a.v1' as const,
      reviewContextId: input.context.reviewContextId,
      contextRevision: input.context.contextRevision,
      reviewResourceId: resource.reviewResourceId,
      reviewResourceRevision: resource.resourceRevision,
      candidateId: candidate.candidateId,
      candidateRevision: candidate.candidateRevision,
      canonicalVersion: state.version,
      canonicalSnapshotDigest: state.snapshot_digest,
    };
    const identityDigest = sha256Text(stableJson(identity));
    const draftId = `draft:discovery-authoring:${identityDigest}`;
    const materializationId = `materialization:discovery-authoring:${identityDigest}`;
    const operationId = `operation:discovery-relation:${identityDigest}`;
    const sourceLineage = sourceLineageFromResource(resource);
    const evidenceReferences = resource.evidenceLineage.map((entry) => {
      if (
        entry.sourceId === undefined ||
        entry.sourceVersionId === undefined ||
        entry.evidenceSpanId === undefined
      ) {
        reviewFailure('VALIDATION_FAILED', 'Discovery Evidence lineage is incomplete.');
      }
      return {
        sourceId: entry.sourceId,
        sourceVersionId: entry.sourceVersionId,
        evidenceSpanId: entry.evidenceSpanId,
      };
    });
    const temporal = material.temporalQualification;
    if (
      temporal !== undefined &&
      ((temporal.validFrom !== undefined && Number.isNaN(Date.parse(temporal.validFrom))) ||
        (temporal.validTo !== undefined && Number.isNaN(Date.parse(temporal.validTo))) ||
        (temporal.validFrom !== undefined &&
          temporal.validTo !== undefined &&
          Date.parse(temporal.validFrom) > Date.parse(temporal.validTo)))
    ) {
      reviewFailure('VALIDATION_FAILED', 'The authoritative temporal qualification is invalid.');
    }
    const relation: RelationDraftValueV2 = {
      schemaVersion: 'relation.v2',
      relationType: text(material.relationType, 'relationType'),
      fromEndpoint,
      toEndpoint,
      direction: material.direction,
      ...(temporal?.validFrom === undefined ? {} : { validFrom: temporal.validFrom }),
      ...(temporal?.validTo === undefined ? {} : { validTo: temporal.validTo }),
      rationale: text(material.rationale, 'relation rationale'),
    };
    const operationCommon = {
      operationId,
      baseRevision: state.version,
      rationale: relation.rationale,
      evidenceReferences,
      expectedImpact: {
        summary: resource.content.expectedImpact ?? resource.content.summary,
        targetIds: [fromEndpoint.resourceId, toEndpoint.resourceId],
      },
      operationRevision: 1,
    } as const;
    const operationDigest = sha256Text(
      stableJson({
        ...operationCommon,
        target: { targetType: 'RELATION', resourceId: resource.reviewResourceId },
        kind: 'RELATION_ADD',
        after: relation,
      }),
    );
    const operation = {
      ...operationCommon,
      target: { targetType: 'RELATION' as const, resourceId: resource.reviewResourceId },
      kind: 'RELATION_ADD' as const,
      after: relation,
      contentDigest: operationDigest,
    };
    const discoveryProvenance = {
      schemaVersion: 'discovery-draft-provenance.v1' as const,
      finding: {
        projectId: resource.projectId,
        findingId: resource.findingId,
        findingRevision: resource.findingRevision,
      },
      reentry: {
        manifestId: resource.manifestId,
        candidateId: candidate.candidateId,
        candidateRevision: candidate.candidateRevision,
      },
      review: {
        reviewContextId: input.context.reviewContextId,
        contextRevision: input.context.contextRevision,
        reviewResourceId: resource.reviewResourceId,
        reviewResourceRevision: resource.resourceRevision,
        resourceDigest: resource.contentDigest,
      },
      validation: {
        artifactId: resource.validationResult.artifactId,
        artifactRevision: resource.validationResult.artifactRevision,
        digest: resource.validationResult.digest,
      },
      canonicalBase: {
        canonicalVersion: state.version,
        snapshotDigest: state.snapshot_digest,
      },
      sourceProjectionDigest: resource.sourceProjectionDigest,
      evidenceLineage: resource.evidenceLineage,
      approvedEntityRefs: [fromEndpoint, toEndpoint],
      derivationProvenance: resource.derivationProvenance,
      bridgeVersion: 'adr-152.wp2a.v1' as const,
      materializationId,
    };
    const draft = createInitialFrontendKnowledgeDraft({
      draftId,
      startMode: 'KNOWLEDGE_PAGE',
      binding: {
        activeProjectId: input.scope.activeProjectId,
        resourceProjectId: resource.projectId,
        draftProjectId: resource.projectId,
        effectiveProjectId: resource.effectiveProjectId,
        accessRevision: input.scope.accessRevision,
        policyContextRevision: input.scope.policyContextRevision,
      },
      resourceId: resource.reviewResourceId,
      base: {
        revisionIdentityKind: 'NEW_RESOURCE_SNAPSHOT',
        resourceProjectId: resource.projectId,
        canonicalSnapshotId: `canonical:${resource.projectId}:${state.version}`,
        canonicalVersion: state.version,
        canonicalSnapshotDigest: state.snapshot_digest,
        accessRevision: input.scope.accessRevision,
        policyContextRevision: input.scope.policyContextRevision,
        sourceLineage,
      },
      operations: [operation],
      discoveryProvenance,
      createdAt: input.now,
      updatedAt: input.now,
    });
    const materialization: DraftMaterializationRecordV1 = {
      materializationId,
      draftId,
      target: { kind: 'RESOURCE', resourceId: resource.reviewResourceId },
      resourceProjectId: resource.projectId,
      draftProjectId: resource.projectId,
      effectiveProjectId: resource.effectiveProjectId,
      base: draft.base,
      commandIdentity: {
        principalId: input.scope.principalId,
        clientRequestId: `review:${input.context.reviewContextId}:${input.context.contextRevision}`,
        idempotencyKey: materializationId,
        semanticDigest: identityDigest,
      },
      discoveryProvenance,
      createdAt: input.now,
    };
    const draftRepositories: FrontendKnowledgeDraftTransactionRepositoriesV1 =
      this.draftRepository.repositoriesOn(transaction);
    const materialized = await materializeFrontendKnowledgeDraftOn(draftRepositories, {
      draft,
      materialization,
    });
    return {
      draftId: materialized.draft.draftId,
      draftRevision: materialized.draft.revision,
      resourceProjectId: materialized.draft.resourceProjectId,
      effectiveProjectId: materialized.draft.effectiveProjectId,
    };
  }
}
