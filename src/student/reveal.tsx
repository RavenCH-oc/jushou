// What a student sees after the teacher reveals the answer: their own result
// (in words and a mark, not only colour) and the correct answer.
import type { Answer } from "../shared/grading";
import type { StudentCurrent } from "../shared/lesson";
import { optionLetter, type Question } from "../shared/questions";
import { ReceivedReview } from "./peer-review";

const VERDICT = {
  correct: ["○", "答對了"],
  wrong: ["✕", "答錯了"],
  unanswered: ["－", "沒有作答"],
  pending: ["…", "老師之後批改"],
  graded: ["✓", "老師已批改"],
} as const;

export function Reveal({ current }: { current: StudentCurrent }) {
  const { result, question } = current.reveal!;
  const [mark, label] = VERDICT[result.status];
  return (
    <div class="stack">
      {current.received !== undefined && <ReceivedReview received={current.received} />}
      <p class={`verdict verdict-${result.status}`} role="status">
        <span class="verdict-mark" aria-hidden="true">
          {mark}
        </span>
        {label}
      </p>
      {result.score !== null && (
        <p class="verdict-score">
          得 {result.score}／{question.points} 分
        </p>
      )}
      <p class="muted">第 {current.number} 題</p>
      <p class="reveal-text">{question.text}</p>
      <CorrectAnswer question={question} answer={current.answer} blanks={result.blanks} />
    </div>
  );
}

const tf = (v: unknown) => (v === true ? "○ 對" : v === false ? "✕ 錯" : "（沒有作答）");

function CorrectAnswer({ question: q, answer, blanks }: { question: Question; answer: Answer | null; blanks?: boolean[] }) {
  switch (q.type) {
    case "truefalse":
      return (
        <dl class="reveal-list">
          <dt>正確答案</dt>
          <dd>{tf(q.config.answer)}</dd>
          <dt>你的答案</dt>
          <dd>{tf(answer)}</dd>
        </dl>
      );
    case "single":
    case "multiple": {
      const picked = Array.isArray(answer) ? answer : [answer];
      return (
        <ul class="reveal-options">
          {q.config.options.map((text, i) => {
            const correct = q.config.correct.includes(i);
            return (
              <li key={i} class={correct ? "reveal-correct" : ""}>
                <span class="qv-letter">{optionLetter(i)}</span>
                <span class="reveal-option-text">{text}</span>
                <span class="reveal-tags">
                  {correct && <strong>✓ 正確答案</strong>}
                  {picked.includes(i) && <span>你選的</span>}
                </span>
              </li>
            );
          })}
        </ul>
      );
    }
    case "fill": {
      const given = Array.isArray(answer) ? (answer as string[]) : [];
      return (
        <ul class="reveal-blanks">
          {q.config.blanks.map((accepted, i) => (
            <li key={i}>
              <strong>第 {i + 1} 格</strong>　你寫「{given[i]?.trim() || "（空白）"}」
              <strong class={blanks?.[i] ? "ok" : "no"}>{blanks?.[i] ? "○ 對" : "✕ 錯"}</strong>
              <br />
              答案：{accepted.join("、")}
            </li>
          ))}
        </ul>
      );
    }
    case "essay":
      return typeof answer === "string" ? (
        <div>
          <p class="muted">你的回答</p>
          <p class="essay-answer">{answer}</p>
        </div>
      ) : null;
  }
}
