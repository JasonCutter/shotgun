-- Inactive until an operator provisions store/root/registration/link in the dedicated authority DB.
-- No authority identity, quota or production workload is issued by this migration.
CREATE SCHEMA provider_account;
CREATE TABLE provider_account.roots (
  root_id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES vp_global_budget.authority_store(store_id),
  policy jsonb NOT NULL CHECK (jsonb_typeof(policy)='object'),
  policy_digest text NOT NULL CHECK (policy_digest ~ '^sha256:[a-f0-9]{64}$'),
  enabled boolean NOT NULL DEFAULT false,
  CHECK (policy->>'rootId'=root_id::text AND policy->>'storeId'=store_id::text)
);
CREATE UNIQUE INDEX provider_account_scope_unique ON provider_account.roots((policy->>'provider'),(policy->>'accountScopeId'));
CREATE TABLE provider_account.registrations (
  registration_id uuid PRIMARY KEY,
  root_id uuid NOT NULL REFERENCES provider_account.roots(root_id),
  profile jsonb NOT NULL CHECK (jsonb_typeof(profile)='object'),
  profile_digest text NOT NULL CHECK (profile_digest ~ '^sha256:[a-f0-9]{64}$'),
  identity_digest text NOT NULL CHECK (identity_digest ~ '^sha256:[a-f0-9]{64}$'),
  project_ids text[] NOT NULL CHECK (cardinality(project_ids)>0),
  access_scopes text[] NOT NULL CHECK (cardinality(access_scopes)>0),
  runtime_role name NOT NULL,
  expires_at timestamptz NOT NULL,
  enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE provider_account.daily_calls (
  root_id uuid NOT NULL REFERENCES provider_account.roots(root_id),
  budget_day date NOT NULL,
  calls bigint NOT NULL CHECK (calls BETWEEN 0 AND 1000000000000),
  PRIMARY KEY(root_id,budget_day)
);
CREATE TABLE provider_account.grants (
  receipt_id uuid PRIMARY KEY,
  root_id uuid NOT NULL REFERENCES provider_account.roots(root_id),
  registration_id uuid NOT NULL REFERENCES provider_account.registrations(registration_id),
  operation_id text NOT NULL,
  reservation_id text NOT NULL,
  binding_digest text NOT NULL CHECK (binding_digest ~ '^sha256:[a-f0-9]{64}$'),
  binding jsonb NOT NULL,
  profile_snapshot jsonb NOT NULL,
  budget_day date NOT NULL,
  state text NOT NULL CHECK (state IN ('AUTHORIZED','SETTLED')),
  usage jsonb,
  usage_digest text,
  overage_resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  settled_at timestamptz,
  UNIQUE(root_id,reservation_id),
  CHECK ((state='AUTHORIZED' AND usage IS NULL AND usage_digest IS NULL)
    OR (state='SETTLED' AND usage IS NOT NULL AND usage_digest ~ '^sha256:[a-f0-9]{64}$'))
);
CREATE UNIQUE INDEX provider_account_unresolved_operation
  ON provider_account.grants(root_id,operation_id) WHERE state='AUTHORIZED';
CREATE INDEX provider_account_grants_day ON provider_account.grants(root_id,budget_day);
CREATE TABLE provider_account.legacy_links (
  authority_id uuid PRIMARY KEY REFERENCES vp_global_budget.policies(authority_id),
  root_id uuid NOT NULL REFERENCES provider_account.roots(root_id)
);
CREATE TABLE provider_account.credential_accounts (
  provider text NOT NULL,
  credential_fingerprint text NOT NULL CHECK (credential_fingerprint ~ '^[a-f0-9]{64}$'),
  root_id uuid NOT NULL REFERENCES provider_account.roots(root_id),
  PRIMARY KEY(provider,credential_fingerprint)
);
CREATE TABLE provider_account.legacy_releases (
  claim_id uuid PRIMARY KEY REFERENCES vp_global_budget.claims(claim_id),
  root_id uuid NOT NULL REFERENCES provider_account.roots(root_id)
);
-- A legacy claim must consume admission charged by its own transaction.
CREATE TABLE provider_account.legacy_admissions (
  authority_id uuid NOT NULL REFERENCES vp_global_budget.policies(authority_id),
  root_id uuid NOT NULL REFERENCES provider_account.roots(root_id),
  budget_day date NOT NULL,
  transaction_id bigint NOT NULL,
  credits bigint NOT NULL CHECK (credits>0),
  PRIMARY KEY(authority_id,budget_day,transaction_id)
);

CREATE FUNCTION provider_account.caller_role() RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog
AS $$ SELECT coalesce(nullif(current_setting('role'),'none'),session_user::text) $$;

CREATE FUNCTION provider_account.valid_usage(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE k text; x jsonb;
BEGIN
  IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(v))<>5 THEN RETURN false; END IF;
  FOR k,x IN SELECT key,value FROM jsonb_each(v) LOOP
    IF k NOT IN ('calls','inputTokens','outputTokens','moneyMicros','elapsedMs')
      OR jsonb_typeof(x) IS DISTINCT FROM 'number' OR x::text !~ '^[0-9]+$' THEN RETURN false; END IF;
    IF (x::text)::numeric>1000000000000 THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;

CREATE FUNCTION provider_account.valid_root(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE k text;
BEGIN
  IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(v))<>11 THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(v) x WHERE x NOT IN ('schemaVersion','rootId','storeId','provider','accountScopeId','mode','currency','revision','expiresAtMs','dailyCallLimit','surferDailyLimits')) THEN RETURN false; END IF;
  FOREACH k IN ARRAY ARRAY['schemaVersion','rootId','storeId','provider','accountScopeId','mode','currency','revision'] LOOP
    IF jsonb_typeof(v->k) IS DISTINCT FROM 'string' OR length(v->>k) NOT BETWEEN 1 AND 256 THEN RETURN false; END IF;
  END LOOP;
  IF v->>'schemaVersion'<>'1.0.0' OR v->>'provider'<>'deepseek' OR v->>'mode' NOT IN ('LIVE','ISOLATED_CONTRACT')
    OR v->>'currency' !~ '^[A-Z]{3}$' OR coalesce(v->>'expiresAtMs','') !~ '^[0-9]+$'
    OR coalesce(v->>'dailyCallLimit','') !~ '^[0-9]+$' THEN RETURN false; END IF;
  IF (v->>'expiresAtMs')::numeric NOT BETWEEN 1 AND 9007199254740991 OR (v->>'dailyCallLimit')::numeric NOT BETWEEN 1 AND 1000000
    OR NOT provider_account.valid_usage(v->'surferDailyLimits') THEN RETURN false; END IF;
  RETURN (v->'surferDailyLimits'->>'calls')::numeric<=(v->>'dailyCallLimit')::numeric;
END $$;
ALTER TABLE provider_account.roots ADD CHECK (provider_account.valid_root(policy));

CREATE FUNCTION provider_account.pin_credential(provider text,fingerprint text,rid uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
BEGIN
  INSERT INTO provider_account.credential_accounts VALUES(provider,fingerprint,rid) ON CONFLICT DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM provider_account.credential_accounts c WHERE c.provider=provider AND c.credential_fingerprint=fingerprint AND c.root_id=rid)
  THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_CREDENTIAL_ROOT_CONFLICT'; END IF;
END $$;
CREATE FUNCTION provider_account.register_credential() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r provider_account.roots%ROWTYPE;
BEGIN
  SELECT * INTO STRICT r FROM provider_account.roots WHERE root_id=NEW.root_id;
  IF NEW.profile->'identity'->>'providerId' IS DISTINCT FROM r.policy->>'provider'
     OR NEW.profile->>'authorityRef' IS DISTINCT FROM NEW.root_id::text THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_PROFILE_ROOT'; END IF;
  PERFORM provider_account.pin_credential(r.policy->>'provider',NEW.profile->>'accountFingerprint',NEW.root_id);
  RETURN NEW;
END $$;
CREATE TRIGGER provider_account_registration AFTER INSERT ON provider_account.registrations
  FOR EACH ROW EXECUTE FUNCTION provider_account.register_credential();

-- Called only while holding the root row lock. Unknown grants burn a call; Surfer has no refund API.
CREATE FUNCTION provider_account.admit(rid uuid,day date,delta bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r provider_account.roots%ROWTYPE; used bigint;
BEGIN
  SELECT * INTO STRICT r FROM provider_account.roots WHERE root_id=rid FOR NO KEY UPDATE;
  SELECT calls INTO used FROM provider_account.daily_calls WHERE root_id=rid AND budget_day=day;
  used:=coalesce(used,0);
  IF delta>0 AND (NOT r.enabled OR (r.policy->>'expiresAtMs')::numeric<=extract(epoch FROM clock_timestamp())*1000
       OR used+delta>(r.policy->>'dailyCallLimit')::bigint) THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_QUOTA_OR_POLICY'; END IF;
  INSERT INTO provider_account.daily_calls(root_id,budget_day,calls) VALUES(rid,day,used+delta)
    ON CONFLICT(root_id,budget_day) DO UPDATE SET calls=excluded.calls;
END $$;

-- Statement locks precede legacy usage row locks, including old writer versions.
CREATE FUNCTION provider_account.lock_legacy_roots() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE rid uuid;
BEGIN
  FOR rid IN SELECT r.root_id FROM provider_account.roots r
    WHERE EXISTS(SELECT 1 FROM provider_account.legacy_links l WHERE l.root_id=r.root_id)
    ORDER BY r.root_id FOR NO KEY UPDATE LOOP NULL; END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER provider_account_legacy_lock BEFORE INSERT OR UPDATE OR DELETE ON vp_global_budget.daily_usage
  FOR EACH STATEMENT EXECUTE FUNCTION provider_account.lock_legacy_roots();

CREATE FUNCTION provider_account.legacy_usage_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE rid uuid; delta bigint; released uuid;
BEGIN
  SELECT root_id INTO rid FROM provider_account.legacy_links WHERE authority_id=CASE WHEN TG_OP='DELETE' THEN OLD.authority_id ELSE NEW.authority_id END;
  IF rid IS NULL THEN RETURN NULL; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_HISTORY_PRESERVED'; END IF;
  IF TG_OP='UPDATE' AND (NEW.authority_id<>OLD.authority_id OR NEW.budget_day<>OLD.budget_day) THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_IDENTITY_CHANGED'; END IF;
  delta:=NEW.claimed_count-CASE WHEN TG_OP='INSERT' THEN 0 ELSE OLD.claimed_count END;
  IF delta<0 THEN
    IF delta<>-1 THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_UNPROVEN_REFUND'; END IF;
    SELECT c.claim_id INTO released FROM vp_global_budget.claims c
      WHERE c.authority_id=NEW.authority_id AND c.budget_day=NEW.budget_day AND c.state='RELEASED'
        AND c.execution_authorized_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM provider_account.legacy_releases x WHERE x.claim_id=c.claim_id)
      ORDER BY c.claimed_at,c.claim_id LIMIT 1;
    IF released IS NULL THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_UNPROVEN_REFUND'; END IF;
    INSERT INTO provider_account.legacy_releases(claim_id,root_id) VALUES(released,rid);
  END IF;
  IF delta<>0 THEN PERFORM provider_account.admit(rid,NEW.budget_day,delta); END IF;
  IF delta>0 THEN
    INSERT INTO provider_account.legacy_admissions(authority_id,root_id,budget_day,transaction_id,credits)
      VALUES(NEW.authority_id,rid,NEW.budget_day,txid_current(),delta)
      ON CONFLICT(authority_id,budget_day,transaction_id) DO UPDATE SET credits=provider_account.legacy_admissions.credits+excluded.credits;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER provider_account_legacy_usage AFTER INSERT OR UPDATE OR DELETE ON vp_global_budget.daily_usage
  FOR EACH ROW EXECUTE FUNCTION provider_account.legacy_usage_changed();

CREATE FUNCTION provider_account.guard_legacy_claim() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r provider_account.roots%ROWTYPE; credit bigint;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS(SELECT 1 FROM provider_account.legacy_links WHERE authority_id=NEW.authority_id) THEN RETURN NEW; END IF;
    IF NEW.state<>'RESERVED' OR NEW.execution_authorized_at IS NOT NULL THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_UNADMITTED_CLAIM'; END IF;
    SELECT credits INTO credit FROM provider_account.legacy_admissions
      WHERE authority_id=NEW.authority_id AND budget_day=NEW.budget_day AND transaction_id=txid_current() FOR UPDATE;
    IF credit IS NULL THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_UNADMITTED_CLAIM'; END IF;
    IF credit=1 THEN
      DELETE FROM provider_account.legacy_admissions WHERE authority_id=NEW.authority_id AND budget_day=NEW.budget_day AND transaction_id=txid_current();
    ELSE
      UPDATE provider_account.legacy_admissions SET credits=credits-1 WHERE authority_id=NEW.authority_id AND budget_day=NEW.budget_day AND transaction_id=txid_current();
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS(SELECT 1 FROM provider_account.legacy_links WHERE authority_id=OLD.authority_id) THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_HISTORY_PRESERVED'; END IF;
    IF NEW.authority_id<>OLD.authority_id OR NEW.claim_id<>OLD.claim_id OR NEW.budget_day<>OLD.budget_day
      OR (OLD.execution_authorized_at IS NOT NULL AND NEW.execution_authorized_at IS DISTINCT FROM OLD.execution_authorized_at)
      OR (OLD.state<>'RESERVED' AND NEW.state<>OLD.state)
      OR (NEW.state='RELEASED' AND (OLD.state NOT IN ('RESERVED','RELEASED') OR OLD.execution_authorized_at IS NOT NULL))
      OR (OLD.relation_job_id IS NOT NULL AND (NEW.relation_job_id IS DISTINCT FROM OLD.relation_job_id
        OR NEW.semantic_attempt_id IS DISTINCT FROM OLD.semantic_attempt_id OR NEW.execution_key IS DISTINCT FROM OLD.execution_key
        OR NEW.provider_identity IS DISTINCT FROM OLD.provider_identity OR NEW.project_id IS DISTINCT FROM OLD.project_id))
    THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_LEGACY_FENCE'; END IF;
    IF OLD.execution_authorized_at IS NULL AND NEW.execution_authorized_at IS NOT NULL THEN
      SELECT roots.* INTO STRICT r FROM provider_account.roots roots
        JOIN provider_account.legacy_links l ON l.root_id=roots.root_id
        WHERE l.authority_id=OLD.authority_id FOR NO KEY UPDATE OF roots;
      IF NOT r.enabled OR (r.policy->>'expiresAtMs')::numeric<=extract(epoch FROM clock_timestamp())*1000
        OR OLD.budget_day<>vp_global_budget.current_budget_day()
      THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_LEGACY_ACTIVATION_POLICY'; END IF;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER provider_account_legacy_claim BEFORE INSERT OR UPDATE OR DELETE ON vp_global_budget.claims
  FOR EACH ROW EXECUTE FUNCTION provider_account.guard_legacy_claim();

-- Provisioning requires a quiesced rollout. It imports existing counts without changing the VP ledger.
CREATE FUNCTION provider_account.link_legacy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r provider_account.roots%ROWTYPE; p vp_global_budget.policies%ROWTYPE;
BEGIN
  LOCK TABLE vp_global_budget.daily_usage IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT r FROM provider_account.roots WHERE root_id=NEW.root_id FOR NO KEY UPDATE;
  SELECT * INTO STRICT p FROM vp_global_budget.policies WHERE authority_id=NEW.authority_id;
  IF p.provider<>r.policy->>'provider' OR p.budget_timezone<>'UTC' THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_LEGACY_PROFILE'; END IF;
  PERFORM provider_account.pin_credential(p.provider,p.account_fingerprint,NEW.root_id);
  INSERT INTO provider_account.daily_calls(root_id,budget_day,calls)
    SELECT NEW.root_id,budget_day,claimed_count FROM vp_global_budget.daily_usage WHERE authority_id=NEW.authority_id
    ON CONFLICT(root_id,budget_day) DO UPDATE SET calls=provider_account.daily_calls.calls+excluded.calls;
  INSERT INTO provider_account.legacy_releases(claim_id,root_id)
    SELECT claim_id,NEW.root_id FROM vp_global_budget.claims WHERE authority_id=NEW.authority_id AND state='RELEASED';
  RETURN NEW;
END $$;
CREATE TRIGGER provider_account_legacy_link AFTER INSERT ON provider_account.legacy_links
  FOR EACH ROW EXECUTE FUNCTION provider_account.link_legacy();

CREATE FUNCTION provider_account.authorize(
  rid uuid, expected_policy jsonb, expected_policy_digest text, registration uuid,
  expected_profile jsonb, expected_profile_digest text, binding jsonb, binding_digest text, receipt uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE r provider_account.roots%ROWTYPE; reg provider_account.registrations%ROWTYPE;
  day date; k text; used numeric; keys integer; limits jsonb;
BEGIN
  SELECT * INTO STRICT r FROM provider_account.roots WHERE root_id=rid FOR NO KEY UPDATE;
  IF r.policy<>expected_policy OR r.policy_digest<>expected_policy_digest
    OR NOT EXISTS(SELECT 1 FROM vp_global_budget.authority_store WHERE singleton AND store_id=r.store_id)
  THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_STORE_OR_POLICY'; END IF;
  SELECT * INTO STRICT reg FROM provider_account.registrations WHERE registration_id=registration AND root_id=rid;
  IF NOT reg.enabled OR reg.expires_at<=clock_timestamp() OR reg.runtime_role::text<>provider_account.caller_role()
    OR reg.profile<>expected_profile OR reg.profile_digest<>expected_profile_digest
  THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_REGISTRATION'; END IF;
  SELECT count(*) INTO keys FROM jsonb_object_keys(binding);
  IF keys<>12 OR binding->>'workloadClass'<>'SURFER_COGNITION'
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(binding) k WHERE k NOT IN ('workloadClass','mode','operationId','reservationId','projectId','sourceVersionId','sensitivity','accessScope','identityDigest','profileDigest','inputDigest','maximum'))
    OR binding->>'mode' IS DISTINCT FROM reg.profile->>'mode' OR reg.profile->>'mode' IS DISTINCT FROM r.policy->>'mode'
    OR binding->>'profileDigest' IS DISTINCT FROM reg.profile_digest OR binding->>'identityDigest' IS DISTINCT FROM reg.identity_digest
    OR binding->'maximum' IS DISTINCT FROM reg.profile->'maximum'
    OR reg.profile->>'authorityRef' IS DISTINCT FROM rid::text OR reg.profile->>'currency' IS DISTINCT FROM r.policy->>'currency'
    OR reg.profile->'identity'->>'providerId' IS DISTINCT FROM r.policy->>'provider'
    OR NOT coalesce(binding->>'projectId'=ANY(reg.project_ids),false)
    OR coalesce(binding->>'sensitivity','') NOT IN ('public','internal','private')
    OR jsonb_typeof(binding->'accessScope') IS DISTINCT FROM 'array'
    OR jsonb_array_length(binding->'accessScope') NOT BETWEEN 1 AND 64
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(binding->'accessScope') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'string')
    OR (SELECT count(DISTINCT x) FROM jsonb_array_elements(binding->'accessScope') x)<>jsonb_array_length(binding->'accessScope')
    OR EXISTS(SELECT 1 FROM jsonb_each(binding) x WHERE x.key NOT IN ('maximum','accessScope') AND jsonb_typeof(x.value) IS DISTINCT FROM 'string')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(binding->'accessScope') x WHERE NOT x=ANY(reg.access_scopes))
    OR length(coalesce(binding->>'sourceVersionId','')) NOT BETWEEN 1 AND 256
    OR length(coalesce(binding->>'operationId','')) NOT BETWEEN 1 AND 256
    OR length(coalesce(binding->>'reservationId','')) NOT BETWEEN 1 AND 256
    OR coalesce(binding->>'inputDigest','') !~ '^sha256:[a-f0-9]{64}$'
    OR binding_digest !~ '^sha256:[a-f0-9]{64}$'
    OR NOT provider_account.valid_usage(binding->'maximum') OR (binding->'maximum'->>'calls')::bigint<>1
  THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_BINDING'; END IF;
  IF EXISTS(SELECT 1 FROM provider_account.grants WHERE root_id=rid
    AND (reservation_id=binding->>'reservationId' OR (operation_id=binding->>'operationId' AND state='AUTHORIZED')))
  THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_ALREADY_CONSUMED_OR_UNKNOWN'; END IF;
  IF EXISTS(SELECT 1 FROM provider_account.grants g,jsonb_each(g.usage) x
    WHERE g.root_id=rid AND NOT g.overage_resolved AND (x.value::text)::numeric>(g.binding->'maximum'->>x.key)::numeric)
  THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_OVERAGE'; END IF;
  day:=vp_global_budget.current_budget_day(); limits:=r.policy->'surferDailyLimits';
  IF NOT provider_account.valid_usage(limits) THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_LIMITS'; END IF;
  FOR k IN SELECT jsonb_object_keys(limits) LOOP
    SELECT coalesce(sum((coalesce(g.usage,g.binding->'maximum')->>k)::numeric),0) INTO used
      FROM provider_account.grants g WHERE g.root_id=rid AND g.budget_day=day;
    IF used+(binding->'maximum'->>k)::numeric>(limits->>k)::numeric THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_RESOURCE_QUOTA'; END IF;
  END LOOP;
  PERFORM provider_account.admit(rid,day,1);
  INSERT INTO provider_account.grants(receipt_id,root_id,registration_id,operation_id,reservation_id,binding_digest,binding,profile_snapshot,budget_day,state)
    VALUES(receipt,rid,registration,binding->>'operationId',binding->>'reservationId',binding_digest,binding,reg.profile,day,'AUTHORIZED');
  RETURN jsonb_build_object('workloadClass','SURFER_COGNITION','mode',reg.profile->>'mode','receiptId',receipt::text,'authorityRef',rid::text,'bindingDigest',binding_digest);
END $$;

CREATE FUNCTION provider_account.settle(rid uuid,store uuid,registration uuid,receipt uuid,binding jsonb,binding_digest text,usage jsonb,usage_digest text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE g provider_account.grants%ROWTYPE; reg provider_account.registrations%ROWTYPE; price numeric;
BEGIN
  PERFORM 1 FROM provider_account.roots r WHERE r.root_id=rid AND r.store_id=store
    AND EXISTS(SELECT 1 FROM vp_global_budget.authority_store s WHERE s.singleton AND s.store_id=store) FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_STORE'; END IF;
  SELECT * INTO STRICT reg FROM provider_account.registrations WHERE registration_id=registration AND root_id=rid;
  IF reg.runtime_role::text<>provider_account.caller_role() THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_ROLE'; END IF;
  SELECT * INTO STRICT g FROM provider_account.grants WHERE receipt_id=receipt AND root_id=rid AND registration_id=registration FOR UPDATE;
  IF g.binding<>binding OR g.binding_digest<>binding_digest OR NOT provider_account.valid_usage(usage)
    OR usage_digest !~ '^sha256:[a-f0-9]{64}$' OR (usage->>'calls')::bigint<>1
  THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_SETTLEMENT'; END IF;
  price:=ceil(((usage->>'inputTokens')::numeric*(g.profile_snapshot->>'inputMicrosPerMillion')::numeric
    +(usage->>'outputTokens')::numeric*(g.profile_snapshot->>'outputMicrosPerMillion')::numeric)/1000000);
  IF price<>(usage->>'moneyMicros')::numeric THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_PRICE'; END IF;
  IF g.state='SETTLED' THEN
    IF g.usage<>usage OR g.usage_digest<>usage_digest THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_SETTLEMENT_CHANGED'; END IF;
    RETURN;
  END IF;
  UPDATE provider_account.grants SET state='SETTLED',usage=settle.usage,usage_digest=settle.usage_digest,settled_at=clock_timestamp() WHERE receipt_id=receipt;
END $$;

CREATE FUNCTION provider_account.status(rid uuid,store uuid,registration uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r provider_account.roots%ROWTYPE; day date;
BEGIN
  SELECT * INTO STRICT r FROM provider_account.roots WHERE root_id=rid AND store_id=store;
  IF NOT EXISTS(SELECT 1 FROM vp_global_budget.authority_store WHERE singleton AND store_id=store)
    OR NOT EXISTS(SELECT 1 FROM provider_account.registrations WHERE registration_id=registration AND root_id=rid AND runtime_role::text=provider_account.caller_role())
  THEN RAISE EXCEPTION 'ACCOUNT_AUTHORITY_STATUS'; END IF;
  day:=vp_global_budget.current_budget_day();
  RETURN jsonb_build_object('rootId',rid::text,'storeId',store::text,'budgetDay',day::text,'calls',coalesce((SELECT calls FROM provider_account.daily_calls WHERE root_id=rid AND budget_day=day),0),
    'dailyCallLimit',r.policy->'dailyCallLimit','enabled',r.enabled,'pending', (SELECT count(*) FROM provider_account.grants WHERE root_id=rid AND state='AUTHORIZED'));
END $$;

REVOKE ALL ON SCHEMA provider_account FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA provider_account FROM PUBLIC,shotgun_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA provider_account FROM PUBLIC;
GRANT USAGE ON SCHEMA provider_account TO shotgun_runtime;
GRANT EXECUTE ON FUNCTION provider_account.authorize(uuid,jsonb,text,uuid,jsonb,text,jsonb,text,uuid),
  provider_account.settle(uuid,uuid,uuid,uuid,jsonb,text,jsonb,text),provider_account.status(uuid,uuid,uuid) TO shotgun_runtime;
