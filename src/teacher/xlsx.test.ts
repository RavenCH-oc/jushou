import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { buildXlsx, columnName, fileName, sheetName } from "./xlsx";
import { classSheets, lessonSheets } from "./export";
import type { LessonRecord } from "../shared/records";

describe("sheet names", () => {
  it("removes characters Excel refuses and keeps 31 characters", () => {
    const used = new Set<string>();
    expect(sheetName("11/5 出師表[一]:*?\\", used)).toBe("11_5 出師表_一_____");
    expect(sheetName("一".repeat(40), used)).toHaveLength(31);
    expect(sheetName("", used)).toBe("工作表");
    expect(sheetName("'引號'", used)).toBe("引號");
  });

  it("makes repeated names unique, still within 31", () => {
    const used = new Set<string>();
    expect(sheetName("成績", used)).toBe("成績");
    expect(sheetName("成績", used)).toBe("成績(2)");
    expect(sheetName("成績", used)).toBe("成績(3)");
    const long = "字".repeat(31);
    expect(sheetName(long, used)).toBe(long);
    expect(sheetName(long, used)).toBe(`${"字".repeat(28)}(2)`);
  });

  it("column letters and file names", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
    expect(fileName(["高二孝班", "出師表 上/下", "2026-11-05"])).toBe("高二孝班_出師表_上_下_2026-11-05.xlsx");
  });
});

describe("xlsx file", () => {
  it("stores numbers as numbers, text inline, header frozen", () => {
    const bytes = buildXlsx([
      {
        name: "成績",
        rows: [
          ["座號", "姓名"],
          [1, "王<小>明&"],
          [2, null],
        ],
      },
    ]);
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
    ]);
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain('<c r="A2"><v>1</v></c>');
    expect(sheet).toContain("王&lt;小&gt;明&amp;");
    expect(sheet).toContain('state="frozen"');
    expect(sheet).not.toContain('r="B3"'); // empty cell left out
    expect(strFromU8(files["xl/workbook.xml"])).toContain('<sheet name="成績"');
  });
});

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
    { id: "B", seat: 2, name: "乙", present: false },
  ],
  questions: [
    { id: "s", type: "single", text: "單選題", note: "", points: 2, config: { options: ["x", "y"], correct: [1] }, status: "revealed" },
    { id: "f", type: "fill", text: "填＿＿＿空", note: "", points: 2, config: { blanks: [["說", "悅"]] }, status: "closed" },
    { id: "e", type: "essay", text: "簡答", note: "", points: 5, config: {}, status: "revealed" },
    { id: "n", type: "truefalse", text: "沒出", note: "", points: 1, config: { answer: true }, status: "pending" },
  ],
  answers: [
    { questionId: "s", studentId: "A", answer: 1, status: "correct", score: 2, blanks: null },
    { questionId: "f", studentId: "A", answer: ["悅"], status: "correct", score: 2, blanks: [true] },
    { questionId: "e", studentId: "A", answer: "好", status: "graded", score: 3, blanks: null },
  ],
};

describe("export sheets", () => {
  it("one lesson: 成績, 每題統計, 作答明細", () => {
    const [scores, stats, details] = lessonSheets(record);
    expect(scores.rows).toEqual([
      ["座號", "姓名", "出席", "第1題(2分)", "第2題(2分)", "第3題(5分)", "總分(滿分9)"],
      [1, "甲", "出席", 2, 2, 3, 7],
      [2, "乙", "缺席"],
    ]);
    expect(stats.rows.slice(1)).toEqual([
      [1, "單選題", "單選題", 2, 1, 100, null],
      [2, "填空題", "填＿＿＿空", 2, 1, 100, null],
      [3, "簡答／申論", "簡答", 5, 1, null, 3],
    ]);
    expect(details.rows.slice(1)).toEqual([
      [1, "甲", 1, "B", "答對", 2],
      [1, "甲", 2, "悅", "答對", 2],
      [1, "甲", 3, "好", "已批改", 3],
    ]);
  });

  it("no 互評 sheet without 互評; with it, one row per review and scores unchanged", () => {
    expect(lessonSheets(record).map((x) => x.name)).toEqual(["成績", "每題統計", "作答明細"]);
    const students = [...record.students, { id: "C", seat: 3, name: "丙", present: true }];
    const reviewed = {
      ...record,
      students,
      reviews: [
        { questionId: "e", reviewerId: "C", revieweeId: "A", score: 4, comment: "寫得好" },
        { questionId: "e", reviewerId: "A", revieweeId: "C", score: 2, comment: "太短" },
      ],
    };
    const sheets = lessonSheets(reviewed);
    expect(sheets.map((x) => x.name)).toEqual(["成績", "每題統計", "作答明細", "互評"]);
    expect(sheets[3].rows).toEqual([
      ["題號", "被評者座號", "被評者姓名", "評分者座號", "評分者姓名", "分數", "評語"],
      [3, 1, "甲", 3, "丙", 4, "寫得好"],
      [3, 3, "丙", 1, "甲", 2, "太短"],
    ]);
    expect(sheets[0].rows).toEqual(lessonSheets({ ...reviewed, reviews: [] })[0].rows); // 成績 doesn't change
  });

  it("whole class: 總表 oldest first, absent left empty", () => {
    const later = {
      ...record,
      id: "L2",
      setName: "師說",
      startedAt: "2026-11-12T02:10:00.000Z",
      students: record.students.map((s) => ({ ...s, present: true })),
    };
    const [summary, first, second] = classSheets([later, record]);
    expect(summary.rows[0]).toEqual(["座號", "姓名", "11/5 出師表", "11/12 師說", "出席次數", "平均得分率(%)"]);
    expect(summary.rows[1]).toEqual([1, "甲", 7, 7, 2, 77.8]);
    expect(summary.rows[2]).toEqual([2, "乙", null, 0, 1, 0]);
    expect([first.name, second.name]).toEqual(["11-5 出師表", "11-12 師說"]);
  });
});
