// Excel export, built in the browser from the same analysis the pages show.
// Imported with import() when the teacher presses a 下載 button.
import { buildXlsx, download, fileName, type CellValue, type Sheet } from "./xlsx";
import {
  analyze,
  answerText,
  dateStamp,
  formatTaipei,
  ratio,
  RESULT_WORD,
  typeLabel,
  type LessonRecord,
} from "../shared/records";

const pct = (r: number | null) => (r === null ? null : Math.round(r * 1000) / 10); // 72.5 (%)
const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
const shortDate = (iso: string) => formatTaipei(iso).replace(/（.*$/, ""); // 11/5

function scoreSheet(r: LessonRecord, name: string): Sheet {
  const a = analyze(r);
  const head = ["座號", "姓名", "出席", ...a.asked.map((q, i) => `第${i + 1}題(${q.points}分)`), `總分(滿分${a.max})`];
  const rows: CellValue[][] = a.students.map((s) =>
    s.present ? [s.seat, s.name, "出席", ...s.cells.map((c) => c.score), s.score] : [s.seat, s.name, "缺席"],
  );
  return { name, rows: [head, ...rows] };
}

export function lessonSheets(r: LessonRecord): Sheet[] {
  const a = analyze(r);
  const stats: CellValue[][] = a.questions.map((x) => [
    x.number,
    typeLabel(x.q.type),
    x.q.text,
    x.q.points,
    x.answered,
    pct(x.rate),
    round1(x.average),
  ]);
  const details: CellValue[][] = [];
  for (const s of a.students) {
    if (!s.present) continue;
    a.asked.forEach((q, i) => {
      const c = s.cells[i];
      details.push([s.seat, s.name, i + 1, answerText(q, a.answerOf(q, s.id)?.answer), RESULT_WORD[c.kind], c.score]);
    });
  }
  return [
    scoreSheet(r, "成績"),
    { name: "每題統計", rows: [["題號", "題型", "題目", "配分", "作答人數", "正確率(%)", "簡答平均分"], ...stats], widths: [6, 12, 50] },
    { name: "作答明細", rows: [["座號", "姓名", "題號", "作答內容", "結果", "得分"], ...details], widths: [6, 10, 6, 40] },
  ];
}

// 總表 (one row per student, one column per lesson, oldest first) + each lesson's 成績.
export function classSheets(records: LessonRecord[]): Sheet[] {
  const lessons = [...records].sort((x, y) => x.startedAt.localeCompare(y.startedAt));
  const analyses = lessons.map(analyze);
  const students = lessons[0]?.students ?? []; // the class roster now; same in every record
  const head = ["座號", "姓名", ...lessons.map((l) => `${shortDate(l.startedAt)} ${l.setName}`), "出席次數", "平均得分率(%)"];
  const rows: CellValue[][] = students.map((st) => {
    let attended = 0;
    let score = 0;
    let max = 0;
    const cells = analyses.map((a) => {
      const s = a.students.find((x) => x.id === st.id);
      if (!s?.present) return null; // 缺席 stays empty
      attended++;
      score += s.score ?? 0;
      max += a.max;
      return s.score;
    });
    return [st.seat, st.name, ...cells, attended, pct(ratio(score, max))];
  });
  return [
    { name: "總表", rows: [head, ...rows] },
    ...lessons.map((l) => scoreSheet(l, `${shortDate(l.startedAt).replace("/", "-")} ${l.setName}`)),
  ];
}

export function downloadLesson(r: LessonRecord) {
  download(buildXlsx(lessonSheets(r)), fileName([r.className, r.setName, dateStamp(r.startedAt)]));
}

export function downloadClass(className: string, records: LessonRecord[]) {
  download(buildXlsx(classSheets(records)), fileName([className, "成績", dateStamp(new Date().toISOString())]));
}

