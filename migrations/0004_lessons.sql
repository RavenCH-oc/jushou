-- SHA-256 of the random token a student's phone keeps; set when they pick
-- their seat and kept across lessons. NULL = no phone bound.
ALTER TABLE students ADD COLUMN device_hash TEXT;
CREATE INDEX students_device ON students(device_hash);

-- One lesson (上課) of one class with one question set.
-- set_name is a copy so the lesson still makes sense after the set is renamed or deleted.
CREATE TABLE lessons (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  set_name TEXT NOT NULL,
  status TEXT NOT NULL, -- active | ended
  current_question_id TEXT, -- the question students see now (NULL before the first one)
  started_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE INDEX lessons_class ON lessons(class_id);
-- Only one lesson can be in progress at a time.
CREATE UNIQUE INDEX lessons_one_active ON lessons(status) WHERE status = 'active';

-- Questions are copied in when the lesson starts, so editing the set later
-- changes nothing here. Same columns as `questions`, plus a status.
CREATE TABLE lesson_questions (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  note TEXT NOT NULL,
  points INTEGER NOT NULL,
  config TEXT NOT NULL,
  status TEXT NOT NULL -- pending | open | closed | revealed
);
CREATE INDEX lesson_questions_lesson ON lesson_questions(lesson_id, position);

-- Who has joined this lesson (opened it on their bound phone).
CREATE TABLE lesson_students (
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (lesson_id, student_id)
);

-- One row per student per question; answering again replaces it.
-- Graded by the server when submitted (see gradeAnswer in src/shared/grading.ts).
CREATE TABLE answers (
  lesson_question_id TEXT NOT NULL REFERENCES lesson_questions(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  answer TEXT NOT NULL, -- JSON
  status TEXT NOT NULL, -- correct | wrong | pending
  score INTEGER, -- NULL while pending (簡答)
  blanks TEXT, -- JSON boolean[] for fill questions
  submitted_at TEXT NOT NULL,
  PRIMARY KEY (lesson_question_id, student_id)
);
CREATE INDEX answers_student ON answers(student_id);
