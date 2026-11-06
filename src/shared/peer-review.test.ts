import { describe, expect, it } from "vitest";
import { assignReviews, checkReview } from "./peer-review";

describe("assignReviews", () => {
  for (const n of [2, 3, 30]) {
    it(`${n} students: everyone reviews exactly one, is reviewed exactly once, never themselves`, () => {
      const ids = Array.from({ length: n }, (_, i) => `s${i}`);
      for (let round = 0; round < 20; round++) {
        const pairs = assignReviews(ids);
        expect(pairs).toHaveLength(n);
        expect(new Set(pairs.map((p) => p.reviewer))).toEqual(new Set(ids));
        expect(new Set(pairs.map((p) => p.reviewee))).toEqual(new Set(ids));
        for (const p of pairs) expect(p.reviewer).not.toBe(p.reviewee);
      }
    });
  }

  it("is one circle, not several small ones", () => {
    const ids = Array.from({ length: 30 }, (_, i) => `s${i}`);
    const next = new Map(assignReviews(ids).map((p) => [p.reviewer, p.reviewee]));
    let at = "s0";
    for (let i = 0; i < 30; i++) at = next.get(at)!;
    expect(at).toBe("s0");
    // Walking 1..29 steps never comes back early.
    const seen = new Set<string>();
    at = "s0";
    for (let i = 0; i < 30; i++) {
      seen.add(at);
      at = next.get(at)!;
    }
    expect(seen.size).toBe(30);
  });

  it("needs at least 2 students", () => {
    expect(assignReviews([])).toEqual([]);
    expect(assignReviews(["s0"])).toEqual([]);
  });
});

describe("checkReview", () => {
  it("accepts 1..5 and a comment of 1..200 characters", () => {
    expect(checkReview(1, "好")).toBeNull();
    expect(checkReview(5, "  寫得很清楚  ")).toBeNull();
    expect(checkReview(3, "字".repeat(200))).toBeNull();
    expect(checkReview(3, ` ${"字".repeat(200)} `)).toBeNull(); // spaces around don't count
    expect(checkReview(3, "😀".repeat(200))).toBeNull(); // an emoji is one character
  });

  it("rejects anything else", () => {
    for (const score of [0, 6, 2.5, "3", null, undefined]) expect(checkReview(score, "好")).not.toBeNull();
    for (const comment of ["", "   ", "字".repeat(201), 3, null]) expect(checkReview(3, comment)).not.toBeNull();
  });
});
