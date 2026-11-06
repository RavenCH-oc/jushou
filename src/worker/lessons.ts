// Teacher side of a lesson (上課). Everything is stored in D1; after each
// change the lesson's hub tells the open pages to refetch (see lesson-hub.ts).
import { Hono } from "hono";
import type { AppEnv } from "./env";
import type { Question } from "../shared/questions";
import type {
  ActiveLesson,
  EssayAnswer,
  LessonDetail,
  LessonQuestion,
  PeerReviewItem,
  QuestionStats,
  QuestionStatus,
} from "../shared/lesson";
import { assignReviews } from "../shared/peer-review";
import { notify } from "./lesson-hub";
import { fail, now, readBody } from "./util";

const app = new Hono<AppEnv>();

const LESSON_GONE = "找不到這堂課，可能已經被刪除。";
const QUESTION_GONE = "找不到這一題，可能已經被刪除。";
const LESSON_ENDED = "這堂課已經結束了。";

export type LessonQuestionRow = {
  id: string;
  lesson_id: string;
  position: number;
  type: string;
  text: string;
  note: string;
  points: number;
  config: string;
  status: QuestionStatus;
};

export function toQuestion(r: LessonQuestionRow): Question {
  return { id: r.id, type: r.type, text: r.text, note: r.note, points: r.points, config: JSON.parse(r.config) } as Question;
}

export function activeLesson(db: D1Database) {
  return db
    .prepare(
      `SELECT l.id, l.class_id AS classId, c.name AS className
       FROM lessons l JOIN classes c ON c.id = l.class_id WHERE l.status = 'active'`,
    )
    .first<ActiveLesson>();
}

type AnswerRow = { qid: string; student_id: string; answer: string; status: string; blanks: string | null };

function stats(q: Question, rows: AnswerRow[]): QuestionStats {
  const s: QuestionStats = { answered: rows.length, correct: rows.filter((r) => r.status === "correct").length };
  const answers = rows.map((r) => JSON.parse(r.answer) as unknown);
  if (q.type === "truefalse") s.choices = [true, false].map((v) => answers.filter((a) => a === v).length);
  if (q.type === "single" || q.type === "multiple") {
    s.choices = q.config.options.map((_, i) => answers.filter((a) => a === i || (Array.isArray(a) && a.includes(i))).length);
  }
  if (q.type === "fill") {
    const right = rows.map((r) => (r.blanks ? (JSON.parse(r.blanks) as boolean[]) : []));
    s.blanks = q.config.blanks.map((_, i) => right.filter((b) => b[i]).length);
  }
  return s;
}

app.get("/lessons/active", async (c) => c.json(await activeLesson(c.env.DB)));

// Body: { classId, setId }. Copies every question of the set into the lesson.
app.post("/lessons", async (c) => {
  const { classId, setId } = await readBody(c);
  const db = c.env.DB;
  const [cls, set, active] = await Promise.all([
    db
      .prepare("SELECT id, (SELECT COUNT(*) FROM students WHERE class_id = classes.id) AS n FROM classes WHERE id = ?")
      .bind(classId)
      .first<{ id: string; n: number }>(),
    db.prepare("SELECT id, name FROM question_sets WHERE id = ?").bind(setId).first<{ id: string; name: string }>(),
    activeLesson(db),
  ]);
  if (!cls) return fail(c, "找不到這個班級，可能已經被刪除。", 404);
  if (!set) return fail(c, "找不到這個題組，可能已經被刪除。", 404);
  if (active) return fail(c, `「${active.className}」正在上課，請先結束那堂課。`, 409);
  if (!cls.n) return fail(c, "這個班級還沒有學生，請先加入學生名冊。");
  const { results: questions } = await db
    .prepare("SELECT * FROM questions WHERE set_id = ? ORDER BY position")
    .bind(set.id)
    .all<LessonQuestionRow>();
  if (!questions.length) return fail(c, "這個題組還沒有題目，請先出題。");

  const id = crypto.randomUUID();
  const insertQuestion = db.prepare(
    `INSERT INTO lesson_questions (id, lesson_id, position, type, text, note, points, config, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
  );
  try {
    await db.batch([
      db
        .prepare("INSERT INTO lessons (id, class_id, set_name, status, started_at) VALUES (?, ?, ?, 'active', ?)")
        .bind(id, cls.id, set.name, now()),
      ...questions.map((q, i) => insertQuestion.bind(crypto.randomUUID(), id, i, q.type, q.text, q.note, q.points, q.config)),
    ]);
  } catch (e) {
    // Two "開始" at once: the unique index lets only one lesson be active.
    if (await activeLesson(db)) return fail(c, "已經有一堂課正在進行，請先結束那堂課。", 409);
    throw e;
  }
  return c.json({ id }, 201);
});

app.get("/lessons/:id", async (c) => {
  const db = c.env.DB;
  const lesson = await db
    .prepare(
      `SELECT l.id, l.status, l.class_id, l.set_name, l.current_question_id, c.name, c.join_code
       FROM lessons l JOIN classes c ON c.id = l.class_id WHERE l.id = ?`,
    )
    .bind(c.req.param("id"))
    .first<{
      id: string;
      status: "active" | "ended";
      class_id: string;
      set_name: string;
      current_question_id: string | null;
      name: string;
      join_code: string;
    }>();
  if (!lesson) return fail(c, LESSON_GONE, 404);

  const [students, joined, questions, answers, reviews] = await Promise.all([
    db
      .prepare("SELECT id, seat, name, device_hash IS NOT NULL AS bound FROM students WHERE class_id = ? ORDER BY seat")
      .bind(lesson.class_id)
      .all<{ id: string; seat: number; name: string; bound: number }>(),
    db.prepare("SELECT student_id FROM lesson_students WHERE lesson_id = ?").bind(lesson.id).all<{ student_id: string }>(),
    db.prepare("SELECT * FROM lesson_questions WHERE lesson_id = ? ORDER BY position").bind(lesson.id).all<LessonQuestionRow>(),
    db
      .prepare(
        `SELECT a.lesson_question_id AS qid, a.student_id, a.answer, a.status, a.blanks
         FROM answers a JOIN lesson_questions q ON q.id = a.lesson_question_id WHERE q.lesson_id = ?`,
      )
      .bind(lesson.id)
      .all<AnswerRow>(),
    db
      .prepare(
        `SELECT r.lesson_question_id AS qid, COUNT(*) AS total, COUNT(r.submitted_at) AS done
         FROM peer_reviews r JOIN lesson_questions q ON q.id = r.lesson_question_id WHERE q.lesson_id = ? GROUP BY r.lesson_question_id`,
      )
      .bind(lesson.id)
      .all<{ qid: string; total: number; done: number }>(),
  ]);
  const joinedIds = new Set(joined.results.map((r) => r.student_id));

  const detail: LessonDetail = {
    id: lesson.id,
    status: lesson.status,
    classId: lesson.class_id,
    className: lesson.name,
    joinCode: lesson.join_code,
    setName: lesson.set_name,
    currentQuestionId: lesson.current_question_id,
    students: students.results.map((s) => ({ id: s.id, seat: s.seat, name: s.name, bound: !!s.bound, joined: joinedIds.has(s.id) })),
    questions: questions.results.map((row): LessonQuestion => {
      const q = toQuestion(row);
      const rows = answers.results.filter((a) => a.qid === row.id);
      const review = reviews.results.find((r) => r.qid === row.id);
      return {
        ...q,
        status: row.status,
        answeredBy: rows.map((r) => r.student_id),
        stats: stats(q, rows),
        ...(review ? { review: { done: review.done, total: review.total } } : {}),
      };
    }),
  };
  return c.json(detail);
});

// pending → open → closed → (reviewing →) revealed; see QuestionStatus.
// reveal also ends 互評 (結束互評). Opening a question stops whatever the students
// were on: an open one becomes closed, one being reviewed becomes revealed.
const STEPS: Record<string, { from: QuestionStatus[]; to: QuestionStatus }> = {
  open: { from: ["pending"], to: "open" },
  close: { from: ["open"], to: "closed" },
  reveal: { from: ["closed", "reviewing"], to: "revealed" },
};
const CHANGED = "這一題的狀態已經變了，畫面會自動更新。";

function findQuestion(db: D1Database, id: string) {
  return db
    .prepare(
      `SELECT q.id, q.type, q.status, q.lesson_id, l.status AS lesson_status
       FROM lesson_questions q JOIN lessons l ON l.id = q.lesson_id WHERE q.id = ?`,
    )
    .bind(id)
    .first<{ id: string; type: string; status: QuestionStatus; lesson_id: string; lesson_status: string }>();
}

// 開始互評: pair up everyone who answered this 簡答. Fixed from now on, whoever joins or leaves.
app.post("/lesson-questions/:id/review", async (c) => {
  const db = c.env.DB;
  const row = await findQuestion(db, c.req.param("id"));
  if (!row) return fail(c, QUESTION_GONE, 404);
  if (row.lesson_status !== "active") return fail(c, LESSON_ENDED, 409);
  if (row.type !== "essay") return fail(c, "只有簡答題可以互評。");
  if (row.status === "reviewing") return c.json({ ok: true }); // pressed twice
  if (row.status !== "closed") return fail(c, CHANGED, 409);
  const { results } = await db
    .prepare("SELECT student_id FROM answers WHERE lesson_question_id = ?")
    .bind(row.id)
    .all<{ student_id: string }>();
  const pairs = assignReviews(results.map((r) => r.student_id));
  if (!pairs.length) return fail(c, "至少要 2 位同學作答才能互評。");
  // Inserted only if the UPDATE before it, in the same transaction, started 互評.
  const insert = db.prepare(
    `INSERT INTO peer_reviews (lesson_question_id, reviewer_id, reviewee_id)
     SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM lesson_questions WHERE id = ?1 AND status = 'reviewing')`,
  );
  try {
    await db.batch([
      // Only from 已停止, so two presses at once can't both pair people up.
      db.prepare("UPDATE lesson_questions SET status = 'reviewing' WHERE id = ? AND status = 'closed'").bind(row.id),
      ...pairs.map((p) => insert.bind(row.id, p.reviewer, p.reviewee)),
    ]);
  } catch (e) {
    if ((await findQuestion(db, row.id))?.status === "reviewing") return c.json({ ok: true });
    throw e;
  }
  await notify(c.env, row.lesson_id, "question");
  return c.json({ ok: true });
});

app.post("/lesson-questions/:id/:step", async (c) => {
  const step = STEPS[c.req.param("step")];
  if (!step) return fail(c, "找不到這個功能。", 404);
  const db = c.env.DB;
  const row = await findQuestion(db, c.req.param("id"));
  if (!row) return fail(c, QUESTION_GONE, 404);
  if (row.lesson_status !== "active") return fail(c, LESSON_ENDED, 409);
  if (row.status === step.to) return c.json({ ok: true }); // pressed twice
  if (!step.from.includes(row.status)) return fail(c, CHANGED, 409);

  const stmts = [db.prepare("UPDATE lesson_questions SET status = ? WHERE id = ?").bind(step.to, row.id)];
  if (step.to === "open") {
    stmts.unshift(
      db.prepare("UPDATE lesson_questions SET status = 'closed' WHERE lesson_id = ? AND status = 'open'").bind(row.lesson_id),
      db.prepare("UPDATE lesson_questions SET status = 'revealed' WHERE lesson_id = ? AND status = 'reviewing'").bind(row.lesson_id),
    );
    stmts.push(db.prepare("UPDATE lessons SET current_question_id = ? WHERE id = ?").bind(row.id, row.lesson_id));
  }
  await db.batch(stmts);
  await notify(c.env, row.lesson_id, "question");
  return c.json({ ok: true });
});

// 看評語: every pair with names, for the teacher only.
app.get("/lesson-questions/:id/reviews", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.reviewer_id, a.seat AS a_seat, a.name AS a_name, b.seat AS b_seat, b.name AS b_name, r.score, r.comment, r.deleted
     FROM peer_reviews r JOIN students a ON a.id = r.reviewer_id JOIN students b ON b.id = r.reviewee_id
     WHERE r.lesson_question_id = ? ORDER BY a.seat`,
  )
    .bind(c.req.param("id"))
    .all<{
      reviewer_id: string;
      a_seat: number;
      a_name: string;
      b_seat: number;
      b_name: string;
      score: number | null;
      comment: string | null;
      deleted: number;
    }>();
  const list: PeerReviewItem[] = results.map((r) => ({
    reviewerId: r.reviewer_id,
    reviewer: `${r.a_seat} 號 ${r.a_name}`,
    reviewee: `${r.b_seat} 號 ${r.b_name}`,
    score: r.score,
    comment: r.comment,
    deleted: !!r.deleted,
  }));
  return c.json(list);
});

// Removes an unkind comment; the student it was about sees 「這次沒有收到互評」.
app.delete("/lesson-questions/:id/reviews/:reviewerId", async (c) => {
  const db = c.env.DB;
  const row = await findQuestion(db, c.req.param("id"));
  if (!row) return fail(c, QUESTION_GONE, 404);
  const res = await db
    .prepare(
      "UPDATE peer_reviews SET score = NULL, comment = NULL, deleted = 1 WHERE lesson_question_id = ? AND reviewer_id = ? AND score IS NOT NULL",
    )
    .bind(row.id, c.req.param("reviewerId"))
    .run();
  if (!res.meta.changes) return fail(c, "找不到這則評語，可能已經被刪除。", 404);
  if (row.lesson_status === "active") await notify(c.env, row.lesson_id, "question");
  return c.json({ ok: true });
});

app.get("/lesson-questions/:id/essays", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.seat, s.name, a.answer FROM answers a JOIN students s ON s.id = a.student_id
     WHERE a.lesson_question_id = ? ORDER BY s.seat`,
  )
    .bind(c.req.param("id"))
    .all<{ seat: number; name: string; answer: string }>();
  const list: EssayAnswer[] = results.map((r) => ({ seat: r.seat, name: r.name, text: String(JSON.parse(r.answer)) }));
  return c.json(list);
});

app.post("/lessons/:id/end", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  // One transaction: copy the class's groups as they are now (the teacher may have grouped
  // mid-lesson), then end it. Both only happen while the lesson is still active.
  const [, res] = await db.batch([
    db
      .prepare(
        `INSERT INTO lesson_groups (lesson_id, grouping_id, grouping_name, grouping_created_at, group_name, group_position, student_id)
         SELECT l.id, g.id, g.name, g.created_at, gr.name, gr.position, m.student_id
         FROM lessons l JOIN groupings g ON g.class_id = l.class_id
           JOIN groups gr ON gr.grouping_id = g.id JOIN group_members m ON m.group_id = gr.id
         WHERE l.id = ? AND l.status = 'active'`,
      )
      .bind(id),
    db.prepare("UPDATE lessons SET status = 'ended', ended_at = ?, groups_saved = 1 WHERE id = ? AND status = 'active'").bind(now(), id),
  ]);
  if (!res.meta.changes) {
    const exists = await db.prepare("SELECT 1 FROM lessons WHERE id = ?").bind(id).first();
    return exists ? c.json({ ok: true }) : fail(c, LESSON_GONE, 404);
  }
  await db.batch([
    db.prepare("UPDATE lesson_questions SET status = 'closed' WHERE lesson_id = ? AND status = 'open'").bind(id),
    db.prepare("UPDATE lesson_questions SET status = 'revealed' WHERE lesson_id = ? AND status = 'reviewing'").bind(id),
  ]);
  await notify(c.env, id, "ended");
  return c.json({ ok: true });
});

// The student picks their seat again on their next visit (換手機、點錯人).
app.post("/students/:id/unbind", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const res = await db.prepare("UPDATE students SET device_hash = NULL WHERE id = ?").bind(id).run();
  if (!res.meta.changes) return fail(c, "找不到這位學生，可能已經被刪除。", 404);
  const lesson = await activeLesson(db);
  if (lesson) {
    await db.prepare("DELETE FROM lesson_students WHERE lesson_id = ? AND student_id = ?").bind(lesson.id, id).run();
    await notify(c.env, lesson.id, "roster"); // students too, so that phone goes back to picking a seat
  }
  return c.json({ ok: true });
});

export default app;
