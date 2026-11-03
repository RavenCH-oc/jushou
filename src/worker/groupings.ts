import { Hono } from "hono";
import type { AppEnv } from "./env";
import { checkGroupCount, checkGroupingName, checkGroupName, MAX_GROUPING_NAME, MAX_GROUPS } from "../shared/limits";
import { defaultGroupName, groupCountFor, randomGroups } from "../shared/grouping";
import type { GroupingDetail, GroupingSummary, Student } from "../shared/types";
import { cryptoRandom, fail, now, readBody } from "./util";

const app = new Hono<AppEnv>();

const GROUPING_GONE = "找不到這套分組，可能已經被刪除。";

type GroupingRow = { id: string; class_id: string; name: string };
type GroupRow = { id: string; name: string };

function getGrouping(db: D1Database, id: string) {
  return db.prepare("SELECT id, class_id, name FROM groupings WHERE id = ?").bind(id).first<GroupingRow>();
}

async function classStudentIds(db: D1Database, classId: string) {
  const { results } = await db.prepare("SELECT id FROM students WHERE class_id = ?").bind(classId).all<{ id: string }>();
  return results.map((s) => s.id);
}

function insertMembers(db: D1Database, groupingId: string, groupIds: string[], members: string[][]) {
  return members.flatMap((studentIds, i) =>
    studentIds.map((studentId) =>
      db
        .prepare("INSERT INTO group_members (grouping_id, group_id, student_id) VALUES (?, ?, ?)")
        .bind(groupingId, groupIds[i], studentId),
    ),
  );
}

// Body: { name, mode: "random" | "manual", groupCount?, groupSize? }
// Random needs exactly one of groupCount / groupSize; manual needs groupCount.
app.post("/classes/:id/groupings", async (c) => {
  const { name, mode, groupCount, groupSize } = await readBody(c);
  const nameErr = checkGroupingName(name);
  if (nameErr) return fail(c, nameErr);
  if (mode !== "random" && mode !== "manual") return fail(c, "請選擇隨機分組或手動分組。");

  const db = c.env.DB;
  const classId = c.req.param("id");
  const cls = await db.prepare("SELECT id FROM classes WHERE id = ?").bind(classId).first();
  if (!cls) return fail(c, "找不到這個班級，可能已經被刪除。", 404);
  const studentIds = await classStudentIds(db, classId);

  let count: number;
  if (mode === "manual" || groupSize === undefined || groupSize === null) {
    const err = checkGroupCount(groupCount);
    if (err) return fail(c, err);
    count = groupCount as number;
  } else {
    if (groupCount !== undefined && groupCount !== null) return fail(c, "「分成幾組」和「每組幾人」只能選一個。");
    if (typeof groupSize !== "number" || !Number.isInteger(groupSize) || groupSize < 1) {
      return fail(c, "每組人數要是正整數。");
    }
    count = groupCountFor(studentIds.length, { groupSize });
  }
  if (mode === "random") {
    if (studentIds.length === 0) return fail(c, "名冊裡還沒有學生，請先加入學生再隨機分組。");
    if (count > studentIds.length) return fail(c, `組數不能比學生人數（${studentIds.length} 人）多。`);
  }

  const groupingId = crypto.randomUUID();
  const groupIds = Array.from({ length: count }, () => crypto.randomUUID());
  const members = mode === "random" ? randomGroups(studentIds, count, cryptoRandom) : [];
  await db.batch([
    db
      .prepare("INSERT INTO groupings (id, class_id, name, created_at) VALUES (?, ?, ?, ?)")
      .bind(groupingId, classId, (name as string).trim(), now()),
    ...groupIds.map((id, i) =>
      db
        .prepare("INSERT INTO groups (id, grouping_id, name, position) VALUES (?, ?, ?, ?)")
        .bind(id, groupingId, defaultGroupName(i), i),
    ),
    ...insertMembers(db, groupingId, groupIds, members),
  ]);
  const summary: GroupingSummary = { id: groupingId, name: (name as string).trim(), groupCount: count };
  return c.json(summary, 201);
});

app.get("/groupings/:id", async (c) => {
  const db = c.env.DB;
  const grouping = await getGrouping(db, c.req.param("id"));
  if (!grouping) return fail(c, GROUPING_GONE, 404);
  const [cls, groups, members, students] = await Promise.all([
    db.prepare("SELECT name FROM classes WHERE id = ?").bind(grouping.class_id).first<{ name: string }>(),
    db.prepare("SELECT id, name FROM groups WHERE grouping_id = ? ORDER BY position").bind(grouping.id).all<GroupRow>(),
    db
      .prepare("SELECT group_id, student_id FROM group_members WHERE grouping_id = ?")
      .bind(grouping.id)
      .all<{ group_id: string; student_id: string }>(),
    db.prepare("SELECT id, seat, name FROM students WHERE class_id = ? ORDER BY seat").bind(grouping.class_id).all<Student>(),
  ]);
  const seatOf = new Map(students.results.map((s) => [s.id, s.seat]));
  const detail: GroupingDetail = {
    id: grouping.id,
    classId: grouping.class_id,
    className: cls?.name ?? "",
    name: grouping.name,
    groups: groups.results.map((g) => ({
      id: g.id,
      name: g.name,
      studentIds: members.results
        .filter((m) => m.group_id === g.id)
        .map((m) => m.student_id)
        .sort((a, b) => (seatOf.get(a) ?? 0) - (seatOf.get(b) ?? 0)),
    })),
    students: students.results,
  };
  return c.json(detail);
});

app.patch("/groupings/:id", async (c) => {
  const { name } = await readBody(c);
  const err = checkGroupingName(name);
  if (err) return fail(c, err);
  const res = await c.env.DB.prepare("UPDATE groupings SET name = ? WHERE id = ?")
    .bind((name as string).trim(), c.req.param("id"))
    .run();
  if (!res.meta.changes) return fail(c, GROUPING_GONE, 404);
  return c.json({ ok: true });
});

app.patch("/groups/:id", async (c) => {
  const { name } = await readBody(c);
  const err = checkGroupName(name);
  if (err) return fail(c, err);
  const res = await c.env.DB.prepare("UPDATE groups SET name = ? WHERE id = ?")
    .bind((name as string).trim(), c.req.param("id"))
    .run();
  if (!res.meta.changes) return fail(c, "找不到這一組，可能已經被刪除。", 404);
  return c.json({ ok: true });
});

// Add one empty group at the end, named after its position (第 N 組).
app.post("/groupings/:id/groups", async (c) => {
  const db = c.env.DB;
  const grouping = await getGrouping(db, c.req.param("id"));
  if (!grouping) return fail(c, GROUPING_GONE, 404);
  const row = await db
    .prepare("SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) AS last FROM groups WHERE grouping_id = ?")
    .bind(grouping.id)
    .first<{ n: number; last: number }>();
  const n = row?.n ?? 0;
  if (n >= MAX_GROUPS) return fail(c, `一套分組最多 ${MAX_GROUPS} 組。`);
  const group = { id: crypto.randomUUID(), name: defaultGroupName(n), studentIds: [] as string[] };
  await db
    .prepare("INSERT INTO groups (id, grouping_id, name, position) VALUES (?, ?, ?, ?)")
    .bind(group.id, grouping.id, group.name, (row?.last ?? -1) + 1)
    .run();
  return c.json(group, 201);
});

// Members of a deleted group go back to 未分組 (their rows cascade away).
app.delete("/groups/:id", async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM groups WHERE id = ?").bind(c.req.param("id")).run();
  if (!res.meta.changes) return fail(c, "找不到這一組，可能已經被刪除。", 404);
  return c.json({ ok: true });
});

// Body: { groupId: string | null }. null takes the student out of this grouping.
app.put("/groupings/:id/members/:studentId", async (c) => {
  const { groupId } = await readBody(c);
  const db = c.env.DB;
  const grouping = await getGrouping(db, c.req.param("id"));
  if (!grouping) return fail(c, GROUPING_GONE, 404);
  const studentId = c.req.param("studentId");
  const student = await db
    .prepare("SELECT 1 FROM students WHERE id = ? AND class_id = ?")
    .bind(studentId, grouping.class_id)
    .first();
  if (!student) return fail(c, "找不到這位學生，可能已經被刪除。", 404);

  if (groupId === null) {
    await db
      .prepare("DELETE FROM group_members WHERE grouping_id = ? AND student_id = ?")
      .bind(grouping.id, studentId)
      .run();
    return c.json({ ok: true });
  }
  if (typeof groupId !== "string") return fail(c, "請選擇要移到哪一組。");
  const group = await db
    .prepare("SELECT 1 FROM groups WHERE id = ? AND grouping_id = ?")
    .bind(groupId, grouping.id)
    .first();
  if (!group) return fail(c, "找不到這一組，可能已經被刪除。", 404);
  await db
    .prepare(
      `INSERT INTO group_members (grouping_id, group_id, student_id) VALUES (?, ?, ?)
       ON CONFLICT (grouping_id, student_id) DO UPDATE SET group_id = excluded.group_id`,
    )
    .bind(grouping.id, groupId, studentId)
    .run();
  return c.json({ ok: true });
});

// Re-deal every student in the class across the existing groups.
app.post("/groupings/:id/shuffle", async (c) => {
  const db = c.env.DB;
  const grouping = await getGrouping(db, c.req.param("id"));
  if (!grouping) return fail(c, GROUPING_GONE, 404);
  const { results: groups } = await db
    .prepare("SELECT id FROM groups WHERE grouping_id = ? ORDER BY position")
    .bind(grouping.id)
    .all<{ id: string }>();
  const groupIds = groups.map((g) => g.id);
  if (groupIds.length === 0) return fail(c, "這套分組還沒有任何組，請先按「新增一組」。");
  const studentIds = await classStudentIds(db, grouping.class_id);
  await db.batch([
    db.prepare("DELETE FROM group_members WHERE grouping_id = ?").bind(grouping.id),
    ...insertMembers(db, grouping.id, groupIds, randomGroups(studentIds, groupIds.length, cryptoRandom)),
  ]);
  return c.json({ ok: true });
});

app.post("/groupings/:id/copy", async (c) => {
  const db = c.env.DB;
  const grouping = await getGrouping(db, c.req.param("id"));
  if (!grouping) return fail(c, GROUPING_GONE, 404);
  const [{ results: groups }, { results: members }] = await Promise.all([
    db.prepare("SELECT id, name, position FROM groups WHERE grouping_id = ?").bind(grouping.id).all<GroupRow & { position: number }>(),
    db
      .prepare("SELECT group_id, student_id FROM group_members WHERE grouping_id = ?")
      .bind(grouping.id)
      .all<{ group_id: string; student_id: string }>(),
  ]);
  const newId = crypto.randomUUID();
  const newGroupId = new Map(groups.map((g) => [g.id, crypto.randomUUID()]));
  const name = `${grouping.name}（複本）`.slice(0, MAX_GROUPING_NAME);
  await db.batch([
    db
      .prepare("INSERT INTO groupings (id, class_id, name, created_at) VALUES (?, ?, ?, ?)")
      .bind(newId, grouping.class_id, name, now()),
    ...groups.map((g) =>
      db
        .prepare("INSERT INTO groups (id, grouping_id, name, position) VALUES (?, ?, ?, ?)")
        .bind(newGroupId.get(g.id), newId, g.name, g.position),
    ),
    ...members.map((m) =>
      db
        .prepare("INSERT INTO group_members (grouping_id, group_id, student_id) VALUES (?, ?, ?)")
        .bind(newId, newGroupId.get(m.group_id), m.student_id),
    ),
  ]);
  const summary: GroupingSummary = { id: newId, name, groupCount: groups.length };
  return c.json(summary, 201);
});

app.delete("/groupings/:id", async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM groupings WHERE id = ?").bind(c.req.param("id")).run();
  if (!res.meta.changes) return fail(c, GROUPING_GONE, 404);
  return c.json({ ok: true });
});

export default app;
