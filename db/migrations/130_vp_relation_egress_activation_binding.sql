-- A local attempt is activated only by a durable provider-call receipt.
-- Nullable columns preserve historical receipts and explicit replay.
ALTER TABLE vp.relation_provider_calls
  ADD COLUMN global_claim_id uuid,
  ADD COLUMN semantic_attempt_id uuid,
  ADD CONSTRAINT vp_relation_provider_call_global_binding_complete CHECK (
    (global_claim_id IS NULL AND semantic_attempt_id IS NULL)
    OR (global_claim_id IS NOT NULL AND semantic_attempt_id IS NOT NULL)
  );

CREATE UNIQUE INDEX vp_relation_provider_call_global_claim_unique
  ON vp.relation_provider_calls (global_claim_id)
  WHERE global_claim_id IS NOT NULL;

CREATE UNIQUE INDEX vp_relation_provider_call_attempt_unique
  ON vp.relation_provider_calls (job_id, semantic_attempt_id)
  WHERE semantic_attempt_id IS NOT NULL;
