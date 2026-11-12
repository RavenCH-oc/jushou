import { describe, expect, it } from "vitest";
import {
  analyze,
  answerText,
  cellMark,
  cellOf,
  correctText,
  dateStamp,
  formatTaipei,
  historyRate,
  summaryRate,
  type LessonRecord,
  type RecordAnswer,
  type RecordQuestion,
} from "./records";

const Q: RecordQuestion[] = [
  {
    id: "tf",
    type: "truefalse",
    text: "是非",
    note: "",
    points: 1,
    config: { answer: true },
    status: "revealed",
    quick: false,
    scored: true,
  },
  {
    id: "single",
    type: "single",
    text: "單選",
    note: "",
    points: 2,
    config: { options: ["甲", "乙", "丙"], correct: [1] },
    status: "closed",
    quick: false,
    scored: true,
  },
  { id: "essay", type: "essay", text: "簡答", note: "", points: 5, config: {}, status: "revealed", quick: false, scored: true },
  {
    id: "never",
    type: "fill",
    text: "＿＿＿",
    note: "",
    points: 3,
    config: { blanks: [["說", "悅"]] },
    status: "pending",
    quick: false,
    scored: true,
  },
];

const ans = (questionId: string, studentId: string, a: Partial<RecordAnswer>): RecordAnswer => ({
  questionId,
  studentId,
  answer: null as never,
  status: "correct",
  score: null,
  blanks: null,
  ...a,
});

// A: all right, essay graded 4. B: wrong + essay not graded. C: present, answered nothing. D: absent.
const record: LessonRecord = {
  id: "L",
  classId: "C",
  className: "高二孝班",
  setName: "出師表",
  startedAt: "2026-11-05T02:10:00.000Z",
  groupingCount: 0,
  groupings: [],
  reviews: [],
  students: [
    { id: "A", seat: 1, name: "甲", present: true },
    { id: "B", seat: 2, name: "乙", present: true },
    { id: "C", seat: 3, name: "丙", present: true },
    { id: "D", seat: 4, name: "丁", present: false },
  ],
  questions: Q,
  answers: [
    ans("tf", "A", { answer: true, status: "correct", score: 1 }),
    ans("single", "A", { answer: 1, status: "correct", score: 2 }),
    ans("essay", "A", { answer: "忠心", status: "graded", score: 4 }),
    ans("tf", "B", { answer: false, status: "wrong", score: 0 }),
    ans("single", "B", { answer: 1, status: "correct", score: 2 }),
    ans("essay", "B", { answer: "囉嗦", status: "pending", score: null }),
  ],
};

describe("scoring rules", () => {
  const a = analyze(record);

  it("leaves out questions that were never asked", () => {
    expect(a.asked.map((q) => q.id)).toEqual(["tf", "single", "essay"]);
    expect(a.max).toBe(8); // 簡答 included
  });

  it("totals: graded 簡答 counts, ungraded counts 0, absent has no score", () => {
    expect(a.students.map((s) => s.score)).toEqual([7, 2, 0, null]);
    expect(a.students.map((s) => s.ungraded)).toEqual([0, 1, 0, 0]);
    expect(a.ungraded).toBe(1);
    expect(a.present).toBe(3);
    expect(a.total).toBe(4);
    expect(a.average).toBe(3); // (7 + 2 + 0) / 3 present
  });

  it("cells: absent, 沒作答, answered", () => {
    expect(a.students[3].cells.map((c) => c.kind)).toEqual(["absent", "absent", "absent"]);
    expect(a.students[2].cells.map((c) => c.kind)).toEqual(["unanswered", "unanswered", "unanswered"]);
    expect(a.students[1].cells.map((c) => c.kind)).toEqual(["wrong", "correct", "ungraded"]);
    expect(cellOf(undefined, true)).toEqual({ kind: "unanswered", score: 0 });
    expect(cellOf(ans("tf", "A", { status: "graded", score: 3 }), false)).toEqual({ kind: "absent", score: null });
    const marks = a.students[1].cells.map((c, i) => cellMark(a.asked[i], c));
    expect(marks).toEqual(["✕", "○", "未改"]);
    expect(cellMark(Q[2], a.students[0].cells[2])).toBe("4");
    expect(cellMark(Q[0], a.students[2].cells[0])).toBe("—");
  });

  it("正確率 is right ÷ present (沒作答 is wrong); 簡答 has an average instead", () => {
    const [tf, single, essay] = a.questions;
    expect(tf).toMatchObject({ answered: 2, correct: 1, rate: 1 / 3, average: null });
    expect(single).toMatchObject({ answered: 2, correct: 2, rate: 2 / 3 });
    // A got 4, C answered nothing (0), B not graded yet so left out.
    expect(essay).toMatchObject({ answered: 2, rate: null, average: 2, ungraded: 1 });
    // Before any 簡答 is graded there is no average yet (not 0).
    const fresh = analyze({ ...record, answers: record.answers.filter((x) => x.questionId !== "essay" || x.status === "pending") });
    expect(fresh.questions[2].average).toBeNull();
  });

  it("rates from SQL summaries", () => {
    expect(summaryRate({ present: 3, max: 8, scoreSum: 9 })).toBeCloseTo(9 / 24);
    expect(summaryRate({ present: 0, max: 8, scoreSum: 0 })).toBeNull();
    const lessons = [
      { id: "1", setName: "", startedAt: "", present: true, score: 6, max: 10, ungraded: 0 },
      { id: "2", setName: "", startedAt: "", present: false, score: 0, max: 50, ungraded: 0 },
      { id: "3", setName: "", startedAt: "", present: true, score: 2, max: 10, ungraded: 0 },
    ];
    expect(historyRate(lessons)).toBeCloseTo(0.4); // absent lessons don't count
    expect(historyRate([])).toBeNull();
  });
});

describe("words", () => {
  it("Taiwan time whatever the computer's zone", () => {
    expect(formatTaipei("2026-11-05T02:10:00.000Z")).toBe("11/5（四）10:10");
    expect(formatTaipei("2026-11-04T16:05:00.000Z")).toBe("11/5（四）00:05");
    expect(dateStamp("2026-11-04T16:05:00.000Z")).toBe("2026-11-05");
  });

  it("turns answers into readable text", () => {
    expect(answerText(Q[0], true)).toBe("○");
    expect(answerText(Q[0], false)).toBe("✕");
    expect(answerText(Q[1], 1)).toBe("B");
    expect(answerText({ ...Q[1], type: "multiple", config: { options: ["a", "b", "c", "d"], correct: [0] } }, [3, 0])).toBe("A、D");
    expect(answerText(Q[3], ["說", " ", "悅"])).toBe("說、（空白）、悅");
    expect(answerText(Q[2], "很忠心")).toBe("很忠心");
    expect(answerText(Q[1], null)).toBe("");
  });

  it("says the correct answer", () => {
    expect(correctText(Q[0])).toBe("○");
    expect(correctText(Q[1])).toBe("B");
    expect(correctText(Q[3])).toBe("第 1 格：說 或 悅");
  });
});
