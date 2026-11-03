import { describe, expect, it } from "vitest";
import { groupCountFor, randomGroups } from "./grouping";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `s${i + 1}`);

describe("randomGroups", () => {
  it("keeps group sizes within 1 of each other", () => {
    for (const [n, k] of [[30, 4], [31, 6], [7, 7], [29, 5], [3, 5], [1, 1]]) {
      const groups = randomGroups(ids(n), k);
      const sizes = groups.map((g) => g.length);
      expect(groups).toHaveLength(k);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
    }
  });

  it("puts every student in exactly one group", () => {
    const groups = randomGroups(ids(30), 4);
    const all = groups.flat();
    expect(new Set(all).size).toBe(30);
    expect(all.sort()).toEqual(ids(30).sort());
  });

  it("actually shuffles", () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const groups = randomGroups(ids(30), 1, random);
    expect(groups[0]).not.toEqual(ids(30));
  });
});

describe("groupCountFor", () => {
  it("uses the group count as given", () => {
    expect(groupCountFor(30, { groupCount: 5 })).toBe(5);
  });

  it("derives the group count from a group size", () => {
    expect(groupCountFor(30, { groupSize: 4 })).toBe(8); // 6×4 + 2×3
    expect(groupCountFor(30, { groupSize: 5 })).toBe(6);
    expect(groupCountFor(3, { groupSize: 10 })).toBe(1);
  });
});
