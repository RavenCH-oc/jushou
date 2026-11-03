import { describe, expect, it } from "vitest";
import { parseRoster } from "./roster";

const ok = (rows: ReturnType<typeof parseRoster>) => rows.map((r) => [r.seat, r.name, r.error]);

describe("parseRoster", () => {
  it("splits on tab, comma, full-width comma and spaces", () => {
    const input = ["1\t王小明", "2,李小華", "3，陳大文", "4  林美玲", "5 　張 三"].join("\n");
    expect(ok(parseRoster(input))).toEqual([
      [1, "王小明", null],
      [2, "李小華", null],
      [3, "陳大文", null],
      [4, "林美玲", null],
      [5, "張 三", null],
    ]);
  });

  it("handles full-width digits, blank lines, CRLF and surrounding spaces", () => {
    const input = "\r\n  １２\t王小明  \r\n\r\n\t\n０３ 李小華\r\n";
    const rows = parseRoster(input);
    expect(ok(rows)).toEqual([
      [12, "王小明", null],
      [3, "李小華", null],
    ]);
    expect(rows.map((r) => r.line)).toEqual([2, 5]);
  });

  it("skips a header row", () => {
    expect(ok(parseRoster("座號\t姓名\n1\t王小明"))).toEqual([[1, "王小明", null]]);
  });

  it("ignores extra columns from Excel", () => {
    expect(ok(parseRoster("1\t王小明\t\t"))).toEqual([[1, "王小明", null]]);
  });

  it("flags bad rows with a reason", () => {
    const rows = parseRoster(["abc\t王小明", "7", "0\t李小華", "8\t" + "名".repeat(31)].join("\n"));
    expect(rows.map((r) => r.error)).toEqual([
      "座號不是數字。",
      "缺少姓名。",
      "座號要是正整數。",
      "姓名最多 30 個字。",
    ]);
  });

  it("flags duplicate seats after the first one", () => {
    const rows = parseRoster("1\t王小明\n2\t李小華\n1\t陳大文");
    expect(rows[0].error).toBeNull();
    expect(rows[1].error).toBeNull();
    expect(rows[2].error).toBe("座號重複（和第 1 行相同）。");
  });
});
