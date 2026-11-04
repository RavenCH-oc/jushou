import { useState } from "preact/hooks";
import { api } from "./api";
import { go, href } from "./router";
import { Confirm, ErrorText, Loading, Modal, Rename, useAction, useLoad } from "./ui";
import { QuestionView } from "../student/question-view";
import { toStudentView, type Answer } from "../shared/grading";
import { MAX_SET_NAME, QUESTION_TYPES, typeLabel, type Question } from "../shared/questions";
import type { QuestionSetDetail, QuestionSetSummary } from "../shared/types";

function snippet(text: string) {
  const oneLine = text.replace(/\s+/g, " ");
  return oneLine.length > 40 ? `${oneLine.slice(0, 40)}…` : oneLine;
}

type Dialog = { kind: "add" } | { kind: "rename" } | { kind: "delete" } | { kind: "delete-question"; q: Question; number: number };

export function SetPage({ id }: { id: string }) {
  const { data: set, error, reload } = useLoad(() => api<QuestionSetDetail>("GET", `/sets/${id}`), [id]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const action = useAction();
  const close = () => setDialog(null);

  if (!set) return <Loading error={error} />;
  const total = set.questions.reduce((sum, q) => sum + q.points, 0);

  const change = (method: string, path: string, body?: unknown) =>
    action.run(async () => {
      await api(method, path, body);
      reload();
    });

  const copySet = () =>
    action.run(async () => {
      const copy = await api<QuestionSetSummary>("POST", `/sets/${set.id}/copy`);
      go(`/set/${copy.id}`);
    });

  return (
    <main class="page">
      <a class="back" href={href("/")}>
        ← 回首頁
      </a>
      <h1>{set.name}</h1>
      <div class="section-head">
        <p class="muted set-total">
          共 {set.questions.length} 題，總分 {total} 分
        </p>
        {set.questions.length > 0 && (
          <a class="btn btn-secondary" href={href(`/set/${set.id}/preview`)}>
            預覽全部
          </a>
        )}
      </div>
      <ErrorText message={action.error} />

      {set.questions.length === 0 ? (
        <p class="muted">這個題組還沒有題目</p>
      ) : (
        <ol class="question-list">
          {set.questions.map((q, i) => (
            <li key={q.id} class="card question-item">
              <p class="question-head">
                <strong>第 {i + 1} 題</strong>
                <span class="muted">
                  {typeLabel(q.type)}・{q.points} 分
                </span>
              </p>
              <p class="question-snippet">{snippet(q.text)}</p>
              <div class="row">
                <a class="btn btn-secondary btn-small" href={href(`/set/${set.id}/q/${q.id}`)}>
                  修改
                </a>
                <button class="btn btn-secondary btn-small" disabled={action.busy} onClick={() => change("POST", `/questions/${q.id}/copy`)}>
                  複製
                </button>
                <button
                  class="btn btn-secondary btn-small"
                  disabled={action.busy || i === 0}
                  onClick={() => change("POST", `/questions/${q.id}/move`, { direction: "up" })}
                >
                  上移
                </button>
                <button
                  class="btn btn-secondary btn-small"
                  disabled={action.busy || i === set.questions.length - 1}
                  onClick={() => change("POST", `/questions/${q.id}/move`, { direction: "down" })}
                >
                  下移
                </button>
                <button class="btn btn-secondary btn-small" onClick={() => setDialog({ kind: "delete-question", q, number: i + 1 })}>
                  刪除
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {/* Right under the last question, where the new one will appear. */}
      <button class="btn btn-block add-question" onClick={() => setDialog({ kind: "add" })}>
        ＋ 新增第 {set.questions.length + 1} 題
      </button>

      <div class="row tools">
        <button class="btn btn-secondary" onClick={() => setDialog({ kind: "rename" })}>
          改題組名稱
        </button>
        <button class="btn btn-secondary" disabled={action.busy} onClick={copySet}>
          複製整個題組
        </button>
        <button class="btn btn-secondary" onClick={() => setDialog({ kind: "delete" })}>
          刪除題組
        </button>
      </div>

      {dialog?.kind === "add" && (
        <Modal title="要新增哪一種題目？" onClose={close}>
          <div class="type-picker">
            {QUESTION_TYPES.map((t) => (
              <a key={t.type} class="btn btn-block type-button" href={href(`/set/${set.id}/add/${t.type}`)}>
                <span>{t.label}</span>
                <span class="type-desc">{t.description}</span>
              </a>
            ))}
            <button class="btn btn-secondary btn-block" onClick={close}>
              取消
            </button>
          </div>
        </Modal>
      )}
      {dialog?.kind === "rename" && (
        <Rename
          title="修改題組名稱"
          label="題組名稱"
          value={set.name}
          maxLength={MAX_SET_NAME}
          onSave={async (name) => {
            await api("PATCH", `/sets/${set.id}`, { name });
            reload();
          }}
          onClose={close}
        />
      )}
      {dialog?.kind === "delete-question" && (
        <Confirm
          title={`刪除第 ${dialog.number} 題？`}
          message={`「${snippet(dialog.q.text)}」會被刪除，無法復原。`}
          confirmLabel="刪除這一題"
          danger
          onConfirm={async () => {
            await api("DELETE", `/questions/${dialog.q.id}`);
            reload();
          }}
          onClose={close}
        />
      )}
      {dialog?.kind === "delete" && (
        <Confirm
          title={`刪除「${set.name}」？`}
          message={
            set.questions.length > 0
              ? `題組和裡面的 ${set.questions.length} 題都會被刪除，無法復原。`
              : "這個題組會被刪除，無法復原。"
          }
          confirmLabel="刪除題組"
          danger
          onConfirm={async () => {
            await api("DELETE", `/sets/${set.id}`);
            location.replace(href("/"));
          }}
          onClose={close}
        />
      )}
    </main>
  );
}

// Every question in order, exactly as a student's phone shows it.
export function SetPreview({ id }: { id: string }) {
  const { data: set, error } = useLoad(() => api<QuestionSetDetail>("GET", `/sets/${id}`), [id]);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  if (!set) return <Loading error={error} />;
  return (
    <main class="page">
      <a class="back" href={href(`/set/${set.id}`)}>
        ← 回到 {set.name}
      </a>
      <h1>預覽：{set.name}</h1>
      <p class="muted">這是學生手機上看到的樣子。可以點點看，不會記錄。</p>
      <div class="phone-column stack-lg">
        {set.questions.map((q, i) => (
          <div key={q.id} class="phone">
            <QuestionView
              q={toStudentView(q)}
              number={i + 1}
              answer={answers[q.id]}
              onAnswer={(a) => setAnswers((all) => ({ ...all, [q.id]: a }))}
            />
          </div>
        ))}
      </div>
    </main>
  );
}
