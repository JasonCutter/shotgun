-- Isolated rehearsal only. Stop ALL linked VP/Surfer egress and archive provider_account first.
-- Removing this enforcement while writers run would remove their shared call ceiling.
DROP TRIGGER provider_account_legacy_link ON provider_account.legacy_links;
DROP TRIGGER provider_account_legacy_claim ON vp_global_budget.claims;
DROP TRIGGER provider_account_legacy_usage ON vp_global_budget.daily_usage;
DROP TRIGGER provider_account_legacy_lock ON vp_global_budget.daily_usage;
DROP SCHEMA provider_account CASCADE;
