import type { Pool, PoolClient } from 'pg';

import {
  FrontendKnowledgeDraftCommandError,
  stableJson,
} from '../../../packages/contracts/src/index.js';
import type { FrontendKnowledgeDraftChangeSetV1 } from '../../../packages/contracts/src/index.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';
import type {
  DraftMaterializationRecordV1,
  FrontendKnowledgeDraftRepositoryBoundaryPort,
  FrontendKnowledgeDraftRevisionRecordV1,
  FrontendKnowledgeDraftTransactionHandleV1,
  FrontendKnowledgeDraftTransactionRepositoriesV1,
} from '../../../modules/frontend-knowledge-draft/src/index.js';

const conflict = (message: string): never => {
  throw new FrontendKnowledgeDraftCommandError('DRAFT_REVISION_CONFLICT', message);
};

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === '23505';

export type PostgresFrontendKnowledgeDraftOptions = {
  /** Test failpoint: throws when appending operations, verifying atomic rollback. */
  failOperationAppend?: boolean;
};

const JSONB_SNAPSHOT = (value: unknown): string => JSON.stringify(value);
/**
 * node-postgres already deserializes `jsonb` columns into JS objects, so the
 * value may arrive as a parsed object. Only string values need JSON.parse.
 */
const PARSE = (value: unknown): unknown => {
  if (typeof value === 'string') return JSON.parse(value);
  return value;
};

export class PostgresFrontendKnowledgeDraftRepository implements FrontendKnowledgeDraftRepositoryBoundaryPort {
  failOperationAppend = false;

  constructor(
    private readonly pool: Pool,
    options: PostgresFrontendKnowledgeDraftOptions = {},
  ) {
    this.failOperationAppend = options.failOperationAppend ?? false;
  }

  async transaction<T>(
    action: (repositories: FrontendKnowledgeDraftTransactionRepositoriesV1) => Promise<T>,
  ): Promise<T> {
    return withSafePostgresTransaction(
      this.pool,
      async (client) => action(this.repositories(client)),
      { module: 'frontend-knowledge-draft-postgres', operation: 'draft-transaction' },
    );
  }

  async transactionWithHandle<T>(
    action: (handle: FrontendKnowledgeDraftTransactionHandleV1) => Promise<T>,
  ): Promise<T> {
    return withSafePostgresTransaction(
      this.pool,
      async (client) => action({ repositories: this.repositories(client), raw: client }),
      { module: 'frontend-knowledge-draft-postgres', operation: 'draft-transaction' },
    );
  }

  /**
   * Exposes the repository set for an already-open PoolClient. This is only
   * used by the Review→Draft authoring bridge; it never opens a second
   * transaction or connection.
   */
  repositoriesOn(transaction: unknown): FrontendKnowledgeDraftTransactionRepositoriesV1 {
    if (!transaction || typeof transaction !== 'object' || !('query' in transaction)) {
      throw new TypeError('A PostgreSQL transaction client is required.');
    }
    return this.repositories(transaction as PoolClient);
  }

  private artifactQueryValues(draft: FrontendKnowledgeDraftChangeSetV1) {
    const result: {
      artifactId: string;
      kind: 'VALIDATION' | 'IMPACT';
      draftId: string;
      draftRevision: number;
      artifactRevision: number;
      digest: string;
      status: string;
      projectId: string;
      policyContext: unknown;
    }[] = [];
    const push = (
      kind: 'VALIDATION' | 'IMPACT',
      ref: FrontendKnowledgeDraftChangeSetV1['validation'] | undefined,
    ): void => {
      if (ref === undefined) return;
      result.push({
        artifactId: ref.artifactId,
        kind,
        draftId: draft.draftId,
        draftRevision: draft.revision,
        artifactRevision: ref.artifactRevision,
        digest: ref.digest,
        status: ref.status,
        projectId: draft.resourceProjectId,
        policyContext: ref.projectPolicyContext,
      });
    };
    push('VALIDATION', draft.validation);
    push('IMPACT', draft.impactPreview);
    return result;
  }

  /**
   * Reconciles the current aggregate's Validation/Impact references for the
   * current revision. One authoritative reference per (draft_id,
   * draft_revision, artifact_kind) is allowed; past revision references are
   * never deleted. For an existing reference, every immutable field is
   * compared: an exact match is an idempotent no-op, a digest change fails
   * closed with DIGEST_MISMATCH, and any other immutable field change fails
   * closed with DRAFT_REVISION_CONFLICT. A transaction-scoped advisory lock on
   * the artifact identity makes the read-compare-insert atomic under
   * concurrency. The append-only trigger on `artifact_refs` rejects any
   * UPDATE/DELETE.
   */
  private async replaceArtifactRefs(
    client: PoolClient,
    draft: FrontendKnowledgeDraftChangeSetV1,
  ): Promise<void> {
    for (const ref of this.artifactQueryValues(draft)) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [
        `artifact:${draft.draftId}:${draft.revision}:${ref.kind}`,
      ]);
      const existing = await client.query<{
        artifact_id: string;
        artifact_revision: number;
        digest: string;
        status: string;
        resource_project_id: string;
        project_policy_context: unknown;
      }>(
        `SELECT artifact_id, artifact_revision, digest, status,
                resource_project_id, project_policy_context
         FROM frontend_knowledge_draft.artifact_refs
         WHERE draft_id = $1 AND draft_revision = $2 AND artifact_kind = $3`,
        [draft.draftId, draft.revision, ref.kind],
      );
      const row = existing.rows[0];
      if (row === undefined) {
        await client.query(
          `INSERT INTO frontend_knowledge_draft.artifact_refs
             (artifact_id, artifact_kind, draft_id, draft_revision, artifact_revision,
              digest, status, resource_project_id, project_policy_context)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            ref.artifactId,
            ref.kind,
            ref.draftId,
            ref.draftRevision,
            ref.artifactRevision,
            ref.digest,
            ref.status,
            ref.projectId,
            JSONB_SNAPSHOT(ref.policyContext),
          ],
        );
        continue;
      }
      if (
        row.artifact_id !== ref.artifactId ||
        row.artifact_revision !== ref.artifactRevision ||
        row.status !== ref.status ||
        row.resource_project_id !== ref.projectId ||
        stableJson(PARSE(row.project_policy_context)) !== stableJson(ref.policyContext)
      ) {
        conflict('Artifact reference immutable fields differ for the same Draft revision.');
      }
      if (row.digest !== ref.digest) {
        throw new FrontendKnowledgeDraftCommandError(
          'DIGEST_MISMATCH',
          'Artifact reference digest differs for the same Draft revision.',
        );
      }
    }
  }
  private repositories(client: PoolClient): FrontendKnowledgeDraftTransactionRepositoriesV1 {
    return {
      drafts: {
        findById: async (projectId, draftId) => {
          const result = await client.query<{ snapshot: string }>(
            `SELECT snapshot FROM frontend_knowledge_draft.drafts
             WHERE draft_id = $1 AND resource_project_id = $2`,
            [draftId, projectId],
          );
          const row = result.rows[0];
          return row ? (PARSE(row.snapshot) as FrontendKnowledgeDraftChangeSetV1) : undefined;
        },
        insert: async (draft) => {
          try {
            await client.query(
              `INSERT INTO frontend_knowledge_draft.drafts
                 (draft_id, resource_project_id, draft_project_id, effective_project_id,
                  active_project_id, resource_id, seed_id, answer_run_id, start_mode, status,
                  revision, content_digest, snapshot, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
              [
                draft.draftId,
                draft.resourceProjectId,
                draft.draftProjectId,
                draft.effectiveProjectId,
                draft.activeProjectId,
                draft.resourceId,
                draft.seedId ?? null,
                draft.answerRunId ?? null,
                draft.startMode,
                draft.status,
                draft.revision,
                draft.contentDigest,
                JSONB_SNAPSHOT(draft),
                draft.createdAt,
                draft.updatedAt,
              ],
            );
          } catch (error) {
            if (isUniqueViolation(error)) conflict('A Draft with this identity already exists.');
            throw error;
          }
          await this.replaceArtifactRefs(client, draft);
          return draft;
        },
        replaceIfRevision: async ({ projectId, draft, expectedRevision }) => {
          const updated = await client.query(
            `UPDATE frontend_knowledge_draft.drafts
             SET snapshot = $1, status = $2, revision = $3, content_digest = $4, updated_at = $5
             WHERE draft_id = $6 AND resource_project_id = $7 AND revision = $8
             RETURNING draft_id`,
            [
              JSONB_SNAPSHOT(draft),
              draft.status,
              draft.revision,
              draft.contentDigest,
              draft.updatedAt,
              draft.draftId,
              projectId,
              expectedRevision,
            ],
          );
          if ((updated.rowCount ?? 0) > 0) {
            await this.replaceArtifactRefs(client, draft);
            return 'UPDATED';
          }
          const exists = await client.query(
            `SELECT 1 FROM frontend_knowledge_draft.drafts
             WHERE draft_id = $1 AND resource_project_id = $2`,
            [draft.draftId, projectId],
          );
          return (exists.rowCount ?? 0) > 0 ? 'REVISION_CONFLICT' : 'NOT_FOUND';
        },
      },

      revisions: {
        find: async (projectId, draftId, revision) => {
          const result = await client.query(
            `SELECT draft_id, revision, status, resource_project_id, draft_project_id,
                    effective_project_id, base, operations, content_digest, created_at, updated_at
             FROM frontend_knowledge_draft.revisions
             WHERE draft_id = $1 AND revision = $2 AND resource_project_id = $3`,
            [draftId, revision, projectId],
          );
          const row = result.rows[0];
          if (!row) return undefined;
          return {
            draftId: row.draft_id,
            revision: row.revision,
            status: row.status,
            resourceProjectId: row.resource_project_id,
            draftProjectId: row.draft_project_id,
            effectiveProjectId: row.effective_project_id,
            base: PARSE(row.base) as FrontendKnowledgeDraftChangeSetV1['base'],
            operations: PARSE(row.operations) as FrontendKnowledgeDraftChangeSetV1['operations'],
            contentDigest: row.content_digest,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          } as FrontendKnowledgeDraftRevisionRecordV1;
        },
        append: async (revision) => {
          try {
            await client.query(
              `INSERT INTO frontend_knowledge_draft.revisions
                 (draft_id, revision, status, resource_project_id, draft_project_id,
                  effective_project_id, base, operations, content_digest, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
              [
                revision.draftId,
                revision.revision,
                revision.status,
                revision.resourceProjectId,
                revision.draftProjectId,
                revision.effectiveProjectId,
                JSONB_SNAPSHOT(revision.base),
                JSONB_SNAPSHOT(revision.operations),
                revision.contentDigest,
                revision.createdAt,
                revision.updatedAt,
              ],
            );
          } catch (error) {
            if (isUniqueViolation(error)) {
              conflict('A Draft revision already exists and is immutable.');
            }
            throw error;
          }
          return revision;
        },
      },
      operations: {
        append: async (input) => {
          if (this.failOperationAppend) {
            throw new Error('operation append failpoint');
          }
          for (let index = 0; index < input.operations.length; index += 1) {
            const operation = input.operations[index];
            if (operation === undefined) break;
            try {
              await client.query(
                `INSERT INTO frontend_knowledge_draft.operations
                   (draft_id, revision, operation_id, operation_ordinal, resource_project_id, operation)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                  input.draftId,
                  input.revision,
                  operation.operationId,
                  index + 1,
                  input.projectId,
                  JSONB_SNAPSHOT(operation),
                ],
              );
            } catch (error) {
              if (isUniqueViolation(error)) {
                conflict('An operation with this ID already exists for the Draft revision.');
              }
              throw error;
            }
          }
        },
        list: async (projectId, draftId, revision) => {
          const result = await client.query<{ operation: string }>(
            `SELECT operation FROM frontend_knowledge_draft.operations
             WHERE resource_project_id = $1 AND draft_id = $2 AND revision = $3
             ORDER BY operation_ordinal`,
            [projectId, draftId, revision],
          );
          return result.rows.map(
            (row) =>
              PARSE(row.operation) as FrontendKnowledgeDraftChangeSetV1['operations'][number],
          );
        },
      },

      materializations: {
        /**
         * Seed and command replay-key lookups take a transaction-scoped
         * advisory lock before reading. Concurrent materializations of the
         * same Seed / replay identity therefore serialize: the second
         * transaction observes the first committed row after the lock is
         * released at COMMIT/ROLLBACK and resolves via the replay path instead
         * of racing into a duplicate insert. The unique constraints in
         * migration 025 remain as a hard safety net.
         */
        findBySeed: async (seedId) => {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [
            `seed:${seedId}`,
          ]);
          const result = await client.query<{ snapshot: string }>(
            'SELECT snapshot FROM frontend_knowledge_draft.materializations WHERE seed_id = $1',
            [seedId],
          );
          const row = result.rows[0];
          return row ? (PARSE(row.snapshot) as DraftMaterializationRecordV1) : undefined;
        },
        findByDraftId: async (projectId, draftId) => {
          const result = await client.query<{ snapshot: string }>(
            `SELECT snapshot FROM frontend_knowledge_draft.materializations
             WHERE resource_project_id = $1 AND draft_id = $2`,
            [projectId, draftId],
          );
          const row = result.rows[0];
          return row ? (PARSE(row.snapshot) as DraftMaterializationRecordV1) : undefined;
        },
        findByCommandReplayKey: async (projectId, replayKey) => {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [
            `replay:${projectId}:${replayKey.principalId}:${replayKey.clientRequestId}:${replayKey.idempotencyKey}`,
          ]);
          const result = await client.query<{ snapshot: string }>(
            `SELECT snapshot FROM frontend_knowledge_draft.materializations
             WHERE resource_project_id = $1
               AND replay_principal_id = $2
               AND replay_client_request_id = $3
               AND replay_idempotency_key = $4`,
            [projectId, replayKey.principalId, replayKey.clientRequestId, replayKey.idempotencyKey],
          );
          const row = result.rows[0];
          return row ? (PARSE(row.snapshot) as DraftMaterializationRecordV1) : undefined;
        },
        insert: async (materialization) => {
          try {
            await client.query(
              `INSERT INTO frontend_knowledge_draft.materializations
                 (materialization_id, draft_id, seed_id, target_kind, page_id, resource_id,
                  resource_project_id, draft_project_id, effective_project_id, base,
                  command_identity, replay_principal_id, replay_client_request_id,
                  replay_idempotency_key, semantic_digest, snapshot, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
              [
                materialization.materializationId,
                materialization.draftId,
                materialization.target.kind === 'SEED' ? materialization.target.seedId : null,
                materialization.target.kind,
                materialization.target.kind === 'PAGE' ? materialization.target.pageId : null,
                materialization.target.resourceId,
                materialization.resourceProjectId,
                materialization.draftProjectId,
                materialization.effectiveProjectId,
                JSONB_SNAPSHOT(materialization.base),
                JSONB_SNAPSHOT(materialization.commandIdentity),
                materialization.commandIdentity.principalId,
                materialization.commandIdentity.clientRequestId,
                materialization.commandIdentity.idempotencyKey,
                materialization.commandIdentity.semanticDigest,
                JSONB_SNAPSHOT(materialization),
                materialization.createdAt,
              ],
            );
          } catch (error) {
            if (isUniqueViolation(error)) {
              conflict('A Draft, Seed or command replay identity is already materialized.');
            }
            throw error;
          }
          return materialization;
        },
      },
    };
  }

  /** Test inspection: normalized persisted state shared with the in-memory adapter. */
  async snapshotState() {
    const drafts = await this.pool.query<{
      draft_id: string;
      project_id: string;
      revision: number;
      status: string;
      start_mode: string;
      seed_id: string | null;
    }>(
      `SELECT draft_id, resource_project_id AS project_id, revision, status,
              start_mode, seed_id
       FROM frontend_knowledge_draft.drafts ORDER BY draft_id`,
    );
    const revisions = await this.pool.query<{
      draft_id: string;
      revision: number;
      project_id: string;
      status: string;
      content_digest: string;
    }>(
      `SELECT draft_id, revision, resource_project_id AS project_id, status, content_digest
       FROM frontend_knowledge_draft.revisions ORDER BY draft_id, revision`,
    );
    const operations = await this.pool.query<{
      draft_id: string;
      revision: number;
      project_id: string;
      operation_id: string;
    }>(
      `SELECT draft_id, revision, resource_project_id AS project_id, operation_id
       FROM frontend_knowledge_draft.operations ORDER BY draft_id, revision, operation_ordinal`,
    );
    const materializations = await this.pool.query<{
      materialization_id: string;
      draft_id: string;
      project_id: string;
      seed_id: string | null;
      kind: string;
    }>(
      `SELECT materialization_id, draft_id, resource_project_id AS project_id,
              seed_id, target_kind AS kind
       FROM frontend_knowledge_draft.materializations ORDER BY draft_id`,
    );
    const artifacts = await this.pool.query<{
      artifact_id: string;
      kind: string;
      draft_id: string;
      draft_revision: number;
      artifact_revision: number;
      digest: string;
      status: string;
      project_id: string;
      project_policy_context: unknown;
    }>(
      `SELECT artifact_id, artifact_kind AS kind, draft_id, draft_revision,
              artifact_revision, digest, status,
              resource_project_id AS project_id, project_policy_context
       FROM frontend_knowledge_draft.artifact_refs ORDER BY artifact_id, artifact_kind`,
    );
    return {
      drafts: drafts.rows.map((row) => ({
        draftId: row.draft_id,
        projectId: row.project_id,
        revision: row.revision,
        status: row.status,
        startMode: row.start_mode,
        seedId: row.seed_id ?? null,
      })),
      revisions: revisions.rows.map((row) => ({
        draftId: row.draft_id,
        revision: row.revision,
        projectId: row.project_id,
        status: row.status,
        contentDigest: row.content_digest,
      })),
      operations: operations.rows.map((row) => ({
        draftId: row.draft_id,
        revision: row.revision,
        projectId: row.project_id,
        operationId: row.operation_id,
      })),
      materializations: materializations.rows.map((row) => ({
        materializationId: row.materialization_id,
        draftId: row.draft_id,
        projectId: row.project_id,
        seedId: row.seed_id ?? null,
        kind: row.kind,
      })),
      artifacts: artifacts.rows.map((row) => ({
        artifactId: row.artifact_id,
        kind: row.kind,
        draftId: row.draft_id,
        draftRevision: row.draft_revision,
        artifactRevision: row.artifact_revision,
        digest: row.digest,
        status: row.status,
        projectId: row.project_id,
        projectPolicyContext: PARSE(row.project_policy_context),
      })),
    };
  }
}
