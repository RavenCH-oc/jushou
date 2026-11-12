// 臨時出題: a question made up during the lesson, asked out loud or on the board.
// The phone only shows A/B/C… (or ○/✕, or a text box). Always 1 point, and the
// correct answer is chosen when the teacher reveals it (or 「這題不計分」).
import type { QuestionData } from "./questions";

export const QUICK_SET_NAME = "隨堂"; // 題組 name of a lesson started without one
export const QUICK_TYPES = [
  { type: "single", label: "選擇題" },
  { type: "truefalse", label: "是非題" },
  { type: "essay", label: "簡答題" },
] as const;
export type QuickType = (typeof QUICK_TYPES)[number]["type"];
export const QUICK_MIN_OPTIONS = 2;
export const QUICK_MAX_OPTIONS = 6;
export const QUICK_DEFAULT_OPTIONS = 4;
export const QUICK_MAX_TEXT = 200;
export const ORAL_LABEL = "（口頭提問）"; // a quick question without text, on teacher pages

// Body of 臨時出題: { type, optionCount?, text? }. Options have no text, and
// there is no correct answer yet (correct: [] / answer: null) until 公布.
export function validateQuick(raw: Record<string, unknown>): { value: QuestionData } | { error: string } {
  const type = raw.type;
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (raw.text !== undefined && raw.text !== null && typeof raw.text !== "string") return { error: "題目文字的格式不正確。" };
  if (text.length > QUICK_MAX_TEXT) return { error: `題目最多 ${QUICK_MAX_TEXT} 個字。` };
  const base = { text, note: "", points: 1 };
  if (type === "single") {
    const n = raw.optionCount;
    if (typeof n !== "number" || !Number.isInteger(n) || n < QUICK_MIN_OPTIONS || n > QUICK_MAX_OPTIONS) {
      return { error: `選項數要是 ${QUICK_MIN_OPTIONS} 到 ${QUICK_MAX_OPTIONS} 個。` };
    }
    return { value: { ...base, type, config: { options: Array.from({ length: n }, () => ""), correct: [] } } };
  }
  if (type === "truefalse") return { value: { ...base, type, config: { answer: null } } };
  if (type === "essay") return { value: { ...base, type, config: {} } };
  return { error: "臨時出題只能出選擇題、是非題或簡答題。" };
}

// What 公布答案 does with a quick 選擇題／是非題: body { answer } or { unscored: true }.
// Returns the question with its correct answer filled in, or that it doesn't count.
export function revealQuick(q: QuestionData, body: Record<string, unknown>): { value: QuestionData; scored: boolean } | { error: string } {
  if (q.type === "essay") return { value: q, scored: true };
  if (body.unscored === true) return { value: q, scored: false };
  const answer = body.answer;
  if (answer === undefined || answer === null) return { error: "請先選正確答案，或選這題不計分。" };
  if (q.type === "truefalse") {
    if (typeof answer !== "boolean") return { error: "是非題的正確答案要選「○ 對」或「✕ 錯」。" };
    return { value: { ...q, config: { answer } }, scored: true };
  }
  if (q.type === "single") {
    const n = q.config.options.length;
    if (typeof answer !== "number" || !Number.isInteger(answer) || answer < 0 || answer >= n) {
      return { error: "正確答案要是其中一個選項，請重新選擇。" };
    }
    return { value: { ...q, config: { ...q.config, correct: [answer] } }, scored: true };
  }
  return { error: "這一題不能這樣公布。" };
}
