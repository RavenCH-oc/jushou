import { beforeEach, describe, expect, it } from "vitest";
import app from "./index";
import type { Bindings } from "./env";
import { createTestDb } from "./test/d1";
import { createFakeHub } from "./test/hub";
import type { ClassSummary, QuestionSetSummary } from "../shared/types";
import type { QuestionData } from "../shared/questions";
import type { LessonDetail, StudentState } from "../shared/lesson";
import { analyze, parseRecord, type LessonSummary, type RecordDetail, type StudentHistory } from "../shared/records";

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

async function call<T>(path: string, method: string, headers: Record<string, string>, body?: unknown) {
  const res = await app.request(
    path,
    { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) },
    env,
  );
  const text = await res.text();
  return { status: res.status, data: JSON.parse(text) as T, text };
}

const teacher = <T = unknown>(method: string, path: string, body?: unknown) =>
  call<T & { error?: string }>(`/api/teacher${path}`, method, { Cookie: cookie }, body);

function phone(code: string) {
  const token = crypto.randomUUID().replaceAll("-", "");
  const send = <T = unknown>(method: string, path: string, body?: unknown) =>
    call<T>(`/api/student${path}/${code}`, method, { "X-Device-Token": token }, body);
  return {
    state: () => send<StudentState>("GET", "/state"),
    bind: (seat: number) => send("POST", "/bind", { seat }),
    answer: (questionId: string, answer: unknown) => send("POST", "/answer", { questionId, answer }),
  };
}

const q = (text: string): QuestionData => ({ type: "truefalse", text, note: "", points: 2, config: { answer: true } });

// A lesson with the given set questions (none: 不用題組) and `n` students who joined.
async function lesson(setTexts: string[] | null, n = 3) {
  const { data: cls } = await teacher<ClassSummary>("POST", "/classes", { name: "高二孝班" });
  const rows = Array.from({ length: n }, (_, i) => ({ seat: i + 1, name: `學生${i + 1}` }));
  await teacher("POST", `/classes/${cls.id}/students/import`, { rows, onConflict: "skip" });
  let setId: string | null = null;
  if (setTexts) {
    const { data: set } = await teacher<QuestionSetSummary>("POST", "/sets", { name: "論語" });
    for (const t of setTexts) await teacher("POST", `/sets/${set.id}/questions`, q(t));
    setId = set.id;
  }
  const res = await teacher<{ id: string }>("POST", "/lessons", { classId: cls.id, setId });
  expect(res.status).toBe(201);
  const id = res.data.id;
  const detail = async () => (await teacher<LessonDetail>("GET", `/lessons/${id}`)).data;
  const phones = [];
  const live = await detail();
  for (let i = 0; i < n; i++) {
    const p = phone(live.joinCode);
    await p.bind(i + 1);
    await p.state();
    phones.push(p);
  }
  const quick = async (body: object) => {
    const r = await teacher<{ id: string }>("POST", `/lessons/${id}/quick`, body);
    expect(r.status, r.text).toBe(201);
    return r.data.id;
  };
  return { cls, id, detail, phones, quick, students: live.students };
}

const order = (d: LessonDetail) => d.questions.map((x) => x.text || "臨時");

describe("不用題組", () => {
  it("starts a lesson with no questions, named 隨堂", async () => {
    const { id, cls, detail } = await lesson(null);
    const d = await detail();
    expect(d.setName).toBe("隨堂");
    expect(d.questions).toEqual([]);
    expect(d.currentQuestionId).toBeNull();
    await teacher("POST", `/lessons/${id}/end`);
    const [summary] = (await teacher<LessonSummary[]>("GET", `/classes/${cls.id}/records`)).data;
    expect(summary).toMatchObject({ setName: "隨堂", max: 0, present: 3 });
  });

  it("a set that doesn't exist is still an error", async () => {
    const { data: cls } = await teacher<ClassSummary>("POST", "/classes", { name: "高二孝班" });
    await teacher("POST", `/classes/${cls.id}/students/import`, { rows: [{ seat: 1, name: "甲" }], onConflict: "skip" });
    expect((await teacher("POST", "/lessons", { classId: cls.id, setId: "nope" })).status).toBe(404);
    expect((await teacher("POST", "/lessons", { classId: cls.id })).status).toBe(404);
  });
});

describe("臨時出題", () => {
  it("goes first when nothing was asked yet, and opens right away", async () => {
    const { detail, quick } = await lesson(["一", "二"]);
    const qid = await quick({ type: "single", optionCount: 4 });
    const d = await detail();
    expect(order(d)).toEqual(["臨時", "一", "二"]);
    expect(d.currentQuestionId).toBe(qid);
    expect(d.questions[0]).toMatchObject({
      quick: true,
      scored: false, // no answer yet: counts only once one is picked at 公布
      status: "open",
      points: 1,
      config: { options: ["", "", "", ""], correct: [] },
    });
  });

  it("goes right after the current question, stops it, and 出下一題 carries on with the set", async () => {
    const { detail, quick } = await lesson(["一", "二", "三"]);
    let d = await detail();
    await teacher("POST", `/lesson-questions/${d.questions[0].id}/open`);
    await teacher("POST", `/lesson-questions/${d.questions[0].id}/close`);
    await teacher("POST", `/lesson-questions/${d.questions[0].id}/reveal`);
    await teacher("POST", `/lesson-questions/${d.questions[1].id}/open`); // 第 2 題 is open
    const q1 = await quick({ type: "truefalse", text: "臨時一" });
    d = await detail();
    expect(order(d)).toEqual(["一", "二", "臨時一", "三"]);
    expect(d.questions.map((x) => x.status)).toEqual(["revealed", "closed", "open", "pending"]); // 二 was stopped
    // Reveal it, then the next one in line is 三.
    await teacher("POST", `/lesson-questions/${q1}/close`);
    await teacher("POST", `/lesson-questions/${q1}/reveal`, { answer: true });
    d = await detail();
    const at = d.questions.findIndex((x) => x.id === d.currentQuestionId);
    expect(d.questions[at + 1].text).toBe("三");
    await teacher("POST", `/lesson-questions/${d.questions[at + 1].id}/open`);
    // And one more at the very end.
    await quick({ type: "essay" });
    d = await detail();
    expect(order(d)).toEqual(["一", "二", "臨時一", "三", "臨時"]);
    expect(d.questions.at(-1)!.status).toBe("open");
    expect(d.questions.find((x) => x.text === "三")!.status).toBe("closed");
  });

  it("in a lesson without a set, quick questions just line up", async () => {
    const { detail, quick } = await lesson(null);
    await quick({ type: "single", optionCount: 3, text: "A" });
    await quick({ type: "truefalse", text: "B" });
    await quick({ type: "essay", text: "C" });
    const d = await detail();
    expect(d.questions.map((x) => [x.text, x.status])).toEqual([
      ["A", "closed"],
      ["B", "closed"],
      ["C", "open"],
    ]);
  });

  it("checks the request and needs the teacher", async () => {
    const { id, quick } = await lesson(null);
    for (const body of [
      { type: "multiple", optionCount: 4 },
      { type: "fill" },
      { type: "single", optionCount: 7 },
      { type: "single", optionCount: 1 },
      { type: "essay", text: "字".repeat(201) },
    ]) {
      expect((await teacher("POST", `/lessons/${id}/quick`, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await app.request(`/api/teacher/lessons/${id}/quick`, { method: "POST" }, env)).status).toBe(401);
    expect((await app.request(`/api/teacher/lesson-questions/x/reveal`, { method: "POST" }, env)).status).toBe(401);
    expect((await teacher("POST", `/lessons/nope/quick`, { type: "essay" })).status).toBe(404);
    await quick({ type: "essay" });
    await teacher("POST", `/lessons/${id}/end`);
    expect((await teacher("POST", `/lessons/${id}/quick`, { type: "essay" })).status).toBe(409);
  });
});

describe("公布 a quick question", () => {
  it("grades every answer again with the chosen answer", async () => {
    const { detail, quick, phones, students } = await lesson(null, 4);
    const qid = await quick({ type: "single", optionCount: 4 });
    await phones[0].answer(qid, 0);
    await phones[1].answer(qid, 1);
    await phones[2].answer(qid, 1);
    await teacher("POST", `/lesson-questions/${qid}/close`);
    // The phone never had a correct answer to see before 公布.
    const before = await phones[1].state();
    expect(before.data.current?.reveal).toBeUndefined();
    expect(before.data.current?.question).toEqual({
      id: qid,
      type: "single",
      text: "",
      note: "",
      points: 1,
      quick: true,
      options: ["", "", "", ""],
    });
    expect(before.text).not.toContain("correct");

    expect((await teacher("POST", `/lesson-questions/${qid}/reveal`, { answer: 1 })).status).toBe(200);
    const d = await detail();
    expect(d.questions[0]).toMatchObject({
      status: "revealed",
      scored: true,
      config: { correct: [1] },
      stats: { answered: 3, correct: 2 },
    });
    const rows = (
      await env.DB.prepare("SELECT student_id, status, score FROM answers WHERE lesson_question_id = ?")
        .bind(qid)
        .all<{ student_id: string; status: string; score: number }>()
    ).results;
    const byStudent = Object.fromEntries(rows.map((r) => [r.student_id, [r.status, r.score]]));
    expect(byStudent).toEqual({ [students[0].id]: ["wrong", 0], [students[1].id]: ["correct", 1], [students[2].id]: ["correct", 1] });
    expect((await phones[1].state()).data.current?.reveal?.result).toEqual({ status: "correct", score: 1 });
    expect((await phones[3].state()).data.current?.reveal?.result.status).toBe("unanswered");
  });

  it("是非題 too", async () => {
    const { quick, phones } = await lesson(null, 2);
    const qid = await quick({ type: "truefalse" });
    await phones[0].answer(qid, true);
    await phones[1].answer(qid, false);
    await teacher("POST", `/lesson-questions/${qid}/close`);
    await teacher("POST", `/lesson-questions/${qid}/reveal`, { answer: false });
    expect((await phones[0].state()).data.current?.reveal?.result.status).toBe("wrong");
    expect((await phones[1].state()).data.current?.reveal?.result.status).toBe("correct");
  });

  it("checks the answer; only quick questions take one", async () => {
    const { detail, quick } = await lesson(["一"], 1);
    const qid = await quick({ type: "single", optionCount: 3 });
    await teacher("POST", `/lesson-questions/${qid}/close`);
    for (const body of [undefined, {}, { answer: 3 }, { answer: -1 }, { answer: "1" }, { answer: true }, { answer: null }]) {
      const res = await teacher("POST", `/lesson-questions/${qid}/reveal`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await teacher("POST", `/lesson-questions/${qid}/reveal`)).data.error).toBe("請先選正確答案，或選這題不計分。");
    expect((await detail()).questions.find((x) => x.id === qid)!.status).toBe("closed");

    const tf = await quick({ type: "truefalse" });
    await teacher("POST", `/lesson-questions/${tf}/close`);
    expect((await teacher("POST", `/lesson-questions/${tf}/reveal`, { answer: 1 })).status).toBe(400);

    // A question from the set: its answer is already set, so one sent in is refused.
    const regular = (await detail()).questions.find((x) => !x.quick)!;
    await teacher("POST", `/lesson-questions/${regular.id}/open`);
    await teacher("POST", `/lesson-questions/${regular.id}/close`);
    const res = await teacher("POST", `/lesson-questions/${regular.id}/reveal`, { answer: false });
    expect(res.status).toBe(400);
    expect(res.data.error).toBe("只有臨時出題可以在公布時設定答案。");
    expect((await teacher("POST", `/lesson-questions/${regular.id}/reveal`, { unscored: true })).status).toBe(400);
    expect((await teacher("POST", `/lesson-questions/${regular.id}/reveal`)).status).toBe(200);
    expect((await detail()).questions.find((x) => x.id === regular.id)).toMatchObject({
      status: "revealed",
      scored: true,
      config: { answer: true },
    });
  });

  it("簡答 needs no answer and can still be reviewed", async () => {
    const { quick, phones } = await lesson(null, 2);
    const qid = await quick({ type: "essay" });
    await phones[0].answer(qid, "甲的想法");
    await phones[1].answer(qid, "乙的想法");
    await teacher("POST", `/lesson-questions/${qid}/close`);
    expect((await teacher("POST", `/lesson-questions/${qid}/review`)).status).toBe(200);
    expect((await teacher("POST", `/lesson-questions/${qid}/reveal`)).status).toBe(200);
  });
});

describe("這題不計分", () => {
  it("shows the choice without right or wrong, and counts in no score", async () => {
    const { id, cls, detail, quick, phones, students } = await lesson(["一"], 2);
    // 一 (2 points, counted) then an unscored quick question.
    const regular = (await detail()).questions[0];
    await teacher("POST", `/lesson-questions/${regular.id}/open`);
    await phones[0].answer(regular.id, true);
    await teacher("POST", `/lesson-questions/${regular.id}/close`);
    await teacher("POST", `/lesson-questions/${regular.id}/reveal`);
    const qid = await quick({ type: "single", optionCount: 4 });
    await phones[0].answer(qid, 2);
    await phones[1].answer(qid, 3); // only answers the unscored one: still present
    await teacher("POST", `/lesson-questions/${qid}/close`);
    await teacher("POST", `/lesson-questions/${qid}/reveal`, { unscored: true });

    const s1 = (await phones[0].state()).data.current!;
    expect(s1.reveal?.unscored).toBe(true);
    expect(s1.answer).toBe(2);
    expect((await detail()).questions[1]).toMatchObject({ scored: false, status: "revealed", stats: { answered: 2 } });
    await teacher("POST", `/lessons/${id}/end`);

    const record = (await teacher<RecordDetail>("GET", `/records/${id}`)).data;
    const a = analyze(parseRecord(record));
    expect(a.max).toBe(2);
    expect(a.students.map((s) => s.score)).toEqual([2, 0]);
    expect(a.students.map((s) => s.present)).toEqual([true, true]);
    expect(a.questions[1]).toMatchObject({ answered: 2, rate: null });
    const [summary] = (await teacher<LessonSummary[]>("GET", `/classes/${cls.id}/records`)).data;
    expect(summary).toMatchObject({ max: 2, scoreSum: 2, present: 2 });
    const history = (await teacher<StudentHistory>("GET", `/students/${students[1].id}/history`)).data;
    expect(history.lessons[0]).toMatchObject({ present: true, score: 0, max: 2 });

    // The 下課 list says 不計分 and leaves it out of the total.
    const result = (await phones[0].state()).data.result!;
    expect(result.items.map((i) => i.result)).toEqual(["correct", "unscored"]);
    expect(result.items[1].snippet).toBe("（口頭提問）");
    expect([result.score, result.max]).toEqual([2, 2]);
  });
});

describe("臨時出題 that was never revealed", () => {
  it("選擇／是非 stopped but not revealed count in no score; the students are still present", async () => {
    const { id, cls, detail, quick, phones, students } = await lesson(null, 2);
    const single = await quick({ type: "single", optionCount: 4 });
    await phones[0].answer(single, 0);
    await phones[1].answer(single, 1);
    await teacher("POST", `/lesson-questions/${single}/close`);
    // Glanced at the bars, then straight on to the next one (stops this one, never revealed).
    const tf = await quick({ type: "truefalse" });
    await phones[0].answer(tf, true);
    // An essay quick question still counts as usual.
    const essay = await quick({ type: "essay" });
    await phones[1].answer(essay, "我的想法");
    const live = await detail();
    expect(live.questions.map((x) => [x.status, x.scored])).toEqual([
      ["closed", false],
      ["closed", false],
      ["open", true],
    ]);
    await teacher("POST", `/lessons/${id}/end`);

    const record = (await teacher<RecordDetail>("GET", `/records/${id}`)).data;
    expect(record.questions.map((x) => [x.status, x.scored])).toEqual([
      ["closed", false],
      ["closed", false],
      ["closed", true],
    ]);
    const a = analyze(parseRecord(record));
    expect(a.max).toBe(1); // only the essay
    expect(a.students.map((s) => s.score)).toEqual([0, 0]);
    expect(a.students.map((s) => s.present)).toEqual([true, true]);
    expect(a.questions.map((x) => x.rate)).toEqual([null, null, null]);
    const [summary] = (await teacher<LessonSummary[]>("GET", `/classes/${cls.id}/records`)).data;
    expect(summary).toMatchObject({ max: 1, scoreSum: 0, present: 2, ungraded: 1 });
    for (const s of students) {
      const h = (await teacher<StudentHistory>("GET", `/students/${s.id}/history`)).data;
      expect(h.lessons[0]).toMatchObject({ present: true, max: 1 });
    }
  });

  it("picking an answer at 公布 makes it count", async () => {
    const { quick, phones, detail } = await lesson(null, 1);
    const qid = await quick({ type: "truefalse" });
    await phones[0].answer(qid, true);
    await teacher("POST", `/lesson-questions/${qid}/close`);
    expect((await detail()).questions[0].scored).toBe(false);
    await teacher("POST", `/lesson-questions/${qid}/reveal`, { answer: true });
    expect((await detail()).questions[0]).toMatchObject({ scored: true, status: "revealed" });
    expect((await phones[0].state()).data.current?.reveal).toMatchObject({ result: { status: "correct", score: 1 } });
    expect((await phones[0].state()).data.current?.reveal?.unscored).toBeUndefined();
  });
});
