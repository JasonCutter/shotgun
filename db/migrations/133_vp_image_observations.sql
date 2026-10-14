-- Typed generated observations belong to the existing VP Ledger owner.
-- They are neither source Evidence nor direct-source assertions or Fact.
CREATE UNIQUE INDEX transformation_image_revision_lineage_unique
  ON transformation.revisions(project_id, source_id, source_version_id, revision_id);
CREATE TABLE vp.image_observations (
  observation_id uuid PRIMARY KEY,
  project_id text NOT NULL REFERENCES project_admin.projects(id),
  source_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  original_asset_id uuid NOT NULL,
  transformation_revision_id uuid NOT NULL,
  call_id uuid NOT NULL UNIQUE,
  attempt_id uuid NOT NULL,
  source_content_hash text NOT NULL CHECK (source_content_hash ~ '^sha256:[a-f0-9]{64}$'),
  observation_text text NOT NULL CHECK (length(btrim(observation_text)) BETWEEN 1 AND 128000),
  epistemic_status text NOT NULL CHECK (epistemic_status = 'GENERATED_UNVERIFIED'),
  access_scope text[] NOT NULL CHECK (cardinality(access_scope) BETWEEN 1 AND 64),
  sensitivity text NOT NULL CHECK (sensitivity IN ('public','internal','private','restricted')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL,
  UNIQUE(project_id, observation_id),
  FOREIGN KEY (project_id, source_id) REFERENCES asset.sources(project_id, source_id),
  FOREIGN KEY (source_id, source_version_id) REFERENCES asset.source_versions(source_id, source_version_id),
  FOREIGN KEY (original_asset_id, source_version_id) REFERENCES asset.source_versions(original_asset_id, source_version_id),
  FOREIGN KEY (project_id,source_id,source_version_id,transformation_revision_id)
    REFERENCES transformation.revisions(project_id,source_id,source_version_id,revision_id),
  CHECK ((payload->>'schemaVersion' = 'vp-image-observation/1.0.0'
    AND payload->>'epistemicStatus' = epistemic_status
    AND payload->>'observationId' = observation_id::text
    AND payload->>'projectId' = project_id
    AND payload->>'sourceId' = source_id::text
    AND payload->>'sourceVersionId' = source_version_id::text
    AND payload->>'originalAssetId' = original_asset_id::text
    AND payload->>'sourceContentHash' = source_content_hash
    AND payload->>'text' = observation_text
    AND payload->>'sensitivity' = sensitivity
    AND payload->'accessScope' = to_jsonb(access_scope)
    AND (payload->>'createdAt')::timestamptz = created_at
    AND payload#>>'{derivation,transformationRevisionId}' = transformation_revision_id::text
    AND payload#>>'{derivation,callId}' = call_id::text
    AND payload#>>'{derivation,attemptId}' = attempt_id::text) IS TRUE)
);
CREATE INDEX vp_image_observations_source ON vp.image_observations(project_id,source_version_id,observation_id);
CREATE INDEX vp_image_observations_text ON vp.image_observations USING gin(to_tsvector('simple',observation_text));
GRANT SELECT,INSERT ON vp.image_observations TO shotgun_runtime;
GRANT SELECT,DELETE ON vp.image_observations TO shotgun_schema_owner;
CREATE TRIGGER vp_image_observations_append_only BEFORE UPDATE OR DELETE ON vp.image_observations
  FOR EACH ROW EXECUTE FUNCTION vp.reject_ledger_mutation();
CREATE TRIGGER vp_image_observations_no_truncate BEFORE TRUNCATE ON vp.image_observations
  FOR EACH STATEMENT EXECUTE FUNCTION vp.reject_ledger_truncate();
CREATE TRIGGER vp_image_observations_write_fence BEFORE INSERT OR UPDATE ON vp.image_observations
  FOR EACH ROW EXECUTE FUNCTION project_admin.t3_guard_project_knowledge_write();
