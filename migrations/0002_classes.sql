CREATE TABLE classes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  join_code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE students (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  seat INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (class_id, seat)
);

-- A "grouping" is one set of groups for a class, e.g. 第一次報告分組.
CREATE TABLE groupings (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX groupings_class ON groupings(class_id);

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  grouping_id TEXT NOT NULL REFERENCES groupings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL
);
CREATE INDEX groups_grouping ON groups(grouping_id);

-- The primary key guarantees a student is in at most one group per grouping.
CREATE TABLE group_members (
  grouping_id TEXT NOT NULL REFERENCES groupings(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  PRIMARY KEY (grouping_id, student_id)
);
CREATE INDEX group_members_group ON group_members(group_id);
CREATE INDEX group_members_student ON group_members(student_id);
