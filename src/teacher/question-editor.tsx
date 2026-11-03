import { useRef, useState } from "preact/hooks";
import { api } from "./api";
import { goBackTo, href, useLeaveGuard } from "./router";
import { ErrorText, Loading, useAction, useLoad } from "./ui";
import { QuestionView } from "../student/question-view";
import { toStudentView, type Answer } from "../shared/grading";
import {
  BLANK,
  blankContexts,
  countBlanks,
  MAX_NOTE,
  MAX_OPTION_TEXT,
  MAX_OPTIONS,
  MAX_QUESTION_TEXT,
  MIN_OPTIONS,
  optionLetter,
  QUESTION_TYPES,
  splitAccepted,
  typeLabel,
  validateQuestion,
  type FieldErrors,
  type Question,
  type QuestionData,
  type QuestionType,
} from "../shared/questions";
import type { QuestionSetDetail } from "../shared/types";

// What the form holds while editing; turned into QuestionData by toData().
type Draft = {
  type: QuestionType;
  text: string;
  note: string;
  points: string;
  tf: boolean | null;
  options: { text: string; correct: boolean }[];
  blanks: string[]; // accepted answers per blank, as typed (、 or new lines)
};

function emptyDraft(type: QuestionType): Draft {
  const options = type === "single" || type === "multiple" ? Array.from({ length: 4 }, () => ({ text: "", correct: false })) : [];
  return { type, text: "", note: "", points: "1", tf: null, options, blanks: [] };
}

function fromQuestion(q: Question): Draft {
  const d = emptyDraft(q.type);
  d.text = q.text;
  d.note = q.note;
  d.points = String(q.points);
  if (q.type === "truefalse") d.tf = q.config.answer;
  if (q.type === "single" || q.type === "multiple") {
    d.options = q.config.options.map((text, i) => ({ text, correct: q.config.correct.includes(i) }));
  }
  if (q.type === "fill") d.blanks = q.config.blanks.map((list) => list.join("、"));
  return d;
}

function toData(d: Draft) {
  const points = Number(d.points.normalize("NFKC").trim());
  const base = { type: d.type, text: d.text, note: d.note, points };
  switch (d.type) {
    case "truefalse":
      return { ...base, config: { answer: d.tf } };
    case "single":
    case "multiple":
      return {
        ...base,
        config: { options: d.options.map((o) => o.text), correct: d.options.flatMap((o, i) => (o.correct ? [i] : [])) },
      };
    case "fill":
      return { ...base, config: { blanks: Array.from({ length: countBlanks(d.text) }, (_, i) => splitAccepted(d.blanks[i] ?? "")) } };
    default:
      return { ...base, config: {} };
  }
}

// /set/:setId/add/:type (new) or /set/:setId/q/:questionId (edit)
export function QuestionEditor({ setId, questionId, type }: { setId: string; questionId?: string; type?: string }) {
  const { data: set, error } = useLoad(() => api<QuestionSetDetail>("GET", `/sets/${setId}`), [setId]);
  if (!set) return <Loading error={error} />;
  const existing = questionId ? set.questions.find((q) => q.id === questionId) : undefined;
  if (questionId && !existing) return <Loading error="找不到這一題，可能已經被刪除。" />;
  if (!existing && !QUESTION_TYPES.some((t) => t.type === type)) return <Loading error="找不到這種題型。" />;
  const number = existing ? set.questions.indexOf(existing) + 1 : set.questions.length + 1;
  return <Editor set={set} existing={existing} type={(existing?.type ?? type) as QuestionType} number={number} />;
}

function Editor(props: { set: QuestionSetDetail; existing?: Question; type: QuestionType; number: number }) {
  const { set, existing } = props;
  const [draft, setDraft] = useState(() => (existing ? fromQuestion(existing) : emptyDraft(props.type)));
  const [initial] = useState(() => JSON.stringify(toData(draft)));
  const [showNote, setShowNote] = useState(!!draft.note);
  const [tried, setTried] = useState(false); // show field errors only after the first 儲存
  const [previewAnswer, setPreviewAnswer] = useState<Answer | undefined>(undefined);
  const [blanksMoved, setBlanksMoved] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const { busy, error, run } = useAction();

  const data = toData(draft);
  const result = validateQuestion(data);
  const errors: FieldErrors = tried && "errors" in result ? result.errors : {};
  const clean = useRef(true);
  clean.current = JSON.stringify(data) === initial;
  const saved = useRef(false);
  useLeaveGuard(() => clean.current || saved.current, "還沒儲存，確定要離開嗎？");

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setOptions = (fn: (o: Draft["options"]) => Draft["options"]) => setDraft((d) => ({ ...d, options: fn(d.options) }));
  const back = () => goBackTo(`/set/${set.id}`);

  const save = async () => {
    setTried(true);
    if ("errors" in result) {
      // Let the form render the messages, then bring the first one into view.
      requestAnimationFrame(() => document.querySelector(".field-error")?.scrollIntoView({ block: "center" }));
      return;
    }
    const ok = await run(() =>
      existing ? api("PATCH", `/questions/${existing.id}`, result.value) : api("POST", `/sets/${set.id}/questions`, result.value),
    );
    if (ok) {
      saved.current = true;
      back();
    }
  };

  const insertBlank = () => {
    const el = textRef.current;
    const start = el?.selectionStart ?? draft.text.length;
    const end = el?.selectionEnd ?? start;
    const text = draft.text.slice(0, start) + BLANK + draft.text.slice(end);
    // Keep each answer with its blank when inserting in front of existing ones.
    const blanks = draft.blanks.slice();
    blanks.splice(countBlanks(draft.text.slice(0, start)), 0, "");
    update({ text, blanks });
    // After the new text is rendered, put the cursor right after the blank.
    setTimeout(() => {
      el?.focus();
      el?.setSelectionRange(start + BLANK.length, start + BLANK.length);
    });
  };

  const contexts = blankContexts(draft.text);
  const blankCount = contexts.length;
  const preview = toStudentView({ ...(data as QuestionData), id: "preview", points: Number.isFinite(data.points) ? data.points : 1 });

  return (
    <main class="page page-wide">
      <a class="back" href={href(`/set/${set.id}`)}>
        ← 回到 {set.name}
      </a>
      <h1>
        {existing ? "修改" : "新增"}第 {props.number} 題
      </h1>
      <div class="editor">
        <div class="stack-lg">
          <p class="type-line">
            題型：<strong>{typeLabel(draft.type)}</strong>
            <span class="muted">（建立後不能改；要換題型，請刪掉這題再新增）</span>
          </p>

          <div>
            <label for="q-text">題目文字</label>
            <textarea
              id="q-text"
              ref={textRef}
              class="field textarea textarea-short"
              maxLength={MAX_QUESTION_TEXT}
              aria-invalid={!!errors.text}
              value={draft.text}
              onInput={(e) => {
                const text = e.currentTarget.value;
                // Typing or deleting ＿＿＿ by hand doesn't move the answers below.
                if (countBlanks(text) !== countBlanks(draft.text)) setBlanksMoved(true);
                update({ text });
              }}
            />
            <FieldError message={errors.text} />
            {draft.type === "fill" && (
              <div class="row blank-tools">
                <button type="button" class="btn btn-secondary" onMouseDown={(e) => e.preventDefault()} onClick={insertBlank}>
                  插入空格
                </button>
                <span class="muted">也可以直接打三個以上的全形底線「＿＿＿」</span>
              </div>
            )}
          </div>

          {showNote ? (
            <div>
              <label for="q-note">給學生的提示（選填）</label>
              <textarea
                id="q-note"
                class="field textarea textarea-note"
                maxLength={MAX_NOTE}
                aria-describedby="q-note-hint"
                placeholder="例如：想想作者當時的處境"
                value={draft.note}
                onInput={(e) => update({ note: e.currentTarget.value })}
              />
              <p id="q-note-hint" class="muted field-hint">
                作答時學生就看得到，請不要寫答案
              </p>
              <FieldError message={errors.note} />
            </div>
          ) : (
            <button type="button" class="link-button" onClick={() => setShowNote(true)}>
              ＋ 加上給學生的提示
            </button>
          )}

          <div>
            <label for="q-points">配分</label>
            <div class="row row-center">
              <input
                id="q-points"
                class="field field-seat"
                inputMode="numeric"
                aria-invalid={!!errors.points}
                value={draft.points}
                onInput={(e) => update({ points: e.currentTarget.value })}
              />
              <span>分</span>
            </div>
            <FieldError message={errors.points} />
          </div>

          {draft.type === "truefalse" && (
            <fieldset class="choices">
              <legend>正確答案</legend>
              <div class="choices-row tf-answer">
                {[true, false].map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    class={`btn ${draft.tf === v ? "" : "btn-secondary"}`}
                    aria-pressed={draft.tf === v}
                    onClick={() => update({ tf: v })}
                  >
                    {v ? "○ 對" : "✕ 錯"}
                  </button>
                ))}
              </div>
              <FieldError message={errors.answer} />
            </fieldset>
          )}

          {(draft.type === "single" || draft.type === "multiple") && (
            <fieldset class="choices">
              <legend>選項{draft.type === "multiple" && "（勾選所有正確答案）"}</legend>
              {draft.options.map((o, i) => (
                <div key={i} class={`option-edit${o.correct ? " option-correct" : ""}`}>
                  <div class="option-main">
                    <span class="option-letter">{optionLetter(i)}</span>
                    <input
                      class="field"
                      aria-label={`選項 ${optionLetter(i)}`}
                      aria-invalid={!!errors[`option-${i}`]}
                      maxLength={MAX_OPTION_TEXT}
                      value={o.text}
                      onInput={(e) => {
                        const text = e.currentTarget.value;
                        setOptions((list) => list.map((x, j) => (j === i ? { ...x, text } : x)));
                      }}
                    />
                  </div>
                  <FieldError message={errors[`option-${i}`]} />
                  <div class="row option-tools">
                    {draft.type === "single" ? (
                      <button
                        type="button"
                        class={`btn btn-small ${o.correct ? "" : "btn-secondary"}`}
                        aria-pressed={o.correct}
                        onClick={() => setOptions((list) => list.map((x, j) => ({ ...x, correct: j === i })))}
                      >
                        {o.correct ? "✓ 正確答案" : "設為正確答案"}
                      </button>
                    ) : (
                      <label class="choice option-check">
                        <input
                          type="checkbox"
                          checked={o.correct}
                          onChange={() => setOptions((list) => list.map((x, j) => (j === i ? { ...x, correct: !x.correct } : x)))}
                        />
                        正確答案
                      </label>
                    )}
                    <button type="button" class="btn btn-secondary btn-small" disabled={i === 0} onClick={() => setOptions((l) => swap(l, i, i - 1))}>
                      上移
                    </button>
                    <button
                      type="button"
                      class="btn btn-secondary btn-small"
                      disabled={i === draft.options.length - 1}
                      onClick={() => setOptions((l) => swap(l, i, i + 1))}
                    >
                      下移
                    </button>
                    <button
                      type="button"
                      class="btn btn-secondary btn-small"
                      disabled={draft.options.length <= MIN_OPTIONS}
                      onClick={() => setOptions((l) => l.filter((_, j) => j !== i))}
                    >
                      刪除
                    </button>
                  </div>
                </div>
              ))}
              <FieldError message={errors.options ?? errors.answer} />
              <div>
                <button
                  type="button"
                  class="btn btn-secondary"
                  disabled={draft.options.length >= MAX_OPTIONS}
                  onClick={() => setOptions((l) => [...l, { text: "", correct: false }])}
                >
                  ＋ 新增選項
                </button>
                {draft.options.length >= MAX_OPTIONS && <span class="muted">　最多 {MAX_OPTIONS} 個選項</span>}
              </div>
            </fieldset>
          )}

          {draft.type === "fill" && (
            <fieldset class="choices">
              <legend>每一格的答案</legend>
              {blankCount === 0 ? (
                <p class="muted">題目裡還沒有空格。把游標放在要挖空的地方，按「插入空格」。</p>
              ) : (
                <p class="muted">同一格有好幾種可以接受的答案時，用頓號「、」或換行分開。全形半形、前後空白、英文大小寫都不影響對錯。</p>
              )}
              {blanksMoved && blankCount > 0 && (
                <p class="warning" role="status">
                  空格數量變了，請確認每一格的答案
                </p>
              )}
              {contexts.map((context, i) => (
                <div key={i}>
                  <label for={`blank-${i}`}>
                    第 {i + 1} 格：<span class="blank-context">{context}</span>
                  </label>
                  <textarea
                    id={`blank-${i}`}
                    class="field textarea textarea-blank"
                    placeholder="例如：說、悅"
                    aria-invalid={!!errors[`blank-${i}`]}
                    value={draft.blanks[i] ?? ""}
                    onInput={(e) => {
                      const blanks = Array.from({ length: Math.max(blankCount, draft.blanks.length) }, (_, j) => draft.blanks[j] ?? "");
                      blanks[i] = e.currentTarget.value;
                      update({ blanks });
                    }}
                  />
                  <FieldError message={errors[`blank-${i}`]} />
                </div>
              ))}
            </fieldset>
          )}

          {draft.type === "essay" && <p class="muted">簡答／申論題只需要題目文字。學生寫的回答，老師之後再看、再批改。</p>}

          <ErrorText message={error} />
          {tried && "errors" in result && <p class="error">還有地方要修改，請看上面紅色的說明。</p>}
          <div class="row">
            <button type="button" class="btn" disabled={busy} onClick={save}>
              {busy ? "儲存中…" : "儲存"}
            </button>
            <button type="button" class="btn btn-secondary" onClick={back}>
              取消
            </button>
          </div>
        </div>

        <aside class="editor-preview">
          <h2>學生看到的樣子</h2>
          <div class="phone">
            <QuestionView q={preview} number={props.number} answer={previewAnswer} onAnswer={setPreviewAnswer} />
          </div>
          <p class="muted preview-note">可以點點看，不會記錄。</p>
        </aside>
      </div>
    </main>
  );
}

function FieldError({ message }: { message?: string }) {
  return message ? (
    <p class="error field-error" role="alert">
      {message}
    </p>
  ) : null;
}

function swap<T>(list: T[], a: number, b: number) {
  const next = list.slice();
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}
