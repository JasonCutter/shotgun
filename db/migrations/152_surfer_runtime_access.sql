-- Minimum runtime access; storage admin stage/route transitions stay unavailable to runtime.
GRANT USAGE ON SCHEMA surfer_knowledge,surfer_rows TO shotgun_runtime;
GRANT SELECT,INSERT,UPDATE ON surfer_knowledge.space_state,surfer_knowledge.source_binding_v2 TO shotgun_runtime;
GRANT SELECT,INSERT,UPDATE ON surfer_rows.space TO shotgun_runtime;
GRANT SELECT,INSERT ON surfer_rows.record,surfer_rows.source_capture,surfer_rows.source_binding TO shotgun_runtime;
GRANT SELECT ON surfer_rows.route TO shotgun_runtime;
