import { afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "./index";
import type { Bindings } from "./env";
import { createTestDb } from "./test/d1";
import { createFakeHub, type Broadcast } from "./test/hub";
import { BUZZ } from "./buzz";
import type { ClassSummary, QuestionSetSummary } from "../shared/types";
import type { BuzzBoard, LessonDetail, StudentState } from "../shared/lesson";
import { analyze, parseRecord, type LessonSummary, type RecordDetail } from "../shared/records";

let env: Bindings;
let cookie: string;
let broadcasts: Broadcast[];

beforeEach(async () => {
  const hub = createFakeHub();
  broadcasts = hub.calls;
  env = { DB: createTestDb(), LESSON_HUB: hub.namespace, TEACHER_PASSWORD: "pw", SESSION_SECRET: "test-secret" };
  BUZZ.countdownMs = 0; // most tests don't wait for 3-2-1
  const res = await app.request(
    "/api/teacher/login",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "pw" }) },
    env,
  );
  cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0];
});
afterEach(() => {
  BUZZ.countdownMs = 3000;
});

async function call<T>(path: string, method: string, headers: Record<string, string>, body?: unknown) {
  const res = await app.request(
    path,
    { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) },
    env,
  );
  const text = await res.text();
  return { status: res.status, data: JSON.parse(text) as T & { error?: string }, text };
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
    buzz: (round?: number) => send<{ rank: number }>("POST", "/buzz", round === undefined ? {} : { round }),
  };
}

// A lesson with one 是非題 and `n` students on their phones.
async function lesson(n = 4) {
  const { data: cls } = await teacher<ClassSummary>("POST", "/classes", { name: "高二孝班" });
  const rows = Array.from({ length: n + 1 }, (_, i) => ({ seat: i + 1, name: `學生${i + 1}` })); // the last one never binds
  await teacher("POST", `/classes/${cls.id}/students/import`, { rows, onConflict: "skip" });
  const { data: set } = await teacher<QuestionSetSummary>("POST", "/sets", { name: "論語" });
  await teacher("POST", `/sets/${set.id}/questions`, {
    type: "truefalse",
    text: "孔子是魯國人",
    note: "",
    points: 1,
    config: { answer: true },
  });
  const { data: l } = await teacher<{ id: string }>("POST", "/lessons", { classId: cls.id, setId: set.id });
  const live = (await teacher<LessonDetail>("GET", `/lessons/${l.id}`)).data;
  const phones = [];
  for (let i = 0; i < n; i++) {
    const p = phone(live.joinCode);
    await p.bind(i + 1);
    await p.state();
    phones.push(p);
  }
  const board = async () => (await teacher<BuzzBoard>("GET", `/lessons/${l.id}/buzz`)).data;
  const start = () => teacher("POST", `/lessons/${l.id}/buzz`);
  return { cls, id: l.id, code: live.joinCode, question: live.questions[0], phones, students: live.students, board, start };
}

describe("搶答", () => {
  it("ranks in the order the server gets presses; pressing again keeps the same place", async () => {
    const { phones, board, start, id } = await lesson(4);
    expect((await start()).status).toBe(200);
    expect((await teacher<LessonDetail>("GET", `/lessons/${id}`)).data.buzzOpen).toBe(true);
    for (const [i, p] of [phones[2], phones[0], phones[3], phones[1]].entries()) {
      const res = await p.buzz();
      expect(res.status).toBe(200);
      expect(res.data.rank).toBe(i + 1);
    }
    expect((await phones[0].buzz()).data.rank).toBe(2); // again: same place, not recorded twice
    const b = await board();
    expect(b).toMatchObject({ open: true, round: 1, count: 4, joined: 4 });
    expect(b.top.map((s) => s.seat)).toEqual([3, 1, 4, 2]);
    expect((await phones[1].state()).data.buzz).toEqual({ round: 1, opensInMs: 0, rank: 4 });
  });

  it("shows only the first 5 names, and counts the rest", async () => {
    const { phones, board, start } = await lesson(7);
    await start();
    for (const p of phones) await p.buzz();
    const b = await board();
    expect(b.top).toHaveLength(5);
    expect(b.count).toBe(7);
  });

  it("refuses presses during the countdown, after the end, and from an old round", async () => {
    const { phones, board, start, id } = await lesson(2);
    BUZZ.countdownMs = 3000;
    await start();
    const early = await phones[0].buzz();
    expect(early.status).toBe(409);
    expect(early.data.error).toBe("還沒開始，等倒數結束再按。");
    const s = (await phones[0].state()).data.buzz!;
    expect(s.rank).toBeNull();
    expect(s.opensInMs).toBeGreaterThan(2000);
    expect(s.opensInMs).toBeLessThanOrEqual(3000);
    expect((await board()).opensInMs).toBeGreaterThan(2000);

    BUZZ.countdownMs = 0;
    await start(); // 再搶一次: round 2, opens now
    expect((await phones[0].buzz(1)).data.error).toBe("這一輪搶答已經結束了。"); // still thinks it's round 1
    expect((await phones[0].buzz(2)).data.rank).toBe(1);
    await teacher("POST", `/lessons/${id}/buzz/end`);
    const late = await phones[1].buzz();
    expect(late.status).toBe(409);
    expect(late.data.error).toBe("這一輪搶答已經結束了。");
    expect((await phones[1].state()).data.buzz).toBeUndefined();
    expect((await teacher<LessonDetail>("GET", `/lessons/${id}`)).data.buzzOpen).toBe(false);
  });

  it("再搶一次 clears the ranking and starts a new round", async () => {
    const { phones, board, start } = await lesson(3);
    await start();
    await phones[0].buzz();
    await phones[1].buzz();
    await start();
    const b = await board();
    expect(b).toMatchObject({ round: 2, count: 0, top: [] });
    expect((await phones[1].state()).data.buzz).toMatchObject({ round: 2, rank: null });
    expect((await phones[1].buzz()).data.rank).toBe(1);
  });

  it("starting stops the question being answered", async () => {
    const { question, phones, start, id } = await lesson(2);
    await teacher("POST", `/lesson-questions/${question.id}/open`);
    await phones[0].answer(question.id, true);
    await start();
    const live = (await teacher<LessonDetail>("GET", `/lessons/${id}`)).data;
    expect(live.questions[0].status).toBe("closed");
    expect(live.questions[0].stats.answered).toBe(1);
    // The phone still has its question underneath the 搶答 screen.
    expect((await phones[1].state()).data.current?.status).toBe("closed");
  });

  it("a press tells only the teacher; start and end tell everyone", async () => {
    const { phones, start, id } = await lesson(2);
    broadcasts.length = 0;
    await start();
    expect(broadcasts).toEqual([{ lesson: id, t: "buzz", to: "all" }]);
    broadcasts.length = 0;
    await phones[0].buzz();
    await phones[1].buzz();
    await phones[0].buzz(); // again: nothing new to tell
    expect(broadcasts).toEqual([
      { lesson: id, t: "buzz", to: "teacher" },
      { lesson: id, t: "buzz", to: "teacher" },
    ]);
    broadcasts.length = 0;
    await teacher("POST", `/lessons/${id}/buzz/end`);
    expect(broadcasts).toEqual([{ lesson: id, t: "buzz", to: "all" }]);
  });

  it("a phone only ever learns its own place, never who else pressed", async () => {
    const { phones, start, students } = await lesson(3);
    await start();
    await phones[0].buzz();
    await phones[1].buzz();
    const res = await phones[2].state();
    expect(res.data.buzz).toEqual({ round: 1, opensInMs: 0, rank: null });
    for (const s of students.slice(0, 2)) {
      expect(res.text).not.toContain(s.name);
      expect(res.text).not.toContain(s.id);
    }
    const pressed = await phones[2].buzz();
    expect(Object.keys(pressed.data)).toEqual(["rank"]);
  });

  it("needs the teacher for the teacher side, and a bound phone in a running lesson to press", async () => {
    const { id, code, start } = await lesson(1);
    for (const [method, path] of [
      ["POST", `/lessons/${id}/buzz`],
      ["POST", `/lessons/${id}/buzz/end`],
      ["GET", `/lessons/${id}/buzz`],
    ]) {
      expect((await app.request(`/api/teacher${path}`, { method }, env)).status, `${method} ${path}`).toBe(401);
    }
    await start();
    const stranger = phone(code); // not bound to a seat
    const res = await stranger.buzz();
    expect(res.status).toBe(403);
    expect(res.data.error).toBe("請重新選擇你的座號。");
    expect((await stranger.state()).data.buzz).toBeUndefined();
    const wrong = await phone("000000").buzz();
    expect(wrong.status).toBe(404);
    expect(wrong.data.error).toBe("找不到這個加入碼，請再確認一次。");
  });

  it("ending the lesson clears 搶答 and leaves records and scores alone", async () => {
    const { question, phones, start, id, cls } = await lesson(2);
    await teacher("POST", `/lesson-questions/${question.id}/open`);
    await phones[0].answer(question.id, true);
    await teacher("POST", `/lesson-questions/${question.id}/close`);
    await teacher("POST", `/lesson-questions/${question.id}/reveal`);
    await start();
    await phones[1].buzz(); // 學生2 only pressed 搶!, never answered
    await teacher("POST", `/lessons/${id}/end`);
    const count = (await env.DB.prepare("SELECT COUNT(*) AS n FROM buzzes").first<{ n: number }>())?.n;
    expect(count).toBe(0);
    const row = await env.DB.prepare("SELECT buzz_open FROM lessons WHERE id = ?").bind(id).first<{ buzz_open: number }>();
    expect(row?.buzz_open).toBe(0);
    expect((await teacher("POST", `/lessons/${id}/buzz`)).status).toBe(409);
    const record = (await teacher<RecordDetail>("GET", `/records/${id}`)).data;
    const a = analyze(parseRecord(record));
    expect(a.max).toBe(1);
    expect(a.students.map((s) => s.score)).toEqual([1, 0, null]);
    const [summary] = (await teacher<LessonSummary[]>("GET", `/classes/${cls.id}/records`)).data;
    expect(summary).toMatchObject({ max: 1, scoreSum: 1, present: 2 });
  });

  it("works with nobody joined", async () => {
    const { data: cls } = await teacher<ClassSummary>("POST", "/classes", { name: "空班" });
    await teacher("POST", `/classes/${cls.id}/students/import`, { rows: [{ seat: 1, name: "甲" }], onConflict: "skip" });
    const { data: l } = await teacher<{ id: string }>("POST", "/lessons", { classId: cls.id, setId: null });
    expect((await teacher("POST", `/lessons/${l.id}/buzz`)).status).toBe(200);
    expect((await teacher<BuzzBoard>("GET", `/lessons/${l.id}/buzz`)).data).toMatchObject({ open: true, joined: 0, count: 0 });
  });
});
