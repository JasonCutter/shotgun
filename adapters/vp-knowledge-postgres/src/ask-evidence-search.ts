import type { Pool } from 'pg';

import type { AskKnowledgeEvidenceSearchPort } from '../../../modules/frontend-ask-execution/src/index.js';

/** VP assertions select an authorized shortlist; Ask validates Source/Evidence again. */
export class PostgresVPAskEvidenceSearch implements AskKnowledgeEvidenceSearchPort {
  constructor(private readonly pool: Pool) {}

  async search(
    input: Parameters<AskKnowledgeEvidenceSearchPort['search']>[0],
  ): Promise<readonly string[]> {
    if (!input.projectId || !input.question.trim() || input.accessScope.length === 0) return [];
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
    return result.rows.map((row) => row.evidence_id);
  }
}
