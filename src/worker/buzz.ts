// 搶答 (teacher side). One round at a time; nothing kept once it's over.
// The server decides when 「搶！」 opens and ranks presses in the order it gets them.
// The student side (state + pressing) is in student.ts.
import { Hono } from "hono";
import type { AppEnv } from "./env";
import type { BuzzBoard } from "../shared/lesson";
import { notify } from "./lesson-hub";
import { fail } from "./util";

const app = new Hono<AppEnv>();

// The 3-2-1 countdown, so every phone lights up at the same moment even if the
// "started" message reaches some of them a little later. Tests may change it.
export const BUZZ = { countdownMs: 3000 };

const LESSON_GONE = "找不到這堂課，可能已經被刪除。";

function findLesson(db: D1Database, id: string) {
  return db.prepare("SELECT id, status FROM lessons WHERE id = ?").bind(id).first<{ id: string; status: string }>();
}

// Statements that wipe 搶答 for a lesson (end of a round, or of the lesson).
export function clearBuzz(db: D1Database, lessonId: string) {
  return [
    db.prepare("DELETE FROM buzzes WHERE lesson_id = ?").bind(lessonId),
    db.prepare("UPDATE lessons SET buzz_open = 0, buzz_opens_at = NULL WHERE id = ?").bind(lessonId),
  ];
}

// 搶答 and 再搶一次: a new round. Questions are left exactly as they are: 搶答 is a quick
// aside, and a question being answered (or reviewed) carries on underneath.
app.post("/lessons/:id/buzz", async (c) => {
  const db = c.env.DB;
  const lesson = await findLesson(db, c.req.param("id"));
  if (!lesson) return fail(c, LESSON_GONE, 404);
  if (lesson.status !== "active") return fail(c, "這堂課已經結束了。", 409);
  await db.batch([
    db.prepare("DELETE FROM buzzes WHERE lesson_id = ?").bind(lesson.id),
    db
      .prepare("UPDATE lessons SET buzz_round = buzz_round + 1, buzz_open = 1, buzz_opens_at = ? WHERE id = ?")
      .bind(Date.now() + BUZZ.countdownMs, lesson.id),
  ]);
  await notify(c.env, lesson.id, "buzz");
  return c.json({ ok: true });
});

// 結束搶答: phones go back to what they showed before.
app.post("/lessons/:id/buzz/end", async (c) => {
  const db = c.env.DB;
  const lesson = await findLesson(db, c.req.param("id"));
  if (!lesson) return fail(c, LESSON_GONE, 404);
  await db.batch(clearBuzz(db, lesson.id));
  if (lesson.status === "active") await notify(c.env, lesson.id, "buzz");
  return c.json({ ok: true });
});

// The ranking. Light on purpose: the page fetches it on every press.
app.get("/lessons/:id/buzz", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const [lesson, top, counts] = await Promise.all([
    db.prepare("SELECT buzz_round, buzz_open, buzz_opens_at FROM lessons WHERE id = ?").bind(id).first<{
      buzz_round: number;
      buzz_open: number;
      buzz_opens_at: number | null;
    }>(),
    db
      .prepare("SELECT s.seat, s.name FROM buzzes b JOIN students s ON s.id = b.student_id WHERE b.lesson_id = ? ORDER BY b.seq LIMIT 5")
      .bind(id)
      .all<{ seat: number; name: string }>(),
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM buzzes WHERE lesson_id = ?1) AS count,
           (SELECT COUNT(*) FROM lesson_students WHERE lesson_id = ?1) AS joined`,
      )
      .bind(id)
      .first<{ count: number; joined: number }>(),
  ]);
  if (!lesson) return fail(c, LESSON_GONE, 404);
  const board: BuzzBoard = {
    open: !!lesson.buzz_open,
    round: lesson.buzz_round,
    opensInMs: lesson.buzz_open && lesson.buzz_opens_at ? Math.max(0, lesson.buzz_opens_at - Date.now()) : 0,
    top: top.results,
    count: counts?.count ?? 0,
    joined: counts?.joined ?? 0,
  };
  return c.json(board);
});

export default app;
