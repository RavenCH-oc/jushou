// Student side. No login: a phone sends its random token in X-Device-Token,
// and the student it is bound to (by the token's SHA-256) is "me".
// A student can only ever read or change their own things, in their own class's lesson.
import { Hono, type Context } from "hono";
import type { AppEnv } from "./env";
import { gradeAnswer, toStudentView, type GradeResult } from "../shared/grading";
import type { LessonResult, StudentCurrent, StudentState } from "../shared/lesson";
import { notify } from "./lesson-hub";
import { toQuestion, type LessonQuestionRow } from "./lessons";
import { fail, now, readBody } from "./util";

const app = new Hono<AppEnv>();

const NO_CODE = "找不到這個加入碼，請再確認一次。";
const NOT_ME = "請重新選擇你的座號。";
const MAX_ANSWER_LENGTH = 5000; // characters of JSON

type Me = { id: string; seat: number; name: string };

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The token is made by the phone (crypto.getRandomValues); anything odd counts as none.
async function deviceHash(c: Context<AppEnv>) {
  const token = c.req.header("X-Device-Token") ?? "";
  return /^[A-Za-z0-9_-]{32,128}$/.test(token) ? sha256(token) : null;
}

function findClass(db: D1Database, code: string) {
  return db.prepare("SELECT id, name FROM classes WHERE join_code = ?").bind(code).first<{ id: string; name: string }>();
}

function findMe(db: D1Database, classId: string, hash: string | null) {
  if (!hash) return null;
  return db.prepare("SELECT id, seat, name FROM students WHERE class_id = ? AND device_hash = ?").bind(classId, hash).first<Me>();
}

function findLesson(db: D1Database, classId: string) {
  return db
    .prepare("SELECT id, current_question_id FROM lessons WHERE class_id = ? AND status = 'active'")
    .bind(classId)
    .first<{ id: string; current_question_id: string | null }>();
}

async function current(db: D1Database, lessonId: string, questionId: string, me: Me): Promise<StudentCurrent | null> {
  const row = await db.prepare("SELECT * FROM lesson_questions WHERE id = ?").bind(questionId).first<LessonQuestionRow>();
  if (!row || row.status === "pending") return null;
  const [counts, mine] = await Promise.all([
    db
      .prepare("SELECT COUNT(*) AS total, SUM(position < ?) AS before FROM lesson_questions WHERE lesson_id = ?")
      .bind(row.position, lessonId)
      .first<{ total: number; before: number }>(),
    db
      .prepare("SELECT answer, status, score, blanks FROM answers WHERE lesson_question_id = ? AND student_id = ?")
      .bind(row.id, me.id)
      .first<{ answer: string; status: GradeResult["status"]; score: number | null; blanks: string | null }>(),
  ]);
  const question = toQuestion(row);
  const out: StudentCurrent = {
    question: toStudentView(question), // never the answers before they're revealed
    number: (counts?.before ?? 0) + 1,
    total: counts?.total ?? 1,
    status: row.status,
    answer: mine ? JSON.parse(mine.answer) : null,
  };
  if (row.status === "revealed") {
    const result: GradeResult = mine
      ? { status: mine.status, score: mine.score, ...(mine.blanks ? { blanks: JSON.parse(mine.blanks) } : {}) }
      : gradeAnswer(question, null);
    out.reveal = { result, question };
  }
  return out;
}

// Midnight in Taiwan (UTC+8, no daylight saving), as the ISO string lessons store.
export function startOfTaipeiDay(at = new Date()) {
  const offset = 8 * 3600_000;
  const day = Math.floor((at.getTime() + offset) / 86_400_000) * 86_400_000;
  return new Date(day - offset).toISOString();
}

// This student's results in the last lesson they joined that ended today, if any.
async function todaysResult(db: D1Database, classId: string, me: Me): Promise<LessonResult | null> {
  const lesson = await db
    .prepare(
      `SELECT l.id, l.set_name FROM lessons l JOIN lesson_students ls ON ls.lesson_id = l.id AND ls.student_id = ?
       WHERE l.class_id = ? AND l.status = 'ended' AND l.ended_at >= ? ORDER BY l.ended_at DESC LIMIT 1`,
    )
    .bind(me.id, classId, startOfTaipeiDay())
    .first<{ id: string; set_name: string }>();
  if (!lesson) return null;
  const { results } = await db
    .prepare(
      `SELECT q.text, q.type, q.points, q.status, a.status AS result, a.score
       FROM lesson_questions q LEFT JOIN answers a ON a.lesson_question_id = q.id AND a.student_id = ?
       WHERE q.lesson_id = ? ORDER BY q.position`,
    )
    .bind(me.id, lesson.id)
    .all<{ text: string; type: string; points: number; status: string; result: GradeResult["status"] | null; score: number | null }>();
  const out: LessonResult = { setName: lesson.set_name, items: [], score: 0, max: 0 };
  results.forEach((r, i) => {
    const revealed = r.status === "revealed";
    const result = revealed ? (r.result ?? "unanswered") : "hidden";
    const score = revealed ? (r.result ? r.score : 0) : null;
    out.items.push({ number: i + 1, snippet: r.text.replace(/\s+/g, " ").slice(0, 20), result, score });
    if (revealed && r.type !== "essay") {
      out.max += r.points;
      out.score += score ?? 0;
    }
  });
  return out;
}

app.get("/state/:code", async (c) => {
  const db = c.env.DB;
  const cls = await findClass(db, c.req.param("code"));
  if (!cls) return fail(c, NO_CODE, 404);
  const [me, lesson] = await Promise.all([findMe(db, cls.id, await deviceHash(c)), findLesson(db, cls.id)]);
  const state: StudentState = { className: cls.name, lessonId: lesson?.id ?? null, me: me && { seat: me.seat, name: me.name }, current: null };

  if (!me) {
    const { results } = await db
      .prepare("SELECT seat, name, device_hash IS NOT NULL AS taken FROM students WHERE class_id = ? ORDER BY seat")
      .bind(cls.id)
      .all<{ seat: number; name: string; taken: number }>();
    state.seats = results.map((s) => ({ seat: s.seat, name: s.name, taken: !!s.taken }));
  } else if (lesson) {
    // Opening the lesson on a bound phone counts as joining it.
    const joined = await db
      .prepare("INSERT OR IGNORE INTO lesson_students (lesson_id, student_id, joined_at) VALUES (?, ?, ?)")
      .bind(lesson.id, me.id, now())
      .run();
    if (joined.meta.changes) await notify(c.env, lesson.id, "roster", "teacher");
    if (lesson.current_question_id) state.current = await current(db, lesson.id, lesson.current_question_id, me);
  } else {
    state.result = await todaysResult(db, cls.id, me);
  }
  return c.json(state);
});

// Body: { seat }. Binds this phone to that seat, unless another phone has it.
app.post("/bind/:code", async (c) => {
  const db = c.env.DB;
  const hash = await deviceHash(c);
  if (!hash) return fail(c, "這個瀏覽器沒辦法記住你，請換一個瀏覽器再試一次。");
  const cls = await findClass(db, c.req.param("code"));
  if (!cls) return fail(c, NO_CODE, 404);
  const { seat } = await readBody(c);
  const student = await db
    .prepare("SELECT id, device_hash FROM students WHERE class_id = ? AND seat = ?")
    .bind(cls.id, seat)
    .first<{ id: string; device_hash: string | null }>();
  if (!student) return fail(c, "名冊裡沒有這個座號，請找老師。", 404);
  const taken = "這個座號已經有人使用，請找老師。";
  if (student.device_hash === hash) return c.json({ ok: true });
  if (student.device_hash) return fail(c, taken, 409);

  // One phone is one student per class: let go of any seat it held before.
  await db.batch([
    db
      .prepare("DELETE FROM lesson_students WHERE student_id IN (SELECT id FROM students WHERE class_id = ? AND device_hash = ?)")
      .bind(cls.id, hash),
    db.prepare("UPDATE students SET device_hash = NULL WHERE class_id = ? AND device_hash = ?").bind(cls.id, hash),
    db.prepare("UPDATE students SET device_hash = ? WHERE id = ? AND device_hash IS NULL").bind(hash, student.id),
  ]);
  const me = await findMe(db, cls.id, hash);
  if (me?.id !== student.id) return fail(c, taken, 409); // another phone was a moment faster
  return c.json({ ok: true });
});

// 「不是我？」: this phone lets go of its seat.
app.post("/unbind/:code", async (c) => {
  const db = c.env.DB;
  const cls = await findClass(db, c.req.param("code"));
  if (!cls) return fail(c, NO_CODE, 404);
  const me = await findMe(db, cls.id, await deviceHash(c));
  if (!me) return c.json({ ok: true });
  const lesson = await findLesson(db, cls.id);
  await db.batch([
    db.prepare("UPDATE students SET device_hash = NULL WHERE id = ?").bind(me.id),
    ...(lesson ? [db.prepare("DELETE FROM lesson_students WHERE lesson_id = ? AND student_id = ?").bind(lesson.id, me.id)] : []),
  ]);
  if (lesson) await notify(c.env, lesson.id, "roster", "teacher");
  return c.json({ ok: true });
});

// Body: { questionId, answer }. Graded here, never trusting the phone. Sending again replaces it.
app.post("/answer/:code", async (c) => {
  const db = c.env.DB;
  const cls = await findClass(db, c.req.param("code"));
  if (!cls) return fail(c, NO_CODE, 404);
  const me = await findMe(db, cls.id, await deviceHash(c));
  if (!me) return fail(c, NOT_ME, 403);
  const lesson = await findLesson(db, cls.id);
  if (!lesson) return fail(c, "這堂課已經結束了。", 409);

  const { questionId, answer } = await readBody(c);
  const row = await db
    .prepare("SELECT * FROM lesson_questions WHERE id = ? AND lesson_id = ?")
    .bind(questionId, lesson.id)
    .first<LessonQuestionRow>();
  if (!row) return fail(c, "找不到這一題，請重新整理。", 404);
  if (row.status !== "open") return fail(c, "老師已經停止作答了。", 409);
  const json = JSON.stringify(answer ?? null);
  if (json.length > MAX_ANSWER_LENGTH) return fail(c, "答案太長了，請縮短一點再送出。");
  const result = gradeAnswer(toQuestion(row), answer);
  if (result.status === "unanswered") return fail(c, "還沒有作答，請先作答再送出。");

  await db
    .prepare(
      `INSERT INTO answers (lesson_question_id, student_id, answer, status, score, blanks, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (lesson_question_id, student_id) DO UPDATE SET
         answer = excluded.answer, status = excluded.status, score = excluded.score,
         blanks = excluded.blanks, submitted_at = excluded.submitted_at`,
    )
    .bind(row.id, me.id, json, result.status, result.score, result.blanks ? JSON.stringify(result.blanks) : null, now())
    .run();
  await notify(c.env, lesson.id, "answers", "teacher");
  return c.json({ ok: true });
});

export default app;
