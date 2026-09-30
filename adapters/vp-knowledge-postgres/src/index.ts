import { createHash, randomUUID } from 'node:crypto';

import type { Pool, QueryResultRow } from 'pg';

import type {
  VPAssertionReadScope,
  VPCurrentAssertion,
  VPKnowledgeLedgerPort,
} from '../../../modules/vp-knowledge-ledger/src/index.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';

type ValidatedCandidateRow = QueryResultRow & {
  readonly candidate_id: string;
  readonly batch_id: string;
  readonly project_id: string;
  readonly source_id: string;
  readonly source_version_id: string;
  readonly evidence_id: string;
  readonly claim_text: string;
  readonly access_scope: string[];
  readonly sensitivity: VPCurrentAssertion['sensitivity'];
};

type CurrentAssertionRow = QueryResultRow & {
  readonly assertion_id: string;
  readonly project_id: string;
  readonly source_id: string;
  readonly source_version_id: string;
  readonly evidence_id: string;
  readonly claim_text: string;
  readonly access_scope: string[];
  readonly sensitivity: VPCurrentAssertion['sensitivity'];
};

type EmptyBatchRow = QueryResultRow & {
  readonly project_id: string;
  readonly source_version_id: string;
  readonly batch_id: string;
};

const currentEmptyBatchesSql = `
  WITH eligible_batches AS (
    SELECT batch.project_id, batch.source_version_id, batch.revision_id,
           batch.batch_id, batch.created_at,
           row_number() OVER (
             PARTITION BY batch.project_id, batch.source_version_id, batch.revision_id
             ORDER BY batch.created_at DESC, batch.batch_id DESC
           ) AS selection_rank
      FROM candidate.batches AS batch
      JOIN asset.source_versions AS version
        ON version.source_version_id = batch.source_version_id
      JOIN asset.sources AS source
        ON source.source_id = version.source_id
       AND source.project_id = batch.project_id
      JOIN source_product.source_stage3_progress AS progress
        ON progress.project_id = batch.project_id
       AND progress.source_version_id = batch.source_version_id
       AND progress.state = 'STAGE3_COMPLETED'
      JOIN evidence.indexing_results AS indexing
        ON indexing.indexing_result_id = progress.indexing_result_id
       AND indexing.project_id = progress.project_id
       AND indexing.source_version_id = progress.source_version_id
       AND indexing.revision_id = batch.revision_id
      LEFT JOIN project_admin.project_knowledge_epoch AS reset_epoch
        ON reset_epoch.project_id = batch.project_id
     WHERE ($1::text IS NULL OR batch.project_id = $1)
       AND (reset_epoch.state IS NULL OR reset_epoch.state = 'READY')
       AND version.version_number = (
         SELECT max(latest.version_number)
           FROM asset.source_versions AS latest
          WHERE latest.source_id = version.source_id
       )
       AND NOT EXISTS (
         SELECT 1
           FROM candidate.claim_candidates AS item
           LEFT JOIN validation.results AS validation
             ON validation.project_id = item.project_id
            AND validation.source_version_id = item.source_version_id
            AND validation.candidate_id = item.candidate_id
            AND validation.revision_number = item.revision_number
           LEFT JOIN vp.assertions AS materialized
             ON materialized.candidate_id = item.candidate_id
          WHERE item.batch_id = batch.batch_id
            AND (item.status = 'PENDING_VALIDATION'
              OR validation.validation_id IS NULL
              OR validation.status <> item.status
              OR (item.status = 'READY' AND materialized.assertion_id IS NULL))
       )
  )
  SELECT selected.project_id, selected.source_version_id::text,
         selected.batch_id::text
    FROM eligible_batches AS selected
   WHERE selected.selection_rank = 1
     AND NOT EXISTS (
       SELECT 1 FROM candidate.claim_candidates AS ready
        WHERE ready.batch_id = selected.batch_id AND ready.status = 'READY'
     )
     AND NOT EXISTS (
       SELECT 1 FROM vp.history_events AS event
        WHERE event.project_id = selected.project_id
          AND event.batch_id = selected.batch_id
          AND event.event_kind = 'SOURCE_BATCH_ACTIVATED'
     )
   ORDER BY selected.project_id, selected.batch_id`;

const exactPairDigest = (left: string, right: string, claimText: string): string =>
  `sha256:${createHash('sha256')
    .update(JSON.stringify([left, right, claimText]))
    .digest('hex')}`;
export class PostgresVPKnowledgeLedger implements VPKnowledgeLedgerPort {
  constructor(private readonly pool: Pool) {}

  async ingestValidatedDirectClaims(limit = 32): Promise<number> {
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const candidates = await client.query<ValidatedCandidateRow>(
          `SELECT candidate.candidate_id::text, candidate.batch_id::text,
                  candidate.project_id,
                  evidence.source_id::text, candidate.source_version_id::text,
                  evidence.evidence_id::text, candidate.claim_text,
                  evidence.access_scope, evidence.sensitivity
             FROM candidate.claim_candidates AS candidate
             JOIN candidate.batches AS batch
               ON batch.batch_id = candidate.batch_id
              AND batch.project_id = candidate.project_id
              AND batch.source_version_id = candidate.source_version_id
             JOIN validation.results AS validation
               ON validation.candidate_id = candidate.candidate_id
              AND validation.project_id = candidate.project_id
              AND validation.source_version_id = candidate.source_version_id
              AND validation.revision_number = candidate.revision_number
              AND validation.status = 'READY'
             JOIN evidence.spans AS evidence
               ON evidence.evidence_id = candidate.evidence_id
              AND evidence.project_id = candidate.project_id
              AND evidence.source_version_id = candidate.source_version_id
              AND evidence.revision_id = batch.revision_id
             JOIN asset.source_versions AS version
               ON version.source_version_id = candidate.source_version_id
              AND version.source_id = evidence.source_id
             JOIN source_product.source_stage3_progress AS progress
               ON progress.project_id = candidate.project_id
              AND progress.source_version_id = candidate.source_version_id
              AND progress.state = 'STAGE3_COMPLETED'
             JOIN asset.sources AS source
               ON source.source_id = version.source_id
              AND source.project_id = candidate.project_id
             LEFT JOIN project_admin.project_knowledge_epoch AS reset_epoch
               ON reset_epoch.project_id = candidate.project_id
            WHERE candidate.status = 'READY'
              AND (reset_epoch.state IS NULL OR reset_epoch.state = 'READY')
              AND candidate.evidence_mode = 'DIRECT_EVIDENCE'
              AND candidate.extraction_profile = 'direct-only'
              AND candidate.access_scope @> evidence.access_scope
              AND candidate.access_scope <@ evidence.access_scope
              AND candidate.sensitivity = evidence.sensitivity
              AND candidate.access_scope @> version.access_scope
              AND candidate.access_scope <@ version.access_scope
              AND candidate.sensitivity = version.sensitivity
              AND NOT EXISTS (
                SELECT 1 FROM asset.source_versions AS newer
                 WHERE newer.source_id = version.source_id
                   AND newer.version_number > version.version_number
              )
              AND NOT EXISTS (
                SELECT 1 FROM vp.assertions AS existing
                 WHERE existing.candidate_id = candidate.candidate_id
              )
            ORDER BY candidate.created_at, candidate.candidate_id
            LIMIT $1 FOR UPDATE OF candidate SKIP LOCKED`,
          [Math.max(1, Math.floor(limit))],
        );
        let ingested = 0;
        for (const candidate of candidates.rows) {
          // Serialize exact-equivalence links for a project. Another worker
          // cannot insert an assertion between the pair scan and relation write.
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
            `vp-ledger:${candidate.project_id}`,
          ]);
          const assertionId = randomUUID();
          const inserted = await client.query<{ assertion_id: string }>(
            `INSERT INTO vp.assertions (
               assertion_id, project_id, candidate_id, source_id,
               source_version_id, evidence_id, claim_text, origin,
               access_scope, sensitivity
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'DIRECT_SOURCE', $8, $9)
             ON CONFLICT (candidate_id) DO NOTHING
             RETURNING assertion_id::text`,
            [
              assertionId,
              candidate.project_id,
              candidate.candidate_id,
              candidate.source_id,
              candidate.source_version_id,
              candidate.evidence_id,
              candidate.claim_text,
              candidate.access_scope,
              candidate.sensitivity,
            ],
          );
          if (!inserted.rowCount) continue;
          const exactMatches = await client.query<{ assertion_id: string }>(
            `SELECT assertion_id::text FROM vp.current_assertions
              WHERE project_id = $1 AND claim_text = $2 AND assertion_id <> $3
                AND access_scope = $4::text[] AND sensitivity = $5
                AND source_version_id <> $6::uuid
             UNION
             SELECT previous.assertion_id::text
               FROM vp.assertions AS previous
               JOIN candidate.claim_candidates AS prior_candidate
                 ON prior_candidate.candidate_id = previous.candidate_id
              WHERE previous.project_id = $1 AND previous.claim_text = $2
                AND previous.assertion_id <> $3
                AND previous.access_scope = $4::text[]
                AND previous.sensitivity = $5
                AND prior_candidate.batch_id = $7::uuid
             ORDER BY assertion_id`,
            [
              candidate.project_id,
              candidate.claim_text,
              assertionId,
              candidate.access_scope,
              candidate.sensitivity,
              candidate.source_version_id,
              candidate.batch_id,
            ],
          );
          const relationIds: string[] = [];
          for (const match of exactMatches.rows) {
            const [left, right] = [assertionId, match.assertion_id].sort();
            if (!left || !right) continue;
            const decisionId = randomUUID();
            const relationId = randomUUID();
            await client.query(
              `INSERT INTO vp.decision_receipts (
                 decision_id, project_id, method, task_kind, policy_revision,
                 input_digest, outcome
               ) VALUES ($1, $2, 'DETERMINISTIC', 'EXACT_TEXT_EQUIVALENCE',
                         'vp-exact-claim-v1', $3, 'EQUIVALENT')`,
              [
                decisionId,
                candidate.project_id,
                exactPairDigest(left, right, candidate.claim_text),
              ],
            );
            await client.query(
              `INSERT INTO vp.relations (
                 relation_id, project_id, left_assertion_id, right_assertion_id,
                 relation_kind, decision_id
               ) VALUES ($1, $2, $3, $4, 'EQUIVALENT', $5)`,
              [relationId, candidate.project_id, left, right, decisionId],
            );
            relationIds.push(relationId);
          }
          const epoch = await client.query<{ current_epoch: string }>(
            `INSERT INTO vp.project_epochs (project_id, current_epoch)
             VALUES ($1, 1)
             ON CONFLICT (project_id) DO UPDATE
               SET current_epoch = vp.project_epochs.current_epoch + 1,
                   updated_at = clock_timestamp()
             RETURNING current_epoch::text`,
            [candidate.project_id],
          );
          await client.query(
            `INSERT INTO vp.history_events (
               event_id, project_id, epoch, event_kind, assertion_id, relation_ids
             ) VALUES ($1, $2, $3, 'DIRECT_ASSERTION_RECORDED', $4, $5::uuid[])`,
            [
              randomUUID(),
              candidate.project_id,
              epoch.rows[0]?.current_epoch,
              assertionId,
              relationIds,
            ],
          );
          ingested += 1;
        }

        // Empty or fully rejected batches still replace the current assertion
        // set. Give that state transition its own epoch so Ask snapshots cannot
        // mistake the previous projection for the completed empty result.
        const projectsWithEmptyBatches = await client.query<{ project_id: string }>(
          currentEmptyBatchesSql,
          [null],
        );
        for (const { project_id: projectId } of projectsWithEmptyBatches.rows) {
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
            `vp-ledger:${projectId}`,
          ]);
          const emptyBatches = await client.query<EmptyBatchRow>(currentEmptyBatchesSql, [
            projectId,
          ]);
          for (const batch of emptyBatches.rows) {
            const epoch = await client.query<{ current_epoch: string }>(
              `INSERT INTO vp.project_epochs (project_id, current_epoch)
               VALUES ($1, 1)
               ON CONFLICT (project_id) DO UPDATE
                 SET current_epoch = vp.project_epochs.current_epoch + 1,
                     updated_at = clock_timestamp()
               RETURNING current_epoch::text`,
              [projectId],
            );
            await client.query(
              `INSERT INTO vp.history_events (
                 event_id, project_id, epoch, event_kind, assertion_id,
                 relation_ids, source_version_id, batch_id
               ) VALUES ($1, $2, $3, 'SOURCE_BATCH_ACTIVATED', NULL, '{}', $4, $5)`,
              [
                randomUUID(),
                projectId,
                epoch.rows[0]?.current_epoch,
                batch.source_version_id,
                batch.batch_id,
              ],
            );
          }
        }
        return ingested;
      },
      { module: 'vp-knowledge-postgres', operation: 'ingest-validated-direct-claims' },
    );
  }

  async listCurrentAssertions(scope: VPAssertionReadScope): Promise<readonly VPCurrentAssertion[]> {
    const result = await this.pool.query<CurrentAssertionRow>(
      `SELECT assertion_id::text, project_id, source_id::text,
              source_version_id::text, evidence_id::text, claim_text,
              access_scope, sensitivity
         FROM vp.current_assertions
        WHERE project_id = $1
          AND access_scope <@ $2::text[]
          AND sensitivity = ANY($3::text[])
        ORDER BY source_id, source_version_id, assertion_id`,
      [scope.projectId, scope.accessScope, scope.authorizedSensitivities],
    );
    return result.rows.map((row) => ({
      assertionId: row.assertion_id,
      projectId: row.project_id,
      sourceId: row.source_id,
      sourceVersionId: row.source_version_id,
      evidenceId: row.evidence_id,
      claimText: row.claim_text,
      accessScope: row.access_scope,
      sensitivity: row.sensitivity,
    }));
  }
}
