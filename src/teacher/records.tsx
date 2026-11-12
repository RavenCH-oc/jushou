// 上課紀錄: the class's list of lessons, one lesson's record (scores, per-question
// stats, groups, question detail and 簡答 grading), and one student's history.
// All numbers come from src/shared/records.ts so the pages and Excel agree.
import { useEffect, useMemo, useState } from "preact/hooks";
import type { ComponentChild } from "preact";
import { api } from "./api";
import { go, href } from "./router";
import { Confirm, ErrorText, Loading, Modal, useAction, useLoad } from "./ui";
import { AnswerBars } from "./lesson";
import { QuestionText } from "../student/question-view";
import { toStudentView } from "../shared/grading";
import { optionLetter } from "../shared/questions";
import { ORAL_LABEL } from "../shared/quick";
import {
  analyze,
  answerText,
  cellMark,
  correctText,
  distribution,
  formatTaipei,
  historyRate,
  oneDecimal,
  parseRecord,
  percent,
  questionSnippet,
  ratio,
  reviewsOf,
  summaryRate,
  typeLabel,
  type Analysis,
  type LessonRecord,
  type LessonSummary,
  type RecordDetail,
  type RecordQuestion,
  type RecordReview,
  type StudentHistory,
} from "../shared/records";
import type { ClassDetail, GroupingDetail } from "../shared/types";

function Ungraded({ n }: { n: number }) {
  return n ? <span class="badge">{n} 份簡答沒批改</span> : null;
}

// --- 班級頁「上課紀錄」分頁 ---

export function RecordList({ cls }: { cls: ClassDetail }) {
  const { data: list, error } = useLoad(() => api<LessonSummary[]>("GET", `/classes/${cls.id}/records`), [cls.id]);
  const [exporting, setExporting] = useState(false);
  if (!list) return error ? <ErrorText message={error} /> : <p>載入中…</p>;
  return (
    <section>
      <div class="section-head">
        <h2>上課紀錄</h2>
        <button class="btn btn-secondary" disabled={!list.length} onClick={() => setExporting(true)}>
          匯出多堂課
        </button>
      </div>
      {list.length === 0 ? (
        <p class="muted">還沒有上課紀錄。下課後，每堂課的結果會出現在這裡。</p>
      ) : (
        <div class="table-wrap">
          <table class="table records-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>題組</th>
                <th>出席</th>
                <th>平均得分率</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((l) => (
                <tr key={l.id} class="row-link" onClick={() => go(`/record/${l.id}`)}>
                  <td>
                    <a href={href(`/record/${l.id}`)}>{formatTaipei(l.startedAt)}</a>
                  </td>
                  <td>{l.setName}</td>
                  <td>
                    {l.present}／{l.total}
                  </td>
                  <td>{percent(summaryRate(l))}</td>
                  <td>
                    <Ungraded n={l.ungraded} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {exporting && <ExportDialog className={cls.name} list={list} onClose={() => setExporting(false)} />}
    </section>
  );
}

function ExportDialog({ className, list, onClose }: { className: string; list: LessonSummary[]; onClose: () => void }) {
  const [picked, setPicked] = useState(() => new Set(list.map((l) => l.id)));
  const [progress, setProgress] = useState("");
  const action = useAction();
  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const all = picked.size === list.length;

  const run = () =>
    action
      .run(async () => {
        const ids = list.filter((l) => picked.has(l.id)).map((l) => l.id);
        const records: LessonRecord[] = [];
        for (const [i, id] of ids.entries()) {
          setProgress(`準備中 ${i + 1}／${ids.length}`);
          records.push(parseRecord(await api<RecordDetail>("GET", `/records/${id}`)));
        }
        const { downloadClass } = await import("./export");
        downloadClass(className, records);
        onClose();
      })
      .finally(() => setProgress(""));

  return (
    <Modal title="匯出多堂課" wide onClose={onClose}>
      <p>勾選要放進 Excel 的課。第一張工作表是總表，之後每堂課一張。</p>
      <button class="link-button" onClick={() => setPicked(all ? new Set() : new Set(list.map((l) => l.id)))}>
        {all ? "全部取消" : "全選"}
      </button>
      <div class="choices export-list">
        {list.map((l) => (
          <label key={l.id} class={`choice${picked.has(l.id) ? " choice-on" : ""}`}>
            <input type="checkbox" checked={picked.has(l.id)} onChange={() => toggle(l.id)} />
            <span>
              {formatTaipei(l.startedAt)}　{l.setName}
            </span>
          </label>
        ))}
      </div>
      <ErrorText message={action.error} />
      <div class="stack">
        <button class="btn btn-block" disabled={!picked.size || action.busy} onClick={run}>
          {progress || `下載（${picked.size} 堂）`}
        </button>
        <button class="btn btn-secondary btn-block" onClick={onClose}>
          取消
        </button>
      </div>
    </Modal>
  );
}

// --- 首頁「最近上課」 ---

export function RecentRecords({ list }: { list: LessonSummary[] }) {
  if (!list.length) return null;
  return (
    <section class="home-section">
      <h2>最近上課</h2>
      <ul class="card-list">
        {list.map((l) => (
          <li key={l.id}>
            <a class="card card-link" href={href(`/record/${l.id}`)}>
              <span>
                <strong>
                  {l.className}・{l.setName}
                </strong>
                <span class="muted record-when">
                  {formatTaipei(l.startedAt)}・出席 {l.present}／{l.total}
                </span>
              </span>
              <Ungraded n={l.ungraded} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

// --- 上課紀錄頁 ---

const TABS = [
  { key: "", label: "學生成績" },
  { key: "questions", label: "每題統計" },
  { key: "groups", label: "依分組看" },
];

export function RecordPage({ id, tab, qid }: { id: string; tab?: string; qid?: string }) {
  const { data, error } = useLoad(() => api<RecordDetail>("GET", `/records/${id}`), [id]);
  const [record, setRecord] = useState<LessonRecord | null>(null);
  useEffect(() => setRecord(data && parseRecord(data)), [data]);
  const a = useMemo(() => record && analyze(record), [record]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const exporting = useAction();

  if (!record || !a) return <Loading error={error} />;

  const onGraded = (questionId: string, studentId: string, score: number) =>
    setRecord(
      (r) =>
        r && {
          ...r,
          answers: r.answers.map((x) => (x.questionId === questionId && x.studentId === studentId ? { ...x, status: "graded", score } : x)),
        },
    );
  const firstUngraded = a.questions.find((x) => x.ungraded);
  const tabs = TABS.filter((t) => t.key !== "groups" || record.groupingCount > 0);
  const downloadExcel = () =>
    exporting.run(async () => {
      const { downloadLesson } = await import("./export");
      downloadLesson(record);
    });

  return (
    <main class="page">
      {qid ? (
        <a class="back" href={href(`/record/${id}/questions`)}>
          ← 回每題統計
        </a>
      ) : (
        <a class="back" href={href(`/class/${record.classId}/records`)}>
          ← 回上課紀錄
        </a>
      )}
      <h1>
        {record.className}・{record.setName}・{formatTaipei(record.startedAt)}
      </h1>
      {!qid && (
        <div class="record-summary">
          <p>
            出席{" "}
            <strong>
              {a.present}／{a.total}
            </strong>
          </p>
          <p>
            平均分數{" "}
            <strong>
              {oneDecimal(a.average)}／{a.max}
            </strong>
          </p>
          {firstUngraded && (
            <a class="badge badge-link" href={href(`/record/${id}/q/${firstUngraded.q.id}`)}>
              還有 {a.ungraded} 份簡答沒批改
            </a>
          )}
          <button class="btn record-download" disabled={exporting.busy} onClick={downloadExcel}>
            {exporting.busy ? "準備中…" : "下載 Excel"}
          </button>
        </div>
      )}
      <ErrorText message={exporting.error} />

      {qid ? (
        <QuestionDetail record={record} a={a} qid={qid} onGraded={onGraded} />
      ) : (
        <>
          <nav class="tabs">
            {tabs.map((t) => (
              <a
                key={t.key}
                class={`tab${t.key === (tab ?? "") ? " tab-active" : ""}`}
                aria-current={t.key === (tab ?? "") ? "page" : undefined}
                href={href(`/record/${id}${t.key ? `/${t.key}` : ""}`)}
              >
                {t.label}
              </a>
            ))}
          </nav>
          {tab === "questions" ? (
            <QuestionTable record={record} a={a} />
          ) : tab === "groups" && record.groupingCount > 0 ? (
            <GroupView record={record} a={a} />
          ) : (
            <ScoreTable a={a} />
          )}
          <div class="tools">
            <button class="btn btn-secondary" onClick={() => setConfirmDelete(true)}>
              刪除這堂紀錄
            </button>
          </div>
        </>
      )}

      {confirmDelete && (
        <Confirm
          title="刪除這堂課的紀錄？"
          message="學生在這堂課的作答和分數都會刪除，無法復原。"
          confirmLabel="刪除這堂紀錄"
          danger
          onConfirm={async () => {
            await api("DELETE", `/records/${id}`);
            location.replace(href(`/class/${record.classId}/records`));
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </main>
  );
}

function ScoreTable({ a }: { a: Analysis }) {
  const [byScore, setByScore] = useState(false);
  const rows = byScore ? [...a.students].sort((x, y) => (y.score ?? -1) - (x.score ?? -1) || x.seat - y.seat) : a.students;
  return (
    <div class="table-wrap">
      <table class="table score-table">
        <thead>
          <tr>
            <th>座號</th>
            <th>姓名</th>
            {a.asked.map(
              (q, i) =>
                q.scored && (
                  <th key={q.id} class="num" title={questionSnippet(q.text)}>
                    第{i + 1}題
                  </th>
                ),
            )}
            <th class="num">
              <button class="sort-button" aria-pressed={byScore} onClick={() => setByScore(!byScore)}>
                總分（滿分 {a.max}）{byScore ? "▼" : "⇅"}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) =>
            s.present ? (
              <tr key={s.id}>
                <td>{s.seat}</td>
                <td>
                  <a href={href(`/student/${s.id}`)}>{s.name}</a>
                </td>
                {s.cells.map(
                  (c, i) =>
                    c.kind !== "unscored" && (
                      <td key={i} class={`num cell-${c.kind}`}>
                        {cellMark(a.asked[i], c)}
                      </td>
                    ),
                )}
                <td class="num total">{s.score}</td>
              </tr>
            ) : (
              <tr key={s.id} class="row-absent">
                <td>{s.seat}</td>
                <td>
                  <a href={href(`/student/${s.id}`)}>{s.name}</a>
                </td>
                <td colSpan={a.asked.filter((q) => q.scored).length + 1}>缺席</td>
              </tr>
            ),
          )}
        </tbody>
      </table>
      <p class="muted table-note">
        ○ 答對　✕ 答錯　— 沒作答　數字是簡答的分數；還沒批改的簡答先算 0 分。
        {a.asked.some((q) => !q.scored) && "「不計分」的題目不列在這裡。"}
      </p>
    </div>
  );
}

function QuestionTable({ record, a }: { record: LessonRecord; a: Analysis }) {
  const id = record.id;
  return (
    <div class="table-wrap">
      <table class="table records-table">
        <thead>
          <tr>
            <th>題號</th>
            <th>題型</th>
            <th>題目</th>
            <th>正確率</th>
            <th>作答人數</th>
          </tr>
        </thead>
        <tbody>
          {a.questions.map((x) => (
            <tr key={x.q.id} class="row-link" onClick={() => go(`/record/${id}/q/${x.q.id}`)}>
              <td>
                <a href={href(`/record/${id}/q/${x.q.id}`)}>第 {x.number} 題</a>
              </td>
              <td>
                {typeLabel(x.q.type)}
                {x.q.quick && <span class="tag">臨時</span>}
              </td>
              <td class="wrap">{questionSnippet(x.q.text)}</td>
              <td>
                {x.q.type === "essay" ? `平均 ${oneDecimal(x.average)} 分` : x.q.scored ? percent(x.rate) : "不計分"}
                {x.q.type === "essay" && reviewsOf(record, x.q.id).list.length > 0 && (
                  <span class="muted">・互評平均 {oneDecimal(reviewsOf(record, x.q.id).average)} 分</span>
                )}
                {x.ungraded > 0 && <Ungraded n={x.ungraded} />}
              </td>
              <td>
                {x.answered}／{a.present}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Groups = { name: string; studentIds: string[] }[];

// The groups as they were when the lesson ended. Lessons that ended before those were
// recorded fall back to the class's groups as they are now, and say so.
function GroupView({ record, a }: { record: LessonRecord; a: Analysis }) {
  if (!record.groupings) return <CurrentGroupView record={record} a={a} />;
  const groupings = record.groupings;
  return <GroupingPicker groupings={groupings} render={(id) => <GroupTable groups={groupings.find((g) => g.id === id)!.groups} a={a} />} />;
}

function CurrentGroupView({ record, a }: { record: LessonRecord; a: Analysis }) {
  const { data: cls } = useLoad(() => api<ClassDetail>("GET", `/classes/${record.classId}`), [record.classId]);
  if (!cls) return <p>載入中…</p>;
  return (
    <section class="stack">
      <p class="muted">這堂課沒有記錄當時的分組，以下是現在的分組。</p>
      {cls.groupings.length ? (
        <GroupingPicker groupings={cls.groupings} render={(id) => <CurrentGroupTable key={id} id={id} a={a} />} />
      ) : (
        <p class="muted">這個班目前沒有分組。</p>
      )}
    </section>
  );
}

function CurrentGroupTable({ id, a }: { id: string; a: Analysis }) {
  const { data: grouping, error } = useLoad(() => api<GroupingDetail>("GET", `/groupings/${id}`), [id]);
  if (error) return <ErrorText message={error} />;
  return grouping ? <GroupTable groups={grouping.groups.map((g) => ({ name: g.name, studentIds: g.studentIds }))} a={a} /> : <p>載入中…</p>;
}

function GroupingPicker({ groupings, render }: { groupings: { id: string; name: string }[]; render: (id: string) => ComponentChild }) {
  const [groupingId, setGroupingId] = useState<string | null>(null);
  const chosen = groupings.find((g) => g.id === groupingId)?.id ?? groupings[0].id;
  return (
    <section class="stack">
      {groupings.length > 1 && (
        <div class="choices choices-inline">
          {groupings.map((g) => (
            <label key={g.id} class={`choice${g.id === chosen ? " choice-on" : ""}`}>
              <input type="radio" name="grouping" checked={g.id === chosen} onChange={() => setGroupingId(g.id)} />
              {g.name}
            </label>
          ))}
        </div>
      )}
      {render(chosen)}
    </section>
  );
}

function GroupTable({ groups, a }: { groups: Groups; a: Analysis }) {
  const byId = new Map(a.students.map((s) => [s.id, s]));
  const placed = new Set(groups.flatMap((g) => g.studentIds));
  const rows = [...groups, { name: "未分組", studentIds: a.students.map((s) => s.id).filter((id) => !placed.has(id)) }];
  return (
    <table class="table records-table">
      <thead>
        <tr>
          <th>組別</th>
          <th>出席</th>
          <th>平均總分</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((g, i) => {
          const members = g.studentIds.map((id) => byId.get(id)).filter((s) => !!s);
          if (!members.length) return null;
          const present = members.filter((s) => s.present);
          const avg = present.length ? present.reduce((sum, s) => sum + (s.score ?? 0), 0) / present.length : null;
          return (
            <tr key={i}>
              <td>{g.name}</td>
              <td>
                {present.length}／{members.length}
              </td>
              <td>
                {oneDecimal(avg)}／{a.max}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// --- 題目詳情 (簡答: the grading screen) ---

function QuestionDetail(props: {
  record: LessonRecord;
  a: Analysis;
  qid: string;
  onGraded: (questionId: string, studentId: string, score: number) => void;
}) {
  const { record, a, qid } = props;
  const index = a.asked.findIndex((q) => q.id === qid);
  if (index < 0) return <ErrorText message="找不到這一題，可能沒有出過。" />;
  const q = a.asked[index];
  const stats = a.questions[index];
  const prev = a.asked[index - 1];
  const next = a.asked[index + 1];

  return (
    <section class="stack-lg">
      <div class="question-nav">
        <h2>
          第 {index + 1} 題・{typeLabel(q.type)}・{q.points} 分
        </h2>
        <div class="row">
          {prev && (
            <a class="btn btn-secondary" href={href(`/record/${record.id}/q/${prev.id}`)}>
              上一題
            </a>
          )}
          {next && (
            <a class="btn btn-secondary" href={href(`/record/${record.id}/q/${next.id}`)}>
              下一題
            </a>
          )}
        </div>
      </div>
      <div class="card record-question">
        <QuestionText q={toStudentView(q)} oral={ORAL_LABEL} />
        {q.type !== "essay" && !q.scored && <p class="record-correct">這題不計分（只看大家怎麼選）</p>}
        {q.type !== "essay" && q.scored && (
          <p class="record-correct">
            正確答案：<strong>{correctText(q)}</strong>
          </p>
        )}
      </div>
      {q.type === "essay" ? (
        <EssayGrader key={q.id} record={record} q={q} a={a} onGraded={props.onGraded} />
      ) : (
        <>
          {q.scored && (
            <p class="correct-rate">
              正確率 {percent(stats.rate)}（答對 {stats.correct}／出席 {a.present} 人）
            </p>
          )}
          {/* Percentages of everyone present, like 正確率 (沒作答 are listed below). */}
          <AnswerBars q={q} stats={{ ...distribution(q, presentAnswers(a, q)), answered: a.present }} revealed={q.scored} />
          <WhoAnswered a={a} q={q} />
        </>
      )}
    </section>
  );
}

function presentAnswers(a: Analysis, q: RecordQuestion) {
  return a.students.filter((s) => s.present).flatMap((s) => a.answerOf(q, s.id) ?? []);
}

function Names({ list }: { list: { id: string; seat: number; name: string }[] }) {
  if (!list.length) return <p class="muted">（沒有人）</p>;
  return (
    <ul class="name-chips">
      {list.map((s) => (
        <li key={s.id}>
          {s.seat} {s.name}
        </li>
      ))}
    </ul>
  );
}

function WhoAnswered({ a, q }: { a: Analysis; q: RecordQuestion }) {
  const present = a.students.filter((s) => s.present);
  const answered = present.filter((s) => a.answerOf(q, s.id));
  const missing = present.filter((s) => !a.answerOf(q, s.id));

  if (q.type === "fill") {
    return (
      <section>
        <h3>每位學生的答案</h3>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>座號</th>
                <th>姓名</th>
                {q.config.blanks.map((_, i) => (
                  <th key={i}>第 {i + 1} 格</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {answered.map((s) => {
                const ans = a.answerOf(q, s.id)!;
                const given = Array.isArray(ans.answer) ? (ans.answer as string[]) : [];
                return (
                  <tr key={s.id}>
                    <td>{s.seat}</td>
                    <td>{s.name}</td>
                    {q.config.blanks.map((_, i) => (
                      <td key={i} class={ans.blanks?.[i] ? "cell-correct" : "cell-wrong"}>
                        {ans.blanks?.[i] ? "○ " : "✕ "}
                        {given[i]?.trim() || "（空白）"}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <h3>沒作答（{missing.length} 人）</h3>
        <Names list={missing} />
      </section>
    );
  }

  const options =
    q.type === "truefalse"
      ? [
          { label: "○ 對", correct: q.scored && q.config.answer === true, picked: (v: unknown) => v === true },
          { label: "✕ 錯", correct: q.scored && q.config.answer === false, picked: (v: unknown) => v === false },
        ]
      : q.config.options.map((text, i) => ({
          label: text ? `${optionLetter(i)}．${text}` : optionLetter(i),
          correct: q.scored && q.config.correct.includes(i),
          picked: (v: unknown) => v === i || (Array.isArray(v) && v.includes(i)),
        }));
  return (
    <section class="who-answered">
      <h3>誰選了什麼</h3>
      {options.map((o) => {
        const list = answered.filter((s) => o.picked(a.answerOf(q, s.id)!.answer));
        return (
          <div key={o.label} class={`who-option${o.correct ? " who-correct" : ""}`}>
            <p class="who-label">
              {o.label}（{list.length} 人）{o.correct && <strong>✓ 正確答案</strong>}
            </p>
            <Names list={list} />
          </div>
        );
      })}
      <div class="who-option">
        <p class="who-label">沒作答（{missing.length} 人）</p>
        <Names list={missing} />
      </div>
    </section>
  );
}

function EssayGrader(props: {
  record: LessonRecord;
  q: RecordQuestion;
  a: Analysis;
  onGraded: (questionId: string, studentId: string, score: number) => void;
}) {
  const { q, a } = props;
  const reviews = reviewsOf(props.record, q.id);
  const seatOf = (id: string) => a.students.find((s) => s.id === id)?.seat;
  // Students who wrote something; 沒作答 isn't graded.
  const items = a.students
    .filter((s) => s.present)
    .map((s) => ({ s, ans: a.answerOf(q, s.id) }))
    .filter((x) => x.ans && x.ans.status !== "unanswered")
    .map((x) => ({ ...x, ans: x.ans! }));
  const isUngraded = (x: (typeof items)[number]) => x.ans.status === "pending";
  const ungradedCount = items.filter(isUngraded).length;
  const [onlyUngraded, setOnlyUngraded] = useState(ungradedCount > 0);
  const [currentId, setCurrentId] = useState<string | null>(() => (items.find(isUngraded) ?? items[0])?.s.id ?? null);
  const [typed, setTyped] = useState("");
  const action = useAction();

  if (!items.length) return <p class="muted">這一題沒有人作答。</p>;
  const current = items.find((x) => x.s.id === currentId) ?? null;
  const shown = onlyUngraded ? items.filter((x) => isUngraded(x) || x.s.id === currentId) : items;

  const grade = (score: number) =>
    action.run(async () => {
      if (!current) return;
      await api("POST", `/records/${props.record.id}/grade`, { questionId: q.id, studentId: current.s.id, score });
      props.onGraded(q.id, current.s.id, score);
      setTyped("");
      // Next ungraded student after this one (by seat), going round to the start.
      const at = items.indexOf(current);
      const after = [...items.slice(at + 1), ...items.slice(0, at)].find(isUngraded);
      if (after) setCurrentId(after.s.id);
      else if (isUngraded(current)) setCurrentId(null); // that was the last one
    });

  return (
    <section class="grader">
      <div class="grader-head">
        <p class="grader-progress">
          已批改{" "}
          <strong>
            {items.length - ungradedCount}／{items.length}
          </strong>
        </p>
        <div class="segmented" role="group" aria-label="顯示哪些學生">
          <button
            class={`btn btn-small${onlyUngraded ? "" : " btn-secondary"}`}
            aria-pressed={onlyUngraded}
            onClick={() => setOnlyUngraded(true)}
          >
            只看沒批改的（{ungradedCount}）
          </button>
          <button
            class={`btn btn-small${onlyUngraded ? " btn-secondary" : ""}`}
            aria-pressed={!onlyUngraded}
            onClick={() => setOnlyUngraded(false)}
          >
            全部（{items.length}）
          </button>
        </div>
      </div>

      {!current ? (
        <div class="card grader-done">
          <p class="big-text">這一題的簡答都批改完了。</p>
          <p class="muted">要改分數，請按上方「全部」再點學生。</p>
        </div>
      ) : (
        <div class="card grader-card">
          <p class="grader-who">
            {current.s.seat} 號 {current.s.name}
            {current.ans.status === "graded" && <span class="grader-now">目前 {current.ans.score} 分</span>}
          </p>
          <p class="grader-text">{answerText(q, current.ans.answer)}</p>
          {reviews.list.length > 0 && (
            <PeerNote received={reviews.received(current.s.id)} given={reviews.given(current.s.id)} seatOf={seatOf} />
          )}
          <p class="grader-label">給幾分？（滿分 {q.points} 分，按下就儲存）</p>
          {q.points <= 10 ? (
            <div class="score-buttons">
              {Array.from({ length: q.points + 1 }, (_, n) => (
                <button
                  key={n}
                  class={`btn score-button${current.ans.status === "graded" && current.ans.score === n ? "" : " btn-secondary"}`}
                  disabled={action.busy}
                  onClick={() => grade(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          ) : (
            <form
              class="row"
              onSubmit={(e) => {
                e.preventDefault();
                grade(Number(typed));
              }}
            >
              <input
                class="field score-input"
                type="number"
                inputMode="numeric"
                min={0}
                max={q.points}
                step={1}
                aria-label="分數"
                value={typed}
                onInput={(e) => setTyped(e.currentTarget.value)}
              />
              <button class="btn" type="submit" disabled={action.busy || typed === ""}>
                儲存分數
              </button>
            </form>
          )}
          <ErrorText message={action.error} />
        </div>
      )}
      <p class="grader-label">點名字可以直接跳到那位學生：</p>
      <ul class="grader-names">
        {shown.map((x) => (
          <li key={x.s.id}>
            <button
              class={`grader-name${x.s.id === currentId ? " grader-name-on" : ""}`}
              aria-current={x.s.id === currentId}
              onClick={() => setCurrentId(x.s.id)}
            >
              {x.s.seat} {x.s.name}
              {x.ans.status === "graded" && <span class="grader-score">✓ {x.ans.score} 分</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// 互評 under the answer being graded: faint, and clearly not part of the score.
function PeerNote(props: { received?: RecordReview; given?: RecordReview; seatOf: (id: string) => number | undefined }) {
  const { received, given } = props;
  return (
    <div class="peer-note">
      <p>同學互評，僅供參考</p>
      <p>收到的互評：{received ? `${received.score} 分・${received.comment}` : "沒有"}</p>
      <p>他評了誰：{given ? `${props.seatOf(given.revieweeId) ?? "?"} 號・${given.score} 分・${given.comment}` : "沒有"}</p>
    </div>
  );
}

// --- 學生歷次表現 ---

export function StudentPage({ id }: { id: string }) {
  const { data, error } = useLoad(() => api<StudentHistory>("GET", `/students/${id}/history`), [id]);
  if (!data) return <Loading error={error} />;
  const { student, lessons } = data;
  const attended = lessons.filter((l) => l.present).length;
  return (
    <main class="page">
      <a class="back" href={href(`/class/${student.classId}`)}>
        ← 回{student.className}名冊
      </a>
      <h1>
        {student.seat} 號 {student.name}
      </h1>
      <div class="record-summary">
        <p>
          出席{" "}
          <strong>
            {attended}／{lessons.length}
          </strong>{" "}
          堂
        </p>
        <p>
          平均得分率 <strong>{percent(historyRate(lessons))}</strong>
        </p>
      </div>
      {lessons.length === 0 ? (
        <p class="muted">這個班還沒有上課紀錄。</p>
      ) : (
        <div class="table-wrap">
          <table class="table records-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>題組</th>
                <th>出席</th>
                <th>得分／滿分</th>
                <th>得分率</th>
              </tr>
            </thead>
            <tbody>
              {lessons.map((l) => (
                <tr key={l.id} class={`row-link${l.present ? "" : " row-absent"}`} onClick={() => go(`/record/${l.id}`)}>
                  <td>
                    <a href={href(`/record/${l.id}`)}>{formatTaipei(l.startedAt)}</a>
                  </td>
                  <td>{l.setName}</td>
                  <td>{l.present ? "出席" : "缺席"}</td>
                  <td>
                    {l.present ? `${l.score}／${l.max}` : "—"}
                    {l.ungraded > 0 && <span class="muted">（{l.ungraded} 份簡答沒批改）</span>}
                  </td>
                  <td>{l.present ? percent(ratio(l.score, l.max)) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
