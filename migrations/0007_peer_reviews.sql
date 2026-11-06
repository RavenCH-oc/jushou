-- 互評: who reviews whose 簡答 answer, made when the teacher presses 開始互評
-- (src/shared/peer-review.ts). lesson_questions.status gains 'reviewing'.
-- Each student reviews at most one and is reviewed at most once per question.
CREATE TABLE peer_reviews (
  lesson_question_id TEXT NOT NULL REFERENCES lesson_questions(id) ON DELETE CASCADE,
  reviewer_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  reviewee_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  score INTEGER, -- 1..5; NULL until sent (or after the teacher deletes it)
  comment TEXT,
  submitted_at TEXT, -- kept when deleted, so it still counts as 已完成
  deleted INTEGER NOT NULL DEFAULT 0, -- the teacher removed an unkind comment
  PRIMARY KEY (lesson_question_id, reviewer_id),
  UNIQUE (lesson_question_id, reviewee_id)
);
CREATE INDEX peer_reviews_reviewer ON peer_reviews(reviewer_id);
CREATE INDEX peer_reviews_reviewee ON peer_reviews(reviewee_id);
