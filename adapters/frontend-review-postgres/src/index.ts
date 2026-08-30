import type { Pool, PoolClient } from 'pg';

import {
  assertDiscoveryReviewResourceMatchesCandidateV1,
  computeDiscoveryReviewRootIdentityV1,
  DISCOVERY_REVIEW_ROOT_IDENTITY_VERSION,
  FrontendContractError,
  decodeDerivedKnowledgeCandidateV1,
  decodeDiscoveryReviewResourceV1,
  type ReviewApprovalV1,
  type ReviewCommentRecordV1,
  type ReviewContextRevisionV1,
  type ReviewDecisionRecordV1,
  type ReviewItemV1,
  type DerivedKnowledgeCandidateV1,
  type DiscoveryReviewResourceV1,
} from '../../../packages/contracts/src/index.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';
import type { DiscoveryReviewResourceWriterPort } from '../../../modules/discovery-reentry/src/index.js';
import type {
  ReviewRepositoryBoundaryPort,
  ReviewTransactionHandleV1,
  ReviewTransactionRepositoriesV1,
  ReviewContextRecordV1,
} from '../../../modules/frontend-review/src/index.js';
import {
  DraftReviewTargetAdapter,
  type ReviewDiscoveryCandidateDerivedSourceV1,
  type ReviewDiscoveryCandidateReader,
  type ReviewDraftSourceReader,
} from '../../frontend-review-in-memory/src/index.js';
import type { FrontendKnowledgeDraftChangeSetV1 } from '../../../packages/contracts/src/index.js';

const JSONB_SNAPSHOT = (value: unknown): string => JSON.stringify(value);
const PARSE = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
};
const TIMESTAMP = (value: string): string => new Date(value).toISOString();
const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === '23505';

const CONFLICT = (message: string): never => {
  throw new FrontendContractError('CONFLICT', message);
};

type ContextRevisionRow = {
  review_context_id: string;
  context_revision: number;
  review_resource_id: string;
  target_kind: string;
  target_id: string;
  target_revision: string;
  target_digest: string;
  resource_project_id: string;
  effective_project_id: string;
  access_revision: string;
  policy_context_revision: string;
  canonical_base: string | null;
  artifact_refs: string;
  aggregate_state: string;
  capabilities: string;
  generated_at: string;
  stale_reason: string | null;
  source_revision: string;
  source_digest: string;
  source_updated_at: string;
  materialized_at: string;
};

type ItemRow = {
  review_context_id: string;
  context_revision: number;
  review_item_id: string;
  source_item_kind: string;
  source_item_id: string;
  source_item_revision: string;
  source_item_digest: string;
  target_ref: string;
  label: string;
  before_representation: string | null;
  after_representation: string | null;
  rationale: string;
  expected_impact: string | null;
  artifact_refs: string;
  allowed_decisions: string;
  decision_state: string;
  sensitivity: string;
  masked_fields: string;
  access_masking: string;
};

type DependencyRow = {
  review_context_id: string;
  context_revision: number;
  dependency_id: string;
  from_review_item_id: string;
  to_review_item_id: string;
  kind: string;
  reason_code: string;
  description: string;
  availability: string;
};

type DecisionRow = {
  decision_id: string;
  review_context_id: string;
  context_revision: number;
  review_item_id: string;
  intent: string;
  reason: string | null;
  decided_by: string;
  decided_at: string;
  terminal: boolean;
};

type CommentRow = {
  comment_id: string;
  review_context_id: string;
  context_revision: number;
  review_item_id: string | null;
  text: string;
  authored_by: string;
  authored_at: string;
};

type ApprovalRow = {
  approval_id: string;
  approval_status_revision: number;
  purpose: string;
  review_context_id: string;
  context_revision: number;
  target_kind: string;
  target_id: string;
  target_revision: string;
  target_digest: string;
  approved_item_ids: string;
  approved_manifest_digest: string;
  actor: string;
  project_id: string;
  access_revision: string;
  policy_context_revision: string;
  reason: string;
  issued_at: string;
  expires_at: string;
  status: string;
  invalidation_reason: string | null;
};

/**
 * FE-P4-S1 PostgreSQL Review store (ADR-128 parity boundary). Context
 * revisions, Items and dependency edges are immutable; decisions and comments
 * are append-only; Approval status changes preserve history. The existing
 * Frontend Command Ledger remains the command and outcome authority.
 */
export class PostgresFrontendReviewRepository implements ReviewRepositoryBoundaryPort {
  constructor(private readonly pool: Pool) {}

  async transaction<T>(
    action: (repositories: ReviewTransactionRepositoriesV1) => Promise<T>,
  ): Promise<T> {
    return withSafePostgresTransaction(
      this.pool,
      async (client) => action(this.repositories(client)),
      { module: 'frontend-review-postgres', operation: 'review-transaction' },
    );
  }

  async transactionWithHandle<T>(
    action: (handle: ReviewTransactionHandleV1) => Promise<T>,
  ): Promise<T> {
    return withSafePostgresTransaction(
      this.pool,
      async (client) => action({ repositories: this.repositories(client), raw: client }),
      { module: 'frontend-review-postgres', operation: 'review-transaction' },
    );
  }

  // -------------------------------------------------------------------------
  // Context loading
  // -------------------------------------------------------------------------

  private async loadContextRecord(
    client: PoolClient,
    reviewContextId: string,
    contextRevision?: number,
    lock = false,
  ): Promise<ReviewContextRecordV1 | undefined> {
    let sql = `
      SELECT review_context_id, context_revision, review_resource_id, target_kind,
             target_id, target_revision, target_digest, resource_project_id,
             effective_project_id, access_revision, policy_context_revision,
             canonical_base, artifact_refs, aggregate_state, capabilities,
             generated_at, stale_reason, source_revision, source_digest,
             source_updated_at, materialized_at
      FROM frontend_review.context_revision
      WHERE review_context_id = $1`;
    const params: unknown[] = [reviewContextId];
    if (contextRevision !== undefined) {
      sql += ' AND context_revision = $2';
      params.push(contextRevision);
    } else {
      sql += ' ORDER BY context_revision DESC LIMIT 1';
    }
    if (lock) sql += ' FOR UPDATE';
    const result = await client.query<ContextRevisionRow>(sql, params);
    const row = result.rows[0];
    if (!row) return undefined;
    const items = await this.loadItems(client, reviewContextId, row.context_revision);
    const dependencies = await this.loadDependencies(client, reviewContextId, row.context_revision);
    const context: ReviewContextRevisionV1 = {
      schemaVersion: '1.0.0',
      reviewContextId: row.review_context_id,
      contextRevision: row.context_revision,
      reviewResourceId: row.review_resource_id,
      targetKind: row.target_kind as ReviewContextRevisionV1['targetKind'],
      targetId: row.target_id,
      targetRevision: row.target_revision,
      targetDigest: row.target_digest,
      resourceProjectId: row.resource_project_id,
      effectiveProjectId: row.effective_project_id,
      accessRevision: row.access_revision,
      policyContextRevision: row.policy_context_revision,
      canonicalBase:
        row.canonical_base === null
          ? undefined
          : (PARSE(row.canonical_base) as ReviewContextRevisionV1['canonicalBase']),
      artifactRefs: PARSE(row.artifact_refs) as ReviewContextRevisionV1['artifactRefs'],
      items,
      dependencies,
      aggregateState: row.aggregate_state as ReviewContextRevisionV1['aggregateState'],
      capabilities: PARSE(row.capabilities) as ReviewContextRevisionV1['capabilities'],
      generatedAt: TIMESTAMP(row.generated_at),
      staleReason: row.stale_reason ?? undefined,
    };
    return {
      reviewResourceId: row.review_resource_id,
      context,
      sourceRevision: row.source_revision,
      sourceDigest: row.source_digest,
      sourceUpdatedAt: TIMESTAMP(row.source_updated_at),
      materializedAt: TIMESTAMP(row.materialized_at),
    };
  }

  private async loadItems(
    client: PoolClient,
    reviewContextId: string,
    contextRevision: number,
  ): Promise<readonly ReviewItemV1[]> {
    const result = await client.query<ItemRow>(
      `SELECT review_context_id, context_revision, review_item_id, source_item_kind,
              source_item_id, source_item_revision, source_item_digest, target_ref,
              label, before_representation, after_representation, rationale,
              expected_impact, artifact_refs, allowed_decisions, decision_state,
              sensitivity, masked_fields, access_masking
       FROM frontend_review.item
       WHERE review_context_id = $1 AND context_revision = $2
       ORDER BY review_item_id`,
      [reviewContextId, contextRevision],
    );
    return result.rows.map((row) => ({
      schemaVersion: '1.0.0',
      reviewItemId: row.review_item_id,
      sourceItemKind: row.source_item_kind as ReviewItemV1['sourceItemKind'],
      sourceItemId: row.source_item_id,
      sourceItemRevision: row.source_item_revision,
      sourceItemDigest: row.source_item_digest,
      targetRef: PARSE(row.target_ref) as ReviewItemV1['targetRef'],
      label: row.label,
      before:
        row.before_representation === null
          ? undefined
          : (PARSE(row.before_representation) as ReviewItemV1['before']),
      after:
        row.after_representation === null
          ? undefined
          : (PARSE(row.after_representation) as ReviewItemV1['after']),
      rationale: row.rationale,
      expectedImpact: row.expected_impact ?? undefined,
      artifactRefs: PARSE(row.artifact_refs) as ReviewItemV1['artifactRefs'],
      allowedDecisions: PARSE(row.allowed_decisions) as ReviewItemV1['allowedDecisions'],
      decisionState: row.decision_state as ReviewItemV1['decisionState'],
      sensitivity: row.sensitivity as ReviewItemV1['sensitivity'],
      maskedFields: PARSE(row.masked_fields) as ReviewItemV1['maskedFields'],
      accessMasking: row.access_masking as ReviewItemV1['accessMasking'],
    }));
  }

  private async loadDependencies(
    client: PoolClient,
    reviewContextId: string,
    contextRevision: number,
  ): Promise<ReviewContextRevisionV1['dependencies']> {
    const result = await client.query<DependencyRow>(
      `SELECT review_context_id, context_revision, dependency_id, from_review_item_id,
              to_review_item_id, kind, reason_code, description, availability
       FROM frontend_review.dependency
       WHERE review_context_id = $1 AND context_revision = $2
       ORDER BY dependency_id`,
      [reviewContextId, contextRevision],
    );
    return result.rows.map((row) => ({
      schemaVersion: '1.0.0',
      dependencyId: row.dependency_id,
      fromReviewItemId: row.from_review_item_id,
      toReviewItemId: row.to_review_item_id,
      kind: row.kind as ReviewContextRevisionV1['dependencies'][number]['kind'],
      reasonCode: row.reason_code,
      description: row.description,
      availability: row.availability as 'AVAILABLE' | 'UNAVAILABLE',
    }));
  }

  // -------------------------------------------------------------------------
  // Repositories
  // -------------------------------------------------------------------------

  private repositories(client: PoolClient): ReviewTransactionRepositoriesV1 {
    return {
      contexts: {
        findCurrent: async (reviewContextId) => this.loadContextRecord(client, reviewContextId),
        findRevision: async (reviewContextId, contextRevision) => {
          const record = await this.loadContextRecord(client, reviewContextId, contextRevision);
          return record?.context;
        },
        insertContext: async (record) => {
          const context = record.context;
          try {
            await client.query(
              `INSERT INTO frontend_review.context_revision
                 (review_context_id, context_revision, review_resource_id, target_kind,
                  target_id, target_revision, target_digest, resource_project_id,
                  effective_project_id, access_revision, policy_context_revision,
                  canonical_base, artifact_refs, aggregate_state, capabilities,
                  generated_at, stale_reason, source_revision, source_digest,
                  source_updated_at, materialized_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                       $15, $16, $17, $18, $19, $20, $21)`,
              [
                context.reviewContextId,
                context.contextRevision,
                context.reviewResourceId,
                context.targetKind,
                context.targetId,
                context.targetRevision,
                context.targetDigest,
                context.resourceProjectId,
                context.effectiveProjectId,
                context.accessRevision,
                context.policyContextRevision,
                context.canonicalBase === undefined ? null : JSONB_SNAPSHOT(context.canonicalBase),
                JSONB_SNAPSHOT(context.artifactRefs),
                context.aggregateState,
                JSONB_SNAPSHOT(context.capabilities),
                context.generatedAt,
                context.staleReason ?? null,
                record.sourceRevision,
                record.sourceDigest,
                record.sourceUpdatedAt,
                record.materializedAt,
              ],
            );
          } catch (error) {
            if (isUniqueViolation(error)) {
              CONFLICT('The Review context revision already exists.');
            }
            throw error;
          }
          for (const item of context.items) {
            await client.query(
              `INSERT INTO frontend_review.item
                 (review_context_id, context_revision, review_item_id, source_item_kind,
                  source_item_id, source_item_revision, source_item_digest, target_ref,
                  label, before_representation, after_representation, rationale,
                  expected_impact, artifact_refs, allowed_decisions, decision_state,
                  sensitivity, masked_fields, access_masking)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                       $15, $16, $17, $18, $19)`,
              [
                context.reviewContextId,
                context.contextRevision,
                item.reviewItemId,
                item.sourceItemKind,
                item.sourceItemId,
                item.sourceItemRevision,
                item.sourceItemDigest,
                JSONB_SNAPSHOT(item.targetRef),
                item.label,
                item.before === undefined ? null : JSONB_SNAPSHOT(item.before),
                item.after === undefined ? null : JSONB_SNAPSHOT(item.after),
                item.rationale,
                item.expectedImpact ?? null,
                JSONB_SNAPSHOT(item.artifactRefs),
                JSONB_SNAPSHOT(item.allowedDecisions),
                item.decisionState,
                item.sensitivity,
                JSONB_SNAPSHOT(item.maskedFields),
                item.accessMasking,
              ],
            );
          }
          for (const dependency of context.dependencies) {
            await client.query(
              `INSERT INTO frontend_review.dependency
                 (review_context_id, context_revision, dependency_id, from_review_item_id,
                  to_review_item_id, kind, reason_code, description, availability)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                context.reviewContextId,
                context.contextRevision,
                dependency.dependencyId,
                dependency.fromReviewItemId,
                dependency.toReviewItemId,
                dependency.kind,
                dependency.reasonCode,
                dependency.description,
                dependency.availability,
              ],
            );
          }
        },
        lockCurrent: async (reviewContextId) =>
          this.loadContextRecord(client, reviewContextId, undefined, true),
        listContexts: async (resourceProjectId) => {
          const result = await client.query<{ review_context_id: string }>(
            `SELECT DISTINCT ON (review_context_id) review_context_id
             FROM frontend_review.context_revision
             WHERE resource_project_id = $1
             ORDER BY review_context_id, context_revision DESC`,
            [resourceProjectId],
          );
          const records: ReviewContextRecordV1[] = [];
          for (const row of result.rows) {
            const record = await this.loadContextRecord(client, row.review_context_id);
            if (record) records.push(record);
          }
          return records;
        },
      },
      decisions: {
        findDecisions: async (reviewContextId) => {
          const result = await client.query<DecisionRow>(
            `SELECT decision_id, review_context_id, context_revision, review_item_id,
                    intent, reason, decided_by, decided_at, terminal
             FROM frontend_review.decision
             WHERE review_context_id = $1
             ORDER BY decided_at, decision_id`,
            [reviewContextId],
          );
          return result.rows.map((row) => this.toDecision(row));
        },
        appendDecisions: async (decisions) => {
          for (const decision of decisions) {
            await client.query(
              `INSERT INTO frontend_review.decision
                 (decision_id, review_context_id, context_revision, review_item_id,
                  intent, reason, decided_by, decided_at, terminal)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                decision.decisionId,
                decision.reviewContextId,
                decision.contextRevision,
                decision.reviewItemId,
                decision.intent,
                decision.reason ?? null,
                JSONB_SNAPSHOT(decision.decidedBy),
                decision.decidedAt,
                decision.terminal,
              ],
            );
          }
        },
        findComments: async (reviewContextId) => {
          const result = await client.query<CommentRow>(
            `SELECT comment_id, review_context_id, context_revision, review_item_id,
                    text, authored_by, authored_at
             FROM frontend_review.comment
             WHERE review_context_id = $1
             ORDER BY authored_at, comment_id`,
            [reviewContextId],
          );
          return result.rows.map((row) => this.toComment(row));
        },
        appendComment: async (comment) => {
          await client.query(
            `INSERT INTO frontend_review.comment
               (comment_id, review_context_id, context_revision, review_item_id,
                text, authored_by, authored_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              comment.commentId,
              comment.reviewContextId,
              comment.contextRevision,
              comment.reviewItemId ?? null,
              comment.text,
              JSONB_SNAPSHOT(comment.authoredBy),
              comment.authoredAt,
            ],
          );
        },
      },
      approvals: {
        findById: async (approvalId) => {
          const result = await client.query<ApprovalRow>(
            `SELECT approval_id, approval_status_revision, purpose, review_context_id, context_revision, target_kind,
                    target_id, target_revision, target_digest, approved_item_ids,
                    approved_manifest_digest, actor, project_id, access_revision,
                    policy_context_revision, reason, issued_at, expires_at, status,
                    invalidation_reason
             FROM frontend_review.approval
             WHERE approval_id = $1
             ORDER BY approval_status_revision DESC
             LIMIT 1`,
            [approvalId],
          );
          const row = result.rows[0];
          return row ? this.toApproval(row) : undefined;
        },
        findByIdWithRevision: async (approvalId) => {
          const result = await client.query<ApprovalRow>(
            `SELECT approval_id, approval_status_revision, purpose, review_context_id, context_revision, target_kind,
                    target_id, target_revision, target_digest, approved_item_ids,
                    approved_manifest_digest, actor, project_id, access_revision,
                    policy_context_revision, reason, issued_at, expires_at, status,
                    invalidation_reason
             FROM frontend_review.approval
             WHERE approval_id = $1
             ORDER BY approval_status_revision DESC
             LIMIT 1`,
            [approvalId],
          );
          const row = result.rows[0];
          return row
            ? {
                approval: this.toApproval(row),
                approvalStatusRevision: row.approval_status_revision,
              }
            : undefined;
        },
        insert: async (approval) => {
          try {
            await client.query(
              `INSERT INTO frontend_review.approval
                 (approval_id, approval_status_revision, purpose, review_context_id,
                  context_revision, target_kind, target_id, target_revision, target_digest,
                  approved_item_ids, approved_manifest_digest, actor, project_id,
                  access_revision, policy_context_revision, reason, issued_at, expires_at,
                  status, invalidation_reason, recorded_at)
               VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                       $15, $16, $17, $18, $19, $20)`,
              [
                approval.approvalId,
                approval.purpose,
                approval.reviewContextId,
                approval.contextRevision,
                approval.targetKind,
                approval.targetId,
                approval.targetRevision,
                approval.targetDigest,
                JSONB_SNAPSHOT(approval.approvedItemIds),
                approval.approvedManifestDigest,
                JSONB_SNAPSHOT(approval.actor),
                approval.projectId,
                approval.accessRevision,
                approval.policyContextRevision,
                approval.reason,
                approval.issuedAt,
                approval.expiresAt,
                approval.status,
                approval.invalidationReason ?? null,
                approval.issuedAt,
              ],
            );
          } catch (error) {
            if (isUniqueViolation(error)) {
              CONFLICT('The Approval Resource already exists.');
            }
            throw error;
          }
        },
        listByProject: async (projectId) => {
          const result = await client.query<ApprovalRow>(
            `SELECT DISTINCT ON (approval_id) approval_id, purpose, review_context_id,
                    context_revision, target_kind, target_id, target_revision, target_digest,
                    approved_item_ids, approved_manifest_digest, actor, project_id,
                    access_revision, policy_context_revision, reason, issued_at, expires_at,
                    status, invalidation_reason
             FROM frontend_review.approval
             WHERE project_id = $1
             ORDER BY approval_id, approval_status_revision DESC`,
            [projectId],
          );
          return result.rows.map((row) => this.toApproval(row));
        },
        consumeApproval: async (approvalId, canonicalCommitId, consumedAt, consumedBy) => {
          const currentResult = await client.query<ApprovalRow>(
            `SELECT approval_id, approval_status_revision, purpose, review_context_id, context_revision, target_kind,
                    target_id, target_revision, target_digest, approved_item_ids,
                    approved_manifest_digest, actor, project_id, access_revision,
                    policy_context_revision, reason, issued_at, expires_at, status,
                    invalidation_reason
             FROM frontend_review.approval
             WHERE approval_id = $1
             ORDER BY approval_status_revision DESC
             LIMIT 1`,
            [approvalId],
          );
          const currentRow = currentResult.rows[0];
          if (!currentRow) {
            CONFLICT('The Approval Resource does not exist.');
          }
          const current = this.toApproval(currentRow as ApprovalRow);
          if (current.status === 'CONSUMED') {
            if ((current.invalidationReason ?? '').includes(canonicalCommitId)) {
              return;
            }
            CONFLICT('The Approval Resource was already consumed by a different commit.');
          }
          if (current.status !== 'ACTIVE') {
            CONFLICT('The Approval Resource is not ACTIVE.');
          }
          const currentRevision = currentRow!.approval_status_revision;
          try {
            await client.query(
              `INSERT INTO frontend_review.approval
                 (approval_id, approval_status_revision, purpose, review_context_id,
                  context_revision, target_kind, target_id, target_revision, target_digest,
                  approved_item_ids, approved_manifest_digest, actor, project_id,
                  access_revision, policy_context_revision, reason, issued_at, expires_at,
                  status, invalidation_reason, recorded_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                       $15, $16, $17, $18, 'CONSUMED', $19, $20)`,
              [
                approvalId,
                currentRevision + 1,
                current.purpose,
                current.reviewContextId,
                current.contextRevision,
                current.targetKind,
                current.targetId,
                current.targetRevision,
                current.targetDigest,
                JSONB_SNAPSHOT(current.approvedItemIds),
                current.approvedManifestDigest,
                JSONB_SNAPSHOT(current.actor),
                current.projectId,
                current.accessRevision,
                current.policyContextRevision,
                current.reason,
                current.issuedAt,
                current.expiresAt,
                `Consumed by ${consumedBy} via canonical commit ${canonicalCommitId} at ${consumedAt}`,
                consumedAt,
              ],
            );
          } catch (error) {
            if (isUniqueViolation(error)) {
              CONFLICT('The Approval Resource was already consumed.');
            }
            throw error;
          }
        },
      },
    };
  }

  private toDecision(row: DecisionRow): ReviewDecisionRecordV1 {
    return {
      schemaVersion: '1.0.0',
      decisionId: row.decision_id,
      reviewContextId: row.review_context_id,
      contextRevision: row.context_revision,
      reviewItemId: row.review_item_id,
      intent: row.intent as ReviewDecisionRecordV1['intent'],
      reason: row.reason ?? undefined,
      decidedBy: PARSE(row.decided_by) as ReviewDecisionRecordV1['decidedBy'],
      decidedAt: TIMESTAMP(row.decided_at),
      terminal: row.terminal,
    };
  }

  private toComment(row: CommentRow): ReviewCommentRecordV1 {
    return {
      schemaVersion: '1.0.0',
      commentId: row.comment_id,
      reviewContextId: row.review_context_id,
      contextRevision: row.context_revision,
      reviewItemId: row.review_item_id ?? undefined,
      text: row.text,
      authoredBy: PARSE(row.authored_by) as ReviewCommentRecordV1['authoredBy'],
      authoredAt: TIMESTAMP(row.authored_at),
    };
  }

  private toApproval(row: ApprovalRow): ReviewApprovalV1 {
    return {
      schemaVersion: '1.0.0',
      approvalId: row.approval_id,
      purpose: row.purpose as ReviewApprovalV1['purpose'],
      reviewContextId: row.review_context_id,
      contextRevision: row.context_revision,
      targetKind: row.target_kind as ReviewApprovalV1['targetKind'],
      targetId: row.target_id,
      targetRevision: row.target_revision,
      targetDigest: row.target_digest,
      approvedItemIds: PARSE(row.approved_item_ids) as ReviewApprovalV1['approvedItemIds'],
      approvedManifestDigest: row.approved_manifest_digest,
      actor: PARSE(row.actor) as ReviewApprovalV1['actor'],
      projectId: row.project_id,
      accessRevision: row.access_revision,
      policyContextRevision: row.policy_context_revision,
      reason: row.reason,
      issuedAt: TIMESTAMP(row.issued_at),
      expiresAt: TIMESTAMP(row.expires_at),
      status: row.status as ReviewApprovalV1['status'],
      invalidationReason: row.invalidation_reason ?? undefined,
    };
  }
}

/**
 * PostgreSQL FE-P3-S2 Review Submission source reader. Reads submitted Drafts
 * from the real `frontend_knowledge_draft.drafts` table (snapshot JSONB) and
 * reuses the shared `DraftReviewTargetAdapter` materialization logic.
 */
export const createPostgresReviewDraftSourceReader = (pool: Pool): ReviewDraftSourceReader => ({
  async listSubmitted(projectId) {
    const result = await pool.query<{ snapshot: string }>(
      `SELECT snapshot FROM frontend_knowledge_draft.drafts
       WHERE resource_project_id = $1 AND status = 'SUBMITTED'
       ORDER BY updated_at`,
      [projectId],
    );
    return result.rows.map((row) => PARSE(row.snapshot) as FrontendKnowledgeDraftChangeSetV1);
  },
  async findSubmitted(projectId, reviewResourceId) {
    const result = await pool.query<{ snapshot: string }>(
      `SELECT snapshot FROM frontend_knowledge_draft.drafts
       WHERE resource_project_id = $1 AND status = 'SUBMITTED'
         AND snapshot->'reviewResource'->>'reviewResourceId' = $2
       LIMIT 1`,
      [projectId, reviewResourceId],
    );
    const row = result.rows[0];
    return row ? (PARSE(row.snapshot) as FrontendKnowledgeDraftChangeSetV1) : undefined;
  },
});

/** Reuses the shared materialization logic with a PostgreSQL-backed reader. */
export const createPostgresReviewDraftTargetAdapter = (pool: Pool): DraftReviewTargetAdapter =>
  new DraftReviewTargetAdapter(createPostgresReviewDraftSourceReader(pool));

type DiscoveryReviewResourceRow = {
  readonly resource: unknown;
  readonly candidate?: unknown;
};

type DiscoveryReviewRootRow = {
  readonly project_id: string;
  readonly candidate_id: string;
  readonly candidate_revision: number;
  readonly review_resource_id: string;
  readonly identity_version: string;
};

type DiscoveryReviewCandidateRow = {
  readonly candidate: unknown;
};

export type DiscoveryReviewResourceWriteResultV1 = 'CREATED' | 'IDEMPOTENT';

/**
 * PostgreSQL persistence for the normalized WP3 Review bridge resource. The
 * resource JSON is retained as the immutable source snapshot while typed
 * columns enforce project, identity and eligibility filtering.
 */
export class PostgresDiscoveryReviewResourceRepository implements DiscoveryReviewResourceWriterPort {
  constructor(private readonly pool: Pool) {}

  async save(
    resourceInput: DiscoveryReviewResourceV1,
  ): Promise<DiscoveryReviewResourceWriteResultV1> {
    const resource = decodeDiscoveryReviewResourceV1(resourceInput);
    const expectedReviewResourceId = computeDiscoveryReviewRootIdentityV1({
      projectId: resource.projectId,
      candidateId: resource.candidateId,
      candidateRevision: resource.candidateRevision,
      origin: resource.origin,
    });
    if (resource.reviewResourceId !== expectedReviewResourceId) {
      return CONFLICT('The Discovery Review resource uses an invalid stable Review root identity.');
    }

    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const candidateResult = await client.query<DiscoveryReviewCandidateRow>(
          `SELECT candidate
           FROM discovery.reentry_candidates
           WHERE project_id = $1 AND candidate_id = $2 AND candidate_revision = $3
           FOR SHARE`,
          [resource.projectId, resource.candidateId, resource.candidateRevision],
        );
        const candidateRow = candidateResult.rows[0];
        if (!candidateRow) return CONFLICT('The authoritative WP2 candidate was not found.');

        let candidate: DerivedKnowledgeCandidateV1;
        try {
          candidate = decodeDerivedKnowledgeCandidateV1(
            PARSE(candidateRow.candidate),
            'persistedDerivedKnowledgeCandidate',
          );
        } catch {
          return CONFLICT('The authoritative WP2 candidate is malformed and cannot be reused.');
        }
        try {
          assertDiscoveryReviewResourceMatchesCandidateV1(resource, candidate);
        } catch {
          return CONFLICT(
            'The Discovery Review resource does not preserve the authoritative WP2 candidate lineage.',
          );
        }

        const rootInsert = await client.query<DiscoveryReviewRootRow>(
          `INSERT INTO discovery.reentry_review_roots (
             project_id, candidate_id, candidate_revision, review_resource_id,
             identity_version, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING
           RETURNING project_id, candidate_id, candidate_revision,
                     review_resource_id, identity_version`,
          [
            resource.projectId,
            resource.candidateId,
            resource.candidateRevision,
            expectedReviewResourceId,
            DISCOVERY_REVIEW_ROOT_IDENTITY_VERSION,
            resource.createdAt,
          ],
        );
        const root =
          rootInsert.rows[0] ??
          (
            await client.query<DiscoveryReviewRootRow>(
              `SELECT project_id, candidate_id, candidate_revision,
                      review_resource_id, identity_version
               FROM discovery.reentry_review_roots
               WHERE project_id = $1
                 AND (review_resource_id = $2
                      OR (candidate_id = $3 AND candidate_revision = $4))
               FOR UPDATE`,
              [
                resource.projectId,
                expectedReviewResourceId,
                resource.candidateId,
                resource.candidateRevision,
              ],
            )
          ).rows[0];
        if (
          !root ||
          root.project_id !== resource.projectId ||
          root.candidate_id !== resource.candidateId ||
          root.candidate_revision !== resource.candidateRevision ||
          root.review_resource_id !== expectedReviewResourceId ||
          root.identity_version !== DISCOVERY_REVIEW_ROOT_IDENTITY_VERSION
        ) {
          return CONFLICT(
            'The authoritative WP2 candidate is already bound to a different stable Review root.',
          );
        }

        const inserted = await client.query(
          `INSERT INTO discovery.reentry_review_resources (
             review_resource_id, resource_revision, project_id, effective_project_id,
             candidate_id, candidate_revision, finding_id, finding_revision, finding_type,
             manifest_id, origin, governance_target, source_projection_digest,
             canonical_base_version, canonical_snapshot_digest,
             discovery_projection_revision, discovery_projection_digest,
             related_resource_refs, evidence_ids, evidence_lineage,
             derivation_provenance, access_scope, sensitivity, validation_profile,
             validation_result, lifecycle_state, review_eligibility, content,
             content_digest, resource, created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
             $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26,
             $27, $28, $29, $30, $31, $32
           )
           ON CONFLICT DO NOTHING
           RETURNING review_resource_id`,
          [
            resource.reviewResourceId,
            resource.resourceRevision,
            resource.projectId,
            resource.effectiveProjectId,
            resource.candidateId,
            resource.candidateRevision,
            resource.findingId,
            resource.findingRevision,
            resource.findingType,
            resource.manifestId,
            resource.origin,
            resource.governanceTarget,
            resource.sourceProjectionDigest,
            resource.canonicalBase.canonicalVersion,
            resource.canonicalBase.snapshotDigest,
            resource.discoveryBase.projectionRevision,
            resource.discoveryBase.projectionDigest,
            JSONB_SNAPSHOT(resource.relatedResourceRefs),
            resource.evidenceIds,
            JSONB_SNAPSHOT(resource.evidenceLineage),
            JSONB_SNAPSHOT(resource.derivationProvenance),
            resource.accessScope,
            resource.sensitivity,
            JSONB_SNAPSHOT(resource.validationProfile),
            JSONB_SNAPSHOT(resource.validationResult),
            resource.lifecycleState,
            resource.reviewEligibility,
            JSONB_SNAPSHOT(resource.content),
            resource.contentDigest,
            JSONB_SNAPSHOT(resource),
            resource.createdAt,
            resource.updatedAt,
          ],
        );
        if ((inserted.rowCount ?? 0) > 0) return 'CREATED';

        const existing = await client.query<DiscoveryReviewResourceRow>(
          `SELECT resource
           FROM discovery.reentry_review_resources
           WHERE project_id = $1 AND review_resource_id = $2 AND resource_revision = $3
           FOR SHARE`,
          [resource.projectId, expectedReviewResourceId, resource.resourceRevision],
        );
        const row = existing.rows[0];
        if (!row) {
          return CONFLICT(
            'The Discovery Review resource identity conflicted with another immutable key.',
          );
        }
        let persisted: DiscoveryReviewResourceV1;
        try {
          persisted = decodeDiscoveryReviewResourceV1(PARSE(row.resource));
        } catch {
          return CONFLICT(
            'The persisted Discovery Review resource is malformed and cannot be reused.',
          );
        }
        if (persisted.contentDigest === resource.contentDigest) return 'IDEMPOTENT';
        throw new FrontendContractError(
          'CONFLICT',
          'The Discovery Review resource identity already exists with different immutable content.',
        );
      },
      { module: 'frontend-review-postgres', operation: 'save-discovery-review-resource' },
    );
  }
}

const decodePersistedDiscoveryResource = (
  row: DiscoveryReviewResourceRow,
): DiscoveryReviewResourceV1 | undefined => {
  try {
    return decodeDiscoveryReviewResourceV1(row.resource);
  } catch {
    // Malformed or policy-invalid persisted rows are never Review targets.
    return undefined;
  }
};

const toReviewDiscoveryCandidateSource = (
  resource: DiscoveryReviewResourceV1,
): ReviewDiscoveryCandidateDerivedSourceV1 => ({
  origin: 'DERIVED_DISCOVERY',
  reviewResourceId: resource.reviewResourceId,
  resourceRevision: resource.resourceRevision,
  candidateId: resource.candidateId,
  candidateRevision: resource.candidateRevision,
  resourceProjectId: resource.projectId,
  effectiveProjectId: resource.effectiveProjectId,
  content: resource.content,
  evidence: resource.evidenceLineage,
  impact:
    resource.content.normalizedMaterial?.impact.map((entry) => ({
      schemaVersion: entry.schemaVersion,
      impactId: entry.impactId,
      targetKind: entry.targetKind,
      targetId: entry.targetId,
      description: entry.description,
    })) ?? [],
  lineage: resource,
  contentDigest: resource.contentDigest,
  createdAt: resource.createdAt,
  updatedAt: resource.updatedAt,
});

const readEligibleDiscoveryResources = async (
  pool: Pool,
  projectId: string,
  reviewResourceId?: string,
): Promise<readonly DiscoveryReviewResourceV1[]> => {
  const params: unknown[] = [projectId];
  const identityClause = reviewResourceId === undefined ? '' : ' AND review_resource_id = $2';
  if (reviewResourceId !== undefined) params.push(reviewResourceId);
  const result = await pool.query<DiscoveryReviewResourceRow>(
    `SELECT latest.resource, candidate.candidate
     FROM (
       SELECT DISTINCT ON (review_resource_id)
              project_id, candidate_id, candidate_revision,
              finding_id, finding_revision,
              resource, origin, lifecycle_state, review_eligibility
       FROM discovery.reentry_review_resources
       WHERE project_id = $1${identityClause}
       ORDER BY review_resource_id, resource_revision DESC
     ) AS latest
     JOIN discovery.reentry_candidates candidate
       ON candidate.project_id = latest.project_id
      AND candidate.candidate_id = latest.candidate_id
      AND candidate.candidate_revision = latest.candidate_revision
     JOIN discovery.finding_lifecycle_current finding_lifecycle
       ON finding_lifecycle.project_id = latest.project_id
      AND finding_lifecycle.finding_id = latest.finding_id
      AND finding_lifecycle.finding_revision = latest.finding_revision
     WHERE latest.origin = 'DERIVED_DISCOVERY'
       AND latest.lifecycle_state = 'REVIEW_READY'
       AND latest.review_eligibility = 'ELIGIBLE_AFTER_VALIDATION'
       AND finding_lifecycle.lifecycle_state = 'REVIEW_READY'`,
    params,
  );
  return result.rows.flatMap((row) => {
    const resource = decodePersistedDiscoveryResource(row);
    if (resource === undefined || resource.projectId !== projectId || row.candidate === undefined) {
      return [];
    }
    try {
      const candidate = decodeDerivedKnowledgeCandidateV1(
        PARSE(row.candidate),
        'persistedDerivedKnowledgeCandidate',
      );
      assertDiscoveryReviewResourceMatchesCandidateV1(resource, candidate);
      return [resource];
    } catch {
      return [];
    }
  });
};

/** Production source reader: latest revision only, eligible-only, project-scoped. */
export const createPostgresReviewDiscoveryCandidateReader = (
  pool: Pool,
): ReviewDiscoveryCandidateReader => ({
  async list(projectId) {
    const resources = await readEligibleDiscoveryResources(pool, projectId);
    return resources.map(toReviewDiscoveryCandidateSource);
  },
  async find(projectId, reviewResourceId) {
    const resources = await readEligibleDiscoveryResources(pool, projectId, reviewResourceId);
    const resource = resources[0];
    return resource === undefined ? undefined : toReviewDiscoveryCandidateSource(resource);
  },
});
