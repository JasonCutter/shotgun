import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';

import {
  ProviderExternalTransferPolicyError,
  type A4ProviderId,
  type ProviderExternalTransferApproval,
  type ProviderExternalTransferApprovalHistoryEntry,
  type ProviderExternalTransferApprovalProposal,
  type ProviderExternalTransferApprovalRepositoryPort,
} from '../../../modules/provider-privacy-policy/src/index.js';

type ApprovalRow = QueryResultRow & {
  project_id: string;
  provider_id: A4ProviderId;
  approved: boolean;
  approval_revision: number;
  reviewed_by: string;
  reviewed_at: Date;
};

type ProposalRow = QueryResultRow & {
  proposal_id: string;
  project_id: string;
  directive_type: string;
  status: 'PROPOSED' | 'APPROVED' | 'REJECTED';
  payload: {
    providerId?: string;
    approved?: boolean;
    expectedApprovalRevision?: number;
    proposedBy?: string;
  };
  created_at: Date;
};

const approvalColumns = `
  project_id, provider_id, approved, approval_revision, reviewed_by, reviewed_at`;

const mapApproval = (row: ApprovalRow): ProviderExternalTransferApproval => ({
  projectId: row.project_id,
  providerId: row.provider_id,
  approved: row.approved,
  approvalRevision: Number(row.approval_revision),
  reviewedBy: row.reviewed_by,
  reviewedAt: row.reviewed_at.toISOString(),
});

const asExpectedRevision = (value: number): number =>
  Number.isSafeInteger(value) && value >= 0 ? value : -1;

export class PostgresProviderExternalTransferApprovalRepository implements ProviderExternalTransferApprovalRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async getCurrent(input: {
    readonly projectId: string;
    readonly providerId: A4ProviderId;
  }): Promise<ProviderExternalTransferApproval | undefined> {
    const result = await this.pool.query<ApprovalRow>(
      `SELECT ${approvalColumns}
       FROM settings.provider_external_transfer_approvals
       WHERE project_id = $1 AND provider_id = $2`,
      [input.projectId, input.providerId],
    );
    return result.rows[0] ? mapApproval(result.rows[0]) : undefined;
  }

  async listHistory(input: {
    readonly projectId: string;
    readonly providerId: A4ProviderId;
  }): Promise<readonly ProviderExternalTransferApprovalHistoryEntry[]> {
    const result = await this.pool.query<ApprovalRow>(
      `SELECT ${approvalColumns}
       FROM settings.provider_external_transfer_approval_revisions
       WHERE project_id = $1 AND provider_id = $2
       ORDER BY approval_revision ASC`,
      [input.projectId, input.providerId],
    );
    return result.rows.map(mapApproval);
  }

  async createProposal(input: {
    readonly projectId: string;
    readonly providerId: A4ProviderId;
    readonly approved: boolean;
    readonly expectedApprovalRevision: number;
    readonly proposedBy: string;
  }): Promise<ProviderExternalTransferApprovalProposal> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.assertOwner(client, input.projectId, input.proposedBy);
      const current = await this.currentRevision(client, input.projectId, input.providerId, true);
      if (current !== input.expectedApprovalRevision) {
        throw new ProviderExternalTransferPolicyError(
          'REVISION_CONFLICT',
          `Expected provider approval revision ${input.expectedApprovalRevision} but current is ${current}.`,
        );
      }
      const proposalId = `provider-transfer-review-${randomUUID()}`;
      const createdAt = new Date();
      await client.query(
        `INSERT INTO settings.settings_review_proposals
           (proposal_id, project_id, resource_id, directive_type, description, status, payload, created_at)
         VALUES ($1, $2, $3, 'PROVIDER_EXTERNAL_TRANSFER_APPROVAL', $4, 'PROPOSED', $5, $6)`,
        [
          proposalId,
          input.projectId,
          `provider/${input.providerId}/external-transfer`,
          `Review private Project context transfer to ${input.providerId}.`,
          JSON.stringify({
            providerId: input.providerId,
            approved: input.approved,
            expectedApprovalRevision: input.expectedApprovalRevision,
            proposedBy: input.proposedBy,
          }),
          createdAt,
        ],
      );
      await client.query(
        `INSERT INTO settings.settings_audit_events
           (event_id, project_id, actor_id, action_name, risk_level, details, timestamp)
         VALUES ($1, $2, $3, 'PROVIDER_EXTERNAL_TRANSFER_REVIEW_PROPOSED', 'HIGH', $4, $5)`,
        [
          randomUUID(),
          input.projectId,
          input.proposedBy,
          JSON.stringify({
            proposalId,
            providerId: input.providerId,
            approved: input.approved,
            expectedApprovalRevision: input.expectedApprovalRevision,
          }),
          createdAt,
        ],
      );
      await client.query('COMMIT');
      return Object.freeze({
        proposalId,
        projectId: input.projectId,
        providerId: input.providerId,
        approved: input.approved,
        expectedApprovalRevision: input.expectedApprovalRevision,
        proposedBy: input.proposedBy,
        status: 'PROPOSED' as const,
        createdAt: createdAt.toISOString(),
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async approveProposal(input: {
    readonly proposalId: string;
    readonly projectId: string;
    readonly providerId: A4ProviderId;
    readonly reviewedBy: string;
    readonly expectedApprovalRevision: number;
  }): Promise<ProviderExternalTransferApproval> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.assertOwner(client, input.projectId, input.reviewedBy);
      const proposal = await client.query<ProposalRow>(
        `SELECT proposal_id, project_id, directive_type, status, payload, created_at
         FROM settings.settings_review_proposals
         WHERE proposal_id = $1
         FOR UPDATE`,
        [input.proposalId],
      );
      const row = proposal.rows[0];
      if (
        !row ||
        row.project_id !== input.projectId ||
        row.directive_type !== 'PROVIDER_EXTERNAL_TRANSFER_APPROVAL' ||
        row.status !== 'PROPOSED' ||
        row.payload.providerId !== input.providerId ||
        row.payload.expectedApprovalRevision !== input.expectedApprovalRevision
      ) {
        throw new ProviderExternalTransferPolicyError(
          'PROPOSAL_STALE',
          'The provider external transfer review proposal is stale or does not match this approval.',
        );
      }

      const currentResult = await client.query<ApprovalRow>(
        `SELECT ${approvalColumns}
         FROM settings.provider_external_transfer_approvals
         WHERE project_id = $1 AND provider_id = $2
         FOR UPDATE`,
        [input.projectId, input.providerId],
      );
      const current = currentResult.rows[0];
      const currentRevision = current ? Number(current.approval_revision) : 0;
      if (currentRevision !== input.expectedApprovalRevision) {
        throw new ProviderExternalTransferPolicyError(
          'REVISION_CONFLICT',
          `Expected provider approval revision ${input.expectedApprovalRevision} but current is ${currentRevision}.`,
        );
      }
      if (typeof row.payload.approved !== 'boolean') {
        throw new ProviderExternalTransferPolicyError(
          'PROPOSAL_STALE',
          'The approval proposal payload is invalid.',
        );
      }

      const reviewedAt = new Date();
      const nextRevision = currentRevision + 1;
      await client.query(
        `INSERT INTO settings.provider_external_transfer_approval_revisions
           (project_id, provider_id, approved, approval_revision, reviewed_by, reviewed_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          input.projectId,
          input.providerId,
          row.payload.approved,
          nextRevision,
          input.reviewedBy,
          reviewedAt,
        ],
      );
      if (current) {
        await client.query(
          `UPDATE settings.provider_external_transfer_approvals
           SET approved = $3, approval_revision = $4, reviewed_by = $5, reviewed_at = $6
           WHERE project_id = $1 AND provider_id = $2`,
          [
            input.projectId,
            input.providerId,
            row.payload.approved,
            nextRevision,
            input.reviewedBy,
            reviewedAt,
          ],
        );
      } else {
        await client.query(
          `INSERT INTO settings.provider_external_transfer_approvals
             (project_id, provider_id, approved, approval_revision, reviewed_by, reviewed_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            input.projectId,
            input.providerId,
            row.payload.approved,
            nextRevision,
            input.reviewedBy,
            reviewedAt,
          ],
        );
      }
      await client.query(
        `UPDATE settings.settings_review_proposals
         SET status = 'APPROVED'
         WHERE proposal_id = $1`,
        [input.proposalId],
      );
      await client.query(
        `UPDATE settings.settings_review_proposals
         SET status = 'REJECTED'
         WHERE project_id = $1
           AND directive_type = 'PROVIDER_EXTERNAL_TRANSFER_APPROVAL'
           AND resource_id = $2
           AND status = 'PROPOSED'
           AND proposal_id <> $3`,
        [input.projectId, `provider/${input.providerId}/external-transfer`, input.proposalId],
      );
      await client.query(
        `INSERT INTO settings.settings_audit_events
           (event_id, project_id, actor_id, action_name, risk_level, details, timestamp)
         VALUES ($1, $2, $3, 'PROVIDER_EXTERNAL_TRANSFER_REVIEW_APPROVED', 'HIGH', $4, $5)`,
        [
          randomUUID(),
          input.projectId,
          input.reviewedBy,
          JSON.stringify({
            proposalId: input.proposalId,
            providerId: input.providerId,
            approved: row.payload.approved,
            approvalRevision: nextRevision,
          }),
          reviewedAt,
        ],
      );
      await client.query('COMMIT');
      return {
        projectId: input.projectId,
        providerId: input.providerId,
        approved: row.payload.approved,
        approvalRevision: nextRevision,
        reviewedBy: input.reviewedBy,
        reviewedAt: reviewedAt.toISOString(),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async isProjectOwner(input: {
    readonly projectId: string;
    readonly principalId: string;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1
       FROM auth.project_memberships
       WHERE project_id = $1 AND principal_id = $2 AND is_owner
         AND (expires_at IS NULL OR expires_at > now())`,
      [input.projectId, input.principalId],
    );
    return result.rowCount === 1;
  }

  private async currentRevision(
    client: PoolClient,
    projectId: string,
    providerId: A4ProviderId,
    lock: boolean,
  ): Promise<number> {
    const result = await client.query<{ approval_revision: number }>(
      `SELECT approval_revision
       FROM settings.provider_external_transfer_approvals
       WHERE project_id = $1 AND provider_id = $2${lock ? ' FOR UPDATE' : ''}`,
      [projectId, providerId],
    );
    const revision = result.rows[0]?.approval_revision ?? 0;
    return asExpectedRevision(Number(revision));
  }

  private async assertOwner(
    client: PoolClient,
    projectId: string,
    principalId: string,
  ): Promise<void> {
    const result = await client.query(
      `SELECT 1
       FROM auth.project_memberships
       WHERE project_id = $1 AND principal_id = $2 AND is_owner
         AND (expires_at IS NULL OR expires_at > now())
       FOR SHARE`,
      [projectId, principalId],
    );
    if (result.rowCount !== 1) {
      throw new ProviderExternalTransferPolicyError(
        'PROJECT_OWNER_REQUIRED',
        'Project Owner review or approval is required.',
      );
    }
  }
}
