import { beforeEach, describe, expect, it } from "vitest";
import app from "./index";
import type { Bindings } from "./env";
import { createTestDb } from "./test/d1";
import { createFakeHub, type Broadcast } from "./test/hub";
import type { ClassSummary, QuestionSetSummary } from "../shared/types";
import type { QuestionData } from "../shared/questions";
import type { ActiveLesson, EssayAnswer, LessonDetail, StudentState } from "../shared/lesson";

let env: Bindings;
let cookie: string;
let broadcasts: Broadcast[];

beforeEach(async () => {
  const hub = createFakeHub();
  broadcasts = hub.calls;
  env = { DB: createTestDb(), LESSON_HUB: hub.namespace, TEACHER_PASSWORD: "pw", SESSION_SECRET: "test-secret" };
  const res = await app.request(
    "/api/teacher/login",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "pw" }) },
    env,
  );
  cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0];
});

async function call<T>(path: string, method: string, headers: Record<string, string>, body?: unknown) {
  const res = await app.request(
    path,
    { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) },
    env,
  );
  return { status: res.status, data: (await res.json()) as T };
}

const teacher = <T = unknown>(method: string, path: string, body?: unknown) => call<T>(`/api/teacher${path}`, method, { Cookie: cookie }, body);

// A phone: its own random token, talking to the student API with a join code.
function phone(code: string, token = crypto.randomUUID().replaceAll("-", "")) {
  const send = <T = unknown>(method: string, path: string, body?: unknown) =>
    call<T>(`/api/student${path}/${code}`, method, { "X-Device-Token": token }, body);
  return {
    token,
    state: () => send<StudentState>("GET", "/state"),
    bind: (seat: number) => send<{ error?: string }>("POST", "/bind", { seat }),
    unbind: () => send("POST", "/unbind"),
    answer: (questionId: string, answer: unknown) => send<{ error?: string }>("POST", "/answer", { questionId, answer }),
  };
}

const QUESTIONS: QuestionData[] = [
  { type: "truefalse", text: "〈出師表〉作者是諸葛亮", note: "", points: 1, config: { answer: true } },
  { type: "single", text: "「臣本布衣」的布衣指", note: "想想身分", points: 2, config: { options: ["平民", "衣服", "布料"], correct: [0] } },
  { type: "multiple", text: "哪些是三國人物", note: "", points: 2, config: { options: ["劉備", "李白", "曹操"], correct: [0, 2] } },
  { type: "fill", text: "學而時習之，不亦＿＿＿乎？有朋自遠方來，不亦＿＿＿乎？", note: "", points: 2, config: { blanks: [["說", "悅"], ["樂"]] } },
  { type: "essay", text: "寫下你的感想", note: "", points: 5, config: {} },
];

async function setup(students = 3) {
  const { data: cls } = await teacher<ClassSummary>("POST", "/classes", { name: "高二孝班" });
  const rows = Array.from({ length: students }, (_, i) => ({ seat: i + 1, name: `學生${i + 1}` }));
  if (students) await teacher("POST", `/classes/${cls.id}/students/import`, { rows, onConflict: "skip" });
  const { data: set } = await teacher<QuestionSetSummary>("POST", "/sets", { name: "出師表" });
  for (const q of QUESTIONS) await teacher("POST", `/sets/${set.id}/questions`, q);
  return { cls, set };
}

async function startLesson() {
  const { cls, set } = await setup();
  const { data } = await teacher<{ id: string }>("POST", "/lessons", { classId: cls.id, setId: set.id });
  const lesson = () => teacher<LessonDetail>("GET", `/lessons/${data.id}`).then((r) => r.data);
  const step = (qid: string, s: "open" | "close" | "reveal") => teacher<{ error?: string }>("POST", `/lesson-questions/${qid}/${s}`);
  return { cls, set, id: data.id, lesson, step, qs: (await lesson()).questions };
}

async function count(table: string) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

describe("teacher lesson API", () => {
  it("returns 401 without login", async () => {
    const routes: [string, string][] = [
      ["GET", "/lessons/active"],
      ["POST", "/lessons"],
      ["GET", "/lessons/x"],
      ["POST", "/lessons/x/end"],
      ["POST", "/lesson-questions/x/open"],
      ["GET", "/lesson-questions/x/essays"],
      ["POST", "/students/x/unbind"],
    ];
    for (const [method, path] of routes) {
      const res = await app.request(`/api/teacher${path}`, { method }, env);
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it("copies the questions: editing or deleting the set later changes nothing", async () => {
    const { set, lesson } = await startLesson();
    const { data: full } = await teacher<{ questions: { id: string }[] }>("GET", `/sets/${set.id}`);
    await teacher("PATCH", `/questions/${full.questions[0].id}`, { ...QUESTIONS[0], text: "改過了" });
    await teacher("DELETE", `/sets/${set.id}`);
    const l = await lesson();
    expect(l.setName).toBe("出師表");
    expect(l.questions.map((q) => q.text)).toEqual(QUESTIONS.map((q) => q.text));
    expect(l.questions[1]).toMatchObject({ status: "pending", config: { options: ["平民", "衣服", "布料"], correct: [0] } });
  });

  it("only one lesson at a time", async () => {
    const { id, cls, set } = await startLesson();
    expect((await teacher<ActiveLesson>("GET", "/lessons/active")).data).toMatchObject({ id, className: "高二孝班" });
    const again = await teacher("POST", "/lessons", { classId: cls.id, setId: set.id });
    expect(again.status).toBe(409);
    await teacher("POST", `/lessons/${id}/end`);
    expect((await teacher("GET", "/lessons/active")).data).toBeNull();
    expect((await teacher("POST", "/lessons", { classId: cls.id, setId: set.id })).status).toBe(201);
  });

  it("refuses an empty set or a class without students", async () => {
    const { cls, set } = await setup(0);
    expect((await teacher("POST", "/lessons", { classId: cls.id, setId: set.id })).status).toBe(400);
    const { data: empty } = await teacher<QuestionSetSummary>("POST", "/sets", { name: "空的" });
    const { cls: full } = await setup(2);
    expect((await teacher("POST", "/lessons", { classId: full.id, setId: empty.id })).status).toBe(400);
  });

  it("steps a question pending → open → closed → revealed, one open at a time", async () => {
    const { id, qs, step, lesson } = await startLesson();
    expect((await step(qs[0].id, "close")).status).toBe(409);
    expect((await step(qs[0].id, "open")).status).toBe(200);
    expect(broadcasts.at(-1)).toEqual({ lesson: id, t: "question", to: "all" });
    await step(qs[1].id, "open");
    const l = await lesson();
    expect(l.currentQuestionId).toBe(qs[1].id);
    expect(l.questions.slice(0, 2).map((q) => q.status)).toEqual(["closed", "open"]);
    await step(qs[1].id, "close");
    await step(qs[1].id, "reveal");
    expect((await lesson()).questions[1].status).toBe("revealed");

    await teacher("POST", `/lessons/${id}/end`);
    expect(broadcasts.at(-1)).toEqual({ lesson: id, t: "ended", to: "all" });
    expect((await step(qs[2].id, "open")).status).toBe(409);
  });

  it("deleting the class deletes its lessons and answers", async () => {
    const { id, cls, qs, step } = await startLesson();
    const p = phone((await teacher<{ joinCode: string }>("GET", `/classes/${cls.id}`)).data.joinCode);
    await p.bind(1);
    await p.state();
    await step(qs[0].id, "open");
    await p.answer(qs[0].id, true);
    expect(await count("answers")).toBe(1);
    await teacher("DELETE", `/classes/${cls.id}`);
    for (const table of ["lessons", "lesson_questions", "lesson_students", "answers"]) expect(await count(table), table).toBe(0);
    expect(broadcasts.at(-1)).toEqual({ lesson: id, t: "ended", to: "all" });
  });
});

describe("student", () => {
  async function inLesson() {
    const l = await startLesson();
    const code = (await l.lesson()).joinCode;
    return { ...l, code };
  }

  it("join code: unknown code, no lesson yet, then the seat list", async () => {
    expect((await phone("000000").state()).status).toBe(404);
    const { cls } = await setup();
    const code = (await teacher<{ joinCode: string }>("GET", `/classes/${cls.id}`)).data.joinCode;
    const { data } = await phone(code).state();
    expect(data).toMatchObject({ className: "高二孝班", lessonId: null, me: null, current: null });
    expect(data.seats).toEqual([1, 2, 3].map((seat) => ({ seat, name: `學生${seat}`, taken: false })));
  });

  it("binds a seat once; another phone can't take it; binding again moves this phone", async () => {
    const { code, lesson } = await inLesson();
    const a = phone(code);
    const b = phone(code);
    expect((await a.bind(1)).status).toBe(200);
    expect((await a.state()).data.me).toEqual({ seat: 1, name: "學生1" });
    const taken = await b.bind(1);
    expect(taken.status).toBe(409);
    expect(taken.data.error).toContain("請找老師");
    expect((await b.state()).data.seats?.[0]).toMatchObject({ seat: 1, taken: true });

    // A token that isn't a real random token counts as no phone at all.
    expect((await phone(code, "short").bind(2)).status).toBe(400);

    await a.bind(2); // 點錯人 then picks again: seat 1 is free again
    expect((await b.bind(1)).status).toBe(200);
    await b.state();
    await a.state();
    const students = (await lesson()).students;
    expect(students.map((s) => s.bound)).toEqual([true, true, false]);
    expect(students.map((s) => s.joined)).toEqual([true, true, false]);
  });

  it("joining is broadcast to the teacher only, once", async () => {
    const { code, id } = await inLesson();
    const a = phone(code);
    await a.bind(1);
    await a.state();
    await a.state();
    expect(broadcasts.filter((b) => b.t === "roster")).toEqual([{ lesson: id, t: "roster", to: "teacher" }]);
  });

  it("gets no answers before the reveal, then only its own result", async () => {
    const { code, qs, step } = await inLesson();
    const a = phone(code);
    const b = phone(code);
    await a.bind(1);
    await b.bind(2);
    expect((await a.state()).data.current).toBeNull(); // nothing pushed yet

    for (const [i, q] of qs.entries()) {
      await step(q.id, "open");
      const raw = JSON.stringify((await a.state()).data);
      expect(raw).not.toContain("correct");
      expect(raw).not.toContain("config");
      expect(raw).not.toContain("悅");
      expect(raw).not.toContain("blanks");
      expect((await a.state()).data.current).toMatchObject({ number: i + 1, total: 5, status: "open", answer: null });
      await step(q.id, "close");
      expect(JSON.stringify((await a.state()).data)).not.toContain("correct");
    }
    await step(qs[0].id, "reveal");
    // The teacher pushed question 5 last, so that's still what students see.
    expect((await b.state()).data.current?.question.id).toBe(qs[4].id);
  });

  it("answers: only while open, graded by the server, last one counts", async () => {
    const { code, qs, step, lesson } = await inLesson();
    const a = phone(code);
    const b = phone(code);
    await a.bind(1);
    await b.bind(2);
    const fill = qs[3];

    expect((await a.answer(fill.id, ["說", "樂"])).status).toBe(409); // not pushed yet
    await step(fill.id, "open");
    expect((await a.answer(fill.id, ["", " "])).status).toBe(400); // nothing filled in
    expect((await a.answer(fill.id, ["說", "苦"])).status).toBe(200);
    expect((await a.answer(fill.id, ["ｓ", "樂"])).status).toBe(200); // replaces the first one
    expect((await b.answer(fill.id, ["悅", " 樂 "])).status).toBe(200);
    expect(broadcasts.at(-1)).toMatchObject({ t: "answers", to: "teacher" });
    expect(await count("answers")).toBe(2);
    expect((await a.state()).data.current?.answer).toEqual(["ｓ", "樂"]);

    await step(fill.id, "close");
    expect((await a.answer(fill.id, ["說", "樂"])).status).toBe(409);

    const stats = (await lesson()).questions[3].stats;
    expect(stats).toEqual({ answered: 2, correct: 1, blanks: [1, 2] });

    await step(fill.id, "reveal");
    const ra = (await a.state()).data.current!;
    expect(ra.reveal?.result).toEqual({ status: "wrong", score: 0, blanks: [false, true] });
    expect(ra.reveal?.question.config).toEqual({ blanks: [["說", "悅"], ["樂"]] });
    expect((await b.state()).data.current?.reveal?.result).toEqual({ status: "correct", score: 2, blanks: [true, true] });
    // Nobody else's answer ever shows up.
    expect(JSON.stringify((await b.state()).data)).not.toContain("ｓ");

    const c = phone(code);
    await c.bind(3);
    expect((await c.state()).data.current?.reveal?.result.status).toBe("unanswered");
  });

  it("counts choices for the teacher and keeps essays for 看作答內容", async () => {
    const { code, qs, step, lesson } = await inLesson();
    const [a, b, c] = [phone(code), phone(code), phone(code)];
    await a.bind(1);
    await b.bind(2);
    await c.bind(3);
    await step(qs[2].id, "open");
    await a.answer(qs[2].id, [0, 2]);
    await b.answer(qs[2].id, [0]);
    await c.answer(qs[2].id, [1, 2]);
    expect((await lesson()).questions[2].stats).toEqual({ answered: 3, correct: 1, choices: [2, 1, 2] });

    await step(qs[4].id, "open");
    await b.answer(qs[4].id, "很感動");
    const q = (await lesson()).questions[4];
    expect(q.stats).toEqual({ answered: 1, correct: 0 });
    expect(q.answeredBy).toHaveLength(1);
    expect((await teacher<EssayAnswer[]>("GET", `/lesson-questions/${qs[4].id}/essays`)).data).toEqual([
      { seat: 2, name: "學生2", text: "很感動" },
    ]);
  });

  it("a token can't act as anyone else or in another class", async () => {
    const { code, qs, step } = await inLesson();
    const a = phone(code);
    await a.bind(1);
    await step(qs[0].id, "open");

    expect((await phone(code).answer(qs[0].id, true)).status).toBe(403); // not bound
    const { data: other } = await teacher<ClassSummary>("POST", "/classes", { name: "別班" });
    await teacher("POST", `/classes/${other.id}/students`, { seat: 1, name: "別人" });
    // Same phone, other class's code: not bound there, so it's nobody.
    const elsewhere = phone(other.joinCode, a.token);
    expect((await elsewhere.state()).data.me).toBeNull();
    expect((await elsewhere.answer(qs[0].id, true)).status).toBe(403);
  });

  it("unbinding: by the student (不是我？) or by the teacher", async () => {
    const { code, id, lesson } = await inLesson();
    const a = phone(code);
    await a.bind(1);
    await a.state();
    await a.unbind();
    expect((await a.state()).data.me).toBeNull();
    expect((await lesson()).students[0]).toMatchObject({ bound: false, joined: false });

    await a.bind(1);
    await a.state();
    const student = (await lesson()).students[0];
    await teacher("POST", `/students/${student.id}/unbind`);
    expect(broadcasts.at(-1)).toEqual({ lesson: id, t: "roster", to: "all" });
    expect((await a.state()).data.me).toBeNull();
    expect((await lesson()).students[0]).toMatchObject({ bound: false, joined: false });
    expect((await phone(code).bind(1)).status).toBe(200); // a new phone can take the seat
  });

  it("binding stays for the next lesson", async () => {
    const { code, id, cls, set } = await inLesson();
    const a = phone(code);
    await a.bind(2);
    await teacher("POST", `/lessons/${id}/end`);
    expect((await a.state()).data).toMatchObject({ lessonId: null, me: { seat: 2 } });
    const { data: next } = await teacher<{ id: string }>("POST", "/lessons", { classId: cls.id, setId: set.id });
    expect((await a.state()).data).toMatchObject({ lessonId: next.id, me: { seat: 2 } });
  });
});
