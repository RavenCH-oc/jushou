import { describe, expect, it } from "vitest";
import { gradeAnswer, toStudentView } from "./grading";
import type { Question } from "./questions";

const base = { id: "q1", note: "", points: 2 };
const tf: Question = { ...base, type: "truefalse", text: "《論語》是孔子寫的。", config: { answer: false } };
const single: Question = { ...base, type: "single", text: "下列何者是唐代詩人？", config: { options: ["蘇軾", "李白", "屈原"], correct: [1] } };
const multiple: Question = {
  ...base,
  type: "multiple",
  text: "下列哪些是唐宋古文八大家？",
  config: { options: ["韓愈", "李白", "柳宗元", "杜甫"], correct: [0, 2] },
};
const fill: Question = {
  ...base,
  type: "fill",
  text: "學而時習之，不亦＿＿＿乎？有朋自遠方來，不亦＿＿＿乎？",
  config: { blanks: [["說", "悅"], ["樂", "OK"]] },
};
const essay: Question = { ...base, type: "essay", text: "試述你對〈出師表〉的看法。", config: {} };

describe("gradeAnswer", () => {
  it("true/false: right, wrong, unanswered", () => {
    expect(gradeAnswer(tf, false)).toEqual({ status: "correct", score: 2 });
    expect(gradeAnswer(tf, true)).toEqual({ status: "wrong", score: 0 });
    expect(gradeAnswer(tf, null).status).toBe("unanswered");
    expect(gradeAnswer(tf, "false").status).toBe("unanswered");
  });

  it("single: right, wrong, unanswered or out of range", () => {
    expect(gradeAnswer(single, 1)).toEqual({ status: "correct", score: 2 });
    expect(gradeAnswer(single, 0).status).toBe("wrong");
    expect(gradeAnswer(single, undefined).status).toBe("unanswered");
    expect(gradeAnswer(single, 3).status).toBe("unanswered");
    expect(gradeAnswer(single, 1.5).status).toBe("unanswered");
  });

  it("multiple: only the exact set is right", () => {
    expect(gradeAnswer(multiple, [2, 0])).toEqual({ status: "correct", score: 2 });
    expect(gradeAnswer(multiple, [0]).status).toBe("wrong"); // 少選
    expect(gradeAnswer(multiple, [0, 1, 2]).status).toBe("wrong"); // 多選
    expect(gradeAnswer(multiple, [1, 3]).status).toBe("wrong");
    expect(gradeAnswer(multiple, [0, 0, 2]).status).toBe("correct"); // duplicates don't matter
    expect(gradeAnswer(multiple, []).status).toBe("unanswered");
    expect(gradeAnswer(multiple, null).status).toBe("unanswered");
  });

  it("fill: every blank must match; reports each blank", () => {
    expect(gradeAnswer(fill, ["說", "樂"])).toEqual({ status: "correct", score: 2, blanks: [true, true] });
    expect(gradeAnswer(fill, ["悅", "苦"])).toEqual({ status: "wrong", score: 0, blanks: [true, false] });
    expect(gradeAnswer(fill, ["說", ""])).toEqual({ status: "wrong", score: 0, blanks: [true, false] });
    expect(gradeAnswer(fill, ["說"]).blanks).toEqual([true, false]);
    expect(gradeAnswer(fill, ["", "  "])).toEqual({ status: "unanswered", score: 0, blanks: [false, false] });
    expect(gradeAnswer(fill, undefined).status).toBe("unanswered");
  });

  it("fill: ignores full/half width, surrounding spaces and English case", () => {
    expect(gradeAnswer(fill, ["　說 ", "ｏｋ"]).status).toBe("correct"); // 全形空白、全形英文
    expect(gradeAnswer(fill, ["說", " ok\n"]).status).toBe("correct");
    const numbers: Question = { ...fill, text: "一年有＿＿＿個月", config: { blanks: [["12"]] } };
    expect(gradeAnswer(numbers, ["１２"]).status).toBe("correct");
    expect(gradeAnswer(numbers, ["1 2"]).status).toBe("wrong");
  });

  it("essay: pending when written, unanswered when blank", () => {
    expect(gradeAnswer(essay, "我覺得…")).toEqual({ status: "pending", score: null });
    expect(gradeAnswer(essay, "   ").status).toBe("unanswered");
    expect(gradeAnswer(essay, 5).status).toBe("unanswered");
  });
});

describe("toStudentView", () => {
  // Every accepted answer / correct marker must be gone from what students get.
  it("contains no answers for any type", () => {
    for (const q of [tf, single, multiple, fill, essay]) {
      const view = toStudentView(q) as Record<string, unknown>;
      expect(view).not.toHaveProperty("config");
      expect(view).not.toHaveProperty("correct");
      expect(view).not.toHaveProperty("answer");
      expect(view).not.toHaveProperty("blanks");
    }
    const fillJson = JSON.stringify(toStudentView(fill));
    for (const a of ["說", "悅", "樂", "OK"]) expect(fillJson).not.toContain(a);
    expect(JSON.stringify(toStudentView(single))).not.toMatch(/correct|\[1\]/);
  });

  it("keeps what students need to answer", () => {
    expect(toStudentView(single)).toEqual({ ...base, type: "single", text: single.text, options: ["蘇軾", "李白", "屈原"] });
    expect(toStudentView(fill)).toEqual({ ...base, type: "fill", text: fill.text, blankCount: 2 });
    expect(toStudentView(tf)).toEqual({ ...base, type: "truefalse", text: tf.text });
  });

  it("does not share arrays with the original", () => {
    const view = toStudentView(single) as { options: string[] };
    view.options.push("x");
    expect(single.type === "single" && single.config.options).toHaveLength(3);
  });
});
