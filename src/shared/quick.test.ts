import { describe, expect, it } from "vitest";
import { revealQuick, validateQuick } from "./quick";
import type { QuestionData } from "./questions";

describe("validateQuick", () => {
  it("makes a 1-point question with empty options and no answer yet", () => {
    expect(validateQuick({ type: "single", optionCount: 4 })).toEqual({
      value: { type: "single", text: "", note: "", points: 1, config: { options: ["", "", "", ""], correct: [] } },
    });
    expect(validateQuick({ type: "truefalse", text: "  孔子是魯國人  " })).toEqual({
      value: { type: "truefalse", text: "孔子是魯國人", note: "", points: 1, config: { answer: null } },
    });
    expect(validateQuick({ type: "essay", text: "" })).toEqual({ value: { type: "essay", text: "", note: "", points: 1, config: {} } });
    expect("value" in validateQuick({ type: "single", optionCount: 2, text: "字".repeat(200) })).toBe(true);
    expect("value" in validateQuick({ type: "single", optionCount: 6 })).toBe(true);
  });

  it("only 選擇／是非／簡答, 2 to 6 options, at most 200 characters", () => {
    for (const raw of [
      { type: "multiple", optionCount: 4 },
      { type: "fill" },
      { type: "nope" },
      {},
      { type: "single" },
      { type: "single", optionCount: 1 },
      { type: "single", optionCount: 7 },
      { type: "single", optionCount: 2.5 },
      { type: "single", optionCount: "4" },
      { type: "essay", text: "字".repeat(201) },
      { type: "essay", text: 3 },
    ]) {
      expect("error" in validateQuick(raw), JSON.stringify(raw)).toBe(true);
    }
  });
});

describe("revealQuick", () => {
  const single: QuestionData = { type: "single", text: "", note: "", points: 1, config: { options: ["", "", ""], correct: [] } };
  const tf: QuestionData = { type: "truefalse", text: "", note: "", points: 1, config: { answer: null } };

  it("fills in the chosen answer, or marks it unscored", () => {
    expect(revealQuick(single, { answer: 2 })).toEqual({
      value: { ...single, config: { options: ["", "", ""], correct: [2] } },
      scored: true,
    });
    expect(revealQuick(tf, { answer: false })).toEqual({ value: { ...tf, config: { answer: false } }, scored: true });
    expect(revealQuick(single, { unscored: true })).toEqual({ value: single, scored: false });
    const essay: QuestionData = { type: "essay", text: "", note: "", points: 1, config: {} };
    expect(revealQuick(essay, {})).toEqual({ value: essay, scored: true });
  });

  it("rejects a missing or impossible answer", () => {
    for (const body of [
      {},
      { answer: null },
      { answer: 3 },
      { answer: -1 },
      { answer: 1.5 },
      { answer: "1" },
      { answer: true },
      { unscored: "yes" },
    ]) {
      expect("error" in revealQuick(single, body), JSON.stringify(body)).toBe(true);
    }
    for (const body of [{}, { answer: 1 }, { answer: "true" }]) expect("error" in revealQuick(tf, body), JSON.stringify(body)).toBe(true);
  });
});
