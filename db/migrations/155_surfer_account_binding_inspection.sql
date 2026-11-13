-- Read-only readiness is separate from the single-use authorize operation.
-- This function creates no root, registration, allowance, grant or usage row.
CREATE FUNCTION provider_account.binding_current(
 rid uuid, store uuid, expected_policy jsonb, expected_policy_digest text,
 registration uuid, expected_profile jsonb, expected_profile_digest text,
 expected_identity_digest text, project text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r provider_account.roots%ROWTYPE; reg provider_account.registrations%ROWTYPE;
BEGIN
 SELECT * INTO r FROM provider_account.roots WHERE root_id=rid AND store_id=store;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO reg FROM provider_account.registrations WHERE registration_id=registration AND root_id=rid;
 IF NOT FOUND THEN RETURN false; END IF;
 RETURN coalesce(
   r.enabled AND reg.enabled
   AND r.policy=expected_policy AND r.policy_digest=expected_policy_digest
   AND reg.profile=expected_profile AND reg.profile_digest=expected_profile_digest
   AND reg.identity_digest=expected_identity_digest
   AND reg.runtime_role::text=provider_account.caller_role()
   AND clock_timestamp()<reg.expires_at
   AND extract(epoch FROM clock_timestamp())*1000<(r.policy->>'expiresAtMs')::numeric
   AND project=ANY(reg.project_ids)
   AND EXISTS(SELECT 1 FROM vp_global_budget.authority_store WHERE singleton AND store_id=store),false);
END $$;
REVOKE ALL ON FUNCTION provider_account.binding_current(uuid,uuid,jsonb,text,uuid,jsonb,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provider_account.binding_current(uuid,uuid,jsonb,text,uuid,jsonb,text,text,text) TO shotgun_runtime;
