// 上課: choosing a class and set, then the live lesson screen (projected).
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { encode } from "uqr";
import { api } from "./api";
import { go, href } from "./router";
import { Confirm, ErrorText, Loading, Modal, useAction, useLoad } from "./ui";
import { OfflineNote, useLive } from "../student/live";
import { QuestionText, QuestionView } from "../student/question-view";
import { toStudentView } from "../shared/grading";
import { optionLetter, typeLabel, type Question } from "../shared/questions";
import type { LiveEvent } from "../shared/lesson";
import type { ActiveLesson, EssayAnswer, LessonDetail, LessonQuestion, PeerReviewItem, QuestionStats } from "../shared/lesson";
import type { ClassSummary, QuestionSetSummary } from "../shared/types";
import { ORAL_LABEL } from "../shared/quick";
import { BuzzScreen } from "./buzz";
import { PickerDialog, QuickDialog, TimerDialog, TimerDisplay, type QuickRequest, type TimerState } from "./tools";

// --- Start a lesson ---

export function StartLesson({ classId }: { classId: string }) {
  const { data, error } = useLoad(
    () =>
      Promise.all([
        api<ClassSummary[]>("GET", "/classes"),
        api<QuestionSetSummary[]>("GET", "/sets"),
        api<ActiveLesson | null>("GET", "/lessons/active"),
      ]),
    [],
  );
  const [cls, setCls] = useState(classId);
  const [set, setSet] = useState(""); // "none": 不用題組
  const [confirmEnd, setConfirmEnd] = useState(false);
  const action = useAction();

  if (!data) return <Loading error={error} />;
  const [classes, sets, active] = data;

  const start = async () => {
    const lesson = await api<{ id: string }>("POST", "/lessons", { classId: cls, setId: set === "none" ? null : set });
    location.replace(href(`/lesson/${lesson.id}`));
  };

  return (
    <main class="page narrow">
      <a class="back" href={href(classId ? `/class/${classId}` : "/")}>
        ← 回上一頁
      </a>
      <h1>開始上課</h1>
      {active && (
        <p class="notice">
          「{active.className}」正在上課。<a href={href(`/lesson/${active.id}`)}>回到那堂課</a>
        </p>
      )}
      <div class="stack-lg">
        <fieldset class="choices">
          <legend>1. 哪一班？</legend>
          {classes.length === 0 && <p class="muted">還沒有班級，請先回首頁新增班級。</p>}
          {classes.map((c) => (
            <label key={c.id} class={`choice${cls === c.id ? " choice-on" : ""}`}>
              <input type="radio" name="class" checked={cls === c.id} disabled={!c.studentCount} onChange={() => setCls(c.id)} />
              <span>
                {c.name}
                <span class="muted">　{c.studentCount ? `${c.studentCount} 位學生` : "（還沒有學生）"}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset class="choices">
          <legend>2. 用哪一份題組？</legend>
          <label class={`choice${set === "none" ? " choice-on" : ""}`}>
            <input type="radio" name="set" checked={set === "none"} onChange={() => setSet("none")} />
            <span>
              不用題組<span class="muted">（只用臨時出題、抽人、計時器）</span>
            </span>
          </label>
          {sets.length === 0 && <p class="muted">還沒有題組。要用題組的話，請先回首頁新增。</p>}
          {sets.map((s) => (
            <label key={s.id} class={`choice${set === s.id ? " choice-on" : ""}`}>
              <input type="radio" name="set" checked={set === s.id} disabled={!s.questionCount} onChange={() => setSet(s.id)} />
              <span>
                {s.name}
                <span class="muted">　{s.questionCount ? `${s.questionCount} 題` : "（還沒有題目）"}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <ErrorText message={action.error} />
        <button
          class="btn btn-block"
          disabled={!cls || !set || action.busy}
          onClick={() => (active ? setConfirmEnd(true) : action.run(start))}
        >
          {action.busy ? "準備中…" : "開始"}
        </button>
      </div>
      {confirmEnd && active && (
        <Confirm
          title={`先結束「${active.className}」的課？`}
          message="要開新的課，得先結束正在進行的那一堂。結束後那堂課的學生就不能再作答。"
          confirmLabel="結束那堂課，開始新的課"
          onConfirm={async () => {
            await api("POST", `/lessons/${active.id}/end`);
            await start();
          }}
          onClose={() => setConfirmEnd(false)}
        />
      )}
    </main>
  );
}

// --- The lesson screen ---

const STATUS_LABEL = { pending: "未出題", open: "作答中", closed: "已停止作答", reviewing: "互評中", revealed: "已公布答案" };

type Dialog =
  | { kind: "join" }
  | { kind: "roster" }
  | { kind: "end" }
  | { kind: "unbind"; id: string; label: string }
  | { kind: "essay-warn"; q: LessonQuestion }
  | { kind: "essays"; list: EssayAnswer[] }
  | { kind: "end-review"; left: number; label: string; run: () => Promise<void> }
  | { kind: "reviews-warn"; q: LessonQuestion }
  | { kind: "reviews"; q: LessonQuestion; list: PeerReviewItem[] }
  | { kind: "delete-review"; q: LessonQuestion; item: PeerReviewItem; list: PeerReviewItem[] }
  | { kind: "quick" }
  | { kind: "picker" }
  | { kind: "timer" };

// The answer the teacher picked for a stopped 臨時出題, before 公布答案.
type Pick = { qid: string; answer: number | boolean } | { qid: string; unscored: true };

export function LessonPage({ id }: { id: string }) {
  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [timerState, setTimerState] = useState<TimerState | null>(null);
  const action = useAction();
  const close = () => setDialog(null);

  const load = useCallback(async () => {
    try {
      setLesson(await api<LessonDetail>("GET", `/lessons/${id}`));
      setLoadError("");
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  // Many answers arrive at once; refetch at most about twice a second.
  const timer = useRef(0);
  const reload = useCallback(() => {
    if (!timer.current) timer.current = setTimeout(() => ((timer.current = 0), load()), 400);
  }, [load]);
  // 搶答 presses only refresh the light ranking on the 搶答 screen, never the whole lesson.
  const buzzOpen = !!lesson?.buzzOpen;
  const pokeBuzz = useRef<() => void>(() => {});
  const onChange = useCallback(
    (t: LiveEvent | "sync") => {
      if (t === "buzz" && buzzOpen) pokeBuzz.current();
      else reload();
    },
    [reload, buzzOpen],
  );
  const connected = useLive(lesson?.status === "active" ? id : null, "teacher", onChange);

  // Follow the question the students see whenever it changes.
  const currentId = lesson?.currentQuestionId;
  useEffect(() => setFocusId(null), [currentId]);

  if (!lesson) return <Loading error={loadError} />;
  if (lesson.status === "ended") {
    return (
      <main class="page narrow stack">
        <h1>這堂課已經結束了</h1>
        <p>
          {lesson.className}・{lesson.setName}
        </p>
        <a class="btn btn-block" href={href(`/record/${lesson.id}`)}>
          看這堂課的紀錄
        </a>
        <a class="btn btn-secondary btn-block" href={href("/")}>
          回首頁
        </a>
      </main>
    );
  }

  const questions = lesson.questions;
  const index = Math.max(
    0,
    questions.findIndex((q) => q.id === (focusId ?? currentId)),
  );
  const q = questions[index] as LessonQuestion | undefined; // none yet in a lesson without a 題組
  const joined = lesson.students.filter((s) => s.joined);
  const call = async (s: "open" | "close" | "reveal" | "review", target = q!, body?: object) => {
    await api("POST", `/lesson-questions/${target.id}/${s}`, body);
    await load();
  };
  const step = (s: "open" | "close" | "reveal" | "review", target = q!) => action.run(() => call(s, target));

  // Moving on while 互評 is going ends it; ask first if someone hasn't sent theirs.
  const reviewing = questions.find((x) => x.status === "reviewing");
  const left = reviewing?.review ? reviewing.review.total - reviewing.review.done : 0;
  const endingReview = (label: string, run: () => Promise<void>) => () =>
    left > 0 ? setDialog({ kind: "end-review", left, label, run }) : action.run(run);

  // 臨時出題: made and pushed in one go (same as 出這一題, so it may end 互評 first).
  const createQuick = async (req: QuickRequest) => {
    await api("POST", `/lessons/${lesson.id}/quick`, req);
    setFocusId(null);
    await load();
  };
  const onQuick = async (req: QuickRequest) => {
    if (left > 0) setDialog({ kind: "end-review", left, label: "結束互評，出這一題", run: () => createQuick(req) });
    else {
      await createQuick(req);
      setDialog(null);
    }
  };

  // 搶答 starts a round right away; like 臨時出題 it stops what students were answering.
  const startBuzz = async () => {
    await api("POST", `/lessons/${lesson.id}/buzz`);
    setDialog(null);
    await load();
  };
  const onBuzz = () =>
    left > 0 ? setDialog({ kind: "end-review", left, label: "結束互評，開始搶答", run: startBuzz }) : action.run(startBuzz);

  const next = questions[index + 1];
  let main: { label: string; run: () => void; disabled?: boolean };
  const extra: { label: string; run: () => void }[] = [];
  let note = "";
  // A stopped 臨時出題 (選擇／是非) needs its correct answer, or 「不計分」, before 公布.
  const needsAnswer = !!q && q.quick && q.status === "closed" && q.type !== "essay";
  const picked = needsAnswer && pick?.qid === q.id ? pick : null;
  if (!q) main = { label: "臨時出題", run: () => setDialog({ kind: "quick" }) };
  else if (needsAnswer) {
    main = {
      label: "公布答案",
      disabled: !picked,
      run: () => action.run(() => call("reveal", q, "unscored" in picked! ? { unscored: true } : { answer: picked!.answer })),
    };
    if (!picked) note = "請先選正確答案，或選這題不計分。";
  } else if (q.status === "pending")
    main = { label: currentId ? "出這一題" : "出第 1 題", run: endingReview("結束互評，出這一題", () => call("open")) };
  else if (q.status === "open") main = { label: "停止作答", run: () => step("close") };
  else if (q.status === "closed" && q.type === "essay") {
    main = { label: "開始互評", run: () => step("review"), disabled: q.stats.answered < 2 };
    if (q.stats.answered < 2) note = "至少要 2 位同學作答才能互評。";
    extra.push({ label: "跳過互評，直接公布", run: () => step("reveal") });
  } else if (q.status === "closed") main = { label: "公布答案", run: () => step("reveal") };
  else if (q.status === "reviewing") {
    main = { label: "結束互評", run: endingReview("結束互評", () => call("reveal")) };
    if (next?.status === "pending") extra.push({ label: "出下一題", run: endingReview("結束互評，出下一題", () => call("open", next)) });
  }
  // After revealing, the next question goes straight to the students.
  else if (next?.status === "pending") main = { label: "出下一題", run: () => step("open", next) };
  else if (next) main = { label: "下一題", run: () => setFocusId(next.id) };
  // Only 臨時出題 so far (e.g. 不用題組): the next thing is most likely another one.
  else if (questions.every((x) => x.quick)) main = { label: "臨時出題", run: () => setDialog({ kind: "quick" }) };
  else main = { label: "結束上課", run: () => setDialog({ kind: "end" }) };
  const showReviews = () => q && setDialog({ kind: "reviews-warn", q });

  return (
    <main class="lesson">
      <header class="lesson-bar">
        <div class="lesson-head">
          <a class="back" href={href("/")}>
            ← 回首頁（課會繼續進行）
          </a>
          <h1 class="lesson-title">
            {lesson.className}・{lesson.setName}
          </h1>
          {timerState && <TimerDisplay timer={timerState} onChange={setTimerState} onClose={() => setTimerState(null)} />}
        </div>
        <div class="lesson-tools">
          <div class="row">
            <button class="btn btn-secondary" onClick={() => setDialog({ kind: "quick" })}>
              臨時出題
            </button>
            <button class="btn btn-secondary" onClick={() => setDialog({ kind: "picker" })}>
              抽人
            </button>
            <button class="btn btn-secondary" onClick={onBuzz}>
              搶答
            </button>
            <button class="btn btn-secondary" onClick={() => setDialog({ kind: "timer" })}>
              計時器
            </button>
          </div>
          <div class="row">
            <button class="btn btn-secondary" onClick={() => setDialog({ kind: "join" })}>
              加入碼
            </button>
            <button class="btn btn-secondary" onClick={() => setDialog({ kind: "roster" })}>
              名單（{joined.length}）
            </button>
            <FullscreenButton />
            <button class="btn btn-secondary" onClick={() => setDialog({ kind: "end" })}>
              結束上課
            </button>
          </div>
        </div>
      </header>

      {!currentId || !q ? (
        <section class="stack-lg">
          <JoinPanel lesson={lesson} />
          <ErrorText message={action.error} />
          <button class="btn btn-block btn-main" disabled={action.busy} onClick={main.run}>
            {main.label}
          </button>
        </section>
      ) : (
        <div class="lesson-grid">
          <ol class="lesson-list">
            {questions.map((x, i) => (
              <li key={x.id}>
                <button class={`lesson-item${x === q ? " lesson-item-on" : ""}`} aria-current={x === q} onClick={() => setFocusId(x.id)}>
                  <span>
                    {i + 1}. {x.text.replace(/\s+/g, " ").slice(0, 20) || ORAL_LABEL}
                    {x.quick && <span class="tag">臨時</span>}
                  </span>
                  <span class={`lesson-status status-${x.status}`}>{STATUS_LABEL[x.status]}</span>
                </button>
              </li>
            ))}
          </ol>
          <section class="lesson-main">
            <p class="lesson-meta">
              第 {index + 1} 題・{q.quick ? "臨時出題・" : ""}
              {typeLabel(q.type)}・{q.points} 分　<strong class={`status-${q.status}`}>{STATUS_LABEL[q.status]}</strong>
            </p>
            {q.status === "pending" || q.status === "open" ? (
              <div class="projected">
                <QuestionView q={toStudentView(q)} oral={ORAL_LABEL} />
              </div>
            ) : (
              <div class="projected">
                <QuestionText q={toStudentView(q)} oral={ORAL_LABEL} />
              </div>
            )}
            {needsAnswer && <AnswerPicker q={q} pick={picked} onPick={setPick} />}
            {(q.status === "closed" || q.status === "revealed") && (
              <Results
                q={q}
                revealed={q.status === "revealed"}
                onEssays={() => setDialog({ kind: "essay-warn", q })}
                onReviews={showReviews}
              />
            )}
            {q.status === "reviewing" && q.review && (
              <div class="results">
                <p class="review-progress">
                  互評中，已完成 <strong>{q.review.done}</strong>／{q.review.total} 人
                </p>
                <div>
                  <button class="btn btn-secondary" onClick={showReviews}>
                    看評語
                  </button>
                </div>
              </div>
            )}
            <ErrorText message={action.error} />
            {note && <p class="muted">{note}</p>}
            <div class="lesson-foot">
              {q.status !== "pending" && q.status !== "reviewing" && (
                <p class="answered">
                  已作答 <strong>{q.stats.answered}</strong>／{joined.length} 人
                </p>
              )}
              <div class="lesson-actions">
                {extra.map((x) => (
                  <button key={x.label} class="btn btn-secondary" disabled={action.busy} onClick={x.run}>
                    {x.label}
                  </button>
                ))}
                <button class="btn btn-main" disabled={action.busy || main.disabled} onClick={main.run}>
                  {main.label}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
      <OfflineNote connected={connected} />
      {lesson.buzzOpen && (
        <BuzzScreen
          lessonId={lesson.id}
          poke={pokeBuzz}
          onEnd={async () => {
            await api("POST", `/lessons/${lesson.id}/buzz/end`);
            await load();
          }}
        />
      )}

      {dialog?.kind === "join" && (
        <Modal title="加入碼" full onClose={close}>
          <JoinPanel lesson={lesson} />
          <button class="btn btn-block" onClick={close}>
            關閉
          </button>
        </Modal>
      )}
      {dialog?.kind === "roster" && (
        <Modal wide title={`名單：已加入 ${joined.length}／${lesson.students.length} 人`} onClose={close}>
          <table class="table">
            <thead>
              <tr>
                <th>座號</th>
                <th>姓名</th>
                <th>狀態</th>
                {q && <th>第 {index + 1} 題</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {lesson.students.map((s) => (
                <tr key={s.id}>
                  <td>{s.seat}</td>
                  <td>{s.name}</td>
                  <td>{s.joined ? "已加入" : <span class="muted">未加入</span>}</td>
                  {q && <td>{q.answeredBy.includes(s.id) ? "已交" : <span class="muted">未交</span>}</td>}
                  <td>
                    {s.bound && (
                      <button
                        class="btn btn-secondary btn-small"
                        onClick={() => setDialog({ kind: "unbind", id: s.id, label: `${s.seat} 號 ${s.name}` })}
                      >
                        解除綁定
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button class="btn btn-block" onClick={close}>
            關閉
          </button>
        </Modal>
      )}
      {dialog?.kind === "unbind" && (
        <Confirm
          title={`解除 ${dialog.label} 的綁定？`}
          message="解除後，這位學生要重新選座號，換手機或點錯人時使用。"
          confirmLabel="解除綁定"
          onConfirm={async () => {
            await api("POST", `/students/${dialog.id}/unbind`);
            await load();
          }}
          onClose={() => setDialog({ kind: "roster" })}
        />
      )}
      {dialog?.kind === "end" && (
        <Confirm
          title="結束上課？"
          message="結束後學生就不能再作答。"
          confirmLabel="結束上課"
          danger
          onConfirm={async () => {
            await api("POST", `/lessons/${lesson.id}/end`);
            go("/");
          }}
          onClose={close}
        />
      )}
      {dialog?.kind === "essay-warn" && (
        <Confirm
          title="顯示全部作答內容？"
          message="投影中會被學生看到，包括座號和姓名。"
          confirmLabel="顯示作答內容"
          onConfirm={async () => {
            const list = await api<EssayAnswer[]>("GET", `/lesson-questions/${dialog.q.id}/essays`);
            setDialog({ kind: "essays", list });
          }}
          // Confirm closes itself after confirming; keep the list it just opened.
          onClose={() => setDialog((d) => (d?.kind === "essay-warn" ? null : d))}
        />
      )}
      {dialog?.kind === "end-review" && (
        <Confirm
          title="結束互評？"
          message={`還有 ${dialog.left} 人沒評完，結束後就不能再評。`}
          confirmLabel={dialog.label}
          onConfirm={dialog.run}
          onClose={close}
        />
      )}
      {dialog?.kind === "reviews-warn" && (
        <Confirm
          title="顯示全部評語？"
          message="投影中會被學生看到，包括評分者和被評者的座號、姓名。"
          confirmLabel="顯示評語"
          onConfirm={async () => {
            const list = await api<PeerReviewItem[]>("GET", `/lesson-questions/${dialog.q.id}/reviews`);
            setDialog({ kind: "reviews", q: dialog.q, list });
          }}
          onClose={() => setDialog((d) => (d?.kind === "reviews-warn" ? null : d))}
        />
      )}
      {dialog?.kind === "reviews" && (
        <Modal
          wide
          title={`評語（已完成 ${dialog.list.filter((r) => r.score !== null || r.deleted).length}／${dialog.list.length} 人）`}
          onClose={close}
        >
          <ul class="essay-list">
            {dialog.list.map((r) => (
              <li key={r.reviewerId} class="review-item">
                <div>
                  <strong>
                    {r.reviewer} → {r.reviewee}
                  </strong>
                  {r.deleted ? (
                    <p class="muted">（已刪除）</p>
                  ) : r.score === null ? (
                    <p class="muted">（還沒送出）</p>
                  ) : (
                    <p>
                      <strong>{r.score} 分</strong>・{r.comment}
                    </p>
                  )}
                </div>
                {r.score !== null && (
                  <button
                    class="btn btn-secondary btn-small"
                    onClick={() => setDialog({ kind: "delete-review", q: dialog.q, item: r, list: dialog.list })}
                  >
                    刪除
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button class="btn btn-block" onClick={close}>
            關閉
          </button>
        </Modal>
      )}
      {dialog?.kind === "delete-review" && (
        <Confirm
          title={`刪除 ${dialog.item.reviewer} 的評語？`}
          message={`刪除後，${dialog.item.reviewee} 會看到「這次沒有收到互評」，${dialog.item.reviewer} 也不能再送出。`}
          confirmLabel="刪除評語"
          danger
          onConfirm={async () => {
            await api("DELETE", `/lesson-questions/${dialog.q.id}/reviews/${dialog.item.reviewerId}`);
            const list = await api<PeerReviewItem[]>("GET", `/lesson-questions/${dialog.q.id}/reviews`);
            await load();
            setDialog({ kind: "reviews", q: dialog.q, list });
          }}
          onClose={() => setDialog((d) => (d?.kind === "delete-review" ? { kind: "reviews", q: d.q, list: d.list } : d))}
        />
      )}
      {dialog?.kind === "quick" && <QuickDialog onCreate={onQuick} onClose={close} />}
      {dialog?.kind === "picker" && (
        <PickerDialog lessonId={lesson.id} classId={lesson.classId} students={lesson.students} onClose={close} />
      )}
      {dialog?.kind === "timer" && (
        <TimerDialog
          onStart={(seconds) => {
            setTimerState({ total: seconds * 1000, endsAt: Date.now() + seconds * 1000, leftWhenPaused: 0 });
            close();
          }}
          onClose={close}
        />
      )}
      {dialog?.kind === "essays" && (
        <Modal wide title={`作答內容（${dialog.list.length} 份）`} onClose={close}>
          <ul class="essay-list">
            {dialog.list.map((e) => (
              <li key={e.seat}>
                <strong>
                  {e.seat} 號 {e.name}
                </strong>
                <p>{e.text}</p>
              </li>
            ))}
          </ul>
          <button class="btn btn-block" onClick={close}>
            關閉
          </button>
        </Modal>
      )}
    </main>
  );
}

function FullscreenButton() {
  const [on, setOn] = useState(!!document.fullscreenElement);
  useEffect(() => {
    const onChange = () => setOn(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  if (!document.fullscreenEnabled) return null;
  const toggle = () => (on ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
  return (
    <button class="btn btn-secondary" onClick={toggle}>
      {on ? "離開全螢幕" : "全螢幕"}
    </button>
  );
}

function JoinPanel({ lesson }: { lesson: LessonDetail }) {
  const joined = lesson.students.filter((s) => s.joined).length;
  return (
    <div class="join-panel">
      <div class="join-text">
        <p class="join-label">用手機掃描 QR code，</p>
        <p class="join-label">或打開下面的網址，輸入加入碼</p>
        <p class="join-code-huge">{lesson.joinCode}</p>
        <p class="join-count">
          已加入 <strong>{joined}</strong>／{lesson.students.length} 人
        </p>
      </div>
      <figure class="join-qr">
        <QrCode text={`${location.origin}/?code=${lesson.joinCode}`} />
        <figcaption class="join-url">{location.host}</figcaption>
      </figure>
      <ul class="seat-grid" aria-label="已加入的座號">
        {lesson.students.map((s) => (
          <li key={s.id} class={s.joined ? "seat-in" : ""} title={s.name}>
            {s.seat}
          </li>
        ))}
      </ul>
    </div>
  );
}

function QrCode({ text }: { text: string }) {
  // A quiet zone of 4 modules, pure black on white: scannable from the back row.
  const { data, size } = encode(text, { border: 4 });
  let path = "";
  data.forEach((row, y) => row.forEach((dark, x) => dark && (path += `M${x} ${y}h1v1h-1z`)));
  return (
    <svg class="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="加入這堂課的 QR code" shape-rendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

const percent = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

function Bar({ label, n, of, correct }: { label: string; n: number; of: number; correct?: boolean }) {
  return (
    <li class={`bar${correct ? " bar-correct" : ""}`}>
      <span class="bar-label">
        {label}
        {correct && <strong class="bar-mark">✓ 正確答案</strong>}
      </span>
      <span class="bar-track">
        <span class="bar-fill" style={{ width: `${percent(n, of)}%` }} />
      </span>
      <span class="bar-count">
        {n} 人（{percent(n, of)}%）
      </span>
    </li>
  );
}

// Answer distribution after 停止作答; correct answers only marked once revealed.
function Results(props: { q: LessonQuestion; revealed: boolean; onEssays: () => void; onReviews: () => void }) {
  const { q, revealed } = props;
  const { answered, correct } = q.stats;
  if (q.type === "essay") {
    return (
      <div class="results">
        <p>簡答題由老師之後批改。{q.review && `互評完成 ${q.review.done}／${q.review.total} 人（只供參考，不算分）。`}</p>
        <div class="row">
          <button class="btn btn-secondary" disabled={!answered} onClick={props.onEssays}>
            看作答內容
          </button>
          {q.review && (
            <button class="btn btn-secondary" onClick={props.onReviews}>
              看評語
            </button>
          )}
        </div>
      </div>
    );
  }
  const scoredReveal = revealed && q.scored;
  return (
    <div class="results">
      {revealed && !q.scored && <p class="correct-rate">這題不計分（只看大家怎麼選）</p>}
      {scoredReveal && (
        <p class="correct-rate">
          答對 {correct} 人，正確率 {percent(correct, answered)}%
        </p>
      )}
      <AnswerBars q={q} stats={q.stats} revealed={scoredReveal} />
    </div>
  );
}

// One bar per option (or per blank); also used on the 上課紀錄 question page.
export function AnswerBars({ q, stats, revealed }: { q: Question; stats: QuestionStats; revealed: boolean }) {
  const { answered, choices = [], blanks = [] } = stats;
  return (
    <ul class="bars">
      {q.type === "truefalse" &&
        ["○ 對", "✕ 錯"].map((label, i) => (
          <Bar key={label} label={label} n={choices[i] ?? 0} of={answered} correct={revealed && q.config.answer === (i === 0)} />
        ))}
      {(q.type === "single" || q.type === "multiple") &&
        q.config.options.map((text, i) => (
          <Bar
            key={i}
            label={text ? `${optionLetter(i)}．${text}` : optionLetter(i)}
            n={choices[i] ?? 0}
            of={answered}
            correct={revealed && q.config.correct.includes(i)}
          />
        ))}
      {q.type === "fill" &&
        q.config.blanks.map((accepted, i) => (
          <Bar key={i} label={`第 ${i + 1} 格答對${revealed ? `（${accepted.join("、")}）` : ""}`} n={blanks[i] ?? 0} of={answered} />
        ))}
    </ul>
  );
}

// 臨時出題 after 停止作答: the teacher says which answer was right, or that it doesn't count.
function AnswerPicker({ q, pick, onPick }: { q: LessonQuestion; pick: Pick | null; onPick: (p: Pick) => void }) {
  const options: { label: string; value: number | boolean }[] =
    q.type === "truefalse"
      ? [
          { label: "○ 對", value: true },
          { label: "✕ 錯", value: false },
        ]
      : q.type === "single"
        ? q.config.options.map((_, i) => ({ label: optionLetter(i), value: i }))
        : [];
  const chosen = pick && "answer" in pick ? pick.answer : null;
  const unscored = !!pick && "unscored" in pick;
  return (
    <div class="answer-picker">
      <span class="answer-picker-label">正確答案是：</span>
      {options.map((o) => (
        <button
          key={String(o.value)}
          class={`btn answer-choice${chosen === o.value ? "" : " btn-secondary"}`}
          aria-pressed={chosen === o.value}
          onClick={() => onPick({ qid: q.id, answer: o.value })}
        >
          {o.label}
        </button>
      ))}
      <button
        class={`btn${unscored ? "" : " btn-secondary"}`}
        aria-pressed={unscored}
        onClick={() => onPick({ qid: q.id, unscored: true })}
      >
        這題不計分（只看大家怎麼選）
      </button>
    </div>
  );
}
