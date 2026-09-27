-- Keep every policy decision as history, while exposing one current relation
-- for each active assertion pair. A policy revision may reach the same choice.
DO $$
DECLARE
  old_constraint text;
BEGIN
  SELECT constraint_record.conname INTO old_constraint
    FROM pg_constraint AS constraint_record
   WHERE constraint_record.conrelid = 'vp.relations'::regclass
     AND constraint_record.contype = 'u'
     AND pg_get_constraintdef(constraint_record.oid) LIKE
       '%project_id, left_assertion_id, right_assertion_id, relation_kind%';
  IF old_constraint IS NULL THEN
    RAISE EXCEPTION 'Expected VP relation pair-kind uniqueness constraint is missing';
  END IF;
  EXECUTE format('ALTER TABLE vp.relations DROP CONSTRAINT %I', old_constraint);
END
$$;

ALTER TABLE vp.relations
  ADD CONSTRAINT vp_relations_pair_decision_unique
  UNIQUE (project_id, left_assertion_id, right_assertion_id, decision_id);

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
 ORDER BY relation.project_id, relation.left_assertion_id,
          relation.right_assertion_id, decision.created_at DESC,
          relation.relation_id DESC;
