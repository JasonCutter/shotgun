import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type { CanonicalSnapshotPort } from '../../../modules/comparison/src/index.js';
import type {
  CanonicalCommitWrite,
  CanonicalKnowledgeRepositoryPort,
} from '../../../modules/canonical-knowledge/src/index.js';
import {
  canonicalSnapshotDigest,
  type CanonicalClaim,
  type CanonicalCommitResult,
  type CanonicalHistoryEvent,
  type CanonicalOutboxRecord,
  type CanonicalRevision,
  type CanonicalRelationV1,
  type CanonicalSnapshot,
  type CanonicalSnapshotClaim,
  type CanonicalSnapshotRelation,
  type FrontendCanonicalCommitWrite,
  ShotgunError,
} from '../../../packages/contracts/src/index.js';

type StateRow = QueryResultRow & {
  readonly version: number;
  readonly snapshot_digest: string;
  readonly updated_at: Date;
};

type ClaimRow = QueryResultRow & {
  readonly claim_json: CanonicalClaim;
};

type RelationRow = QueryResultRow & {
  readonly relation_json: CanonicalRelationV1;
};

type CommitRow = QueryResultRow & {
  readonly result_json: CanonicalCommitResult;
};

type HistoryRow = QueryResultRow & {
  readonly event_json: CanonicalHistoryEvent;
};

type OutboxRow = QueryResultRow & {
  readonly outbox_id: string;
  readonly project_id: string;
  readonly aggregate_id: string;
  readonly event_type: 'CanonicalCommitted';
  readonly payload_json: CanonicalOutboxRecord['payload'];
  readonly status: CanonicalOutboxRecord['status'];
  readonly attempts: number;
  readonly available_at: Date;
  readonly claimed_at: Date | null;
  readonly published_at: Date | null;
  readonly last_error: string | null;
};

export type PostgresStage6Options = {
  readonly failpoint?: 'after-history';
};

const snapshotClaims = (claims: readonly CanonicalClaim[]) =>
  [...claims]
    .sort((left, right) => left.claimId.localeCompare(right.claimId))
    .map((claim) => ({
      claimId: claim.claimId,
      text: claim.claimText,
      revisionNumber: claim.revisionNumber,
      evidenceIds: claim.evidenceIds,
    }));

const snapshotRelations = (
  relations: readonly CanonicalRelationV1[],
): CanonicalSnapshotRelation[] =>
  [...relations]
    .sort((left, right) => left.relationId.localeCompare(right.relationId))
    .map((relation) => ({
      relationId: relation.relationId,
      logicalIdentityKey: relation.logicalIdentityKey,
      revisionNumber: relation.revisionNumber,
      relationType: relation.relationType,
      fromEndpoint: relation.fromEndpoint,
      toEndpoint: relation.toEndpoint,
      direction: relation.direction,
      ...(relation.validFrom === undefined ? {} : { validFrom: relation.validFrom }),
      ...(relation.validTo === undefined ? {} : { validTo: relation.validTo }),
      evidenceIds: relation.evidenceIds,
    }));

const mapOutbox = (row: OutboxRow): CanonicalOutboxRecord => ({
  outboxId: row.outbox_id,
  projectId: row.project_id,
  aggregateId: row.aggregate_id,
  eventType: row.event_type,
  payload: row.payload_json,
  status: row.status,
  attempts: row.attempts,
  availableAt: row.available_at.toISOString(),
  claimedAt: row.claimed_at?.toISOString(),
  publishedAt: row.published_at?.toISOString(),
  lastError: row.last_error ?? undefined,
});

const loadClaims = async (
  client: Pool | PoolClient,
  projectId: string,
): Promise<CanonicalClaim[]> => {
  const result = await client.query<ClaimRow>(
    `SELECT claim_json
     FROM canonical.claims
     WHERE project_id = $1
     ORDER BY claim_id`,
    [projectId],
  );
  return result.rows.map((row) => row.claim_json);
};

const loadRelations = async (
  client: Pool | PoolClient,
  projectId: string,
): Promise<CanonicalRelationV1[]> => {
  const result = await client.query<RelationRow>(
    `SELECT relation_json
     FROM canonical.relations
     WHERE project_id = $1
     ORDER BY relation_id`,
    [projectId],
  );
  return result.rows.map((row) => row.relation_json);
};

const relationAwareDigest = (
  projectId: string,
  version: number,
  claims: readonly CanonicalSnapshotClaim[],
  relations: readonly CanonicalSnapshotRelation[],
): string =>
  canonicalSnapshotDigest(
    projectId,
    version,
    claims,
    relations.length === 0 ? undefined : relations,
  );

export class PostgresCanonicalKnowledgeRepository
  implements CanonicalKnowledgeRepositoryPort, CanonicalSnapshotPort
{
  constructor(
    private readonly pool: Pool,
    private readonly options: PostgresStage6Options = {},
  ) {}

  async listProjectIds(): Promise<readonly string[]> {
    const result = await this.pool.query<{ project_id: string }>(
      `SELECT project_id FROM canonical.project_state
       UNION
       SELECT project_id FROM canonical.outbox WHERE status <> 'published'
       ORDER BY project_id`,
    );
    return result.rows.map((row) => row.project_id);
  }

  async getSnapshot(projectId: string): Promise<CanonicalSnapshot> {
    const state = await this.pool.query<StateRow>(
      `SELECT version, snapshot_digest, updated_at
       FROM canonical.project_state
       WHERE project_id = $1`,
      [projectId],
    );
    const claims = snapshotClaims(await loadClaims(this.pool, projectId));
    const relations = snapshotRelations(await loadRelations(this.pool, projectId));
    const row = state.rows[0];
    const version = row?.version ?? 0;
    return {
      snapshotId: `canonical:${projectId}:${version}`,
      projectId,
      version,
      digest: row?.snapshot_digest ?? relationAwareDigest(projectId, 0, [], relations),
      claims,
      ...(relations.length === 0 ? {} : { relations }),
      createdAt: row?.updated_at.toISOString() ?? '1970-01-01T00:00:00.000Z',
    };
  }

  async getSnapshotInTransaction(
    transaction: unknown,
    projectId: string,
  ): Promise<CanonicalSnapshot> {
    if (!transaction || typeof transaction !== 'object' || !('query' in transaction)) {
      throw new TypeError('A PostgreSQL transaction client is required.');
    }
    const client = transaction as PoolClient;
    const state = await client.query<StateRow>(
      `SELECT version, snapshot_digest, updated_at
       FROM canonical.project_state
       WHERE project_id = $1`,
      [projectId],
    );
    const claims = snapshotClaims(await loadClaims(client, projectId));
    const relations = snapshotRelations(await loadRelations(client, projectId));
    const row = state.rows[0];
    const version = row?.version ?? 0;
    return {
      snapshotId: `canonical:${projectId}:${version}`,
      projectId,
      version,
      digest: row?.snapshot_digest ?? relationAwareDigest(projectId, 0, [], relations),
      claims,
      ...(relations.length === 0 ? {} : { relations }),
      createdAt: row?.updated_at.toISOString() ?? '1970-01-01T00:00:00.000Z',
    };
  }

  async commit(write: CanonicalCommitWrite): Promise<CanonicalCommitResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO canonical.project_state (project_id, version, snapshot_digest, updated_at)
         VALUES ($1, 0, $2, '1970-01-01T00:00:00.000Z')
         ON CONFLICT (project_id) DO NOTHING`,
        [write.manifest.projectId, canonicalSnapshotDigest(write.manifest.projectId, 0, [])],
      );
      const stateResult = await client.query<StateRow>(
        `SELECT version, snapshot_digest, updated_at
         FROM canonical.project_state
         WHERE project_id = $1
         FOR UPDATE`,
        [write.manifest.projectId],
      );
      const existing = await client.query<CommitRow>(
        `SELECT result_json
         FROM canonical.commits
         WHERE commit_id = $1`,
        [write.commitId],
      );
      if (existing.rows[0]) {
        const result = existing.rows[0].result_json;
        if (
          result.projectId !== write.manifest.projectId ||
          result.manifestDigest !== write.manifest.manifestDigest
        ) {
          throw new ShotgunError({
            code: 'CONFLICT',
            safeMessage: 'The Canonical Commit id was reused with different approved content.',
            module: 'postgres-stage6',
            operation: 'commit-canonical',
          });
        }
        await client.query('COMMIT');
        return result;
      }

      const state = stateResult.rows[0]!;
      if (
        state.version !== write.manifest.expectedCanonicalVersion ||
        state.snapshot_digest !== write.manifest.snapshotDigest
      ) {
        throw new ShotgunError({
          code: 'STALE_APPROVAL',
          safeMessage: 'The Canonical Snapshot changed after approval.',
          module: 'postgres-stage6',
          operation: 'commit-canonical',
        });
      }

      let claim: CanonicalClaim | undefined;
      if (write.manifest.operation === 'ADD_CLAIM' && write.claimId) {
        claim = {
          claimId: write.claimId,
          projectId: write.manifest.projectId,
          revisionNumber: 1,
          claimText: write.manifest.claimText,
          sourceVersionId: write.manifest.sourceVersionId,
          evidenceIds: [...write.manifest.evidenceIds],
          createdFromManifestId: write.manifest.manifestId,
          authorityId: null,
          authorityDigest: null,
          accessScope: [...write.manifest.accessScope],
          sensitivity: write.manifest.sensitivity,
          createdAt: write.committedAt,
        };
        await client.query(
          `INSERT INTO canonical.claims (
             claim_id, project_id, source_version_id, manifest_id, claim_json, created_at
           )
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            claim.claimId,
            claim.projectId,
            claim.sourceVersionId,
            claim.createdFromManifestId,
            JSON.stringify(claim),
            claim.createdAt,
          ],
        );
      }

      const afterVersion = claim ? state.version + 1 : state.version;
      const afterClaims = snapshotClaims(await loadClaims(client, write.manifest.projectId));
      const afterRelations = snapshotRelations(
        await loadRelations(client, write.manifest.projectId),
      );
      const afterDigest = relationAwareDigest(
        write.manifest.projectId,
        afterVersion,
        afterClaims,
        afterRelations,
      );
      const result: CanonicalCommitResult = {
        commitId: write.commitId,
        projectId: write.manifest.projectId,
        manifestId: write.manifest.manifestId,
        manifestDigest: write.manifest.manifestDigest,
        changeSetId: write.manifest.changeSetId,
        authorityId: null,
        authorityDigest: null,
        operation: write.manifest.operation,
        status: claim ? 'COMMITTED' : 'NO_OP',
        beforeVersion: state.version,
        afterVersion,
        snapshotDigest: afterDigest,
        claimId: claim?.claimId,
        revisionId: write.revisionId,
        historyEventId: write.historyEventId,
        outboxId: write.outboxId,
        committedAt: write.committedAt,
      };
      const revision: CanonicalRevision = {
        revisionId: write.revisionId,
        projectId: write.manifest.projectId,
        commitId: write.commitId,
        manifestId: write.manifest.manifestId,
        operation: write.manifest.operation,
        beforeVersion: state.version,
        afterVersion,
        claimId: claim?.claimId,
        reason: write.manifest.reason,
        actor: write.actor,
        createdAt: write.committedAt,
      };
      const history: CanonicalHistoryEvent = {
        historyEventId: write.historyEventId,
        projectId: write.manifest.projectId,
        commitId: write.commitId,
        manifestId: write.manifest.manifestId,
        changeSetId: write.manifest.changeSetId,
        eventType: claim ? 'CANONICAL_CLAIM_ADDED' : 'CHANGESET_NO_OP',
        beforeVersion: state.version,
        afterVersion,
        claimId: claim?.claimId,
        reason: write.manifest.reason,
        actor: write.actor,
        createdAt: write.committedAt,
      };
      const outbox: CanonicalOutboxRecord = {
        outboxId: write.outboxId,
        projectId: write.manifest.projectId,
        aggregateId: write.commitId,
        eventType: 'CanonicalCommitted',
        payload: {
          commitId: write.commitId,
          manifestId: write.manifest.manifestId,
          changeSetId: write.manifest.changeSetId,
          operation: write.manifest.operation,
          status: result.status,
          canonicalVersion: afterVersion,
          snapshotDigest: afterDigest,
          claimId: claim?.claimId,
          actorId: write.actor.id,
          accessScope: [...write.manifest.accessScope],
          sensitivity: write.manifest.sensitivity,
        },
        status: 'pending',
        attempts: 0,
        availableAt: write.committedAt,
      };

      await client.query(
        `INSERT INTO canonical.commits (
           commit_id, project_id, manifest_id, manifest_digest, change_set_id,
           result_json, committed_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          result.commitId,
          result.projectId,
          result.manifestId,
          result.manifestDigest,
          result.changeSetId,
          JSON.stringify(result),
          result.committedAt,
        ],
      );
      await client.query(
        `INSERT INTO canonical.revisions (
           revision_id, project_id, commit_id, revision_json, created_at
         )
         VALUES ($1, $2, $3, $4, $5)`,
        [
          revision.revisionId,
          revision.projectId,
          revision.commitId,
          JSON.stringify(revision),
          revision.createdAt,
        ],
      );
      await client.query(
        `INSERT INTO canonical.history_events (
           history_event_id, project_id, commit_id, event_json, created_at
         )
         VALUES ($1, $2, $3, $4, $5)`,
        [
          history.historyEventId,
          history.projectId,
          history.commitId,
          JSON.stringify(history),
          history.createdAt,
        ],
      );
      if (this.options.failpoint === 'after-history') {
        throw new Error('Stage 6 failpoint after history insert.');
      }
      await client.query(
        `INSERT INTO canonical.outbox (
           outbox_id, project_id, aggregate_id, event_type, payload_json,
           status, attempts, available_at
         )
         VALUES ($1, $2, $3, $4, $5, 'pending', 0, $6)`,
        [
          outbox.outboxId,
          outbox.projectId,
          outbox.aggregateId,
          outbox.eventType,
          JSON.stringify(outbox.payload),
          outbox.availableAt,
        ],
      );
      await client.query(
        `UPDATE canonical.project_state
         SET version = $2, snapshot_digest = $3, updated_at = $4
         WHERE project_id = $1`,
        [write.manifest.projectId, afterVersion, afterDigest, write.committedAt],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async commitFrontendDraft(write: FrontendCanonicalCommitWrite): Promise<CanonicalCommitResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await this.commitFrontendDraftOnClient(client, write);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Joins an already-open transaction; the caller owns BEGIN/COMMIT/ROLLBACK. */
  async commitFrontendDraftInTransaction(
    transaction: unknown,
    write: FrontendCanonicalCommitWrite,
  ): Promise<CanonicalCommitResult> {
    if (!transaction || typeof transaction !== 'object' || !('query' in transaction)) {
      throw new TypeError('A PostgreSQL transaction client is required.');
    }
    return this.commitFrontendDraftOnClient(transaction as PoolClient, write);
  }

  private async commitFrontendDraftOnClient(
    client: PoolClient,
    write: FrontendCanonicalCommitWrite,
  ): Promise<CanonicalCommitResult> {
    await client.query(
      `INSERT INTO canonical.project_state (project_id, version, snapshot_digest, updated_at)
         VALUES ($1, 0, $2, '1970-01-01T00:00:00.000Z')
         ON CONFLICT (project_id) DO NOTHING`,
      [write.projectId, canonicalSnapshotDigest(write.projectId, 0, [])],
    );
    const stateResult = await client.query<StateRow>(
      `SELECT version, snapshot_digest, updated_at
         FROM canonical.project_state
         WHERE project_id = $1
         FOR UPDATE`,
      [write.projectId],
    );
    const existing = await client.query<CommitRow>(
      `SELECT result_json
         FROM canonical.commits
         WHERE commit_id = $1`,
      [write.commitId],
    );
    if (existing.rows[0]) {
      const result = existing.rows[0].result_json;
      if (
        result.projectId !== write.projectId ||
        result.authorityId !== write.authority.approvalId ||
        result.authorityDigest !== write.authority.approvalBindingDigest
      ) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: 'The Canonical Commit id was reused with different frontend authority.',
          module: 'postgres-stage6',
          operation: 'commit-frontend-draft',
        });
      }
      return result;
    }

    // One Frontend Approval -> at most one Canonical commit.
    const existingByApproval = await client.query<CommitRow>(
      `SELECT result_json
         FROM canonical.commits
         WHERE authority_kind = 'FRONTEND_REVIEW_APPROVAL'
           AND authority_id = $1
           AND project_id = $2
           AND commit_id <> $3`,
      [write.authority.approvalId, write.projectId, write.commitId],
    );
    if (existingByApproval.rows[0]) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'A Canonical Commit for this approval already exists.',
        module: 'postgres-stage6',
        operation: 'commit-frontend-draft',
      });
    }

    const state = stateResult.rows[0]!;
    if (
      state.version !== write.expectedCanonicalVersion ||
      state.snapshot_digest !== write.snapshotDigest
    ) {
      throw new ShotgunError({
        code: 'STALE_APPROVAL',
        safeMessage: 'The Canonical Snapshot changed after approval.',
        module: 'postgres-stage6',
        operation: 'commit-frontend-draft',
      });
    }

    let claim: CanonicalClaim | undefined;
    let relation: CanonicalRelationV1 | undefined;
    if (write.operation === 'ADD_CLAIM') {
      claim = {
        claimId: write.claimId,
        projectId: write.projectId,
        revisionNumber: 1,
        claimText: write.claimText,
        sourceVersionId: write.sourceVersionId,
        evidenceIds: [...write.evidenceIds],
        createdFromManifestId: null,
        authorityId: write.authority.approvalId,
        authorityDigest: write.authority.approvalBindingDigest,
        accessScope: [...write.accessScope],
        sensitivity: write.sensitivity,
        createdAt: write.committedAt,
      };
      await client.query(
        `INSERT INTO canonical.claims (
             claim_id, project_id, source_version_id, manifest_id, claim_json, created_at,
             authority_id, authority_digest
           )
           VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)`,
        [
          claim.claimId,
          claim.projectId,
          claim.sourceVersionId,
          JSON.stringify(claim),
          claim.createdAt,
          claim.authorityId,
          claim.authorityDigest,
        ],
      );
    } else if (write.operation === 'ADD_RELATION') {
      const hasDiscoveryProvenance = write.discoveryProvenanceRef !== undefined;
      const hasDiscoveryProvenanceRevision = write.discoveryProvenanceRevision !== undefined;
      if (
        hasDiscoveryProvenance !== hasDiscoveryProvenanceRevision ||
        (hasDiscoveryProvenance &&
          (write.discoveryProvenanceRef!.trim().length === 0 ||
            !Number.isSafeInteger(write.discoveryProvenanceRevision) ||
            write.discoveryProvenanceRevision! < 1))
      ) {
        throw new ShotgunError({
          code: 'VALIDATION_ERROR',
          safeMessage: 'The Discovery authoring precursor linkage is invalid.',
          module: 'postgres-stage6',
          operation: 'commit-frontend-draft',
        });
      }
      const endpointProjectIds = [write.fromEndpoint.projectId, write.toEndpoint.projectId];
      if (
        write.fromEndpoint.authority !== 'APPROVED_KNOWLEDGE' ||
        write.toEndpoint.authority !== 'APPROVED_KNOWLEDGE' ||
        write.fromEndpoint.resourceType !== 'ENTITY' ||
        write.toEndpoint.resourceType !== 'ENTITY' ||
        endpointProjectIds.some((projectId) => projectId !== write.projectId) ||
        write.fromEndpoint.resourceRevision < 1 ||
        write.toEndpoint.resourceRevision < 1 ||
        write.evidenceIds.length === 0
      ) {
        throw new ShotgunError({
          code: 'VALIDATION_ERROR',
          safeMessage: 'The Canonical Relation endpoint or Evidence binding is invalid.',
          module: 'postgres-stage6',
          operation: 'commit-frontend-draft',
        });
      }
      const existingRelation = await client.query<RelationRow>(
        `SELECT relation_json
           FROM canonical.relations
           WHERE project_id = $1 AND logical_identity_key = $2
           FOR SHARE`,
        [write.projectId, write.logicalIdentityKey],
      );
      if (existingRelation.rows[0]) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: 'The Canonical Relation logical identity already exists.',
          module: 'postgres-stage6',
          operation: 'commit-frontend-draft',
        });
      }
      relation = {
        relationId: write.relationId,
        logicalIdentityKey: write.logicalIdentityKey,
        projectId: write.projectId,
        revisionNumber: 1,
        relationType: write.relationType,
        fromEndpoint: write.fromEndpoint,
        toEndpoint: write.toEndpoint,
        direction: write.direction,
        ...(write.validFrom === undefined ? {} : { validFrom: write.validFrom }),
        ...(write.validTo === undefined ? {} : { validTo: write.validTo }),
        evidenceIds: [...write.evidenceIds],
        accessScope: [...write.accessScope],
        sensitivity: write.sensitivity,
        authority: write.authority,
        ...(write.discoveryProvenanceRef === undefined
          ? {}
          : { discoveryProvenanceRef: write.discoveryProvenanceRef }),
        ...(write.discoveryProvenanceRevision === undefined
          ? {}
          : { discoveryProvenanceRevision: write.discoveryProvenanceRevision }),
        createdAt: write.committedAt,
      };
      try {
        await client.query(
          `INSERT INTO canonical.relations (
               relation_id, project_id, revision_number, logical_identity_key,
               relation_type, direction, from_endpoint, to_endpoint,
               valid_from, valid_to, evidence_ids, access_scope, sensitivity,
               authority_json, discovery_provenance_ref, relation_json, created_at
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               $14, $15, $16, $17
             )`,
          [
            relation.relationId,
            relation.projectId,
            relation.revisionNumber,
            relation.logicalIdentityKey,
            relation.relationType,
            relation.direction,
            JSON.stringify(relation.fromEndpoint),
            JSON.stringify(relation.toEndpoint),
            relation.validFrom ?? null,
            relation.validTo ?? null,
            relation.evidenceIds,
            relation.accessScope,
            relation.sensitivity,
            JSON.stringify(relation.authority),
            relation.discoveryProvenanceRef ?? null,
            JSON.stringify(relation),
            relation.createdAt,
          ],
        );
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new ShotgunError({
            code: 'CONFLICT',
            safeMessage: 'The Canonical Relation logical identity already exists.',
            module: 'postgres-stage6',
            operation: 'commit-frontend-draft',
          });
        }
        throw error;
      }
      if (
        relation.discoveryProvenanceRef !== undefined &&
        relation.discoveryProvenanceRevision !== undefined
      ) {
        try {
          await client.query(
            `INSERT INTO canonical.relation_precursors (
               project_id, review_resource_id, review_resource_revision,
               relation_id, relation_revision, linked_at
             ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              relation.projectId,
              relation.discoveryProvenanceRef,
              relation.discoveryProvenanceRevision,
              relation.relationId,
              relation.revisionNumber,
              relation.createdAt,
            ],
          );
        } catch (error) {
          if ((error as { code?: string }).code === '23505') {
            throw new ShotgunError({
              code: 'CONFLICT',
              safeMessage: 'The Discovery authoring precursor is already linked.',
              module: 'postgres-stage6',
              operation: 'commit-frontend-draft',
            });
          }
          throw error;
        }
      }
    }

    const changed = claim !== undefined || relation !== undefined;
    const afterVersion = changed ? state.version + 1 : state.version;
    const afterClaims = snapshotClaims(await loadClaims(client, write.projectId));
    const afterRelations = snapshotRelations(await loadRelations(client, write.projectId));
    const afterDigest = relationAwareDigest(
      write.projectId,
      afterVersion,
      afterClaims,
      afterRelations,
    );
    const result: CanonicalCommitResult = {
      commitId: write.commitId,
      projectId: write.projectId,
      manifestId: null,
      manifestDigest: null,
      changeSetId: null,
      authorityId: write.authority.approvalId,
      authorityDigest: write.authority.approvalBindingDigest,
      operation: write.operation,
      status: changed ? 'COMMITTED' : 'NO_OP',
      beforeVersion: state.version,
      afterVersion,
      snapshotDigest: afterDigest,
      claimId: claim?.claimId,
      relationId: relation?.relationId,
      logicalIdentityKey: relation?.logicalIdentityKey,
      revisionId: write.revisionId,
      historyEventId: write.historyEventId,
      outboxId: write.outboxId,
      committedAt: write.committedAt,
    };
    const revision: CanonicalRevision = {
      revisionId: write.revisionId,
      projectId: write.projectId,
      commitId: write.commitId,
      manifestId: null,
      operation: write.operation,
      beforeVersion: state.version,
      afterVersion,
      claimId: claim?.claimId,
      relationId: relation?.relationId,
      reason: write.reason,
      actor: write.actor,
      createdAt: write.committedAt,
    };
    const history: CanonicalHistoryEvent = {
      historyEventId: write.historyEventId,
      projectId: write.projectId,
      commitId: write.commitId,
      manifestId: null,
      changeSetId: null,
      eventType: claim
        ? 'CANONICAL_CLAIM_ADDED'
        : relation
          ? 'CANONICAL_RELATION_ADDED'
          : 'CHANGESET_NO_OP',
      beforeVersion: state.version,
      afterVersion,
      claimId: claim?.claimId,
      relationId: relation?.relationId,
      reason: write.reason,
      actor: write.actor,
      createdAt: write.committedAt,
    };
    const outbox: CanonicalOutboxRecord = {
      outboxId: write.outboxId,
      projectId: write.projectId,
      aggregateId: write.commitId,
      eventType: 'CanonicalCommitted',
      payload: {
        commitId: write.commitId,
        manifestId: null,
        changeSetId: null,
        operation: write.operation,
        status: result.status,
        canonicalVersion: afterVersion,
        snapshotDigest: afterDigest,
        claimId: claim?.claimId,
        relationId: relation?.relationId,
        logicalIdentityKey: relation?.logicalIdentityKey,
        actorId: write.actor.id,
        accessScope: claim ? [...claim.accessScope] : relation ? [...relation.accessScope] : [],
        sensitivity: claim ? claim.sensitivity : relation ? relation.sensitivity : 'public',
      },
      status: 'pending',
      attempts: 0,
      availableAt: write.committedAt,
    };

    await client.query(
      `INSERT INTO canonical.commits (
           commit_id, project_id, manifest_id, manifest_digest, change_set_id,
           result_json, committed_at, authority_kind, authority_id, authority_digest
         )
         VALUES ($1, $2, NULL, NULL, NULL, $3, $4, 'FRONTEND_REVIEW_APPROVAL', $5, $6)`,
      [
        result.commitId,
        result.projectId,
        JSON.stringify(result),
        result.committedAt,
        result.authorityId,
        result.authorityDigest,
      ],
    );
    await client.query(
      `INSERT INTO canonical.revisions (
           revision_id, project_id, commit_id, revision_json, created_at
         )
         VALUES ($1, $2, $3, $4, $5)`,
      [
        revision.revisionId,
        revision.projectId,
        revision.commitId,
        JSON.stringify(revision),
        revision.createdAt,
      ],
    );
    await client.query(
      `INSERT INTO canonical.history_events (
           history_event_id, project_id, commit_id, event_json, created_at
         )
         VALUES ($1, $2, $3, $4, $5)`,
      [
        history.historyEventId,
        history.projectId,
        history.commitId,
        JSON.stringify(history),
        history.createdAt,
      ],
    );
    await client.query(
      `INSERT INTO canonical.outbox (
           outbox_id, project_id, aggregate_id, event_type, payload_json,
           status, attempts, available_at
         )
         VALUES ($1, $2, $3, $4, $5, 'pending', 0, $6)`,
      [
        outbox.outboxId,
        outbox.projectId,
        outbox.aggregateId,
        outbox.eventType,
        JSON.stringify(outbox.payload),
        outbox.availableAt,
      ],
    );
    await client.query(
      `UPDATE canonical.project_state
         SET version = $2, snapshot_digest = $3, updated_at = $4
         WHERE project_id = $1`,
      [write.projectId, afterVersion, afterDigest, write.committedAt],
    );
    return result;
  }

  async findClaim(projectId: string, claimId: string): Promise<CanonicalClaim | undefined> {
    const result = await this.pool.query<ClaimRow>(
      `SELECT claim_json
       FROM canonical.claims
       WHERE project_id = $1 AND claim_id = $2`,
      [projectId, claimId],
    );
    return result.rows[0]?.claim_json;
  }

  async findCommit(
    projectId: string,
    commitId: string,
  ): Promise<CanonicalCommitResult | undefined> {
    const result = await this.pool.query<CommitRow>(
      `SELECT result_json
       FROM canonical.commits
       WHERE project_id = $1 AND commit_id = $2`,
      [projectId, commitId],
    );
    return result.rows[0]?.result_json;
  }

  async findCommitInTransaction(
    transaction: unknown,
    projectId: string,
    commitId: string,
  ): Promise<CanonicalCommitResult | undefined> {
    if (!transaction || typeof transaction !== 'object' || !('query' in transaction)) {
      throw new TypeError('A PostgreSQL transaction client is required.');
    }
    const result = await (transaction as PoolClient).query<CommitRow>(
      `SELECT result_json
       FROM canonical.commits
       WHERE project_id = $1 AND commit_id = $2`,
      [projectId, commitId],
    );
    return result.rows[0]?.result_json;
  }

  async findRevision(
    projectId: string,
    revisionId: string,
  ): Promise<CanonicalRevision | undefined> {
    const result = await this.pool.query<{ revision_json: CanonicalRevision }>(
      `SELECT revision_json
       FROM canonical.revisions
       WHERE project_id = $1 AND revision_id = $2`,
      [projectId, revisionId],
    );
    return result.rows[0]?.revision_json;
  }

  async listHistory(projectId: string): Promise<readonly CanonicalHistoryEvent[]> {
    const result = await this.pool.query<HistoryRow>(
      `SELECT event_json
       FROM canonical.history_events
       WHERE project_id = $1
       ORDER BY created_at, history_event_id`,
      [projectId],
    );
    return result.rows.map((row) => row.event_json);
  }

  async findOutbox(
    projectId: string,
    outboxId: string,
  ): Promise<CanonicalOutboxRecord | undefined> {
    const result = await this.pool.query<OutboxRow>(
      `SELECT outbox_id, project_id, aggregate_id, event_type, payload_json,
              status, attempts, available_at, claimed_at, published_at, last_error
       FROM canonical.outbox
       WHERE project_id = $1 AND outbox_id = $2`,
      [projectId, outboxId],
    );
    return result.rows[0] ? mapOutbox(result.rows[0]) : undefined;
  }

  async claimOutbox(
    projectId: string,
    limit: number,
    claimedAt: string,
    staleBefore: string,
  ): Promise<readonly CanonicalOutboxRecord[]> {
    const result = await this.pool.query<OutboxRow>(
      `WITH claimable AS (
         SELECT outbox_id
         FROM canonical.outbox
         WHERE project_id = $1
           AND available_at <= $2
           AND (
             status = 'pending'
             OR (status = 'processing' AND claimed_at < $3)
           )
         ORDER BY available_at, outbox_id
         FOR UPDATE SKIP LOCKED
         LIMIT $4
       ), updated AS (
         UPDATE canonical.outbox AS outbox
         SET status = 'processing',
             attempts = outbox.attempts + 1,
             claimed_at = $2,
             last_error = NULL
         FROM claimable
         WHERE outbox.outbox_id = claimable.outbox_id
         RETURNING outbox.outbox_id, outbox.project_id, outbox.aggregate_id,
                   outbox.event_type, outbox.payload_json, outbox.status, outbox.attempts,
                   outbox.available_at, outbox.claimed_at, outbox.published_at, outbox.last_error
       )
       SELECT * FROM updated
       ORDER BY available_at, outbox_id`,
      [projectId, claimedAt, staleBefore, limit],
    );
    return result.rows.map(mapOutbox);
  }

  async markOutboxPublished(
    projectId: string,
    outboxId: string,
    attempt: number,
    publishedAt: string,
  ): Promise<void> {
    const result = await this.pool.query(
      `UPDATE canonical.outbox
       SET status = 'published', published_at = $4, claimed_at = NULL
       WHERE project_id = $1 AND outbox_id = $2
         AND status = 'processing' AND attempts = $3`,
      [projectId, outboxId, attempt, publishedAt],
    );
    if (result.rowCount !== 1) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'The Outbox claim is no longer current.',
        module: 'postgres-stage6',
        operation: 'mark-outbox-published',
      });
    }
  }

  async releaseOutbox(
    projectId: string,
    outboxId: string,
    attempt: number,
    error: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE canonical.outbox
       SET status = 'pending', claimed_at = NULL, last_error = $4
       WHERE project_id = $1 AND outbox_id = $2
         AND status = 'processing' AND attempts = $3`,
      [projectId, outboxId, attempt, error],
    );
  }
}
