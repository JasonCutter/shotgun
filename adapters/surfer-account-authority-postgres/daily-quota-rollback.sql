-- Operator-only rollback. Choose explicit finite policies before rollback; never reset counters/history.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM provider_account.roots WHERE policy->>'schemaVersion'='1.1.0')
    THEN RAISE EXCEPTION 'UNLIMITED_ROOTS_REQUIRE_EXPLICIT_BOUNDED_POLICY_BEFORE_ROLLBACK'; END IF;
END $$;
CREATE OR REPLACE FUNCTION provider_account.valid_root(v jsonb) RETURNS boolean
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

CREATE OR REPLACE FUNCTION provider_account.admit(rid uuid,day date,delta bigint) RETURNS void
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

CREATE OR REPLACE FUNCTION provider_account.authorize(
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
DROP FUNCTION provider_account.valid_bounded_root_v144(jsonb);
