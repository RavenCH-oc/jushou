import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "./index";
import type { Bindings } from "./env";
import { createTestDb } from "./test/d1";
import { createFakeHub } from "./test/hub";
import type { ClassSummary, GroupingDetail, GroupingSummary, QuestionSetSummary } from "../shared/types";
import type { QuestionData } from "../shared/questions";
import type { LessonDetail, StudentState } from "../shared/lesson";
import { analyze, parseRecord, summaryRate, type LessonSummary, type RecordDetail, type StudentHistory } from "../shared/records";

let env: Bindings;
let cookie: string;

beforeEach(async () => {
  env = { DB: createTestDb(), LESSON_HUB: createFakeHub().namespace, TEACHER_PASSWORD: "pw", SESSION_SECRET: "test-secret" };
  const res = await app.request(
    "/api/teacher/login",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "pw" }) },
    env,
  );
  cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0];
});

afterEach(() => vi.restoreAllMocks());

async function call<T>(path: string, method: string, headers: Record<string, string>, body?: unknown) {
  const res = await app.request(
    path,
    { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) },
    env,
  );
  return { status: res.status, data: (await res.json()) as T };
}

const teacher = <T = unknown>(method: string, path: string, body?: unknown) =>
  call<T>(`/api/teacher${path}`, method, { Cookie: cookie }, body);

function phone(code: string) {
  const token = crypto.randomUUID().replaceAll("-", "");
  const send = <T = unknown>(method: string, path: string, body?: unknown) =>
    call<T>(`/api/student${path}/${code}`, method, { "X-Device-Token": token }, body);
  return {
    state: () => send<StudentState>("GET", "/state"),
    bind: (seat: number) => send("POST", "/bind", { seat }),
    answer: (questionId: string, answer: unknown) => send("POST", "/answer", { questionId, answer }),
    unbind: () => send("POST", "/unbind"), // 「不是我？」
  };
}

const QUESTIONS: QuestionData[] = [
  { type: "truefalse", text: "〈出師表〉作者是諸葛亮", note: "", points: 1, config: { answer: true } },
  { type: "single", text: "「臣本布衣」的布衣指", note: "", points: 2, config: { options: ["平民", "衣服", "布料"], correct: [0] } },
  { type: "essay", text: "寫下你的感想", note: "", points: 5, config: {} },
  { type: "fill", text: "親賢臣，遠＿＿＿", note: "", points: 2, config: { blanks: [["小人"]] } }, // never asked
];

// A lesson still in progress.
async function activeLesson() {
  const { data: cls } = await teacher<ClassSummary>("POST", "/classes", { name: "高二孝班" });
  await teacher("POST", `/classes/${cls.id}/students/import`, { rows: [{ seat: 1, name: "學生1" }], onConflict: "skip" });
  const { data: set } = await teacher<QuestionSetSummary>("POST", "/sets", { name: "出師表" });
  await teacher("POST", `/sets/${set.id}/questions`, QUESTIONS[0]);
  const { data: lesson } = await teacher<{ id: string }>("POST", "/lessons", { classId: cls.id, setId: set.id });
  return { cls, lesson };
}

// 4 students: 1 and 2 answer, 3 joins but answers nothing, 4 never joins. The fill question is never asked.
async function runLesson() {
  const { data: cls } = await teacher<ClassSummary>("POST", "/classes", { name: "高二孝班" });
  const rows = [1, 2, 3, 4].map((seat) => ({ seat, name: `學生${seat}` }));
  await teacher("POST", `/classes/${cls.id}/students/import`, { rows, onConflict: "skip" });
  const { data: set } = await teacher<QuestionSetSummary>("POST", "/sets", { name: "出師表" });
  for (const q of QUESTIONS) await teacher("POST", `/sets/${set.id}/questions`, q);
  const { data: lesson } = await teacher<{ id: string }>("POST", "/lessons", { classId: cls.id, setId: set.id });
  const { data: live } = await teacher<LessonDetail>("GET", `/lessons/${lesson.id}`);
  const [tf, single, essay] = live.questions;
  const [p1, p2, p3] = [1, 2, 3].map(() => phone(live.joinCode));
  for (const [i, p] of [p1, p2, p3].entries()) {
    await p.bind(i + 1);
    await p.state();
  }
  await teacher("POST", `/lesson-questions/${tf.id}/open`);
  await p1.answer(tf.id, true);
  await p2.answer(tf.id, false);
  await teacher("POST", `/lesson-questions/${single.id}/open`);
  await p1.answer(single.id, 0);
  await p2.answer(single.id, 0);
  await teacher("POST", `/lesson-questions/${essay.id}/open`);
  await p1.answer(essay.id, "很忠心");
  await p2.answer(essay.id, "很囉嗦");
  await teacher("POST", `/lesson-questions/${essay.id}/close`);
  await teacher("POST", `/lesson-questions/${essay.id}/reveal`);
  // Grouped in the middle of the lesson: still part of its record.
  const { data: grouping } = await teacher<GroupingSummary>("POST", `/classes/${cls.id}/groupings`, {
    name: "國文小組",
    mode: "random",
    groupCount: 2,
  });
  await teacher("POST", `/lessons/${lesson.id}/end`);
  const students = (await teacher<RecordDetail>("GET", `/records/${lesson.id}`)).data.students;
  return { cls, id: lesson.id, tf, single, essay, students, p1, grouping };
}

describe("records API", () => {
  it("returns 401 without login", async () => {
    const routes: [string, string][] = [
      ["GET", "/classes/x/records"],
      ["GET", "/records/recent"],
      ["GET", "/records/x"],
      ["POST", "/records/x/grade"],
      ["DELETE", "/records/x"],
      ["GET", "/students/x/history"],
    ];
    for (const [method, path] of routes) {
      const res = await app.request(`/api/teacher${path}`, { method }, env);
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it("lists ended lessons with the same numbers the record page counts", async () => {
    const { cls, id, students, essay } = await runLesson();
    const [list, recent, detail] = await Promise.all([
      teacher<LessonSummary[]>("GET", `/classes/${cls.id}/records`),
      teacher<LessonSummary[]>("GET", "/records/recent"),
      teacher<RecordDetail>("GET", `/records/${id}`),
    ]);
    expect(list.data).toHaveLength(1);
    expect(recent.data[0].id).toBe(id);
    // tf 1 + single 2 + essay 5; the fill question was never asked.
    expect(list.data[0]).toMatchObject({
      className: "高二孝班",
      setName: "出師表",
      present: 3,
      total: 4,
      max: 8,
      scoreSum: 1 + 2 + 2,
      ungraded: 2,
    });
    const a = analyze(parseRecord(detail.data));
    expect(a.max).toBe(list.data[0].max);
    expect(a.present).toBe(list.data[0].present);
    expect(a.ungraded).toBe(list.data[0].ungraded);
    expect(a.average! * a.present).toBe(list.data[0].scoreSum);
    expect(summaryRate(list.data[0])).toBeCloseTo(5 / 24);
    expect(detail.data.students.map((s) => s.present)).toEqual([true, true, true, false]);

    await teacher("POST", `/records/${id}/grade`, { questionId: essay.id, studentId: students[0].id, score: 4 });
    const after = (await teacher<LessonSummary[]>("GET", `/classes/${cls.id}/records`)).data[0];
    expect(after).toMatchObject({ scoreSum: 9, ungraded: 1 });
  });

  it("an active lesson isn't a record yet", async () => {
    const { cls } = await activeLesson();
    expect((await teacher<LessonSummary[]>("GET", `/classes/${cls.id}/records`)).data).toEqual([]);
  });

  it("grades 簡答 only, within 0..配分", async () => {
    const { id, tf, essay, students, p1 } = await runLesson();
    const grade = (body: object) => teacher<{ error?: string }>("POST", `/records/${id}/grade`, body);
    const s1 = students[0].id;
    expect((await grade({ questionId: essay.id, studentId: s1, score: 6 })).status).toBe(400);
    expect((await grade({ questionId: essay.id, studentId: s1, score: -1 })).status).toBe(400);
    expect((await grade({ questionId: essay.id, studentId: s1, score: 2.5 })).status).toBe(400);
    expect((await grade({ questionId: essay.id, studentId: s1, score: "3" })).status).toBe(400);
    expect((await grade({ questionId: tf.id, studentId: s1, score: 1 })).status).toBe(400); // not 簡答
    expect((await grade({ questionId: essay.id, studentId: students[2].id, score: 1 })).status).toBe(404); // didn't answer
    expect((await grade({ questionId: essay.id, studentId: "nobody", score: 1 })).status).toBe(404);
    expect((await teacher("POST", `/records/other/grade`, { questionId: essay.id, studentId: s1, score: 1 })).status).toBe(404);

    expect((await grade({ questionId: essay.id, studentId: s1, score: 5 })).status).toBe(200);
    const detail = parseRecord((await teacher<RecordDetail>("GET", `/records/${id}`)).data);
    expect(detail.answers.find((a) => a.questionId === essay.id && a.studentId === s1)).toMatchObject({ status: "graded", score: 5 });
    // The student's 下課 screen shows it as graded.
    const items = (await p1.state()).data.result?.items;
    expect(items?.[2]).toMatchObject({ result: "graded", score: 5 });
  });

  it("deleting a record deletes its answers and attendance", async () => {
    const { id, cls } = await runLesson();
    const count = async (table: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n;
    expect(await count("answers")).toBe(6);
    expect(await count("lesson_groups")).toBe(4);
    expect((await teacher("DELETE", `/records/${id}`)).status).toBe(200);
    expect(await count("answers")).toBe(0);
    expect(await count("lesson_students")).toBe(0);
    expect(await count("lesson_questions")).toBe(0);
    expect(await count("lesson_groups")).toBe(0);
    expect((await teacher("GET", `/records/${id}`)).status).toBe(404);
    expect((await teacher<LessonSummary[]>("GET", `/classes/${cls.id}/records`)).data).toEqual([]);
    expect(await count("students")).toBe(4); // the roster stays
  });

  it("won't delete a lesson in progress", async () => {
    const { lesson } = await activeLesson();
    expect((await teacher("DELETE", `/records/${lesson.id}`)).status).toBe(409);
  });

  it("a student's history: absent is not 0 points", async () => {
    const { students } = await runLesson();
    const h1 = (await teacher<StudentHistory>("GET", `/students/${students[0].id}/history`)).data;
    expect(h1.student).toMatchObject({ seat: 1, className: "高二孝班" });
    expect(h1.lessons).toEqual([expect.objectContaining({ setName: "出師表", present: true, score: 3, max: 8, ungraded: 1 })]);
    const h3 = (await teacher<StudentHistory>("GET", `/students/${students[2].id}/history`)).data;
    expect(h3.lessons[0]).toMatchObject({ present: true, score: 0, ungraded: 0 });
    const h4 = (await teacher<StudentHistory>("GET", `/students/${students[3].id}/history`)).data;
    expect(h4.lessons[0]).toMatchObject({ present: false });
  });

  it("依分組看 keeps the groups as they were when the lesson ended", async () => {
    const { cls, id, grouping, students } = await runLesson();
    const then = (await teacher<GroupingDetail>("GET", `/groupings/${grouping.id}`)).data;
    const record = async () => (await teacher<RecordDetail>("GET", `/records/${id}`)).data;
    const expected = [
      { id: grouping.id, name: "國文小組", groups: then.groups.map((g) => ({ name: g.name, studentIds: [...g.studentIds].sort() })) },
    ];
    const saved = async () => {
      const r = await record();
      return r.groupings?.map((g) => ({ ...g, groups: g.groups.map((x) => ({ ...x, studentIds: [...x.studentIds].sort() })) }));
    };
    expect(await saved()).toEqual(expected);
    expect((await record()).groupingCount).toBe(1);

    // Changing the class's groups afterwards leaves the record alone.
    await teacher("PATCH", `/groupings/${grouping.id}`, { name: "改過的名字" });
    const mover = then.groups[0].studentIds[0];
    await teacher("PUT", `/groupings/${grouping.id}/members/${mover}`, { groupId: then.groups[1].id });
    await teacher("POST", `/classes/${cls.id}/groupings`, { name: "新的分組", mode: "random", groupCount: 2 });
    expect(await saved()).toEqual(expected);
    await teacher("DELETE", `/groupings/${grouping.id}`);
    expect(await saved()).toEqual(expected);
    expect((await record()).groupingCount).toBe(1);

    // A student deleted from the roster drops out of the snapshot too.
    await teacher("DELETE", `/students/${students[3].id}`);
    const left = (await record()).groupings![0].groups.flatMap((g) => g.studentIds);
    expect(left.sort()).toEqual(
      students
        .slice(0, 3)
        .map((s) => s.id)
        .sort(),
    );
  });

  it("starting a new lesson ends the old one with its groups saved", async () => {
    const { cls, lesson } = await activeLesson();
    await teacher("POST", `/classes/${cls.id}/groupings`, { name: "報告分組", mode: "random", groupCount: 1 });
    // What 開始上課 does when another lesson is still going: end it, then start.
    const { data: set } = await teacher<QuestionSetSummary>("POST", "/sets", { name: "師說" });
    await teacher("POST", `/sets/${set.id}/questions`, QUESTIONS[0]);
    expect((await teacher("POST", "/lessons", { classId: cls.id, setId: set.id })).status).toBe(409);
    await teacher("POST", `/lessons/${lesson.id}/end`);
    expect((await teacher("POST", "/lessons", { classId: cls.id, setId: set.id })).status).toBe(201);
    const old = (await teacher<RecordDetail>("GET", `/records/${lesson.id}`)).data;
    expect(old.groupings).toEqual([
      { id: expect.any(String), name: "報告分組", groups: [{ name: expect.any(String), studentIds: [expect.any(String)] }] },
    ]);
    // Ending twice doesn't copy the groups twice.
    await teacher("POST", `/lessons/${lesson.id}/end`);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM lesson_groups").first<{ n: number }>())?.n).toBe(1);
  });

  it("lessons that ended before groups were saved fall back to the current groups", async () => {
    const { id } = await runLesson();
    await env.DB.prepare("DELETE FROM lesson_groups").run();
    await env.DB.prepare("UPDATE lessons SET groups_saved = 0").run();
    const detail = (await teacher<RecordDetail>("GET", `/records/${id}`)).data;
    expect(detail.groupings).toBeNull();
    expect(detail.groupingCount).toBe(1); // the class's grouping now
  });

  it("a student who answered and was then unbound still counts as present", async () => {
    const { data: cls } = await teacher<ClassSummary>("POST", "/classes", { name: "高二孝班" });
    const rows = [1, 2].map((seat) => ({ seat, name: `學生${seat}` }));
    await teacher("POST", `/classes/${cls.id}/students/import`, { rows, onConflict: "skip" });
    const { data: set } = await teacher<QuestionSetSummary>("POST", "/sets", { name: "出師表" });
    for (const q of QUESTIONS.slice(0, 2)) await teacher("POST", `/sets/${set.id}/questions`, q);
    const { data: lesson } = await teacher<{ id: string }>("POST", "/lessons", { classId: cls.id, setId: set.id });
    const { data: live } = await teacher<LessonDetail>("GET", `/lessons/${lesson.id}`);
    const [tf, single] = live.questions;
    const [p1, p2] = [phone(live.joinCode), phone(live.joinCode)];
    await p1.bind(1);
    await p1.state();
    await p2.bind(2);
    await p2.state();
    await teacher("POST", `/lesson-questions/${tf.id}/open`);
    await p1.answer(tf.id, true);
    await p2.answer(tf.id, true);
    // 學生1 taps 「不是我？」, 學生2 is unbound by the teacher; neither comes back.
    await p1.unbind();
    const s2 = live.students[1].id;
    await teacher("POST", `/students/${s2}/unbind`);
    // The lesson screen's 已加入 still drops them.
    expect((await teacher<LessonDetail>("GET", `/lessons/${lesson.id}`)).data.students.map((s) => s.joined)).toEqual([false, false]);
    await teacher("POST", `/lesson-questions/${single.id}/open`);
    await teacher("POST", `/lessons/${lesson.id}/end`);

    const detail = (await teacher<RecordDetail>("GET", `/records/${lesson.id}`)).data;
    expect(detail.students.map((s) => s.present)).toEqual([true, true]);
    expect(analyze(parseRecord(detail)).students.map((s) => s.score)).toEqual([1, 1]);
    const [summary] = (await teacher<LessonSummary[]>("GET", `/classes/${cls.id}/records`)).data;
    expect(summary).toMatchObject({ present: 2, max: 3, scoreSum: 2 });
    const history = (await teacher<StudentHistory>("GET", `/students/${s2}/history`)).data;
    expect(history.lessons[0]).toMatchObject({ present: true, score: 1, max: 3 });
  });
});

describe("summaries stay cheap with a semester of data", () => {
  it("40 lessons × 30 students × 20 questions: a few SQL queries, no answer parsing in the Worker", async () => {
    const { data: cls } = await teacher<ClassSummary>("POST", "/classes", { name: "大班" });
    const rows = Array.from({ length: 30 }, (_, i) => ({ seat: i + 1, name: `學生${i + 1}` }));
    await teacher("POST", `/classes/${cls.id}/students/import`, { rows, onConflict: "skip" });
    const studentIds = (await env.DB.prepare("SELECT id FROM students ORDER BY seat").all<{ id: string }>()).results.map((s) => s.id);

    const db = env.DB;
    const stmts: D1PreparedStatement[] = [];
    for (let l = 0; l < 40; l++) {
      const lid = `L${l}`;
      const day = new Date(Date.UTC(2026, 8, 1 + l, 2)).toISOString();
      stmts.push(
        db
          .prepare("INSERT INTO lessons (id, class_id, set_name, status, started_at, ended_at) VALUES (?, ?, ?, 'ended', ?, ?)")
          .bind(lid, cls.id, `第${l}課`, day, day),
      );
      for (const sid of studentIds.slice(0, 28)) stmts.push(db.prepare("INSERT INTO lesson_students VALUES (?, ?, ?)").bind(lid, sid, day));
      for (let q = 0; q < 20; q++) {
        const qid = `${lid}Q${q}`;
        stmts.push(
          db
            .prepare("INSERT INTO lesson_questions VALUES (?, ?, ?, 'single', '題目', '', 1, ?, 'revealed')")
            .bind(qid, lid, q, JSON.stringify({ options: ["甲", "乙"], correct: [0] })),
        );
        for (const [i, sid] of studentIds.slice(0, 28).entries()) {
          const right = (i + q + l) % 3 !== 0;
          stmts.push(
            db
              .prepare("INSERT INTO answers VALUES (?, ?, ?, ?, ?, NULL, ?)")
              .bind(qid, sid, right ? "0" : "1", right ? "correct" : "wrong", right ? 1 : 0, day),
          );
        }
      }
    }
    await db.batch(stmts);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM answers").first<{ n: number }>())?.n).toBe(40 * 28 * 20);

    const prepare = vi.spyOn(env.DB, "prepare");
    const parse = vi.spyOn(JSON, "parse");

    const list = await teacher<LessonSummary[]>("GET", `/classes/${cls.id}/records`);
    expect(list.data).toHaveLength(40);
    expect(list.data[0].setName).toBe("第39課"); // newest first
    expect(list.data.every((l) => l.present === 28 && l.total === 30 && l.max === 20)).toBe(true);
    const history = await teacher<StudentHistory>("GET", `/students/${studentIds[0]}/history`);
    expect(history.data.lessons).toHaveLength(40);
    expect(history.data.lessons.every((l) => l.present && l.max === 20)).toBe(true);
    const absent = await teacher<StudentHistory>("GET", `/students/${studentIds[29]}/history`);
    expect(absent.data.lessons.every((l) => !l.present)).toBe(true);

    // Session check + one query per list; answers are added up by SQL, never parsed.
    expect(prepare.mock.calls.length).toBeLessThanOrEqual(6);
    expect(parse.mock.calls.filter(([text]) => typeof text === "string" && text.length < 5).length).toBe(0);

    // One lesson's detail sends answers as stored text, still without parsing them.
    parse.mockClear();
    const detail = await teacher<RecordDetail>("GET", "/records/L0");
    expect(detail.data.answers).toHaveLength(28 * 20);
    expect(typeof detail.data.answers[0].answer).toBe("string");
    const workerParses = parse.mock.calls.length;
    expect(workerParses).toBeLessThanOrEqual(20 + 2); // the 20 question configs (+ response handling)
  });
});
