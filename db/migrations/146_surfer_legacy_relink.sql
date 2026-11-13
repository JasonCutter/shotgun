-- Durable import watermarks survive closeout/link removal. No quota or registration is issued.
CREATE TABLE provider_account.legacy_usage_watermarks (
  authority_id uuid NOT NULL REFERENCES vp_global_budget.policies(authority_id),
  root_id uuid NOT NULL REFERENCES provider_account.roots(root_id),
  budget_day date NOT NULL,
  accounted_calls bigint NOT NULL CHECK(accounted_calls>=0),
  PRIMARY KEY(authority_id,budget_day)
);
-- Existing active links were fully imported and maintained by migration 144's triggers.
INSERT INTO provider_account.legacy_usage_watermarks
  SELECT l.authority_id,l.root_id,u.budget_day,u.claimed_count
  FROM provider_account.legacy_links l JOIN vp_global_budget.daily_usage u USING(authority_id);

-- Admin-only recovery for a pre-watermark, already unlinked root. Never changes counters.
-- Only a single legacy authority with exactly reconcilable history can be adopted.
CREATE FUNCTION provider_account.adopt_legacy_accounting(aid uuid,rid uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r provider_account.roots%ROWTYPE; p vp_global_budget.policies%ROWTYPE;
BEGIN
  LOCK TABLE vp_global_budget.daily_usage,vp_global_budget.claims IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE provider_account.roots,provider_account.registrations,provider_account.legacy_links,
    provider_account.grants,provider_account.daily_calls,provider_account.legacy_usage_watermarks
    IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT r FROM provider_account.roots WHERE root_id=rid FOR NO KEY UPDATE;
  SELECT * INTO STRICT p FROM vp_global_budget.policies WHERE authority_id=aid;
  IF r.enabled OR EXISTS(SELECT 1 FROM provider_account.registrations WHERE root_id=rid AND enabled)
    OR EXISTS(SELECT 1 FROM provider_account.legacy_links WHERE root_id=rid OR authority_id=aid)
    OR EXISTS(SELECT 1 FROM provider_account.legacy_usage_watermarks WHERE root_id=rid OR authority_id=aid)
    OR EXISTS(SELECT 1 FROM vp_global_budget.claims WHERE authority_id=aid AND state='RESERVED')
    OR p.provider<>r.policy->>'provider' OR p.budget_timezone<>'UTC'
    OR NOT EXISTS(SELECT 1 FROM provider_account.credential_accounts c WHERE c.root_id=rid
       AND c.provider=p.provider AND c.credential_fingerprint=p.account_fingerprint)
  THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_RECONCILIATION_SCOPE'; END IF;
  IF EXISTS(
    WITH days AS (
      SELECT budget_day FROM provider_account.daily_calls WHERE root_id=rid UNION
      SELECT budget_day FROM provider_account.grants WHERE root_id=rid UNION
      SELECT budget_day FROM vp_global_budget.daily_usage WHERE authority_id=aid
    ) SELECT 1 FROM days d WHERE
      coalesce((SELECT calls FROM provider_account.daily_calls c WHERE c.root_id=rid AND c.budget_day=d.budget_day),0)
      <> (SELECT count(*) FROM provider_account.grants g WHERE g.root_id=rid AND g.budget_day=d.budget_day)
        + coalesce((SELECT claimed_count FROM vp_global_budget.daily_usage u WHERE u.authority_id=aid AND u.budget_day=d.budget_day),0)
  ) THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_RECONCILIATION_MISMATCH'; END IF;
  INSERT INTO provider_account.legacy_usage_watermarks
    SELECT aid,rid,budget_day,claimed_count FROM vp_global_budget.daily_usage WHERE authority_id=aid;
END $$;

CREATE OR REPLACE FUNCTION provider_account.link_legacy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r provider_account.roots%ROWTYPE; p vp_global_budget.policies%ROWTYPE; u record; previous bigint;
BEGIN
  LOCK TABLE vp_global_budget.daily_usage IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT r FROM provider_account.roots WHERE root_id=NEW.root_id FOR NO KEY UPDATE;
  SELECT * INTO STRICT p FROM vp_global_budget.policies WHERE authority_id=NEW.authority_id;
  IF p.provider<>r.policy->>'provider' OR p.budget_timezone<>'UTC' THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_LEGACY_PROFILE'; END IF;
  PERFORM provider_account.pin_credential(p.provider,p.account_fingerprint,NEW.root_id);
  IF EXISTS(SELECT 1 FROM provider_account.legacy_usage_watermarks WHERE authority_id=NEW.authority_id AND root_id<>NEW.root_id)
    THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_RELINK_ROOT'; END IF;
  -- Old unlinked imports cannot be guessed from a nonzero root counter.
  IF NOT EXISTS(SELECT 1 FROM provider_account.legacy_usage_watermarks WHERE authority_id=NEW.authority_id)
    AND EXISTS(SELECT 1 FROM provider_account.daily_calls c WHERE c.root_id=NEW.root_id AND c.calls<>
      (SELECT count(*) FROM provider_account.grants g WHERE g.root_id=c.root_id AND g.budget_day=c.budget_day)
       + coalesce((SELECT sum(w.accounted_calls) FROM provider_account.legacy_usage_watermarks w WHERE w.root_id=c.root_id AND w.budget_day=c.budget_day),0))
    THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_RECONCILIATION_REQUIRED'; END IF;
  FOR u IN SELECT budget_day,claimed_count FROM vp_global_budget.daily_usage WHERE authority_id=NEW.authority_id LOOP
    SELECT accounted_calls INTO previous FROM provider_account.legacy_usage_watermarks
      WHERE authority_id=NEW.authority_id AND budget_day=u.budget_day;
    previous:=coalesce(previous,0);
    IF u.claimed_count<previous THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_UNLINKED_REFUND_REQUIRES_REVIEW'; END IF;
    INSERT INTO provider_account.daily_calls(root_id,budget_day,calls) VALUES(NEW.root_id,u.budget_day,u.claimed_count-previous)
      ON CONFLICT(root_id,budget_day) DO UPDATE SET calls=provider_account.daily_calls.calls+excluded.calls;
    INSERT INTO provider_account.legacy_usage_watermarks VALUES(NEW.authority_id,NEW.root_id,u.budget_day,u.claimed_count)
      ON CONFLICT(authority_id,budget_day) DO UPDATE SET accounted_calls=excluded.accounted_calls;
  END LOOP;
  INSERT INTO provider_account.legacy_releases(claim_id,root_id)
    SELECT claim_id,NEW.root_id FROM vp_global_budget.claims WHERE authority_id=NEW.authority_id AND state='RELEASED'
    ON CONFLICT(claim_id) DO NOTHING;
  RETURN NEW;
END $$;

-- Wrap the existing fully fenced delta handler; update watermark in the same transaction.
ALTER FUNCTION provider_account.legacy_usage_changed() RENAME TO legacy_usage_changed_v144;
-- Triggers reference the function OID, so explicitly replace the old trigger.
DROP TRIGGER provider_account_legacy_usage ON vp_global_budget.daily_usage;
CREATE FUNCTION provider_account.legacy_usage_watermark_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE rid uuid;
BEGIN
  SELECT root_id INTO rid FROM provider_account.legacy_links WHERE authority_id=NEW.authority_id;
  IF rid IS NOT NULL THEN
    INSERT INTO provider_account.legacy_usage_watermarks VALUES(NEW.authority_id,rid,NEW.budget_day,NEW.claimed_count)
      ON CONFLICT(authority_id,budget_day) DO UPDATE SET accounted_calls=excluded.accounted_calls;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER provider_account_legacy_usage AFTER INSERT OR UPDATE OR DELETE ON vp_global_budget.daily_usage
  FOR EACH ROW EXECUTE FUNCTION provider_account.legacy_usage_changed_v144();
CREATE TRIGGER provider_account_legacy_usage_z_watermark AFTER INSERT OR UPDATE ON vp_global_budget.daily_usage
  FOR EACH ROW EXECUTE FUNCTION provider_account.legacy_usage_watermark_changed();
REVOKE ALL ON provider_account.legacy_usage_watermarks FROM PUBLIC,shotgun_runtime;
REVOKE ALL ON FUNCTION provider_account.adopt_legacy_accounting(uuid,uuid),
  provider_account.legacy_usage_watermark_changed() FROM PUBLIC,shotgun_runtime;
