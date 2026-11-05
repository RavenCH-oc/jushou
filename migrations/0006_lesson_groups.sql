-- 依分組看 shows the groups as they were when the lesson ended, not as they are now.
-- Filled when a lesson ends (POST /lessons/:id/end). grouping_id has no foreign key
-- on purpose: deleting or changing a grouping later must not touch old records.
CREATE TABLE lesson_groups (
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  grouping_id TEXT NOT NULL,
  grouping_name TEXT NOT NULL,
  grouping_created_at TEXT NOT NULL, -- keeps the groupings in the order the class page shows
  group_name TEXT NOT NULL,
  group_position INTEGER NOT NULL,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  PRIMARY KEY (lesson_id, grouping_id, student_id)
);
CREATE INDEX lesson_groups_student ON lesson_groups(student_id);

-- 1 once the snapshot above was taken. Lessons that ended before this migration stay 0
-- and the record page falls back to the class's current groups.
ALTER TABLE lessons ADD COLUMN groups_saved INTEGER NOT NULL DEFAULT 0;
