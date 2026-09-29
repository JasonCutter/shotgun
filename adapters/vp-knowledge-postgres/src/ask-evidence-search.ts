import type { Pool } from 'pg';

import { sha256Text, stableJson } from '../../../packages/contracts/src/index.js';
import type {
  AskKnowledgeEvidenceSearchPort,
  AskKnowledgeSnapshot,
} from '../../../modules/frontend-ask-execution/src/index.js';

type KnowledgeSnapshotInput = {
  readonly projectId: string;
  readonly accessScope: readonly string[];
  readonly authorizedSensitivities: readonly ('public' | 'internal' | 'private' | 'restricted')[];
};

type KnowledgeSnapshotRow = {
  readonly knowledge_epoch: string;
  readonly reset_epoch: string | null;
  readonly reset_state: string | null;
  readonly source_versions: string;
};

const readSnapshot = async (
  pool: Pool,
  input: KnowledgeSnapshotInput,
): Promise<AskKnowledgeSnapshot> => {
  const result = await pool.query<KnowledgeSnapshotRow>(
    `WITH accessible_latest_versions AS (
       SELECT source.source_id::text AS source_id,
              version.source_version_id::text AS source_version_id
         FROM asset.sources AS source
         JOIN LATERAL (
           SELECT candidate.source_version_id, candidate.version_number,
                  candidate.access_scope, candidate.sensitivity
             FROM asset.source_versions AS candidate
            WHERE candidate.source_id = source.source_id
            ORDER BY candidate.version_number DESC
            LIMIT 1
         ) AS version ON true
        WHERE source.project_id = $1
          AND version.access_scope <@ $2::text[]
          AND version.sensitivity = ANY($3::text[])
     )
     SELECT COALESCE((
              SELECT epoch.current_epoch::text
                FROM vp.project_epochs AS epoch
               WHERE epoch.project_id = $1
            ), '0') AS knowledge_epoch,
            (SELECT reset.epoch::text
               FROM project_admin.project_knowledge_epoch AS reset
              WHERE reset.project_id = $1) AS reset_epoch,
            (SELECT reset.state
               FROM project_admin.project_knowledge_epoch AS reset
              WHERE reset.project_id = $1) AS reset_state,
            COALESCE((
              SELECT string_agg(
                       source_id || ':' || source_version_id,
                       E'\\n' ORDER BY source_id, source_version_id
                     )
                FROM accessible_latest_versions
            ), '') AS source_versions`,
    [input.projectId, input.accessScope, input.authorizedSensitivities],
  );
  const row = result.rows[0];
  const versionFingerprint = row?.source_versions ?? '';
  return {
    knowledgeEpoch: row?.knowledge_epoch ?? '0',
    sourceWatermark: sha256Text(
      stableJson({
        projectId: input.projectId,
        accessScope: [...input.accessScope].sort(),
        authorizedSensitivities: [...input.authorizedSensitivities].sort(),
        resetEpoch: row?.reset_epoch ?? null,
        resetState: row?.reset_state ?? null,
        sourceVersions: versionFingerprint,
      }),
    ),
  };
};

/** VP assertions select the authoritative shortlist; Ask rechecks every Evidence ID. */
export class PostgresVPAskEvidenceSearch implements AskKnowledgeEvidenceSearchPort {
  constructor(private readonly pool: Pool) {}

  async search(
    input: Parameters<AskKnowledgeEvidenceSearchPort['search']>[0],
  ): Promise<Awaited<ReturnType<AskKnowledgeEvidenceSearchPort['search']>>> {
    const snapshot = await readSnapshot(this.pool, input);
    if (!input.projectId || !input.question.trim() || input.accessScope.length === 0) {
      return { ...snapshot, evidenceIds: [] };
    }
    const limit = Math.max(1, Math.min(12, Math.floor(input.limit)));
    const result = await this.pool.query<{ evidence_id: string }>(
      `WITH query_terms AS (
         SELECT regexp_split_to_table(
           trim(regexp_replace(lower($2), '[^[:alnum:]가-힣]+', ' ', 'g')),
           '\\s+'
         ) AS term
       ), ranked AS (
         SELECT assertion.assertion_id, assertion.evidence_id,
                GREATEST(
                  ts_rank_cd(to_tsvector('simple', assertion.claim_text),
                             websearch_to_tsquery('simple', $2)),
                  similarity(assertion.claim_text, $2),
                  CASE WHEN assertion.claim_text ILIKE '%' || $2 || '%'
                    THEN 1.0 ELSE 0.0 END,
                  (SELECT count(*)::double precision FROM query_terms
                   WHERE char_length(term) >= 2
                     AND lower(assertion.claim_text) ILIKE '%' || term || '%')
                )::double precision AS score,
                assertion.created_at
           FROM vp.current_assertions AS assertion
           LEFT JOIN project_admin.project_knowledge_epoch AS reset_epoch
             ON reset_epoch.project_id = assertion.project_id
          WHERE assertion.project_id = $1
            AND assertion.access_scope <@ $3::text[]
            AND assertion.sensitivity = ANY($4::text[])
            AND (reset_epoch.state IS NULL OR reset_epoch.state = 'READY')
            AND (
              to_tsvector('simple', assertion.claim_text)
                @@ websearch_to_tsquery('simple', $2)
              OR assertion.claim_text % $2
              OR assertion.claim_text ILIKE '%' || $2 || '%'
              OR EXISTS (
                SELECT 1 FROM query_terms
                 WHERE char_length(term) >= 2
                   AND lower(assertion.claim_text) ILIKE '%' || term || '%'
              )
            )
       ), anchors AS (
         SELECT assertion_id, evidence_id, score
           FROM ranked WHERE score > 0
          ORDER BY score DESC, created_at DESC, assertion_id
          LIMIT $5
       ), related AS (
         SELECT CASE WHEN relation.left_assertion_id = anchor.assertion_id
                       THEN relation.right_assertion_id
                     ELSE relation.left_assertion_id END AS assertion_id,
                anchor.score
           FROM anchors AS anchor
           JOIN vp.current_relations AS relation
             ON relation.project_id = $1
            AND relation.relation_kind IN ('EQUIVALENT', 'CONTRADICTS')
            AND (relation.left_assertion_id = anchor.assertion_id
              OR relation.right_assertion_id = anchor.assertion_id)
       ), candidates AS (
         SELECT evidence_id::text, score + 1.0 AS score FROM anchors
         UNION ALL
         SELECT neighbor.evidence_id::text, related.score AS score
           FROM related
           JOIN vp.current_assertions AS neighbor
             ON neighbor.project_id = $1 AND neighbor.assertion_id = related.assertion_id
          WHERE neighbor.access_scope <@ $3::text[]
            AND neighbor.sensitivity = ANY($4::text[])
       )
       SELECT evidence_id FROM (
         SELECT DISTINCT ON (evidence_id) evidence_id, score
           FROM candidates ORDER BY evidence_id, score DESC
       ) AS unique_candidates
       ORDER BY score DESC, evidence_id LIMIT $6`,
      [
        input.projectId,
        input.question,
        input.accessScope,
        input.authorizedSensitivities,
        Math.min(limit, 8),
        limit,
      ],
    );
    return { ...snapshot, evidenceIds: result.rows.map((row) => row.evidence_id) };
  }

  async isSnapshotCurrent(input: {
    readonly projectId: string;
    readonly accessScope: readonly string[];
    readonly authorizedSensitivities: readonly ('public' | 'internal' | 'private' | 'restricted')[];
    readonly snapshot: AskKnowledgeSnapshot;
  }): Promise<boolean> {
    const current = await readSnapshot(this.pool, input);
    return (
      current.knowledgeEpoch === input.snapshot.knowledgeEpoch &&
      current.sourceWatermark === input.snapshot.sourceWatermark
    );
  }
}
