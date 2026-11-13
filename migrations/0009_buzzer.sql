-- 搶答: one round at a time per lesson, no history kept.
-- buzz_round counts rounds (phones notice a new one), buzz_open = 1 while a round is on,
-- buzz_opens_at = when 「搶！」 opens (ms since epoch; server clock only).
ALTER TABLE lessons ADD COLUMN buzz_round INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lessons ADD COLUMN buzz_open INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lessons ADD COLUMN buzz_opens_at INTEGER;

-- Who pressed in the current round. seq only goes up, so the order is the order the
-- server got them (never by time, so no ties). Cleared when a new round starts or the lesson ends.
CREATE TABLE buzzes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  UNIQUE (lesson_id, student_id)
);
CREATE INDEX buzzes_student ON buzzes(student_id);
