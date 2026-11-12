-- 臨時出題: questions the teacher makes up during a lesson (no 題組 needed).
-- quick = 1 for those. scored = 0: doesn't count. Quick 選擇／是非 start at 0 and become 1
-- only when the teacher picks the correct answer at 公布 (「這題不計分」 or never revealed stays 0).
-- Older rows are regular questions that count.
ALTER TABLE lesson_questions ADD COLUMN quick INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lesson_questions ADD COLUMN scored INTEGER NOT NULL DEFAULT 1;
