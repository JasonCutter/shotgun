import type { Pool, PoolClient } from 'pg';
import type { SurferAskSourceRequest } from '../../../packages/contracts/src/surfer-source.js';
import { surferDigest } from '../../../packages/contracts/src/surfer-learning.js';
import { ShotgunError } from '../../../packages/contracts/src/errors.js';
export const denySurferAskRead = (): never => {
  throw new ShotgunError({
    code: 'POLICY_DENIED',
    safeMessage: 'The current Ask attempt is not authorized to read Surfer context.',
    module: 'surfer.source',
    operation: 'ask-context-read',
  });
};
/** One statement snapshot, no token lookup, lock, DML, lease extension or model authority. */
export async function authorizeSurferAskRead(
  queryable: Pick<Pool | PoolClient, 'query'>,
  request: SurferAskSourceRequest,
) {
  const row = (
    await queryable.query(
      `
    SELECT command.principal_id, run.access_scope, run.sensitivity_clearance,
      run.access_revision, run.policy_context_revision, run.question,
      member.scopes, member.sensitivity_clearance AS current_clearance,
      member.is_owner, member.expires_at::text AS membership_expires_at,
      project.revision AS project_revision,
      COALESCE((SELECT MAX(revision) FROM settings.policy_context_revisions WHERE project_id=run.project_id),1)::text AS current_policy
    FROM frontend_ask.answer_runs run
    JOIN frontend_ask.answer_run_attempts attempt ON attempt.answer_run_id=run.answer_run_id AND attempt.project_id=run.project_id
    JOIN frontend_command.command_ledger command ON command.command_id=run.create_command_id
    JOIN auth.principals principal ON principal.principal_id::text=command.principal_id AND principal.status='active'
    JOIN auth.project_memberships member ON member.principal_id=principal.principal_id AND member.project_id=run.project_id
    JOIN project_admin.projects project ON project.id=run.project_id AND project.status='ACTIVE'
    LEFT JOIN project_admin.project_knowledge_epoch epoch ON epoch.project_id=run.project_id
    WHERE run.project_id=$1 AND run.answer_run_id=$2 AND attempt.attempt_id=$3 AND attempt.lease_owner=$4
      AND run.state IN ('RUNNING','STREAMING','PARTIAL') AND attempt.state='RUNNING'
      AND attempt.attempt_number=run.attempt_number
      AND attempt.lease_expires_at>clock_timestamp()
      AND attempt.access_revision=run.access_revision AND attempt.policy_context_revision=run.policy_context_revision
      AND command.command_type='SUBMIT_QUESTION' AND command.target_project_id=run.project_id
      AND command.outcome_state='COMPLETED' AND command.completion_disposition='SUCCEEDED'
      AND command.accepted_policy_context->>'policyContextRevision'=run.policy_context_revision
      AND (member.expires_at IS NULL OR member.expires_at>clock_timestamp())
      AND COALESCE(epoch.state,'READY')='READY'
  `,
      [request.projectId, request.ask.answerRunId, request.ask.attemptId, request.ask.leaseOwner],
    )
  ).rows[0];
  if (
    !row ||
    !Array.isArray(row.scopes) ||
    row.scopes.length === 0 ||
    surferDigest([...row.scopes].sort()) !== surferDigest([...(row.access_scope ?? [])].sort()) ||
    row.current_clearance !== row.sensitivity_clearance ||
    row.current_policy !== row.policy_context_revision
  )
    return denySurferAskRead();
  return {
    principalId: row.principal_id as string,
    membership: {
      scopes: row.scopes as string[],
      sensitivityClearance: row.current_clearance as
        'public' | 'internal' | 'private' | 'restricted',
      isOwner: false,
      expiresAt: row.membership_expires_at as string | null,
    },
    // Lease expiry/heartbeat is checked above but is not a content change when merely extended.
    stamp: surferDigest(row),
  };
}
