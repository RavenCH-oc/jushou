-- 臨時出題: questions the teacher makes up during a lesson (no 題組 needed).
-- quick = 1 for those; scored = 0 when the teacher chose 「這題不計分」 at 公布.
-- Older rows are regular questions that count.
ALTER TABLE lesson_questions ADD COLUMN quick INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lesson_questions ADD COLUMN scored INTEGER NOT NULL DEFAULT 1;
