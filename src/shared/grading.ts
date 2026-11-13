// Grading and the student-safe view of a question. Rules: docs/PRODUCT.md.
import { countBlanks, type QuestionData, type QuestionType } from "./questions";

// What a student answers, per question type.
export type AnswerFor = {
  truefalse: boolean;
  single: number; // option index
  multiple: number[]; // option indexes
  fill: string[]; // one entry per blank
  essay: string;
};
export type Answer = AnswerFor[QuestionType];

export type GradeResult = {
  // pending = 簡答 the teacher hasn't graded yet; graded = the teacher gave it a score.
  status: "correct" | "wrong" | "unanswered" | "pending" | "graded";
  score: number | null; // null while pending
  blanks?: boolean[]; // fill only: whether each blank is right
};

// 全形半形統一、去前後空白、英文不分大小寫.
export function normalizeText(s: string) {
  return s.normalize("NFKC").trim().toLowerCase();
}

// `answer` comes from the network, so anything malformed counts as unanswered.
export function gradeAnswer(question: QuestionData, answer: unknown): GradeResult {
  const right = (ok: boolean): GradeResult => ({ status: ok ? "correct" : "wrong", score: ok ? question.points : 0 });
  const unanswered: GradeResult = { status: "unanswered", score: 0 };

  switch (question.type) {
    case "truefalse":
      return typeof answer === "boolean" ? right(answer === question.config.answer) : unanswered;

    case "single": {
      const n = question.config.options.length;
      if (typeof answer !== "number" || !Number.isInteger(answer) || answer < 0 || answer >= n) return unanswered;
      return right(answer === question.config.correct[0]);
    }

    case "multiple": {
      const n = question.config.options.length;
      if (!Array.isArray(answer)) return unanswered;
      const picked = new Set(answer.filter((i) => Number.isInteger(i) && i >= 0 && i < n));
      if (picked.size === 0) return unanswered;
      const correct = question.config.correct;
      return right(picked.size === correct.length && correct.every((i) => picked.has(i)));
    }

    case "fill": {
      const accepted = question.config.blanks;
      const given = Array.isArray(answer) ? answer.map((a) => (typeof a === "string" ? normalizeText(a) : "")) : [];
      if (!given.some(Boolean)) return { ...unanswered, blanks: accepted.map(() => false) };
      const blanks = accepted.map((list, i) => !!given[i] && list.some((a) => normalizeText(a) === given[i]));
      return { ...right(blanks.every(Boolean)), blanks };
    }

    case "essay":
      return typeof answer === "string" && answer.trim() ? { status: "pending", score: null } : unanswered;
  }
}

// The only shape of a question that may be sent to students before the
// teacher reveals the answer: no correct option, no accepted answers.
// quick: a 臨時出題, whose text and option texts may be empty (asked out loud).
export type StudentQuestion = { id: string; text: string; note: string; points: number; quick?: true } & (
  { type: "truefalse" | "essay" } | { type: "single" | "multiple"; options: string[] } | { type: "fill"; blankCount: number }
);

export function toStudentView(question: QuestionData & { id: string; quick?: boolean }): StudentQuestion {
  const base = {
    id: question.id,
    text: question.text,
    note: question.note,
    points: question.points,
    ...(question.quick ? { quick: true as const } : {}),
  };
  switch (question.type) {
    case "single":
    case "multiple":
      return { ...base, type: question.type, options: [...question.config.options] };
    case "fill":
      return { ...base, type: "fill", blankCount: countBlanks(question.text) };
    default:
      return { ...base, type: question.type };
  }
}
