import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';

import { ShotgunError } from '../../../packages/contracts/src/index.js';
import type {
  CancelSourcesSubmissionInput,
  MarkSourcesOutcomeIndeterminateInput,
  RetrySourcesItemsInput,
  SourcesIntakeLifecyclePort,
  SourcesLifecycleMutationResult,
} from '../../../modules/frontend-sources-write/src/lifecycle.js';

type ItemRow = QueryResultRow & {
  submission_item_id: string;
  state: string;
  item_revision: string;
  latest_attempt_id: string | null;
  latest_attempt_number: number;
};

export class PostgresSourcesIntakeLifecycle implements SourcesIntakeLifecyclePort {
  constructor(private readonly pool: Pool) {}

  async retryItems(input: RetrySourcesItemsInput): Promise<SourcesLifecycleMutationResult> {
    if (input.submissionItemIds.length === 0) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'Retry requires at least one Sources Item.',
        module: 'frontend-sources-write-postgres',
        operation: 'retry-items',
      });
    }
    return this.transaction(input.projectId, input.submissionId, async (client) => {
      await this.assertAcceptedCommand(
        client,
        input.commandId,
        input.projectId,
        'sources.intake.retry.v1',
      );
      const items = await this.lockItems(client, input, input.submissionItemIds);
      for (const item of items) {
        if (!['FAILED', 'CANCELLED', 'OUTCOME_INDETERMINATE'].includes(item.state)) {
          throw new ShotgunError({
            code: 'VALIDATION_ERROR',
            safeMessage: 'Only failed, cancelled or outcome-indeterminate Items may be retried.',
            module: 'frontend-sources-write-postgres',
            operation: 'retry-items',
          });
        }
        if (!item.latest_attempt_id) throw new Error('Retry requires a causation Attempt.');
        await client.query(
          `INSERT INTO source_product.intake_attempts (
             intake_attempt_id, project_id, submission_id, submission_item_id,
             command_id, attempt_number, attempt_kind, state, correlation_id,
             causation_attempt_id, accepted_policy_context_id,
             accepted_policy_binding, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACCEPTED', $8, $9, $10, $11::jsonb, $12, $12)`,
          [
            randomUUID(),
            input.projectId,
            input.submissionId,
            item.submission_item_id,
            input.commandId,
            item.latest_attempt_number + 1,
            input.mode === 'SAME_CONTEXT' ? 'RETRY_SAME_CONTEXT' : 'RETRY_CURRENT_POLICY',
            input.correlationId,
            item.latest_attempt_id,
            input.acceptedPolicyContextId,
            JSON.stringify(input.acceptedPolicyBinding),
            input.createdAt,
          ],
        );
        await client.query(
          `UPDATE source_product.intake_submission_items
           SET state = 'QUEUED'
           WHERE submission_item_id = $1`,
          [item.submission_item_id],
        );
      }
      await client.query(
        `UPDATE source_product.intake_submissions
         SET state = 'QUEUED'
         WHERE submission_id = $1`,
        [input.submissionId],
      );
      return this.snapshot(client, input.submissionId);
    });
  }

  async cancelSubmission(
    input: CancelSourcesSubmissionInput,
  ): Promise<SourcesLifecycleMutationResult> {
    return this.transaction(input.projectId, input.submissionId, async (client) => {
      await this.assertAcceptedCommand(
        client,
        input.commandId,
        input.projectId,
        'sources.intake.cancel.v1',
      );
      const items = await this.lockItems(client, input);
      const cancellable = items.filter((item) => !['SUCCEEDED', 'CANCELLED'].includes(item.state));
      for (const item of cancellable) {
        if (!item.latest_attempt_id) throw new Error('Cancellation requires a causation Attempt.');
        const cancelAttemptId = randomUUID();
        await client.query(
          `INSERT INTO source_product.intake_attempts (
             intake_attempt_id, project_id, submission_id, submission_item_id,
             command_id, attempt_number, attempt_kind, state, correlation_id,
             causation_attempt_id, accepted_policy_context_id,
             accepted_policy_binding, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, 'CANCEL', 'RUNNING', $7, $8, $9, $10::jsonb, $11, $11)`,
          [
            cancelAttemptId,
            input.projectId,
            input.submissionId,
            item.submission_item_id,
            input.commandId,
            item.latest_attempt_number + 1,
            input.correlationId,
            item.latest_attempt_id,
            input.acceptedPolicyContextId,
            JSON.stringify(input.acceptedPolicyBinding),
            input.createdAt,
          ],
        );
        await client.query(
          `UPDATE source_product.intake_submission_items
           SET state = 'CANCEL_REQUESTED'
           WHERE submission_item_id = $1`,
          [item.submission_item_id],
        );
        await client.query(
          `UPDATE source_product.intake_submission_items
           SET state = 'CANCELLED', completed_at = $2
           WHERE submission_item_id = $1`,
          [item.submission_item_id, input.createdAt],
        );
        await client.query(
          `UPDATE source_product.intake_attempts
           SET state = 'SUCCEEDED', completed_at = $2
           WHERE intake_attempt_id = $1`,
          [cancelAttemptId, input.createdAt],
        );
      }
      if (cancellable.length > 0) {
        await client.query(
          `UPDATE source_product.intake_submissions
           SET state = 'CANCEL_REQUESTED'
           WHERE submission_id = $1`,
          [input.submissionId],
        );
        const succeeded = items.some((item) => item.state === 'SUCCEEDED');
        await client.query(
          `UPDATE source_product.intake_submissions
           SET state = $2, completed_at = CASE WHEN $2 = 'CANCELLED' THEN $3::timestamptz ELSE NULL END
           WHERE submission_id = $1`,
          [input.submissionId, succeeded ? 'PARTIAL' : 'CANCELLED', input.createdAt],
        );
      }
      return this.snapshot(client, input.submissionId);
    });
  }

  async markOutcomeIndeterminate(
    input: MarkSourcesOutcomeIndeterminateInput,
  ): Promise<SourcesLifecycleMutationResult> {
    return this.transaction(input.projectId, input.submissionId, async (client) => {
      const items = await this.lockItems(client, input, input.submissionItemIds);
      for (const item of items) {
        if (!item.latest_attempt_id) throw new Error('Outcome recovery requires an Attempt.');
        await client.query(
          `UPDATE source_product.intake_attempts
           SET state = 'OUTCOME_INDETERMINATE'
           WHERE intake_attempt_id = $1`,
          [item.latest_attempt_id],
        );
        await client.query(
          `UPDATE source_product.intake_submission_items
           SET state = 'OUTCOME_INDETERMINATE'
           WHERE submission_item_id = $1`,
          [item.submission_item_id],
        );
      }
      await client.query(
        `UPDATE source_product.intake_submissions
         SET state = 'OUTCOME_INDETERMINATE'
         WHERE submission_id = $1`,
        [input.submissionId],
      );
      return this.snapshot(client, input.submissionId);
    });
  }

  private async transaction<T>(
    projectId: string,
    submissionId: string,
    action: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${projectId}:${submissionId}`,
      ]);
      const submission = await client.query(
        `SELECT 1 FROM source_product.intake_submissions
         WHERE project_id = $1 AND submission_id = $2 FOR UPDATE`,
        [projectId, submissionId],
      );
      if (submission.rowCount !== 1) {
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: 'The Sources submission is not available in this Project.',
          module: 'frontend-sources-write-postgres',
          operation: 'lock-submission',
        });
      }
      const result = await action(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockItems(
    client: PoolClient,
    input: { projectId: string; submissionId: string },
    ids?: readonly string[],
  ): Promise<ItemRow[]> {
    const result = await client.query<ItemRow>(
      `SELECT item.submission_item_id::text, item.state, item.item_revision::text,
              latest.intake_attempt_id::text AS latest_attempt_id,
              COALESCE(latest.attempt_number, 0) AS latest_attempt_number
       FROM source_product.intake_submission_items AS item
       LEFT JOIN LATERAL (
         SELECT intake_attempt_id, attempt_number
         FROM source_product.intake_attempts
         WHERE submission_item_id = item.submission_item_id
         ORDER BY attempt_number DESC
         LIMIT 1
       ) AS latest ON true
       WHERE item.project_id = $1
         AND item.submission_id = $2
         AND ($3::uuid[] IS NULL OR item.submission_item_id = ANY($3::uuid[]))
       ORDER BY item.submission_item_id
       FOR UPDATE OF item`,
      [input.projectId, input.submissionId, ids ?? null],
    );
    if (ids && result.rows.length !== ids.length) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'One or more Sources Items are unavailable.',
        module: 'frontend-sources-write-postgres',
        operation: 'lock-items',
      });
    }
    return result.rows;
  }

  private async assertAcceptedCommand(
    client: PoolClient,
    commandId: string,
    projectId: string,
    commandType: string,
  ): Promise<void> {
    const result = await client.query<{ outcome_state: string }>(
      `SELECT outcome_state
       FROM frontend_command.command_ledger
       WHERE command_id = $1
         AND active_project_id = $2
         AND target_project_id = $2
         AND command_type = $3
       FOR SHARE`,
      [commandId, projectId, commandType],
    );
    if (result.rows[0]?.outcome_state !== 'ACCEPTED') {
      throw new ShotgunError({
        code: 'POLICY_DENIED',
        safeMessage: 'The accepted Frontend Command does not match this lifecycle operation.',
        module: 'frontend-sources-write-postgres',
        operation: 'assert-lifecycle-command',
      });
    }
  }

  private async snapshot(
    client: PoolClient,
    submissionId: string,
  ): Promise<SourcesLifecycleMutationResult> {
    const submission = await client.query<{
      state: string;
      submission_revision: string;
    }>(
      `SELECT state, submission_revision::text
       FROM source_product.intake_submissions WHERE submission_id = $1`,
      [submissionId],
    );
    const items = await client.query<{
      submission_item_id: string;
      state: string;
      item_revision: string;
      attempt_count: string;
    }>(
      `SELECT item.submission_item_id::text, item.state, item.item_revision::text,
              count(attempt.intake_attempt_id)::text AS attempt_count
       FROM source_product.intake_submission_items AS item
       LEFT JOIN source_product.intake_attempts AS attempt
         ON attempt.submission_item_id = item.submission_item_id
       WHERE item.submission_id = $1
       GROUP BY item.submission_item_id, item.state, item.item_revision
       ORDER BY item.submission_item_id`,
      [submissionId],
    );
    const row = submission.rows[0];
    if (!row) throw new Error('Sources submission disappeared during lifecycle mutation.');
    return {
      submissionId,
      submissionState: row.state,
      submissionRevision: row.submission_revision,
      itemStates: items.rows.map((item) => ({
        submissionItemId: item.submission_item_id,
        state: item.state,
        itemRevision: item.item_revision,
        attemptCount: Number(item.attempt_count),
      })),
    };
  }
}
