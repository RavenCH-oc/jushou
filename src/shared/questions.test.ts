import { describe, expect, it } from "vitest";
import { blankContexts, countBlanks, splitAccepted, validateQuestion } from "./questions";

const errorsOf = (raw: unknown) => {
  const r = validateQuestion(raw);
  return "errors" in r ? r.errors : {};
};
const base = { text: "題目", note: "", points: 1 };

describe("blanks", () => {
  it("counts runs of 3+ full-width underscores as one blank each", () => {
    expect(countBlanks("甲＿＿＿乙＿＿＿＿＿丙")).toBe(2);
    expect(countBlanks("＿＿ 不算，___ 也不算")).toBe(0);
  });

  it("shows a few characters around each blank, stopping at neighbouring blanks", () => {
    expect(blankContexts("子曰學而時習之不亦＿＿＿＿乎")).toEqual(["…習之不亦＿＿＿乎"]);
    expect(blankContexts("甲＿＿＿乙\n丙＿＿＿")).toEqual(["甲＿＿＿乙 丙…", "…乙 丙＿＿＿"]);
  });

  it("splits accepted answers on 、 and new lines", () => {
    expect(splitAccepted("說、悅\n 樂 \n\n、")).toEqual(["說", "悅", "樂"]);
  });
});

describe("validateQuestion", () => {
  it("checks text and points for every type", () => {
    expect(errorsOf({ ...base, type: "essay", text: "  " }).text).toBeTruthy();
    expect(errorsOf({ ...base, type: "essay", points: 0 }).points).toBeTruthy();
    expect(errorsOf({ ...base, type: "essay", points: 101 }).points).toBeTruthy();
    expect(errorsOf({ ...base, type: "essay", points: 1.5 }).points).toBeTruthy();
    expect(errorsOf({ ...base, type: "essay", points: "3" }).points).toBeTruthy();
    expect(errorsOf({ ...base, type: "nope" }).type).toBeTruthy();
    expect(validateQuestion({ ...base, type: "essay", text: " 寫一段 ", points: 100 })).toEqual({
      value: { type: "essay", text: "寫一段", note: "", points: 100, config: {} },
    });
  });

  it("true/false needs an answer", () => {
    expect(errorsOf({ ...base, type: "truefalse", config: {} }).answer).toBeTruthy();
    expect(errorsOf({ ...base, type: "truefalse", config: { answer: "true" } }).answer).toBeTruthy();
    expect(errorsOf({ ...base, type: "truefalse", config: { answer: false } })).toEqual({});
  });

  it("single choice: 2–8 options, none empty, exactly one correct", () => {
    const q = (options: string[], correct: number[]) => errorsOf({ ...base, type: "single", config: { options, correct } });
    expect(q(["甲"], [0]).options).toBeTruthy();
    expect(q(Array(9).fill("甲"), [0]).options).toBeTruthy();
    expect(q(["甲", " "], [0])["option-1"]).toBeTruthy();
    expect(q(["甲", "乙"], []).answer).toBeTruthy();
    expect(q(["甲", "乙"], [0, 1]).answer).toBeTruthy();
    expect(q(["甲", "乙"], [2]).answer).toBeTruthy();
    expect(q(["甲", "乙"], [1])).toEqual({});
  });

  it("multiple choice: at least one correct", () => {
    const q = (correct: number[]) => errorsOf({ ...base, type: "multiple", config: { options: ["甲", "乙", "丙"], correct } });
    expect(q([]).answer).toBeTruthy();
    expect(q([0, 2])).toEqual({});
    expect(q([0, 1, 2])).toEqual({});
  });

  it("fill: needs a blank in the text and an answer for every blank", () => {
    const q = (text: string, blanks: unknown) => validateQuestion({ ...base, type: "fill", text, config: { blanks } });
    expect(errorsOf({ ...base, type: "fill", text: "沒有空格", config: { blanks: [] } }).text).toBeTruthy();
    expect(errorsOf({ ...base, type: "fill", text: "甲＿＿＿乙＿＿＿", config: { blanks: [["a"], ["  "]] } })).toEqual({
      "blank-1": "第 2 格還沒有填答案。",
    });
    // Extra stored blanks beyond the ones in the text are dropped; answers are trimmed and de-duplicated.
    expect(q("甲＿＿＿", [[" 說 ", "說", "悅"], ["多的"]])).toEqual({
      value: { type: "fill", text: "甲＿＿＿", note: "", points: 1, config: { blanks: [["說", "悅"]] } },
    });
  });
});
