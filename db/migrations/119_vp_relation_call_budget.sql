-- Count claimed provider attempts before egress. A crash consumes its slot,
-- which keeps the spending ceiling conservative under uncertain outcomes.
CREATE TABLE vp.relation_call_budget (
  budget_day date PRIMARY KEY,
  claimed_count integer NOT NULL DEFAULT 0 CHECK (claimed_count >= 0)
);

GRANT SELECT, INSERT, UPDATE ON vp.relation_call_budget TO shotgun_runtime;
