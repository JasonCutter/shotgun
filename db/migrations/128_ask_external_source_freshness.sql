ALTER TABLE frontend_ask.citations
  ADD COLUMN external_source_last_checked_at timestamptz,
  ADD COLUMN external_source_freshness_expires_at timestamptz,
  ADD COLUMN external_source_freshness_state text;

ALTER TABLE frontend_ask.citations
  ADD CONSTRAINT frontend_ask_citations_external_freshness_check CHECK (
    (
      external_source_last_checked_at IS NULL
      AND external_source_freshness_expires_at IS NULL
      AND external_source_freshness_state IS NULL
    )
    OR
    (
      external_source_last_checked_at IS NOT NULL
      AND external_source_freshness_expires_at IS NOT NULL
      AND external_source_freshness_state IN ('CURRENT', 'EXPIRED')
      AND external_source_freshness_expires_at > external_source_last_checked_at
    )
  );

ALTER TABLE frontend_ask.answer_attempt_evidence
  ADD COLUMN external_source_last_checked_at timestamptz,
  ADD COLUMN external_source_freshness_expires_at timestamptz,
  ADD COLUMN external_source_freshness_state text;

ALTER TABLE frontend_ask.answer_attempt_evidence
  ADD CONSTRAINT frontend_ask_answer_attempt_evidence_external_freshness_check CHECK (
    (
      external_source_last_checked_at IS NULL
      AND external_source_freshness_expires_at IS NULL
      AND external_source_freshness_state IS NULL
    )
    OR
    (
      external_source_last_checked_at IS NOT NULL
      AND external_source_freshness_expires_at IS NOT NULL
      AND external_source_freshness_state IN ('CURRENT', 'EXPIRED')
      AND external_source_freshness_expires_at > external_source_last_checked_at
    )
  );
