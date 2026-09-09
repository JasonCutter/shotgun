-- Issue #247 C15: align the PostgreSQL Review materialization contract with
-- the already-authoritative Comparison V2 Review target kinds.
--
-- Migration 027 predates Comparison V2 and used PostgreSQL-generated CHECK
-- constraint names.  Resolve those names from the catalog so this forward
-- migration remains safe when a compatible database was restored with a
-- different generated name.  The historical migration is intentionally not
-- edited.

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname
    INTO constraint_name
  FROM pg_constraint AS con
  WHERE con.conrelid = 'frontend_review.context_revision'::regclass
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%target_kind%'
    AND pg_get_constraintdef(con.oid) LIKE '%KNOWLEDGE_DRAFT_CHANGE_SET%'
    AND pg_get_constraintdef(con.oid) NOT LIKE '%COMPARISON_V2_CHANGE_SET%'
  ORDER BY con.oid
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE frontend_review.context_revision DROP CONSTRAINT %I',
      constraint_name
    );
  END IF;
END
$$;

ALTER TABLE frontend_review.context_revision
  ADD CONSTRAINT frontend_review_context_revision_target_kind_v2_ck
  CHECK (
    target_kind IN (
      'KNOWLEDGE_DRAFT_CHANGE_SET',
      'DISCOVERY_CANDIDATE',
      'USER_DIRECTIVE_PROPOSAL',
      'COMPARISON_V2_CHANGE_SET'
    )
  );

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname
    INTO constraint_name
  FROM pg_constraint AS con
  WHERE con.conrelid = 'frontend_review.item'::regclass
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%source_item_kind%'
    AND pg_get_constraintdef(con.oid) LIKE '%KNOWLEDGE_OPERATION%'
    AND pg_get_constraintdef(con.oid) NOT LIKE '%COMPARISON_V2_CHANGE_SET%'
  ORDER BY con.oid
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE frontend_review.item DROP CONSTRAINT %I',
      constraint_name
    );
  END IF;
END
$$;

ALTER TABLE frontend_review.item
  ADD CONSTRAINT frontend_review_item_source_item_kind_v2_ck
  CHECK (
    source_item_kind IN (
      'KNOWLEDGE_OPERATION',
      'DISCOVERY_CANDIDATE',
      'USER_DIRECTIVE_CLAUSE',
      'COMPARISON_V2_CHANGE_SET',
      'COMPARISON_V2_OPERATION_RESOLUTION'
    )
  );
