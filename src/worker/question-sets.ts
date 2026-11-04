import { Hono, type Context } from "hono";
import type { AppEnv } from "./env";
import { checkSetName, MAX_QUESTIONS_PER_SET, MAX_SET_NAME, validateQuestion, type Question, type QuestionData } from "../shared/questions";
import type { QuestionSetDetail, QuestionSetSummary } from "../shared/types";
import { fail, now, readBody } from "./util";

const app = new Hono<AppEnv>();

const SET_GONE = "找不到這個題組，可能已經被刪除。";
const QUESTION_GONE = "找不到這一題，可能已經被刪除。";
const TOO_MANY = `一個題組最多 ${MAX_QUESTIONS_PER_SET} 題。`;

type SetRow = { id: string; name: string; updated_at: string };
type QuestionRow = { id: string; set_id: string; position: number; type: string; text: string; note: string; points: number; config: string };

function toQuestion(r: QuestionRow): Question {
  return { id: r.id, type: r.type, text: r.text, note: r.note, points: r.points, config: JSON.parse(r.config) } as Question;
}

function getSet(db: D1Database, id: string) {
  return db.prepare("SELECT id, name, updated_at FROM question_sets WHERE id = ?").bind(id).first<SetRow>();
}

function getQuestion(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM questions WHERE id = ?").bind(id).first<QuestionRow>();
}

async function questionCount(db: D1Database, setId: string) {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM questions WHERE set_id = ?").bind(setId).first<{ n: number }>();
  return row?.n ?? 0;
}

// Any change to a question counts as editing its set (for 最後修改時間).
function touch(db: D1Database, setId: string) {
  return db.prepare("UPDATE question_sets SET updated_at = ? WHERE id = ?").bind(now(), setId);
}

function insertQuestion(db: D1Database, id: string, setId: string, position: number, q: QuestionData) {
  return db
    .prepare(
      `INSERT INTO questions (id, set_id, position, type, text, note, points, config, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, setId, position, q.type, q.text, q.note, q.points, JSON.stringify(q.config), now());
}

// Returns the cleaned question, or a 400 response listing each field's problem.
function readQuestion(c: Context<AppEnv>, body: unknown) {
  const result = validateQuestion(body);
  if ("errors" in result) {
    return { response: c.json({ error: Object.values(result.errors)[0], fields: result.errors }, 400) };
  }
  return { question: result.value };
}

app.get("/sets", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.updated_at, COUNT(q.id) AS n
     FROM question_sets s LEFT JOIN questions q ON q.set_id = s.id
     GROUP BY s.id ORDER BY s.updated_at DESC`,
  ).all<SetRow & { n: number }>();
  const list: QuestionSetSummary[] = results.map((r) => ({ id: r.id, name: r.name, questionCount: r.n, updatedAt: r.updated_at }));
  return c.json(list);
});

app.post("/sets", async (c) => {
  const { name } = await readBody(c);
  const err = checkSetName(name);
  if (err) return fail(c, err);
  const set: QuestionSetSummary = { id: crypto.randomUUID(), name: (name as string).trim(), questionCount: 0, updatedAt: now() };
  await c.env.DB.prepare("INSERT INTO question_sets (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .bind(set.id, set.name, set.updatedAt, set.updatedAt)
    .run();
  return c.json(set, 201);
});

app.get("/sets/:id", async (c) => {
  const db = c.env.DB;
  const set = await getSet(db, c.req.param("id"));
  if (!set) return fail(c, SET_GONE, 404);
  const { results } = await db.prepare("SELECT * FROM questions WHERE set_id = ? ORDER BY position").bind(set.id).all<QuestionRow>();
  const detail: QuestionSetDetail = { id: set.id, name: set.name, updatedAt: set.updated_at, questions: results.map(toQuestion) };
  return c.json(detail);
});

app.patch("/sets/:id", async (c) => {
  const { name } = await readBody(c);
  const err = checkSetName(name);
  if (err) return fail(c, err);
  const res = await c.env.DB.prepare("UPDATE question_sets SET name = ?, updated_at = ? WHERE id = ?")
    .bind((name as string).trim(), now(), c.req.param("id"))
    .run();
  if (!res.meta.changes) return fail(c, SET_GONE, 404);
  return c.json({ ok: true });
});

app.delete("/sets/:id", async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM question_sets WHERE id = ?").bind(c.req.param("id")).run();
  if (!res.meta.changes) return fail(c, SET_GONE, 404);
  return c.json({ ok: true });
});

app.post("/sets/:id/copy", async (c) => {
  const db = c.env.DB;
  const set = await getSet(db, c.req.param("id"));
  if (!set) return fail(c, SET_GONE, 404);
  const { results } = await db.prepare("SELECT * FROM questions WHERE set_id = ? ORDER BY position").bind(set.id).all<QuestionRow>();
  const copy: QuestionSetSummary = {
    id: crypto.randomUUID(),
    name: `${set.name}（複本）`.slice(0, MAX_SET_NAME),
    questionCount: results.length,
    updatedAt: now(),
  };
  await db.batch([
    db
      .prepare("INSERT INTO question_sets (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .bind(copy.id, copy.name, copy.updatedAt, copy.updatedAt),
    ...results.map((r, i) => insertQuestion(db, crypto.randomUUID(), copy.id, i, toQuestion(r))),
  ]);
  return c.json(copy, 201);
});

// Body: the question (type, text, note, points, config). Added at the end.
app.post("/sets/:id/questions", async (c) => {
  const db = c.env.DB;
  const set = await getSet(db, c.req.param("id"));
  if (!set) return fail(c, SET_GONE, 404);
  const { question, response } = readQuestion(c, await readBody(c));
  if (response) return response;
  if ((await questionCount(db, set.id)) >= MAX_QUESTIONS_PER_SET) return fail(c, TOO_MANY);
  const last = await db
    .prepare("SELECT COALESCE(MAX(position), -1) AS p FROM questions WHERE set_id = ?")
    .bind(set.id)
    .first<{ p: number }>();
  const id = crypto.randomUUID();
  await db.batch([insertQuestion(db, id, set.id, (last?.p ?? -1) + 1, question), touch(db, set.id)]);
  return c.json({ id, ...question } satisfies Question, 201);
});

// Body: the whole question. The type can't change (delete and re-create instead).
app.patch("/questions/:id", async (c) => {
  const db = c.env.DB;
  const row = await getQuestion(db, c.req.param("id"));
  if (!row) return fail(c, QUESTION_GONE, 404);
  const body = await readBody(c);
  if (body.type !== row.type) return fail(c, "題型建立後不能更改。要換題型，請刪掉這題再新增。");
  const { question, response } = readQuestion(c, body);
  if (response) return response;
  await db.batch([
    db
      .prepare("UPDATE questions SET text = ?, note = ?, points = ?, config = ? WHERE id = ?")
      .bind(question.text, question.note, question.points, JSON.stringify(question.config), row.id),
    touch(db, row.set_id),
  ]);
  return c.json({ id: row.id, ...question } satisfies Question);
});

app.delete("/questions/:id", async (c) => {
  const db = c.env.DB;
  const row = await getQuestion(db, c.req.param("id"));
  if (!row) return fail(c, QUESTION_GONE, 404);
  await db.batch([db.prepare("DELETE FROM questions WHERE id = ?").bind(row.id), touch(db, row.set_id)]);
  return c.json({ ok: true });
});

// The copy goes right after the original.
app.post("/questions/:id/copy", async (c) => {
  const db = c.env.DB;
  const row = await getQuestion(db, c.req.param("id"));
  if (!row) return fail(c, QUESTION_GONE, 404);
  if ((await questionCount(db, row.set_id)) >= MAX_QUESTIONS_PER_SET) return fail(c, TOO_MANY);
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare("UPDATE questions SET position = position + 1 WHERE set_id = ? AND position > ?").bind(row.set_id, row.position),
    insertQuestion(db, id, row.set_id, row.position + 1, toQuestion(row)),
    touch(db, row.set_id),
  ]);
  return c.json({ ...toQuestion(row), id }, 201);
});

// Body: { direction: "up" | "down" }. Swaps with the neighbour; at the top/bottom nothing happens.
app.post("/questions/:id/move", async (c) => {
  const { direction } = await readBody(c);
  if (direction !== "up" && direction !== "down") return fail(c, "請選擇上移或下移。");
  const db = c.env.DB;
  const row = await getQuestion(db, c.req.param("id"));
  if (!row) return fail(c, QUESTION_GONE, 404);
  const neighbour = await db
    .prepare(
      direction === "up"
        ? "SELECT id, position FROM questions WHERE set_id = ? AND position < ? ORDER BY position DESC LIMIT 1"
        : "SELECT id, position FROM questions WHERE set_id = ? AND position > ? ORDER BY position LIMIT 1",
    )
    .bind(row.set_id, row.position)
    .first<{ id: string; position: number }>();
  if (neighbour) {
    await db.batch([
      db.prepare("UPDATE questions SET position = ? WHERE id = ?").bind(neighbour.position, row.id),
      db.prepare("UPDATE questions SET position = ? WHERE id = ?").bind(row.position, neighbour.id),
      touch(db, row.set_id),
    ]);
  }
  return c.json({ ok: true });
});

export default app;
