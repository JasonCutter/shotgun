-- Pin VP knowledge authority and accessible SourceVersion watermark per Ask attempt.
DO $$
BEGIN
  IF to_regclass('frontend_ask.answer_run_attempts') IS NULL
     OR to_regclass('vp.project_epochs') IS NULL THEN
    RAISE EXCEPTION 'Migration 121 preflight failed: Ask attempts or VP epochs are missing';
  END IF;
END
$$;

ALTER TABLE frontend_ask.answer_run_attempts
  ADD COLUMN vp_knowledge_epoch text,
  ADD COLUMN vp_source_watermark text,
  ADD CONSTRAINT frontend_ask_answer_attempt_vp_snapshot_shape_check CHECK (
    (vp_knowledge_epoch IS NULL AND vp_source_watermark IS NULL)
    OR (
      vp_knowledge_epoch ~ '^(0|[1-9][0-9]*)$'
      AND vp_source_watermark ~ '^sha256:[a-f0-9]{64}$'
    )
  );

CREATE OR REPLACE FUNCTION frontend_ask.reject_answer_attempt_execution_identity_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.provider_id IS NOT NULL AND (
    OLD.provider_id IS DISTINCT FROM NEW.provider_id
    OR OLD.model_id IS DISTINCT FROM NEW.model_id
    OR OLD.ai_configuration_revision IS DISTINCT FROM NEW.ai_configuration_revision
    OR OLD.credential_id IS DISTINCT FROM NEW.credential_id
    OR OLD.credential_revision IS DISTINCT FROM NEW.credential_revision
    OR OLD.initial_provider_policy_fingerprint IS DISTINCT FROM NEW.initial_provider_policy_fingerprint
    OR OLD.ai_execution_pin_created_at IS DISTINCT FROM NEW.ai_execution_pin_created_at
  ) THEN
    RAISE EXCEPTION 'AnswerRun attempt AI execution identity is immutable';
  END IF;
  IF OLD.vp_knowledge_epoch IS NOT NULL AND (
    OLD.vp_knowledge_epoch IS DISTINCT FROM NEW.vp_knowledge_epoch
    OR OLD.vp_source_watermark IS DISTINCT FROM NEW.vp_source_watermark
  ) THEN
    RAISE EXCEPTION 'AnswerRun attempt VP knowledge snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$;
