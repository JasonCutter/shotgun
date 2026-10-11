-- OPERATOR APPROVAL REQUIRED. Run only on the existing, verified dedicated
-- authority store, after all old relation runners are stopped and RESERVED
-- claims reconciled. Never provision a new store/policy/account identity here.
-- Normal application startup does not execute this file.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'vp_global_budget' AND table_name = 'claims'
      AND column_name = 'execution_authorized_at')
    AND EXISTS (SELECT 1 FROM vp_global_budget.claims WHERE state = 'RESERVED') THEN
    RAISE EXCEPTION 'Reconcile existing RESERVED claims before installing the execution fence';
  END IF;
END $$;
ALTER TABLE vp_global_budget.claims
  ADD COLUMN IF NOT EXISTS execution_authorized_at timestamptz;
COMMIT;
