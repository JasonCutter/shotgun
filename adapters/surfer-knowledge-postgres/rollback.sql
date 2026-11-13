-- Isolated rehearsal / explicit owner removal only; destroys Surfer owner payloads.
-- Do not run against production as part of normal startup.
DROP TABLE surfer_knowledge.space_state;
DROP SCHEMA surfer_knowledge RESTRICT;
