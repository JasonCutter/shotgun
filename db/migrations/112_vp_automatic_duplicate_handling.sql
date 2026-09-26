-- Persist the submission's duplicate policy so retries keep the original
-- deterministic VP behavior after a worker restart.
ALTER TABLE source_product.intake_submissions
  ADD COLUMN duplicate_handling text NOT NULL DEFAULT 'MANUAL'
  CHECK (duplicate_handling IN ('MANUAL', 'AUTOMATIC'));
