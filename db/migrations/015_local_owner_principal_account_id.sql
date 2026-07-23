-- Add account_id to principals so credential-less Local Owner principals
-- can be reliably identified without joining through auth.credentials.
ALTER TABLE auth.principals ADD COLUMN account_id text;

-- Backfill from existing credentials where available
UPDATE auth.principals p
SET account_id = c.account_id
FROM auth.credentials c
WHERE c.principal_id = p.principal_id
  AND c.disabled_at IS NULL;

-- account_id must be unique when set (multiple principals may have NULL)
CREATE UNIQUE INDEX auth_principals_account_id_unique_idx
  ON auth.principals (account_id) WHERE account_id IS NOT NULL;
