import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { VPCurrentAssertion } from '../../../modules/vp-knowledge-ledger/src/index.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';
import {
  FRONTIER_CONFIG,
  FRONTIER_CONFIG_DIGEST,
  assertionSnapshotDigest,
  frontierDigest,
  generateCandidateFrontier,
} from './candidate-frontier.js';

const assertions = async (
  db: Pool | PoolClient,
  projectId: string,
): Promise<VPCurrentAssertion[]> =>
  (
    await db.query<VPCurrentAssertion>(
      `SELECT assertion_id::text AS "assertionId",project_id AS "projectId",
    source_id::text AS "sourceId",source_version_id::text AS "sourceVersionId",evidence_id::text AS "evidenceId",
    claim_text AS "claimText",access_scope AS "accessScope",sensitivity
    FROM vp.current_assertions WHERE project_id=$1 ORDER BY assertion_id`,
      [projectId],
    )
  ).rows;

export type CurrentFrontierStatus = {
  readonly projectId: string;
  readonly available: boolean;
  readonly frontierId?: string;
  readonly current: boolean;
  readonly generationComplete: boolean;
  readonly membershipIntegrity: boolean;
  readonly executionComplete: boolean;
  readonly candidateCount: number;
  readonly pending: number;
  readonly failed: number;
  readonly unknown: number;
  readonly snapshotDigest: string;
  readonly generatorRevision: string;
  readonly configDigest: string;
};

type MembershipHeader = {
  readonly frontier_id: string;
  readonly candidate_count: number;
  readonly membership_digest: string;
};

const membershipIntegrity = async (
  client: Pool | PoolClient,
  projectId: string,
  policy: string,
  header: MembershipHeader,
): Promise<boolean> => {
  const rows = (
    await client.query<{
      left: string;
      right: string;
      rank: number;
      policy_revision: string;
    }>(
      `SELECT job.left_assertion_id::text AS "left",job.right_assertion_id::text AS "right",
              member.rank,job.policy_revision
         FROM vp.candidate_frontier_members member
         JOIN vp.relation_jobs job USING(project_id,job_id)
        WHERE member.project_id=$1 AND member.frontier_id=$2
        ORDER BY member.rank`,
      [projectId, header.frontier_id],
    )
  ).rows;
  return (
    rows.length === header.candidate_count &&
    rows.every(
      (row, index) =>
        row.rank === index + 1 && row.left < row.right && row.policy_revision === policy,
    ) &&
    frontierDigest(rows.map(({ left, right, rank }) => ({ left, right, rank }))) ===
      header.membership_digest
  );
};

/** All membership and job insertion commits together; failed generation leaves
 * no current complete header. No provider, local budget or knowledge write here. */
export class PostgresCandidateFrontier {
  constructor(
    private readonly pool: Pool,
    private readonly maxAttempts: number,
  ) {}
  async ensure(policy: string, projectId?: string): Promise<void> {
    if (!policy.trim()) throw new Error('Frontier policy revision is required.');
    const projects = (
      await this.pool.query<{ id: string }>(
        `SELECT project.id FROM project_admin.projects project
      LEFT JOIN project_admin.project_knowledge_epoch reset ON reset.project_id=project.id
      WHERE project.active AND project.status='ACTIVE' AND (reset.state IS NULL OR reset.state='READY')
        AND ($1::text IS NULL OR project.id=$1) ORDER BY project.id`,
        [projectId ?? null],
      )
    ).rows;
    for (const project of projects)
      await withSafePostgresTransaction(
        this.pool,
        async (client) => {
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
            `vp-frontier:${project.id}:${policy}`,
          ]);
          const input = await assertions(client, project.id),
            snapshot = assertionSnapshotDigest(input);
          const current = (
            await client.query<MembershipHeader>(
              `SELECT frontier_id,candidate_count,membership_digest FROM vp.candidate_frontiers
        WHERE project_id=$1 AND policy_revision=$2 AND snapshot_digest=$3 AND generator_revision=$4 AND config_digest=$5 AND is_current`,
              [project.id, policy, snapshot, FRONTIER_CONFIG.revision, FRONTIER_CONFIG_DIGEST],
            )
          ).rows[0];
          if (current) {
            if (!(await membershipIntegrity(client, project.id, policy, current)))
              throw new Error('FRONTIER_MEMBERSHIP_INTEGRITY_FAILED');
            return;
          }
          const pairs = generateCandidateFrontier(input);
          const id = randomUUID();
          await client.query(
            `UPDATE vp.candidate_frontiers SET is_current=false WHERE project_id=$1 AND policy_revision=$2 AND is_current`,
            [project.id, policy],
          );
          const header = (
            await client.query<MembershipHeader>(
              `INSERT INTO vp.candidate_frontiers
        (frontier_id,project_id,policy_revision,snapshot_digest,generator_revision,config_digest,membership_digest,assertion_count,candidate_count,is_current)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
        ON CONFLICT (project_id,policy_revision,snapshot_digest,generator_revision,config_digest) DO UPDATE SET is_current=true RETURNING frontier_id,candidate_count,membership_digest`,
              [
                id,
                project.id,
                policy,
                snapshot,
                FRONTIER_CONFIG.revision,
                FRONTIER_CONFIG_DIGEST,
                frontierDigest(pairs),
                input.length,
                pairs.length,
              ],
            )
          ).rows[0]!;
          await client.query(
            `INSERT INTO vp.relation_jobs(job_id,project_id,left_assertion_id,right_assertion_id,policy_revision,max_attempts,status,last_failure_code)
        SELECT gen_random_uuid(),$1,pair."left"::uuid,pair."right"::uuid,$2,$3,
          CASE WHEN EXISTS (SELECT 1 FROM vp.relations relation JOIN vp.decision_receipts receipt USING(project_id,decision_id)
            WHERE relation.project_id=$1 AND relation.left_assertion_id=pair."left"::uuid AND relation.right_assertion_id=pair."right"::uuid
            AND relation.relation_kind='EQUIVALENT' AND receipt.method='DETERMINISTIC' AND receipt.task_kind='EXACT_TEXT_EQUIVALENCE')
          THEN 'COMPLETED' ELSE 'PENDING' END,NULL
        FROM jsonb_to_recordset($4::jsonb) AS pair("left" text,"right" text,rank int) ON CONFLICT DO NOTHING`,
            [project.id, policy, this.maxAttempts, JSON.stringify(pairs)],
          );
          await client.query(
            `INSERT INTO vp.candidate_frontier_members(project_id,frontier_id,job_id,rank)
        SELECT $1,$2,job.job_id,pair.rank FROM jsonb_to_recordset($4::jsonb) AS pair("left" text,"right" text,rank int)
        JOIN vp.relation_jobs job ON job.project_id=$1 AND job.policy_revision=$3
          AND job.left_assertion_id=pair."left"::uuid AND job.right_assertion_id=pair."right"::uuid ON CONFLICT DO NOTHING`,
            [project.id, header.frontier_id, policy, JSON.stringify(pairs)],
          );
          if (
            header.candidate_count !== pairs.length ||
            header.membership_digest !== frontierDigest(pairs) ||
            !(await membershipIntegrity(client, project.id, policy, header))
          )
            throw new Error('FRONTIER_MEMBERSHIP_INTEGRITY_FAILED');
        },
        { module: 'vp-knowledge-postgres', operation: 'ensure-current-frontier' },
      );
  }

  async status(projectId: string, policy: string): Promise<CurrentFrontierStatus> {
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        return readCandidateFrontierStatus(client, projectId, policy);
      },
      { module: 'vp-knowledge-postgres', operation: 'read-current-frontier' },
    );
  }
}

/** Caller must pin current assertions, header, jobs and membership to one database snapshot. */
export async function readCandidateFrontierStatus(
  client: PoolClient,
  projectId: string,
  policy: string,
): Promise<CurrentFrontierStatus> {
  const isolation = (
    await client.query<{ transaction_isolation: string }>('SHOW transaction_isolation')
  ).rows[0]!.transaction_isolation;
  if (isolation !== 'repeatable read' && isolation !== 'serializable')
    throw new Error('FRONTIER_STATUS_SNAPSHOT_REQUIRED');
  const available = (
    await client.query<{ available: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM project_admin.projects project
         LEFT JOIN project_admin.project_knowledge_epoch reset ON reset.project_id=project.id
        WHERE project.id=$1 AND project.active AND project.status='ACTIVE'
          AND (reset.state IS NULL OR reset.state='READY')) AS available`,
      [projectId],
    )
  ).rows[0]!.available;
  if (!available)
    return {
      projectId,
      available: false,
      current: false,
      generationComplete: false,
      membershipIntegrity: false,
      executionComplete: false,
      candidateCount: 0,
      pending: 0,
      failed: 0,
      unknown: 0,
      snapshotDigest: '',
      generatorRevision: FRONTIER_CONFIG.revision,
      configDigest: FRONTIER_CONFIG_DIGEST,
    };
  const snapshot = assertionSnapshotDigest(await assertions(client, projectId));
  const row = (
    await client.query<{
      frontier_id: string;
      candidate_count: number;
      membership_digest: string;
      n: number;
      pending: number;
      failed: number;
      unknown: number;
    }>(
      `
      SELECT header.frontier_id::text,header.candidate_count,header.membership_digest,count(member.job_id)::int AS n,
        count(job.job_id) FILTER(WHERE job.status IN ('PENDING','RUNNING','RETRYABLE'))::int AS pending,
        count(job.job_id) FILTER(WHERE job.status IN ('FAILED','SUPERSEDED'))::int AS failed,
        count(job.job_id) FILTER(WHERE job.status='OUTCOME_UNKNOWN')::int AS unknown
      FROM vp.candidate_frontiers header LEFT JOIN vp.candidate_frontier_members member USING(project_id,frontier_id)
        LEFT JOIN vp.relation_jobs job USING(project_id,job_id)
      WHERE header.project_id=$1 AND header.policy_revision=$2 AND header.snapshot_digest=$3
        AND header.generator_revision=$4 AND header.config_digest=$5 AND header.is_current
      GROUP BY header.frontier_id`,
      [projectId, policy, snapshot, FRONTIER_CONFIG.revision, FRONTIER_CONFIG_DIGEST],
    )
  ).rows[0];
  const integrity =
    !!row &&
    row.n === row.candidate_count &&
    (await membershipIntegrity(client, projectId, policy, row));
  const complete = integrity;
  return {
    projectId,
    available,
    ...(row ? { frontierId: row.frontier_id } : {}),
    current: !!row,
    generationComplete: complete,
    membershipIntegrity: integrity,
    executionComplete: complete && row!.pending === 0 && row!.failed === 0 && row!.unknown === 0,
    candidateCount: row?.candidate_count ?? 0,
    pending: row?.pending ?? 0,
    failed: row?.failed ?? 0,
    unknown: row?.unknown ?? 0,
    snapshotDigest: snapshot,
    generatorRevision: FRONTIER_CONFIG.revision,
    configDigest: FRONTIER_CONFIG_DIGEST,
  };
}
