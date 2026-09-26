-- A later terminal abstention supersedes an older relation for the same pair.
-- History remains append-only; only the current projection is withdrawn.
CREATE OR REPLACE VIEW vp.current_relations AS
SELECT DISTINCT ON (relation.project_id, relation.left_assertion_id,
                    relation.right_assertion_id)
       relation.*
  FROM vp.relations AS relation
  JOIN vp.current_assertions AS left_assertion
    ON left_assertion.project_id = relation.project_id
   AND left_assertion.assertion_id = relation.left_assertion_id
  JOIN vp.current_assertions AS right_assertion
    ON right_assertion.project_id = relation.project_id
   AND right_assertion.assertion_id = relation.right_assertion_id
  JOIN vp.decision_receipts AS decision
    ON decision.project_id = relation.project_id
   AND decision.decision_id = relation.decision_id
 WHERE NOT EXISTS (
   SELECT 1 FROM vp.relation_jobs AS unresolved
    WHERE unresolved.project_id = relation.project_id
      AND unresolved.left_assertion_id = relation.left_assertion_id
      AND unresolved.right_assertion_id = relation.right_assertion_id
      AND unresolved.status = 'COMPLETED'
      AND unresolved.last_failure_code IN
        ('INSUFFICIENT_EVIDENCE', 'QUALIFIER_NOT_MODELED')
      AND unresolved.updated_at >= decision.created_at
 )
 ORDER BY relation.project_id, relation.left_assertion_id,
          relation.right_assertion_id, decision.created_at DESC,
          relation.relation_id DESC;
