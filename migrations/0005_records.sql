-- 上課紀錄 lists a class's ended lessons newest first.
CREATE INDEX lessons_class_started ON lessons(class_id, status, started_at);
-- answers.status gains 'graded': a 簡答 the teacher scored (score 0..points).
