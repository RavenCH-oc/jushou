-- Placeholder table to verify the migration flow. Real tables come in Phase 1.
CREATE TABLE app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO app_meta (key, value) VALUES ('schema_version', '1');
