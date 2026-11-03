-- A question set (題組) is not tied to a class, so it can be reused anywhere.
CREATE TABLE question_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- config holds the per-type answer settings as JSON (see src/shared/questions.ts).
CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  set_id TEXT NOT NULL REFERENCES question_sets(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  note TEXT NOT NULL,
  points INTEGER NOT NULL,
  config TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX questions_set ON questions(set_id, position);
