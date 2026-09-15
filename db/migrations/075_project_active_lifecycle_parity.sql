-- RUS-2-C2: repair the legacy Project lifecycle parity gap introduced by the
-- original active=false default. This migration is deterministic and
-- repeat-safe: it changes only the active projection for known lifecycle
-- statuses, never revision, timestamps, memberships, or Project history.

UPDATE project_admin.projects
SET active = CASE status
  WHEN 'ACTIVE' THEN true
  WHEN 'ARCHIVED' THEN false
  WHEN 'DELETE_REQUESTED' THEN false
  ELSE active
END
WHERE status IN ('ACTIVE', 'ARCHIVED', 'DELETE_REQUESTED')
  AND active IS DISTINCT FROM CASE status
    WHEN 'ACTIVE' THEN true
    WHEN 'ARCHIVED' THEN false
    WHEN 'DELETE_REQUESTED' THEN false
    ELSE active
  END;
