// Question types, their answer settings, and validation shared by the
// teacher editor and the API. Grading lives in grading.ts.

export type QuestionType = "truefalse" | "single" | "multiple" | "fill" | "essay";

export const QUESTION_TYPES: { type: QuestionType; label: string; description: string }[] = [
  { type: "truefalse", label: "是非題", description: "學生點「○ 對」或「✕ 錯」" },
  { type: "single", label: "單選題", description: "從幾個選項中選一個" },
  { type: "multiple", label: "多選題", description: "可以選好幾個，全對才給分" },
  { type: "fill", label: "填空題", description: "題目裡挖空格，學生在每格打字" },
  { type: "essay", label: "簡答／申論", description: "學生寫一段文字，老師之後批改" },
];

export function typeLabel(type: QuestionType) {
  return QUESTION_TYPES.find((t) => t.type === type)?.label ?? "";
}

// Answer settings, stored as one JSON column in D1.
export type TrueFalseConfig = { answer: boolean };
export type ChoiceConfig = { options: string[]; correct: number[] }; // correct = option indexes
export type FillConfig = { blanks: string[][] }; // accepted answers for each blank
export type EssayConfig = Record<string, never>;

type Base = { text: string; note: string; points: number };
export type QuestionData =
  | (Base & { type: "truefalse"; config: TrueFalseConfig })
  | (Base & { type: "single" | "multiple"; config: ChoiceConfig })
  | (Base & { type: "fill"; config: FillConfig })
  | (Base & { type: "essay"; config: EssayConfig });

export type Question = QuestionData & { id: string };

export const MAX_SET_NAME = 40;
export const MAX_QUESTIONS_PER_SET = 200;
export const MAX_QUESTION_TEXT = 2000;
export const MAX_NOTE = 1000;
export const MAX_POINTS = 100;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 8;
export const MAX_OPTION_TEXT = 200;
export const MAX_BLANKS = 20;
export const MAX_ACCEPTED_TEXT = 100;

// A blank is 3 or more full-width underscores in the question text.
export const BLANK = "＿＿＿";
const BLANK_RE = /＿{3,}/g;

export function countBlanks(text: string) {
  return (text.match(BLANK_RE) ?? []).length;
}

// A few characters around each blank, so the teacher can see which answer
// box belongs to which blank: "子曰學而時習之不亦＿＿＿乎" -> ["…習之不亦＿＿＿乎"].
export function blankContexts(text: string, around = 4) {
  const flat = text.replace(/\s+/g, " ");
  const spans = [...flat.matchAll(BLANK_RE)].map((m) => [m.index, m.index + m[0].length]);
  return spans.map(([start, end], i) => {
    const from = Math.max(start - around, i > 0 ? spans[i - 1][1] : 0);
    const to = Math.min(end + around, i < spans.length - 1 ? spans[i + 1][0] : flat.length);
    return `${from > 0 ? "…" : ""}${flat.slice(from, start)}${BLANK}${flat.slice(end, to)}${to < flat.length ? "…" : ""}`;
  });
}

// "甲、乙\n丙" -> ["甲", "乙", "丙"]
export function splitAccepted(input: string) {
  return input
    .split(/[、\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function optionLetter(i: number) {
  return String.fromCharCode(65 + i); // A, B, C…
}

export function checkSetName(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return "請填寫題組名稱。";
  if (value.trim().length > MAX_SET_NAME) return `題組名稱最多 ${MAX_SET_NAME} 個字。`;
  return null;
}

// Field name -> message. Keys: text, note, points, answer, options, option-<i>, blank-<i>.
export type FieldErrors = Record<string, string>;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// Check a question from the editor or the network and return a cleaned copy.
export function validateQuestion(raw: unknown): { value: QuestionData } | { errors: FieldErrors } {
  const errors: FieldErrors = {};
  const q = isObject(raw) ? raw : {};
  const type = q.type as QuestionType;
  if (!QUESTION_TYPES.some((t) => t.type === type)) return { errors: { type: "題型不正確。" } };

  const text = str(q.text);
  const note = str(q.note);
  const points = q.points;
  if (!text) errors.text = "請填寫題目文字。";
  else if (text.length > MAX_QUESTION_TEXT) errors.text = `題目文字最多 ${MAX_QUESTION_TEXT} 個字。`;
  if (note.length > MAX_NOTE) errors.note = `說明最多 ${MAX_NOTE} 個字。`;
  if (typeof points !== "number" || !Number.isInteger(points) || points < 1) errors.points = "配分要是正整數。";
  else if (points > MAX_POINTS) errors.points = `配分最多 ${MAX_POINTS} 分。`;

  const config = isObject(q.config) ? q.config : {};
  const base = { text, note, points: points as number };
  let value: QuestionData;

  if (type === "truefalse") {
    if (typeof config.answer !== "boolean") errors.answer = "請選擇正確答案是「○ 對」還是「✕ 錯」。";
    value = { ...base, type, config: { answer: config.answer === true } };
  } else if (type === "single" || type === "multiple") {
    const options = Array.isArray(config.options) ? config.options.map(str) : [];
    const correct = Array.isArray(config.correct) ? config.correct : [];
    if (options.length < MIN_OPTIONS) errors.options = `至少要有 ${MIN_OPTIONS} 個選項。`;
    else if (options.length > MAX_OPTIONS) errors.options = `最多 ${MAX_OPTIONS} 個選項。`;
    options.forEach((o, i) => {
      if (!o) errors[`option-${i}`] = `選項 ${optionLetter(i)} 還沒有內容。`;
      else if (o.length > MAX_OPTION_TEXT) errors[`option-${i}`] = `每個選項最多 ${MAX_OPTION_TEXT} 個字。`;
    });
    const valid = correct.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < options.length);
    const picked = [...new Set(valid)].sort((a, b) => a - b);
    if (picked.length !== correct.length) errors.answer = "正確答案的設定有問題，請重新選擇。";
    else if (type === "single" && picked.length !== 1) errors.answer = "請在其中一個選項按「設為正確答案」。";
    else if (type === "multiple" && picked.length === 0) errors.answer = "請至少勾選一個正確答案。";
    value = { ...base, type, config: { options, correct: picked } };
  } else if (type === "fill") {
    const count = countBlanks(text);
    const given = Array.isArray(config.blanks) ? config.blanks : [];
    if (text && count === 0) errors.text = "題目裡還沒有空格，請按「插入空格」。";
    else if (count > MAX_BLANKS) errors.text = `一題最多 ${MAX_BLANKS} 個空格。`;
    const blanks = Array.from({ length: count }, (_, i) => {
      const list = Array.isArray(given[i]) ? (given[i] as unknown[]).map(str).filter(Boolean) : [];
      return [...new Set(list)];
    });
    blanks.forEach((list, i) => {
      if (list.length === 0) errors[`blank-${i}`] = `第 ${i + 1} 格還沒有填答案。`;
      else if (list.some((a) => a.length > MAX_ACCEPTED_TEXT)) errors[`blank-${i}`] = `每個答案最多 ${MAX_ACCEPTED_TEXT} 個字。`;
    });
    value = { ...base, type, config: { blanks } };
  } else {
    value = { ...base, type: "essay", config: {} };
  }

  return Object.keys(errors).length ? { errors } : { value };
}
