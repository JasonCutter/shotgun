-- A completed extraction batch is the current assertion authority for one
-- SourceVersion and transformation revision. Keep prior batches as history.
CREATE OR REPLACE VIEW vp.current_assertions AS
SELECT assertion.assertion_id, assertion.project_id, assertion.candidate_id,
       assertion.source_id, assertion.source_version_id, assertion.evidence_id,
       assertion.claim_text, assertion.origin, assertion.access_scope,
       assertion.sensitivity, assertion.created_at
  FROM vp.assertions AS assertion
  JOIN candidate.claim_candidates AS candidate
    ON candidate.candidate_id = assertion.candidate_id
   AND candidate.project_id = assertion.project_id
   AND candidate.source_version_id = assertion.source_version_id
  JOIN candidate.batches AS batch
    ON batch.batch_id = candidate.batch_id
   AND batch.project_id = candidate.project_id
   AND batch.source_version_id = candidate.source_version_id
  JOIN asset.source_versions AS version
    ON version.source_id = assertion.source_id
   AND version.source_version_id = assertion.source_version_id
  JOIN source_product.source_stage3_progress AS progress
    ON progress.project_id = assertion.project_id
   AND progress.source_version_id = assertion.source_version_id
   AND progress.state = 'STAGE3_COMPLETED'
  JOIN evidence.indexing_results AS indexing
    ON indexing.indexing_result_id = progress.indexing_result_id
   AND indexing.project_id = progress.project_id
   AND indexing.source_version_id = progress.source_version_id
   AND indexing.revision_id = batch.revision_id
 WHERE version.version_number = (
   SELECT max(latest.version_number)
     FROM asset.source_versions AS latest
    WHERE latest.source_id = assertion.source_id
 )
   AND batch.batch_id = (
     SELECT latest_batch.batch_id
       FROM candidate.batches AS latest_batch
      WHERE latest_batch.project_id = batch.project_id
        AND latest_batch.source_version_id = batch.source_version_id
        AND latest_batch.revision_id = batch.revision_id
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
           WHERE item.batch_id = latest_batch.batch_id
             AND (item.status = 'PENDING_VALIDATION'
               OR validation.validation_id IS NULL
               OR validation.status <> item.status
               OR (item.status = 'READY' AND materialized.assertion_id IS NULL))
        )
      ORDER BY latest_batch.created_at DESC, latest_batch.batch_id DESC
      LIMIT 1
   );
