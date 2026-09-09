-- ADR-130 additive amendment for Issue #245.
-- Comparison is a read-only federated Activity adapter; it owns no Activity
-- command authority and does not alter the existing Domain semantics.

ALTER TABLE frontend_activity.activity_index
  DROP CONSTRAINT IF EXISTS activity_index_domain_kind_wp5_ck,
  DROP CONSTRAINT IF EXISTS activity_index_root_domain_wp5_ck;

ALTER TABLE frontend_activity.projection_watermarks
  DROP CONSTRAINT IF EXISTS projection_watermarks_domain_kind_wp5_ck;

ALTER TABLE frontend_activity.activity_index
  ADD CONSTRAINT activity_index_domain_kind_wp6_ck
  CHECK (domain_kind IN ('SOURCES', 'ASK', 'EXTERNAL_ACTION', 'DISCOVERY', 'COMPARISON', 'CONNECTOR_DIAGNOSTICS'));

ALTER TABLE frontend_activity.activity_index
  ADD CONSTRAINT activity_index_root_domain_wp6_ck
  CHECK (
    (domain_kind = 'ASK' AND root_kind = 'RUN')
    OR (domain_kind IN ('SOURCES', 'EXTERNAL_ACTION', 'DISCOVERY', 'COMPARISON', 'CONNECTOR_DIAGNOSTICS')
        AND root_kind = 'JOB')
  );

ALTER TABLE frontend_activity.projection_watermarks
  ADD CONSTRAINT projection_watermarks_domain_kind_wp6_ck
  CHECK (domain_kind IN ('SOURCES', 'ASK', 'EXTERNAL_ACTION', 'DISCOVERY', 'COMPARISON', 'CONNECTOR_DIAGNOSTICS'));
