import { Hono } from "hono";
import type { AppEnv } from "./env";
import { checkClassName, checkSeat, checkStudentName, MAX_IMPORT_ROWS } from "../shared/limits";
import type { ClassDetail, ClassSummary, GroupingSummary, ImportResult, Student } from "../shared/types";
import { notify } from "./lesson-hub";
import { fail, now, readBody, uniqueJoinCode } from "./util";

const app = new Hono<AppEnv>();

const CLASS_GONE = "找不到這個班級，可能已經被刪除。";
const STUDENT_GONE = "找不到這位學生，可能已經被刪除。";

type ClassRow = { id: string; name: string; join_code: string };

function getClass(db: D1Database, id: string) {
  return db.prepare("SELECT id, name, join_code FROM classes WHERE id = ?").bind(id).first<ClassRow>();
}

app.get("/classes", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.name, c.join_code AS joinCode, COUNT(s.id) AS studentCount
     FROM classes c LEFT JOIN students s ON s.class_id = c.id
     GROUP BY c.id ORDER BY c.created_at`,
  ).all<ClassSummary>();
  return c.json(results);
});

app.post("/classes", async (c) => {
  const { name } = await readBody(c);
  const err = checkClassName(name);
  if (err) return fail(c, err);
  const cls: ClassSummary = {
    id: crypto.randomUUID(),
    name: (name as string).trim(),
    joinCode: await uniqueJoinCode(c.env.DB),
    studentCount: 0,
  };
  await c.env.DB.prepare("INSERT INTO classes (id, name, join_code, created_at) VALUES (?, ?, ?, ?)")
    .bind(cls.id, cls.name, cls.joinCode, now())
    .run();
  return c.json(cls, 201);
});

app.get("/classes/:id", async (c) => {
  const db = c.env.DB;
  const cls = await getClass(db, c.req.param("id"));
  if (!cls) return fail(c, CLASS_GONE, 404);
  const [students, groupings, lesson] = await Promise.all([
    db.prepare("SELECT id, seat, name FROM students WHERE class_id = ? ORDER BY seat").bind(cls.id).all<Student>(),
    db
      .prepare(
        `SELECT g.id, g.name, (SELECT COUNT(*) FROM groups WHERE grouping_id = g.id) AS groupCount
         FROM groupings g WHERE g.class_id = ? ORDER BY g.created_at`,
      )
      .bind(cls.id)
      .all<GroupingSummary>(),
    activeLessonOf(db, cls.id),
  ]);
  const detail: ClassDetail = {
    id: cls.id,
    name: cls.name,
    joinCode: cls.join_code,
    students: students.results,
    groupings: groupings.results,
    inLesson: !!lesson,
  };
  return c.json(detail);
});

function activeLessonOf(db: D1Database, classId: string) {
  return db.prepare("SELECT id FROM lessons WHERE class_id = ? AND status = 'active'").bind(classId).first<{ id: string }>();
}

app.patch("/classes/:id", async (c) => {
  const { name } = await readBody(c);
  const err = checkClassName(name);
  if (err) return fail(c, err);
  const res = await c.env.DB.prepare("UPDATE classes SET name = ? WHERE id = ?")
    .bind((name as string).trim(), c.req.param("id"))
    .run();
  if (!res.meta.changes) return fail(c, CLASS_GONE, 404);
  return c.json({ ok: true });
});

app.post("/classes/:id/join-code", async (c) => {
  // A new code would send every student in the lesson back to the join screen.
  if (await activeLessonOf(c.env.DB, c.req.param("id"))) return fail(c, "正在上課，不能更換加入碼。下課後再換。", 409);
  const joinCode = await uniqueJoinCode(c.env.DB);
  const res = await c.env.DB.prepare("UPDATE classes SET join_code = ? WHERE id = ?")
    .bind(joinCode, c.req.param("id"))
    .run();
  if (!res.meta.changes) return fail(c, CLASS_GONE, 404);
  return c.json({ joinCode });
});

// Students, groupings, lessons and answers go with it via ON DELETE CASCADE.
app.delete("/classes/:id", async (c) => {
  const db = c.env.DB;
  const lesson = await activeLessonOf(db, c.req.param("id"));
  const res = await db.prepare("DELETE FROM classes WHERE id = ?").bind(c.req.param("id")).run();
  if (!res.meta.changes) return fail(c, CLASS_GONE, 404);
  if (lesson) await notify(c.env, lesson.id, "ended");
  return c.json({ ok: true });
});

// --- Students ---

function checkStudent(seat: unknown, name: unknown) {
  return checkSeat(seat) ?? checkStudentName(name);
}

app.post("/classes/:id/students", async (c) => {
  const { seat, name } = await readBody(c);
  const err = checkStudent(seat, name);
  if (err) return fail(c, err);
  const db = c.env.DB;
  const cls = await getClass(db, c.req.param("id"));
  if (!cls) return fail(c, CLASS_GONE, 404);
  const taken = await db.prepare("SELECT 1 FROM students WHERE class_id = ? AND seat = ?").bind(cls.id, seat).first();
  if (taken) return fail(c, `座號 ${seat} 已經有人了。`, 409);
  const student: Student = { id: crypto.randomUUID(), seat: seat as number, name: (name as string).trim() };
  await db
    .prepare("INSERT INTO students (id, class_id, seat, name, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(student.id, cls.id, student.seat, student.name, now())
    .run();
  return c.json(student, 201);
});

app.post("/classes/:id/students/import", async (c) => {
  const { rows, onConflict } = await readBody(c);
  if (!Array.isArray(rows) || rows.length === 0) return fail(c, "名冊是空的。");
  if (rows.length > MAX_IMPORT_ROWS) return fail(c, `一次最多加入 ${MAX_IMPORT_ROWS} 位學生。`);
  if (onConflict !== "update" && onConflict !== "skip") return fail(c, "請選擇座號重複時要更新還是略過。");

  const seen = new Set<number>();
  for (const row of rows) {
    const err = checkStudent(row?.seat, row?.name);
    if (err) return fail(c, `座號 ${row?.seat ?? "?"}：${err}`);
    if (seen.has(row.seat)) return fail(c, `座號 ${row.seat} 重複出現。`);
    seen.add(row.seat);
  }

  const db = c.env.DB;
  const cls = await getClass(db, c.req.param("id"));
  if (!cls) return fail(c, CLASS_GONE, 404);
  const { results: existing } = await db
    .prepare("SELECT seat FROM students WHERE class_id = ?")
    .bind(cls.id)
    .all<{ seat: number }>();
  const existingSeats = new Set(existing.map((s) => s.seat));

  const result: ImportResult = { added: 0, updated: 0, skipped: 0 };
  const stmts: D1PreparedStatement[] = [];
  const createdAt = now();
  for (const row of rows as { seat: number; name: string }[]) {
    const name = row.name.trim();
    if (!existingSeats.has(row.seat)) {
      stmts.push(
        db
          .prepare("INSERT INTO students (id, class_id, seat, name, created_at) VALUES (?, ?, ?, ?, ?)")
          .bind(crypto.randomUUID(), cls.id, row.seat, name, createdAt),
      );
      result.added++;
    } else if (onConflict === "update") {
      stmts.push(db.prepare("UPDATE students SET name = ? WHERE class_id = ? AND seat = ?").bind(name, cls.id, row.seat));
      result.updated++;
    } else {
      result.skipped++;
    }
  }
  if (stmts.length) await db.batch(stmts);
  return c.json(result);
});

app.patch("/students/:id", async (c) => {
  const { seat, name } = await readBody(c);
  const err = checkStudent(seat, name);
  if (err) return fail(c, err);
  const db = c.env.DB;
  const id = c.req.param("id");
  const student = await db.prepare("SELECT class_id FROM students WHERE id = ?").bind(id).first<{ class_id: string }>();
  if (!student) return fail(c, STUDENT_GONE, 404);
  const taken = await db
    .prepare("SELECT 1 FROM students WHERE class_id = ? AND seat = ? AND id != ?")
    .bind(student.class_id, seat, id)
    .first();
  if (taken) return fail(c, `座號 ${seat} 已經有人了。`, 409);
  await db.prepare("UPDATE students SET seat = ?, name = ? WHERE id = ?").bind(seat, (name as string).trim(), id).run();
  return c.json({ ok: true });
});

app.delete("/students/:id", async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM students WHERE id = ?").bind(c.req.param("id")).run();
  if (!res.meta.changes) return fail(c, STUDENT_GONE, 404);
  return c.json({ ok: true });
});

export default app;
