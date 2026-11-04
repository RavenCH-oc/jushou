// How a student sees one question on their phone. The teacher editor's
// preview imports this too, so both always look the same.
// It only ever gets a StudentQuestion (no answers), see toStudentView().
import { Fragment } from "preact";
import "./question-view.css";
import type { Answer, StudentQuestion } from "../shared/grading";
import { optionLetter, typeLabel } from "../shared/questions";

type Props = {
  q: StudentQuestion;
  number?: number;
  answer?: Answer;
  onAnswer?: (a: Answer) => void;
};

export function QuestionView({ q, number, answer, onAnswer = () => {} }: Props) {
  return (
    <article class="qv">
      <p class="qv-meta">
        {number !== undefined && <strong>第 {number} 題　</strong>}
        {typeLabel(q.type)}・{q.points} 分
      </p>
      <QuestionText q={q} />
      {q.note && <p class="qv-note">{q.note}</p>}
      {q.type === "truefalse" && <TrueFalse value={answer as boolean | undefined} onChange={onAnswer} />}
      {q.type === "single" && (
        <Options options={q.options} picked={typeof answer === "number" ? [answer] : []} onPick={(i) => onAnswer(i)} />
      )}
      {q.type === "multiple" && (
        <>
          <p class="qv-hint">可以選多個</p>
          <Options
            multiple
            options={q.options}
            picked={Array.isArray(answer) ? (answer as number[]) : []}
            onPick={(i) => {
              const picked = Array.isArray(answer) ? (answer as number[]) : [];
              onAnswer(picked.includes(i) ? picked.filter((x) => x !== i) : [...picked, i].sort((a, b) => a - b));
            }}
          />
        </>
      )}
      {q.type === "fill" && <Blanks count={q.blankCount} value={Array.isArray(answer) ? (answer as string[]) : []} onChange={onAnswer} />}
      {q.type === "essay" && (
        <textarea
          class="field qv-essay"
          aria-label="你的回答"
          placeholder="在這裡寫你的回答"
          value={typeof answer === "string" ? answer : ""}
          onInput={(e) => onAnswer(e.currentTarget.value)}
        />
      )}
    </article>
  );
}

// Fill-in text shows each blank as a numbered box, matching the inputs below.
function QuestionText({ q }: { q: StudentQuestion }) {
  if (!q.text) return <p class="qv-text qv-empty">（題目文字）</p>;
  if (q.type !== "fill") return <p class="qv-text">{q.text}</p>;
  const parts = q.text.split(/＿{3,}/);
  return (
    <p class="qv-text">
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 && <span class="qv-blank">（{i + 1}）</span>}
        </Fragment>
      ))}
    </p>
  );
}

function TrueFalse({ value, onChange }: { value?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div class="qv-tf">
      {[true, false].map((v) => (
        <button key={String(v)} type="button" class={`qv-option${value === v ? " qv-on" : ""}`} aria-pressed={value === v} onClick={() => onChange(v)}>
          <span class="qv-mark">{v ? "○" : "✕"}</span>
          {v ? "對" : "錯"}
        </button>
      ))}
    </div>
  );
}

function Options(props: { options: string[]; picked: number[]; multiple?: boolean; onPick: (i: number) => void }) {
  return (
    <div class="qv-options">
      {props.options.map((text, i) => {
        const on = props.picked.includes(i);
        return (
          <button key={i} type="button" class={`qv-option${on ? " qv-on" : ""}`} aria-pressed={on} onClick={() => props.onPick(i)}>
            <span class="qv-letter">{props.multiple ? (on ? "☑" : "☐") : optionLetter(i)}</span>
            <span>
              {props.multiple && `${optionLetter(i)}．`}
              {text || <span class="qv-empty">（選項內容）</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Blanks(props: { count: number; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div class="qv-blanks">
      {Array.from({ length: props.count }, (_, i) => (
        <label key={i} class="qv-blank-field">
          <span>第 {i + 1} 格</span>
          <input
            class="field"
            autoComplete="off"
            value={props.value[i] ?? ""}
            onInput={(e) => {
              const next = Array.from({ length: props.count }, (_, j) => props.value[j] ?? "");
              next[i] = e.currentTarget.value;
              props.onChange(next);
            }}
          />
        </label>
      ))}
    </div>
  );
}
