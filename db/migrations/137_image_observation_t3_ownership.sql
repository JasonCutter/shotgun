-- Add image derivatives to the existing VP/AI reset owners. Original source
-- Evidence and execution authority are unchanged; no independent reset owner.
GRANT SELECT, INSERT, UPDATE ON ai.image_observation_executions TO shotgun_runtime;
GRANT SELECT, DELETE ON ai.image_observation_executions TO shotgun_schema_owner;
CREATE TRIGGER image_observation_execution_write_fence
  BEFORE INSERT OR UPDATE ON ai.image_observation_executions
  FOR EACH ROW EXECUTE FUNCTION project_admin.t3_guard_project_knowledge_write();
CREATE TRIGGER image_observation_execution_delete_guard
  BEFORE DELETE ON ai.image_observation_executions
  FOR EACH ROW EXECUTE FUNCTION vp.reject_ledger_mutation();
CREATE TRIGGER image_observation_execution_no_truncate
  BEFORE TRUNCATE ON ai.image_observation_executions
  FOR EACH STATEMENT EXECUTE FUNCTION vp.reject_ledger_truncate();

-- Keep the previous owner routines intact and private. Wrappers add the
-- new table while retaining their exact maintenance authorization checks.
ALTER FUNCTION vp.t3_project_status(text, uuid) RENAME TO t3_project_status_before_image;
ALTER FUNCTION vp.t3_erase_project(text, uuid) RENAME TO t3_erase_project_before_image;
ALTER FUNCTION ai.t3_project_provider_status(text, uuid) RENAME TO t3_project_provider_status_before_image;
ALTER FUNCTION ai.t3_erase_project_provider_data(text, uuid) RENAME TO t3_erase_project_provider_data_before_image;
REVOKE ALL ON FUNCTION vp.t3_project_status_before_image(text, uuid),
  vp.t3_erase_project_before_image(text, uuid),
  ai.t3_project_provider_status_before_image(text, uuid),
  ai.t3_erase_project_provider_data_before_image(text, uuid)
  FROM PUBLIC, shotgun_erasure_executor;

CREATE FUNCTION vp.t3_project_status(target_project_id text, reset_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, vp AS $$
DECLARE status jsonb;
BEGIN
  status := vp.t3_project_status_before_image(target_project_id, reset_request_id);
  RETURN status || jsonb_build_object('image_observations',
    (SELECT count(*) FROM vp.image_observations WHERE project_id=target_project_id));
END $$;

CREATE FUNCTION vp.t3_erase_project(target_project_id text, reset_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, project_admin, vp, ai AS $$
DECLARE deleted_count bigint;
BEGIN
  -- Authorization and unfinished execution are checked before any deletion.
  PERFORM vp.t3_project_status_before_image(target_project_id, reset_request_id);
  IF EXISTS (SELECT 1 FROM ai.image_observation_executions
    WHERE project_id=target_project_id AND state NOT IN ('COMPLETED','OUTPUT_REJECTED')) THEN
    RAISE EXCEPTION 'Image provider work has not reached a terminal outcome'
      USING ERRCODE='55000', CONSTRAINT='active_job_outcome_unknown';
  END IF;
  PERFORM set_config('shotgun.t3_reset_request_id', reset_request_id::text, true);
  DELETE FROM vp.image_observations WHERE project_id=target_project_id;
  GET DIAGNOSTICS deleted_count=ROW_COUNT;
  RETURN vp.t3_erase_project_before_image(target_project_id, reset_request_id)
    || jsonb_build_object('image_observations',deleted_count);
END $$;

CREATE FUNCTION ai.t3_project_provider_status(target_project_id text, reset_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, ai, asset, transformation AS $$
DECLARE status jsonb; total_count bigint; active_count bigint; attempts bigint; outputs bigint; unresolved bigint;
BEGIN
  status := ai.t3_project_provider_status_before_image(target_project_id, reset_request_id);
  SELECT count(*),count(*) FILTER (WHERE state NOT IN ('COMPLETED','OUTPUT_REJECTED')),
    count(attempt_id),count(*) FILTER (WHERE output_json IS NOT NULL OR rejected_response_json IS NOT NULL)
    INTO total_count,active_count,attempts,outputs
    FROM ai.image_observation_executions WHERE project_id=target_project_id;
  SELECT count(*) INTO unresolved FROM ai.image_observation_executions AS execution
    LEFT JOIN asset.source_versions AS version ON version.source_version_id=execution.source_version_id
    LEFT JOIN asset.sources AS source ON source.source_id=version.source_id AND source.project_id=execution.project_id
    LEFT JOIN transformation.revisions AS revision ON revision.revision_id=execution.transformation_revision_id
      AND revision.project_id=execution.project_id AND revision.source_version_id=execution.source_version_id
    WHERE execution.project_id=target_project_id AND
      (source.source_id IS NULL OR (execution.state='COMPLETED' AND revision.revision_id IS NULL));
  RETURN status || jsonb_build_object(
    'providerCalls',(status->>'providerCalls')::bigint+total_count,
    'providerAttempts',(status->>'providerAttempts')::bigint+attempts,
    'providerOutputs',(status->>'providerOutputs')::bigint+outputs,
    'activeWork',(status->>'activeWork')::bigint+active_count,
    'unresolvedRecords',(status->>'unresolvedRecords')::bigint+unresolved,
    'derivedRecords',(status->>'derivedRecords')::bigint+total_count);
END $$;

CREATE FUNCTION ai.t3_erase_project_provider_data(target_project_id text, reset_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, project_admin, ai AS $$
DECLARE status jsonb; deleted jsonb; deleted_count bigint;
BEGIN
  status := ai.t3_project_provider_status(target_project_id, reset_request_id);
  IF (status->>'activeWork')::bigint > 0 THEN
    RAISE EXCEPTION 'Image provider work has not reached a terminal outcome'
      USING ERRCODE='55000', CONSTRAINT='active_job_outcome_unknown';
  END IF;
  IF (status->>'unresolvedRecords')::bigint > 0 THEN
    RAISE EXCEPTION 'Image provider records do not have exact Project Source lineage'
      USING ERRCODE='55000', CONSTRAINT='t3_ai_unclassified_content';
  END IF;
  PERFORM set_config('shotgun.t3_reset_request_id', reset_request_id::text, true);
  deleted := ai.t3_erase_project_provider_data_before_image(target_project_id, reset_request_id);
  DELETE FROM ai.image_observation_executions WHERE project_id=target_project_id;
  GET DIAGNOSTICS deleted_count=ROW_COUNT;
  RETURN deleted || jsonb_build_object('imageObservationExecutions',deleted_count);
END $$;

ALTER FUNCTION vp.t3_project_status(text,uuid) OWNER TO shotgun_schema_owner;
ALTER FUNCTION vp.t3_erase_project(text,uuid) OWNER TO shotgun_schema_owner;
ALTER FUNCTION ai.t3_project_provider_status(text,uuid) OWNER TO shotgun_schema_owner;
ALTER FUNCTION ai.t3_erase_project_provider_data(text,uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION vp.t3_project_status(text,uuid),vp.t3_erase_project(text,uuid),
  ai.t3_project_provider_status(text,uuid),ai.t3_erase_project_provider_data(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vp.t3_project_status(text,uuid),vp.t3_erase_project(text,uuid),
  ai.t3_project_provider_status(text,uuid),ai.t3_erase_project_provider_data(text,uuid) TO shotgun_erasure_executor;

-- Source progress carries the observation FK. It is erased before VP/AI,
-- but an unfinished or unknown call must block even a direct owner purge.
ALTER FUNCTION source_product.t3_source_product_status(text,uuid) RENAME TO t3_source_product_status_before_image;
ALTER FUNCTION source_product.t3_erase_project_source_product(text,uuid) RENAME TO t3_erase_project_source_product_before_image;
REVOKE ALL ON FUNCTION source_product.t3_source_product_status_before_image(text,uuid),
  source_product.t3_erase_project_source_product_before_image(text,uuid) FROM PUBLIC,shotgun_erasure_executor;
CREATE FUNCTION source_product.t3_source_product_status(target_project_id text,reset_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,source_product,ai AS $$
DECLARE status jsonb;
BEGIN
  status:=source_product.t3_source_product_status_before_image(target_project_id,reset_request_id);
  PERFORM ai.t3_project_provider_status(target_project_id,reset_request_id);
  RETURN status || jsonb_build_object('activeImageExecutions',
    (SELECT count(*) FROM ai.image_observation_executions WHERE project_id=target_project_id
      AND state NOT IN ('COMPLETED','OUTPUT_REJECTED')));
END $$;
CREATE FUNCTION source_product.t3_erase_project_source_product(target_project_id text,reset_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,source_product,ai AS $$
DECLARE status jsonb;
BEGIN
  status:=ai.t3_project_provider_status(target_project_id,reset_request_id);
  IF (status->>'activeWork')::bigint>0 THEN
    RAISE EXCEPTION 'Provider work has not reached a terminal outcome'
      USING ERRCODE='55000',CONSTRAINT='active_job_outcome_unknown';
  END IF;
  IF (status->>'unresolvedRecords')::bigint>0 THEN
    RAISE EXCEPTION 'Provider records do not have exact Project Source lineage'
      USING ERRCODE='55000',CONSTRAINT='t3_ai_unclassified_content';
  END IF;
  RETURN source_product.t3_erase_project_source_product_before_image(target_project_id,reset_request_id);
END $$;
ALTER FUNCTION source_product.t3_source_product_status(text,uuid) OWNER TO shotgun_schema_owner;
ALTER FUNCTION source_product.t3_erase_project_source_product(text,uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION source_product.t3_source_product_status(text,uuid),
  source_product.t3_erase_project_source_product(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION source_product.t3_source_product_status(text,uuid),
  source_product.t3_erase_project_source_product(text,uuid) TO shotgun_erasure_executor;
