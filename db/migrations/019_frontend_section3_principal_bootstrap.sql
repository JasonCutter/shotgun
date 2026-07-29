-- Frontend Phase 1 Section 3 / ADR-116
-- Expand the Session and Frontend Command persistence boundary while retaining
-- every V1 row and V1 API meaning.

DO $$
BEGIN
  IF EXISTS (
    SELECT project_id
    FROM auth.project_memberships
    WHERE is_owner
      AND (expires_at IS NULL OR expires_at > now())
    GROUP BY project_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'ADR-116 preflight failed: a Project has multiple active Owner memberships';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM auth.sessions session
    LEFT JOIN auth.project_memberships membership
      ON membership.principal_id = session.principal_id
     AND membership.project_id = session.active_project_id
     AND (membership.expires_at IS NULL OR membership.expires_at > now())
    WHERE session.active_project_id IS NOT NULL
      AND session.revoked_at IS NULL
      AND membership.principal_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'ADR-116 preflight failed: an active Session has no matching Project membership';
  END IF;
END
$$;

ALTER TABLE auth.sessions
  ALTER COLUMN active_project_id DROP NOT NULL;

ALTER TABLE frontend_command.command_ledger
  ADD COLUMN envelope_version text,
  ADD COLUMN scope_kind text,
  ADD COLUMN active_project_id text,
  ADD COLUMN scope_binding_key text;

-- Keep an unmodified V1 writer operational throughout Expand and Compatibility.
-- The trigger derives only the new additive columns from the existing V1
-- authority fields; it never invents a Principal or Project identifier.
CREATE FUNCTION frontend_command.apply_v1_scope_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.envelope_version IS NULL THEN
    NEW.envelope_version := '1.0.0';
  END IF;

  IF NEW.envelope_version = '1.0.0' THEN
    IF NEW.scope_kind IS NULL THEN
      NEW.scope_kind := 'PROJECT';
    END IF;
    IF NEW.active_project_id IS NULL THEN
      NEW.active_project_id := NEW.target_project_id;
    END IF;
    IF NEW.scope_binding_key IS NULL THEN
      NEW.scope_binding_key := format(
        '{"envelopeVersion":"1.0.0","scope":"PROJECT","targetProjectId":%s}',
        to_json(NEW.target_project_id)::text
      );
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER frontend_command_ledger_v1_scope_defaults
BEFORE INSERT ON frontend_command.command_ledger
FOR EACH ROW
EXECUTE FUNCTION frontend_command.apply_v1_scope_defaults();

UPDATE frontend_command.command_ledger
SET envelope_version = '1.0.0',
    scope_kind = 'PROJECT',
    active_project_id = target_project_id,
    -- Match deterministicCanonicalizePayload exactly so V1 rows retain
    -- idempotency lookup semantics after the additive backfill.
    scope_binding_key = format(
      '{"envelopeVersion":"1.0.0","scope":"PROJECT","targetProjectId":%s}',
      to_json(target_project_id)::text
    )
WHERE envelope_version IS NULL;

ALTER TABLE frontend_command.command_ledger
  ALTER COLUMN envelope_version SET NOT NULL,
  ALTER COLUMN scope_kind SET NOT NULL,
  ALTER COLUMN scope_binding_key SET NOT NULL,
  ALTER COLUMN target_project_id DROP NOT NULL;

ALTER TABLE frontend_command.command_ledger
  ADD CONSTRAINT frontend_command_envelope_version_check
    CHECK (envelope_version IN ('1.0.0', '2.0.0')),
  ADD CONSTRAINT frontend_command_scope_kind_check
    CHECK (scope_kind IN ('PRINCIPAL', 'PROJECT', 'RESOURCE')),
  ADD CONSTRAINT frontend_command_scope_shape_check
    CHECK (
      (
        envelope_version = '1.0.0'
        AND scope_kind = 'PROJECT'
        AND active_project_id IS NOT NULL
        AND target_project_id IS NOT NULL
      )
      OR
      (
        envelope_version = '2.0.0'
        AND (
          (
            scope_kind = 'PRINCIPAL'
            AND active_project_id IS NULL
            AND target_project_id IS NULL
            AND resource_project_id IS NULL
          )
          OR
          (
            scope_kind = 'PROJECT'
            AND active_project_id IS NOT NULL
            AND target_project_id IS NOT NULL
            AND resource_project_id IS NULL
          )
          OR
          (
            scope_kind = 'RESOURCE'
            AND active_project_id IS NOT NULL
            AND target_project_id IS NOT NULL
            AND resource_project_id IS NOT NULL
          )
        )
      )
    );

CREATE UNIQUE INDEX frontend_command_ledger_v2_idempotency_idx
ON frontend_command.command_ledger (
  principal_id,
  envelope_version,
  scope_kind,
  scope_binding_key,
  command_type,
  command_schema_version,
  idempotency_key
);

CREATE INDEX frontend_command_ledger_scope_lookup_idx
ON frontend_command.command_ledger (
  principal_id,
  envelope_version,
  scope_kind,
  scope_binding_key,
  command_type
);

DO $$
BEGIN
  IF to_regclass('auth.auth_single_owner_per_project_idx') IS NULL
     AND to_regclass('auth.auth_project_single_active_owner_idx') IS NOT NULL THEN
    ALTER INDEX auth.auth_project_single_active_owner_idx
      RENAME TO auth_single_owner_per_project_idx;
  ELSIF to_regclass('auth.auth_single_owner_per_project_idx') IS NULL THEN
    CREATE UNIQUE INDEX auth_single_owner_per_project_idx
      ON auth.project_memberships (project_id)
      WHERE is_owner;
  END IF;
END
$$;
