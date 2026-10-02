-- Pin a finite retry ceiling to each semantic relation job.
DO $$
BEGIN
  IF to_regclass('vp.relation_jobs') IS NULL THEN
    RAISE EXCEPTION 'Migration 122 preflight failed: VP relation jobs are missing';
  END IF;
END
$$;

ALTER TABLE vp.relation_jobs
  ADD COLUMN max_attempts integer NOT NULL DEFAULT 3
    CHECK (max_attempts BETWEEN 1 AND 10),
  DROP CONSTRAINT relation_jobs_status_check,
  ADD CONSTRAINT relation_jobs_status_check
    CHECK (status IN ('PENDING', 'RUNNING', 'RETRYABLE', 'COMPLETED', 'SUPERSEDED', 'FAILED'));
