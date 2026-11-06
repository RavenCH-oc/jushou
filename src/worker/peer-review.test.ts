import { beforeEach, describe, expect, it } from "vitest";
import app from "./index";
import type { Bindings } from "./env";
import { createTestDb } from "./test/d1";
import { createFakeHub } from "./test/hub";
import type { ClassSummary, QuestionSetSummary } from "../shared/types";
import type { QuestionData } from "../shared/questions";
import type { LessonDetail, PeerReviewItem, StudentState } from "../shared/lesson";
import { analyze, parseRecord, type RecordDetail } from "../shared/records";

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
  call<T>(`/api/teacher${path}`, method, { Cookie: cookie }, body);

function phone(code: string) {
  const token = crypto.randomUUID().replaceAll("-", "");
  const send = <T = unknown>(method: string, path: string, body?: unknown) =>
    call<T>(`/api/student${path}/${code}`, method, { "X-Device-Token": token }, body);
  return {
    state: () => send<StudentState>("GET", "/state"),
    bind: (seat: number) => send("POST", "/bind", { seat }),
    answer: (questionId: string, answer: unknown) => send("POST", "/answer", { questionId, answer }),
    review: (questionId: string, score: unknown, comment: unknown) =>
      send<{ error?: string }>("POST", "/review", { questionId, score, comment }),
  };
}
type Phone = ReturnType<typeof phone>;

const ESSAY: QuestionData = { type: "essay", text: "讀完〈出師表〉的感想", note: "", points: 5, config: {} };
const TF: QuestionData = { type: "truefalse", text: "作者是諸葛亮", note: "", points: 1, config: { answer: true } };

// `n` students join; the first `answering` of them answer the 簡答, which is then stopped.
async function essayStopped(n: number, answering: number, questions = [ESSAY, TF]) {
  const { data: cls } = await teacher<ClassSummary>("POST", "/classes", { name: "高二孝班" });
  const rows = Array.from({ length: n + 1 }, (_, i) => ({ seat: i + 1, name: `學生${i + 1}` })); // one extra who joins late
  await teacher("POST", `/classes/${cls.id}/students/import`, { rows, onConflict: "skip" });
  const { data: set } = await teacher<QuestionSetSummary>("POST", "/sets", { name: "出師表" });
  for (const q of questions) await teacher("POST", `/sets/${set.id}/questions`, q);
  const { data: lesson } = await teacher<{ id: string }>("POST", "/lessons", { classId: cls.id, setId: set.id });
  const { data: live } = await teacher<LessonDetail>("GET", `/lessons/${lesson.id}`);
  const phones: Phone[] = [];
  for (let i = 0; i < n; i++) {
    const p = phone(live.joinCode);
    await p.bind(i + 1);
    await p.state();
    phones.push(p);
  }
  const essay = live.questions[0];
  await teacher("POST", `/lesson-questions/${essay.id}/open`);
  for (let i = 0; i < answering; i++) await phones[i].answer(essay.id, `學生${i + 1}的答案：鞠躬盡瘁`);
  await teacher("POST", `/lesson-questions/${essay.id}/close`);
  const detail = async () => (await teacher<LessonDetail>("GET", `/lessons/${lesson.id}`)).data;
  return { cls, lessonId: lesson.id, code: live.joinCode, essay, next: live.questions[1], phones, students: live.students, detail };
}

const pairsIn = async (questionId: string) =>
  (
    await env.DB.prepare("SELECT reviewer_id, reviewee_id, score, comment FROM peer_reviews WHERE lesson_question_id = ?")
      .bind(questionId)
      .all<{ reviewer_id: string; reviewee_id: string; score: number | null; comment: string | null }>()
  ).results;

describe("starting 互評", () => {
  for (const n of [2, 3]) {
    it(`${n} students: each reviews one, is reviewed once, never themselves`, async () => {
      const { essay, detail, students } = await essayStopped(n, n);
      expect((await teacher("POST", `/lesson-questions/${essay.id}/review`)).status).toBe(200);
      const pairs = await pairsIn(essay.id);
      const ids = students.slice(0, n).map((s) => s.id);
      expect(pairs.map((p) => p.reviewer_id).sort()).toEqual([...ids].sort());
      expect(pairs.map((p) => p.reviewee_id).sort()).toEqual([...ids].sort());
      for (const p of pairs) expect(p.reviewer_id).not.toBe(p.reviewee_id);
      const q = (await detail()).questions[0];
      expect(q).toMatchObject({ status: "reviewing", review: { done: 0, total: n } });
    });
  }

  it("30 students", async () => {
    const { essay } = await essayStopped(30, 30);
    await teacher("POST", `/lesson-questions/${essay.id}/review`);
    const pairs = await pairsIn(essay.id);
    expect(pairs).toHaveLength(30);
    expect(new Set(pairs.map((p) => p.reviewee_id)).size).toBe(30);
    for (const p of pairs) expect(p.reviewer_id).not.toBe(p.reviewee_id);
  });

  it("needs at least 2 answers, a stopped 簡答, and only happens once", async () => {
    const one = await essayStopped(3, 1);
    const res = await teacher<{ error: string }>("POST", `/lesson-questions/${one.essay.id}/review`);
    expect(res.status).toBe(400);
    expect(res.data.error).toBe("至少要 2 位同學作答才能互評。");
    expect((await one.detail()).questions[0].status).toBe("closed");
    await teacher("POST", `/lessons/${one.lessonId}/end`);

    const s = await essayStopped(3, 3);
    expect((await teacher("POST", `/lesson-questions/${s.next.id}/review`)).status).toBe(400); // not 簡答
    await teacher("POST", `/lesson-questions/${s.essay.id}/review`);
    const first = await pairsIn(s.essay.id);
    expect((await teacher("POST", `/lesson-questions/${s.essay.id}/review`)).status).toBe(200); // pressed twice
    expect(await pairsIn(s.essay.id)).toEqual(first); // not re-paired
    await teacher("POST", `/lesson-questions/${s.essay.id}/reveal`);
    expect((await teacher("POST", `/lesson-questions/${s.essay.id}/review`)).status).toBe(409);
  });

  it("returns 401 without login", async () => {
    for (const [method, path] of [
      ["POST", "/lesson-questions/x/review"],
      ["GET", "/lesson-questions/x/reviews"],
      ["DELETE", "/lesson-questions/x/reviews/y"],
    ]) {
      const res = await app.request(`/api/teacher${path}`, { method }, env);
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });
});

describe("reviewing on the phone", () => {
  it("the reviewer gets only the answer text, nothing about who wrote it", async () => {
    const { essay, phones, students } = await essayStopped(3, 3);
    await teacher("POST", `/lesson-questions/${essay.id}/review`);
    const pairs = await pairsIn(essay.id);
    for (const [i, p] of phones.entries()) {
      const res = await p.state();
      const review = res.data.current?.review;
      const revieweeId = pairs.find((x) => x.reviewer_id === students[i].id)!.reviewee_id;
      const reviewee = students.find((s) => s.id === revieweeId)!;
      expect(review).toEqual({ text: `${reviewee.name}的答案：鞠躬盡瘁`, score: null, comment: "", deleted: false });
      expect(Object.keys(res.data.current!).sort()).toEqual(["answer", "number", "question", "review", "status", "total"]);
      // The id never appears anywhere in the response, and the name only inside the answer text itself.
      expect(res.text).not.toContain(revieweeId);
      expect(res.text.replace(review!.text, "")).not.toContain(reviewee.name);
    }
  });

  it("checks score and comment; can change it until 互評 ends", async () => {
    const { essay, phones, students, detail } = await essayStopped(2, 2);
    await teacher("POST", `/lesson-questions/${essay.id}/review`);
    const p = phones[0];
    for (const [score, comment] of [
      [0, "好"],
      [6, "好"],
      [2.5, "好"],
      ["3", "好"],
      [3, ""],
      [3, "    "],
      [3, "字".repeat(201)],
    ]) {
      expect((await p.review(essay.id, score, comment)).status, `${score} ${comment}`).toBe(400);
    }
    expect((await p.review(essay.id, 3, ` ${"字".repeat(200)} `)).status).toBe(200);
    expect((await p.review(essay.id, 4, "  寫得很好  ")).status).toBe(200);
    const mine = (await pairsIn(essay.id)).find((x) => x.reviewer_id === students[0].id);
    expect(mine).toMatchObject({ score: 4, comment: "寫得很好" });
    expect((await p.state()).data.current?.review).toMatchObject({ score: 4, comment: "寫得很好" });
    expect((await detail()).questions[0].review).toEqual({ done: 1, total: 2 });
  });

  it("only while 互評中, and only by someone who was given an answer", async () => {
    const { essay, phones, code, detail } = await essayStopped(3, 2);
    // Before 開始互評.
    expect((await phones[0].review(essay.id, 3, "好")).status).toBe(409);
    await teacher("POST", `/lesson-questions/${essay.id}/review`);
    // Didn't answer: nothing to review.
    expect((await phones[2].state()).data.current?.review).toBeNull();
    expect((await phones[2].review(essay.id, 3, "好")).status).toBe(403);
    // Joined after it started.
    const late = phone(code);
    await late.bind(4);
    expect((await late.state()).data.current?.review).toBeNull();
    expect((await late.review(essay.id, 3, "好")).status).toBe(403);
    expect((await detail()).questions[0].review).toEqual({ done: 0, total: 2 }); // not re-paired
    // Not bound to anyone, and a question from nowhere.
    expect((await phone(code).review(essay.id, 3, "好")).status).toBe(403);
    expect((await phones[0].review("nope", 3, "好")).status).toBe(404);
    // After 結束互評.
    await teacher("POST", `/lesson-questions/${essay.id}/reveal`);
    expect((await phones[0].review(essay.id, 3, "好")).status).toBe(409);
    // Not part of it: no 「你收到的互評」 at all.
    expect((await phones[2].state()).data.current?.received).toBeUndefined();
    expect((await phones[0].state()).data.current?.received).toBeNull();
  });

  it("after 結束互評 each student sees what they got, never who wrote it", async () => {
    const { essay, phones, students } = await essayStopped(3, 3);
    await teacher("POST", `/lesson-questions/${essay.id}/review`);
    const pairs = await pairsIn(essay.id);
    // Students 1 and 2 send theirs; student 3 doesn't.
    await phones[0].review(essay.id, 5, "論點清楚");
    await phones[1].review(essay.id, 2, "可以再多寫一點");
    expect((await phones[0].state()).data.current?.received).toBeUndefined(); // not until it ends
    await teacher("POST", `/lesson-questions/${essay.id}/reveal`);
    const gotFrom = (i: number) => pairs.find((p) => p.reviewee_id === students[i].id)!.reviewer_id;
    for (const [i, p] of phones.entries()) {
      const res = await p.state();
      const from = gotFrom(i);
      const expected =
        from === students[0].id
          ? { score: 5, comment: "論點清楚" }
          : from === students[1].id
            ? { score: 2, comment: "可以再多寫一點" }
            : null;
      expect(res.data.current?.received).toEqual(expected);
      expect(res.data.current?.review).toBeUndefined();
      const reviewer = students.find((s) => s.id === from)!;
      expect(res.text).not.toContain(from);
      expect(res.text).not.toContain(reviewer.name);
    }
  });

  it("a 簡答 skipped straight to 公布 has no 互評 section", async () => {
    const { essay, phones } = await essayStopped(2, 2);
    await teacher("POST", `/lesson-questions/${essay.id}/reveal`);
    expect((await phones[0].state()).data.current?.received).toBeUndefined();
  });
});

describe("the teacher's side", () => {
  it("看評語 lists every pair; 刪除 hides it from the student and stops resending", async () => {
    const { essay, phones, students } = await essayStopped(2, 2);
    await teacher("POST", `/lesson-questions/${essay.id}/review`);
    await phones[0].review(essay.id, 1, "很爛");
    const list = (await teacher<PeerReviewItem[]>("GET", `/lesson-questions/${essay.id}/reviews`)).data;
    expect(list).toEqual([
      { reviewerId: students[0].id, reviewer: "1 號 學生1", reviewee: "2 號 學生2", score: 1, comment: "很爛", deleted: false },
      { reviewerId: students[1].id, reviewer: "2 號 學生2", reviewee: "1 號 學生1", score: null, comment: null, deleted: false },
    ]);
    expect((await teacher("DELETE", `/lesson-questions/${essay.id}/reviews/${students[1].id}`)).status).toBe(404); // nothing sent yet
    expect((await teacher("DELETE", `/lesson-questions/${essay.id}/reviews/${students[0].id}`)).status).toBe(200);
    expect((await teacher("DELETE", `/lesson-questions/${essay.id}/reviews/${students[0].id}`)).status).toBe(404); // already gone
    expect((await phones[0].state()).data.current?.review).toMatchObject({ deleted: true, score: null });
    expect((await phones[0].review(essay.id, 3, "重寫")).status).toBe(409);
    await teacher("POST", `/lesson-questions/${essay.id}/reveal`);
    expect((await phones[1].state()).data.current?.received).toBeNull(); // 這次沒有收到互評
  });

  it("出下一題 during 互評 ends it, as does 結束上課", async () => {
    const s = await essayStopped(2, 2);
    await teacher("POST", `/lesson-questions/${s.essay.id}/review`);
    await teacher("POST", `/lesson-questions/${s.next.id}/open`);
    expect((await s.detail()).questions.map((q) => q.status)).toEqual(["revealed", "open"]);
    expect((await s.phones[0].review(s.essay.id, 3, "好")).status).toBe(409);
    await teacher("POST", `/lessons/${s.lessonId}/end`);

    const t = await essayStopped(2, 2);
    await teacher("POST", `/lesson-questions/${t.essay.id}/review`);
    await teacher("POST", `/lessons/${t.lessonId}/end`);
    const rec = (await teacher<RecordDetail>("GET", `/records/${t.lessonId}`)).data;
    expect(rec.questions[0].status).toBe("revealed");
  });
});

describe("records", () => {
  it("show 互評 for reference without touching any score", async () => {
    const { essay, phones, lessonId, students } = await essayStopped(2, 2);
    await teacher("POST", `/lesson-questions/${essay.id}/review`);
    await phones[0].review(essay.id, 5, "很好");
    await phones[1].review(essay.id, 4, "不錯");
    await teacher("POST", `/lesson-questions/${essay.id}/reveal`);
    await teacher("POST", `/records/${lessonId}/grade`, { questionId: essay.id, studentId: students[0].id, score: 3 });
    const detail = (await teacher<RecordDetail>("GET", `/records/${lessonId}`)).data;
    expect(detail.reviews).toHaveLength(2);
    expect(detail.reviews.find((r) => r.reviewerId === students[0].id)).toMatchObject({
      revieweeId: students[1].id,
      score: 5,
      comment: "很好",
    });
    const withReviews = analyze(parseRecord(detail));
    const without = analyze(parseRecord({ ...detail, reviews: [] }));
    expect(withReviews.students.map((s) => s.score)).toEqual(without.students.map((s) => s.score));
    expect(withReviews.students.map((s) => s.score)).toEqual([3, 0, null]);
    expect(withReviews.average).toBe(without.average);
    expect(withReviews.questions[0].average).toBe(without.questions[0].average);
  });

  it("deleting the record or a student deletes their 互評", async () => {
    const count = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM peer_reviews").first<{ n: number }>())?.n;
    const a = await essayStopped(3, 3);
    await teacher("POST", `/lesson-questions/${a.essay.id}/review`);
    expect(await count()).toBe(3);
    await teacher("DELETE", `/students/${a.students[0].id}`); // reviewer of one, reviewee of another
    expect(await count()).toBe(1);
    await teacher("POST", `/lessons/${a.lessonId}/end`);
    expect((await teacher("DELETE", `/records/${a.lessonId}`)).status).toBe(200);
    expect(await count()).toBe(0);
  });
});
