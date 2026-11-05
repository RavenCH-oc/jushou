// 上課紀錄: the scoring rules for lesson records (docs/tasks/phase-4.md).
// Every page and the Excel export count with these functions, so they always agree.
// The SQL summaries in src/worker/records.ts follow the same rules.
// 出席 (present): joined the lesson, or sent at least one answer in it — a student
// unbound mid-lesson (換手機) who never came back still keeps what they handed in.
import type { Answer, GradeResult } from "./grading";
import { optionLetter, typeLabel, type Question } from "./questions";
import type { QuestionStats, QuestionStatus } from "./lesson";

// --- What the API sends ---

export type LessonSummary = {
  id: string;
  classId: string;
  className: string;
  setName: string;
  startedAt: string;
  present: number; // students who joined or answered
  total: number; // students in the class now
  max: number; // points of the questions that were asked
  scoreSum: number; // points of all present students together
  ungraded: number; // 簡答 answers not graded yet
};

export type RecordQuestion = Question & { status: QuestionStatus };

export type RecordAnswerRow = {
  questionId: string;
  studentId: string;
  answer: string; // JSON; parsed in the browser, not in the Worker
  status: GradeResult["status"];
  score: number | null;
  blanks: string | null; // JSON boolean[]
};

export type RecordDetail = {
  id: string;
  classId: string;
  className: string;
  setName: string;
  startedAt: string;
  groupingCount: number; // groupings to show in 依分組看
  // The groups as they were when the lesson ended; null for lessons that ended before
  // this was recorded (the page then shows the class's current groups).
  groupings: RecordGrouping[] | null;
  students: { id: string; seat: number; name: string; present: boolean }[];
  questions: RecordQuestion[]; // all of them, in order; see askedQuestions
  answers: RecordAnswerRow[];
};

export type RecordGrouping = { id: string; name: string; groups: { name: string; studentIds: string[] }[] };

export type StudentHistory = {
  student: { id: string; seat: number; name: string; classId: string; className: string };
  lessons: { id: string; setName: string; startedAt: string; present: boolean; score: number; max: number; ungraded: number }[];
};

// --- Parsed in the browser ---

export type RecordAnswer = Omit<RecordAnswerRow, "answer" | "blanks"> & { answer: Answer; blanks: boolean[] | null };
export type LessonRecord = Omit<RecordDetail, "answers"> & { answers: RecordAnswer[] };

export function parseRecord(d: RecordDetail): LessonRecord {
  return {
    ...d,
    answers: d.answers.map((a) => ({ ...a, answer: JSON.parse(a.answer) as Answer, blanks: a.blanks ? (JSON.parse(a.blanks) as boolean[]) : null })),
  };
}

// --- The rules ---

// 有出的題目: anything but 未出題. Questions never asked appear nowhere.
export function askedQuestions(r: { questions: RecordQuestion[] }) {
  return r.questions.filter((q) => q.status !== "pending");
}

// 滿分: points of every asked question, 簡答 included.
export function maxScore(questions: RecordQuestion[]) {
  return questions.reduce((sum, q) => sum + q.points, 0);
}

export type Cell =
  | { kind: "absent"; score: null }
  | { kind: "unanswered" | "ungraded"; score: 0 } // 沒作答 and not-yet-graded 簡答 count as 0
  | { kind: "correct" | "wrong" | "graded"; score: number };

export function cellOf(answer: RecordAnswer | undefined, present: boolean): Cell {
  if (!present) return { kind: "absent", score: null };
  if (!answer || answer.status === "unanswered") return { kind: "unanswered", score: 0 };
  if (answer.status === "pending") return { kind: "ungraded", score: 0 };
  return { kind: answer.status, score: answer.score ?? 0 };
}

const key = (questionId: string, studentId: string) => `${questionId} ${studentId}`;

// Everything one record page needs, computed once.
export function analyze(r: LessonRecord) {
  const asked = askedQuestions(r);
  const max = maxScore(asked);
  const byKey = new Map(r.answers.map((a) => [key(a.questionId, a.studentId), a]));
  const answerOf = (q: RecordQuestion, studentId: string) => byKey.get(key(q.id, studentId));

  const students = r.students.map((s) => {
    const cells = asked.map((q) => cellOf(answerOf(q, s.id), s.present));
    return {
      ...s,
      cells,
      score: s.present ? cells.reduce((sum, c) => sum + (c.score ?? 0), 0) : null,
      ungraded: cells.filter((c) => c.kind === "ungraded").length,
    };
  });
  const present = students.filter((s) => s.present);

  const questions = asked.map((q, i) => {
    const cells = present.map((s) => s.cells[i]);
    const answered = cells.filter((c) => c.kind !== "unanswered").length;
    const correct = cells.filter((c) => c.kind === "correct").length;
    // 簡答 average: graded answers, with 沒作答 as 0; nothing to show until one is graded.
    const graded = cells.some((c) => c.kind === "graded") ? cells.filter((c) => c.kind === "graded" || c.kind === "unanswered") : [];
    return {
      q,
      number: i + 1,
      answered,
      correct,
      ungraded: cells.filter((c) => c.kind === "ungraded").length,
      // 正確率 = 答對 ÷ 出席 (沒作答 counts as wrong); 簡答 shows the average instead.
      rate: q.type === "essay" ? null : ratio(correct, present.length),
      average: q.type === "essay" ? average(graded.map((c) => c.score ?? 0)) : null,
    };
  });

  const scoreSum = present.reduce((sum, s) => sum + (s.score ?? 0), 0);
  return {
    asked,
    max,
    answerOf,
    students,
    questions,
    present: present.length,
    total: r.students.length,
    average: present.length ? scoreSum / present.length : null, // 平均分數
    ungraded: students.reduce((sum, s) => sum + s.ungraded, 0),
  };
}

export type Analysis = ReturnType<typeof analyze>;

export function ratio(n: number, of: number) {
  return of ? n / of : null;
}

export function average(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

// 平均得分率 of a lesson from its SQL summary: all present students' points ÷ their full marks.
export function summaryRate(s: Pick<LessonSummary, "present" | "max" | "scoreSum">) {
  return ratio(s.scoreSum, s.present * s.max);
}

// 平均得分率 of one student over the lessons they attended.
export function historyRate(lessons: StudentHistory["lessons"]) {
  const attended = lessons.filter((l) => l.present);
  return ratio(
    attended.reduce((sum, l) => sum + l.score, 0),
    attended.reduce((sum, l) => sum + l.max, 0),
  );
}

export function percent(r: number | null) {
  return r === null ? "—" : `${Math.round(r * 100)}%`;
}

export function oneDecimal(n: number | null) {
  return n === null ? "—" : String(Math.round(n * 10) / 10);
}

// The same counts the live lesson screen shows, for the bar chart.
export function distribution(q: RecordQuestion, answers: RecordAnswer[]): QuestionStats {
  const s: QuestionStats = { answered: answers.length, correct: answers.filter((a) => a.status === "correct").length };
  const given = answers.map((a) => a.answer as unknown);
  if (q.type === "truefalse") s.choices = [true, false].map((v) => given.filter((a) => a === v).length);
  if (q.type === "single" || q.type === "multiple") {
    s.choices = q.config.options.map((_, i) => given.filter((a) => a === i || (Array.isArray(a) && a.includes(i))).length);
  }
  if (q.type === "fill") s.blanks = q.config.blanks.map((_, i) => answers.filter((a) => a.blanks?.[i]).length);
  return s;
}

// --- Words ---

const WEEKDAY = "日一二三四五六";
const TAIPEI = 8 * 3600_000; // UTC+8, no daylight saving

// 11/5（三）10:10, in Taiwan time whatever the computer's time zone.
export function formatTaipei(iso: string) {
  const d = new Date(new Date(iso).getTime() + TAIPEI);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEKDAY[d.getUTCDay()]}）${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// 2026-11-05, for file names.
export function dateStamp(iso: string) {
  return new Date(new Date(iso).getTime() + TAIPEI).toISOString().slice(0, 10);
}

// What a student answered, as a person would write it: 「B」「○」「說、悅」.
export function answerText(q: Question, answer: Answer | null | undefined): string {
  if (answer === null || answer === undefined) return "";
  switch (q.type) {
    case "truefalse":
      return answer === true ? "○" : answer === false ? "✕" : "";
    case "single":
      return typeof answer === "number" ? optionLetter(answer) : "";
    case "multiple":
      return Array.isArray(answer) ? [...(answer as number[])].sort((a, b) => a - b).map(optionLetter).join("、") : "";
    case "fill":
      return Array.isArray(answer) ? (answer as string[]).map((s) => s.trim() || "（空白）").join("、") : "";
    case "essay":
      return typeof answer === "string" ? answer : "";
  }
}

// The correct answer in the same words.
export function correctText(q: Question) {
  switch (q.type) {
    case "truefalse":
      return q.config.answer ? "○" : "✕";
    case "single":
    case "multiple":
      return q.config.correct.map(optionLetter).join("、");
    case "fill":
      return q.config.blanks.map((list, i) => `第 ${i + 1} 格：${list.join(" 或 ")}`).join("；");
    case "essay":
      return "";
  }
}

export const RESULT_WORD: Record<Cell["kind"], string> = {
  absent: "缺席",
  unanswered: "沒作答",
  correct: "答對",
  wrong: "答錯",
  ungraded: "未批改",
  graded: "已批改",
};

// One cell of the 學生成績 table: ○／✕／— or the 簡答 score.
export function cellMark(q: Question, c: Cell) {
  if (c.kind === "absent") return "";
  if (c.kind === "unanswered") return "—";
  if (c.kind === "correct") return "○";
  if (c.kind === "wrong") return "✕";
  if (c.kind === "ungraded") return "未改";
  return q.type === "essay" ? String(c.score) : "○";
}

export function questionSnippet(text: string, length = 20) {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > length ? `${line.slice(0, length)}…` : line;
}

export { typeLabel };
