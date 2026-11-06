// 上課紀錄 (teacher only): ended lessons, 簡答 grading, a student's history.
// Summaries across many lessons are added up in SQL so the Worker never reads
// every answer; one lesson's answers go to the browser as stored JSON text.
// Rules (出席, 有出的題目, 滿分, 總分): src/shared/records.ts.
import { Hono } from "hono";
import type { AppEnv } from "./env";
import type { LessonSummary, RecordAnswerRow, RecordDetail, RecordGrouping, RecordReview, StudentHistory } from "../shared/records";
import { toQuestion, type LessonQuestionRow } from "./lessons";
import { fail, readBody } from "./util";

const app = new Hono<AppEnv>();

const RECORD_GONE = "找不到這堂課的紀錄，可能已經被刪除。";

// Points only count for asked questions.
const ASKED = "q.status <> 'pending'";
// 出席: joined, or sent any answer in the lesson. So every answer row counts toward
// the scores, even from a student unbound mid-lesson who never came back.
const attended = (lesson: string, student: string) =>
  `(EXISTS (SELECT 1 FROM lesson_students ls WHERE ls.lesson_id = ${lesson} AND ls.student_id = ${student})
    OR EXISTS (SELECT 1 FROM answers pa JOIN lesson_questions pq ON pq.id = pa.lesson_question_id
               WHERE pq.lesson_id = ${lesson} AND pa.student_id = ${student}))`;

function summaries(db: D1Database, where: string, binds: unknown[], limit = -1) {
  return db
    .prepare(
      `SELECT l.id, l.class_id AS classId, c.name AS className, l.set_name AS setName, l.started_at AS startedAt,
         (SELECT COUNT(*) FROM students s WHERE s.class_id = l.class_id AND ${attended("l.id", "s.id")}) AS present,
         (SELECT COUNT(*) FROM students s WHERE s.class_id = l.class_id) AS total,
         (SELECT COALESCE(SUM(q.points), 0) FROM lesson_questions q WHERE q.lesson_id = l.id AND ${ASKED}) AS max,
         (SELECT COALESCE(SUM(a.score), 0) FROM answers a JOIN lesson_questions q ON q.id = a.lesson_question_id
            WHERE q.lesson_id = l.id AND ${ASKED}) AS scoreSum,
         (SELECT COUNT(*) FROM answers a JOIN lesson_questions q ON q.id = a.lesson_question_id
            WHERE q.lesson_id = l.id AND ${ASKED} AND a.status = 'pending') AS ungraded
       FROM lessons l JOIN classes c ON c.id = l.class_id
       WHERE l.status = 'ended' ${where}
       ORDER BY l.started_at DESC LIMIT ?`,
    )
    .bind(...binds, limit)
    .all<LessonSummary>();
}

app.get("/classes/:id/records", async (c) => {
  const { results } = await summaries(c.env.DB, "AND l.class_id = ?", [c.req.param("id")]);
  return c.json(results);
});

app.get("/records/recent", async (c) => {
  const { results } = await summaries(c.env.DB, "", [], 5);
  return c.json(results);
});

app.get("/records/:id", async (c) => {
  const db = c.env.DB;
  const lesson = await db
    .prepare(
      `SELECT l.id, l.class_id, l.set_name, l.started_at, l.groups_saved, c.name,
         (SELECT COUNT(*) FROM groupings g WHERE g.class_id = l.class_id) AS groupings
       FROM lessons l JOIN classes c ON c.id = l.class_id WHERE l.id = ?`,
    )
    .bind(c.req.param("id"))
    .first<{ id: string; class_id: string; set_name: string; started_at: string; groups_saved: number; name: string; groupings: number }>();
  if (!lesson) return fail(c, RECORD_GONE, 404);
  const [students, questions, answers, groups, reviews] = await Promise.all([
    db
      .prepare(`SELECT s.id, s.seat, s.name, ${attended("?1", "s.id")} AS present FROM students s WHERE s.class_id = ?2 ORDER BY s.seat`)
      .bind(lesson.id, lesson.class_id)
      .all<{ id: string; seat: number; name: string; present: number }>(),
    db.prepare("SELECT * FROM lesson_questions WHERE lesson_id = ? ORDER BY position").bind(lesson.id).all<LessonQuestionRow>(),
    db
      .prepare(
        `SELECT a.lesson_question_id AS questionId, a.student_id AS studentId, a.answer, a.status, a.score, a.blanks
         FROM answers a JOIN lesson_questions q ON q.id = a.lesson_question_id WHERE q.lesson_id = ?`,
      )
      .bind(lesson.id)
      .all<RecordAnswerRow>(),
    db
      .prepare(
        `SELECT grouping_id, grouping_name, group_name, group_position, student_id FROM lesson_groups
         WHERE lesson_id = ? ORDER BY grouping_created_at, grouping_id, group_position`,
      )
      .bind(lesson.id)
      .all<{ grouping_id: string; grouping_name: string; group_name: string; group_position: number; student_id: string }>(),
    // 互評 that were sent and not deleted. For reference only; never part of a score.
    db
      .prepare(
        `SELECT r.lesson_question_id AS questionId, r.reviewer_id AS reviewerId, r.reviewee_id AS revieweeId, r.score, r.comment
         FROM peer_reviews r JOIN lesson_questions q ON q.id = r.lesson_question_id
         WHERE q.lesson_id = ? AND r.score IS NOT NULL`,
      )
      .bind(lesson.id)
      .all<RecordReview>(),
  ]);
  // Rows come sorted, so a new grouping or group starts whenever its id/position changes.
  let groupings: RecordGrouping[] | null = null;
  if (lesson.groups_saved) {
    groupings = [];
    let position = -1;
    for (const r of groups.results) {
      let g = groupings.at(-1);
      if (g?.id !== r.grouping_id) {
        groupings.push((g = { id: r.grouping_id, name: r.grouping_name, groups: [] }));
        position = -1;
      }
      if (r.group_position !== position) g.groups.push({ name: r.group_name, studentIds: [] });
      position = r.group_position;
      g.groups.at(-1)!.studentIds.push(r.student_id);
    }
  }
  const detail: RecordDetail = {
    id: lesson.id,
    classId: lesson.class_id,
    className: lesson.name,
    setName: lesson.set_name,
    startedAt: lesson.started_at,
    groupingCount: groupings ? groupings.length : lesson.groupings,
    groupings,
    students: students.results.map((s) => ({ ...s, present: !!s.present })),
    questions: questions.results.map((q) => ({ ...toQuestion(q), status: q.status })),
    answers: answers.results,
    reviews: reviews.results,
  };
  return c.json(detail);
});

// Body: { questionId, studentId, score }. Only 簡答, only answers that exist, 0..配分.
app.post("/records/:id/grade", async (c) => {
  const db = c.env.DB;
  const { questionId, studentId, score } = await readBody(c);
  const row = await db
    .prepare(
      `SELECT q.type, q.points FROM answers a JOIN lesson_questions q ON q.id = a.lesson_question_id
       WHERE q.lesson_id = ? AND a.lesson_question_id = ? AND a.student_id = ?`,
    )
    .bind(c.req.param("id"), questionId, studentId)
    .first<{ type: string; points: number }>();
  if (!row) return fail(c, "找不到這份作答，可能已經被刪除。", 404);
  if (row.type !== "essay") return fail(c, "只有簡答題需要批改。");
  if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > row.points) {
    return fail(c, `分數要是 0 到 ${row.points} 的整數。`);
  }
  await db
    .prepare("UPDATE answers SET status = 'graded', score = ? WHERE lesson_question_id = ? AND student_id = ?")
    .bind(score, questionId, studentId)
    .run();
  return c.json({ ok: true });
});

app.delete("/records/:id", async (c) => {
  const db = c.env.DB;
  const lesson = await db.prepare("SELECT status FROM lessons WHERE id = ?").bind(c.req.param("id")).first<{ status: string }>();
  if (!lesson) return fail(c, RECORD_GONE, 404);
  if (lesson.status === "active") return fail(c, "這堂課還在進行，請先結束上課。", 409);
  // Questions, attendance and answers go with it (ON DELETE CASCADE).
  await db.prepare("DELETE FROM lessons WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

app.get("/students/:id/history", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const student = await db
    .prepare(
      "SELECT s.id, s.seat, s.name, s.class_id AS classId, c.name AS className FROM students s JOIN classes c ON c.id = s.class_id WHERE s.id = ?",
    )
    .bind(id)
    .first<StudentHistory["student"]>();
  if (!student) return fail(c, "找不到這位學生，可能已經被刪除。", 404);
  const { results } = await db
    .prepare(
      `SELECT l.id, l.set_name AS setName, l.started_at AS startedAt,
         ${attended("l.id", "?1")} AS present,
         (SELECT COALESCE(SUM(q.points), 0) FROM lesson_questions q WHERE q.lesson_id = l.id AND ${ASKED}) AS max,
         (SELECT COALESCE(SUM(a.score), 0) FROM answers a JOIN lesson_questions q ON q.id = a.lesson_question_id
            WHERE q.lesson_id = l.id AND ${ASKED} AND a.student_id = ?1) AS score,
         (SELECT COUNT(*) FROM answers a JOIN lesson_questions q ON q.id = a.lesson_question_id
            WHERE q.lesson_id = l.id AND ${ASKED} AND a.student_id = ?1 AND a.status = 'pending') AS ungraded
       FROM lessons l WHERE l.class_id = ?2 AND l.status = 'ended' ORDER BY l.started_at DESC`,
    )
    .bind(id, student.classId)
    .all<{ id: string; setName: string; startedAt: string; present: number; max: number; score: number; ungraded: number }>();
  const history: StudentHistory = {
    student,
    // Someone absent gets no score at all, not 0.
    lessons: results.map((l) => (l.present ? { ...l, present: true } : { ...l, present: false, score: 0, ungraded: 0 })),
  };
  return c.json(history);
});

export default app;
