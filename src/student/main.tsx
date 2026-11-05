import { render } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import "../shared/base.css";
import "./student.css";
import { ApiError, load, remembers, save, studentApi } from "./api";
import { OfflineNote, useLive } from "./live";
import { QuestionView } from "./question-view";
import { readJoinLink } from "./join-link";
import { Reveal } from "./reveal";
import type { Answer } from "../shared/grading";
import type { LessonResult, StudentCurrent, StudentState } from "../shared/lesson";

// Opened from the QR code: skip typing the join code.
const link = readJoinLink(location.href);
if (link.cleanUrl !== null) history.replaceState(null, "", link.cleanUrl);
if (link.code) save("code", link.code);

function App() {
  const [code, setCode] = useState(() => load("code"));
  const [error, setError] = useState("");

  if (!code) {
    return (
      <JoinForm
        error={error}
        onJoined={(c) => {
          save("code", c);
          setError("");
          setCode(c);
        }}
      />
    );
  }
  return (
    <Classroom
      key={code}
      code={code}
      onLeave={(message = "") => {
        save("code", null);
        setError(message);
        setCode(null);
      }}
    />
  );
}

function JoinForm({ error, onJoined }: { error: string; onJoined: (code: string) => void }) {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState(error);
  const [busy, setBusy] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await studentApi("GET", `/state/${code}`);
      onJoined(code);
    } catch (err) {
      setMessage((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main class="page narrow">
      <h1>舉手</h1>
      <form class="stack" onSubmit={submit}>
        <div>
          <label for="code">輸入老師給的加入碼</label>
          <input
            id="code"
            class="field code-field"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            placeholder="6 位數字"
            value={code}
            onInput={(e) => setCode(e.currentTarget.value.replace(/\D/g, ""))}
          />
        </div>
        {message && (
          <p class="error" role="alert">
            {message}
          </p>
        )}
        <button class="btn btn-block" type="submit" disabled={busy || code.length !== 6}>
          {busy ? "加入中…" : "加入"}
        </button>
      </form>
    </main>
  );
}

function Classroom({ code, onLeave }: { code: string; onLeave: (message?: string) => void }) {
  const [state, setState] = useState<StudentState | null>(null);
  const [error, setError] = useState("");
  const sawLesson = useRef(false);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const s = await studentApi<StudentState>("GET", `/state/${code}`);
      if (ticket !== latest.current) return; // a newer refresh is on its way
      if (s.lessonId) sawLesson.current = true;
      setState(s);
      setError("");
    } catch (e) {
      if (ticket !== latest.current) return;
      if ((e as ApiError).status === 404) onLeave((e as Error).message); // the teacher changed the code
      else setError((e as Error).message);
    }
  }, [code]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Without a lesson there's no live connection yet, so check every 10 seconds.
  const lessonId = state?.lessonId ?? null;
  useEffect(() => {
    if (lessonId) return;
    const timer = setInterval(refresh, 10_000);
    return () => clearInterval(timer);
  }, [lessonId, refresh]);

  const connected = useLive(lessonId, "student", refresh);

  if (!state) {
    return (
      <main class="page narrow stack">
        {error ? (
          <>
            <p class="error">{error}</p>
            <button class="btn btn-block" onClick={refresh}>
              再試一次
            </button>
          </>
        ) : (
          <p>載入中…</p>
        )}
      </main>
    );
  }

  const notMe = async () => {
    try {
      await studentApi("POST", `/unbind/${code}`);
    } catch (e) {
      return setError((e as Error).message);
    }
    refresh();
  };

  let screen;
  if (!state.lessonId && state.result) screen = <LessonResultView result={state.result} onLeave={() => onLeave()} />;
  else if (!state.lessonId) screen = <NoLesson className={state.className} ended={sawLesson.current} onLeave={() => onLeave()} />;
  else if (!state.me) screen = <SeatPicker code={code} state={state} onBound={refresh} />;
  else if (!state.current) screen = <Waiting me={state.me} onNotMe={notMe} />;
  else {
    const current = state.current;
    screen = (
      <>
        <p class="who">
          {state.me.seat} 號 {state.me.name}
        </p>
        {current.status === "open" ? (
          <Answering key={current.question.id} code={code} current={current} onRefresh={refresh} />
        ) : current.status === "closed" ? (
          <Stopped current={current} />
        ) : (
          <Reveal current={current} />
        )}
      </>
    );
  }

  return (
    <main class="page narrow student">
      {!remembers && <p class="notice">請不要關閉這個分頁。關掉後要重新選座號。</p>}
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {screen}
      <OfflineNote connected={connected} />
    </main>
  );
}

function NoLesson({ className, ended, onLeave }: { className: string; ended: boolean; onLeave: () => void }) {
  return (
    <div class="stack center">
      <p class="muted">{className}</p>
      {ended ? <p class="big-status">這堂課結束了，謝謝！</p> : <p class="big-status">老師還沒開始上課，請稍等</p>}
      {!ended && <p class="muted">老師開始上課後，這個畫面會自動換過去。</p>}
      <button class="btn btn-secondary btn-block" onClick={onLeave}>
        換一個加入碼
      </button>
    </div>
  );
}

const RESULT_LABEL = {
  correct: "○ 答對",
  wrong: "✕ 答錯",
  unanswered: "沒作答",
  pending: "老師之後批改",
  hidden: "老師沒有公布答案",
};

// 下課: how this student did on each question of today's last lesson.
function LessonResultView({ result, onLeave }: { result: LessonResult; onLeave: () => void }) {
  return (
    <div class="stack">
      <p class="big-status center">這堂課結束了，謝謝！</p>
      <p class="muted center">{result.setName}</p>
      {result.max > 0 && (
        <p class="result-total">
          總分 <strong>{result.score}</strong>／{result.max} 分
        </p>
      )}
      <ol class="result-list">
        {result.items.map((item) => (
          <li key={item.number} class={`result-item result-${item.result}`}>
            <span class="result-snippet">
              {item.number}. {item.snippet}
            </span>
            <span class="result-mark">
              {RESULT_LABEL[item.result]}
              {item.result === "correct" && `（${item.score} 分）`}
            </span>
          </li>
        ))}
      </ol>
      {result.items.some((i) => i.result === "pending") && <p class="muted">簡答題老師批改後另外計分。</p>}
      <p class="muted center">老師開始下一堂課時，這個畫面會自動換過去。</p>
      <button class="btn btn-secondary btn-block" onClick={onLeave}>
        換一個加入碼
      </button>
    </div>
  );
}

function SeatPicker({ code, state, onBound }: { code: string; state: StudentState; onBound: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ seat: number; text: string } | null>(null);

  const pick = async (seat: number, taken: boolean) => {
    if (taken) return setMessage({ seat, text: "這個座號已經有人使用，請找老師。" });
    setBusy(true);
    setMessage(null);
    try {
      await studentApi("POST", `/bind/${code}`, { seat });
    } catch (e) {
      setMessage({ seat, text: (e as Error).message });
    }
    setBusy(false);
    onBound();
  };

  return (
    <div>
      <h1>{state.className}</h1>
      <p>請點你的座號和名字</p>
      <ul class="seat-list">
        {state.seats?.map((s) => (
          <li key={s.seat}>
            <button class={`seat-button${s.taken ? " seat-taken" : ""}`} disabled={busy} onClick={() => pick(s.seat, s.taken)}>
              <span class="seat-no">{s.seat}</span>
              <span class="seat-name">{s.name}</span>
              {s.taken && <span class="seat-note">已有人使用</span>}
            </button>
            {message?.seat === s.seat && (
              <p class="error" role="alert">
                {message.text}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Waiting({ me, onNotMe }: { me: { seat: number; name: string }; onNotMe: () => void }) {
  return (
    <div class="stack center">
      <p class="big-status">
        {me.seat} 號 {me.name}，已加入
      </p>
      <p class="wait">等老師出題</p>
      <button class="link-button" onClick={onNotMe}>
        不是我？
      </button>
    </div>
  );
}

function isEmpty(a: Answer | undefined | null) {
  if (a === undefined || a === null) return true;
  if (typeof a === "string") return !a.trim();
  if (Array.isArray(a)) return a.every((x) => typeof x === "string" && !x.trim());
  return false;
}

function Answering({ code, current, onRefresh }: { code: string; current: StudentCurrent; onRefresh: () => void }) {
  const [draft, setDraft] = useState<Answer | undefined>(current.answer ?? undefined);
  const [sent, setSent] = useState(current.answer === null ? null : JSON.stringify(current.answer));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changed = JSON.stringify(draft ?? null) !== sent;

  const send = async () => {
    setBusy(true);
    setError("");
    try {
      await studentApi("POST", `/answer/${code}`, { questionId: current.question.id, answer: draft });
      setSent(JSON.stringify(draft));
    } catch (e) {
      setError((e as Error).message);
      if ((e as ApiError).status) onRefresh(); // e.g. the teacher just stopped
    }
    setBusy(false);
  };

  return (
    <div class="stack">
      <QuestionView q={current.question} number={current.number} answer={draft} onAnswer={setDraft} />
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {sent !== null &&
        (changed ? (
          <p class="notice">答案改了，記得再按一次「送出答案」。</p>
        ) : (
          <p class="sent" role="status">
            ✓ 已送出，可以在老師停止前修改
          </p>
        ))}
      <button class="btn btn-block btn-send" disabled={busy || isEmpty(draft) || !changed} onClick={send}>
        {busy ? "送出中…" : "送出答案"}
      </button>
    </div>
  );
}

function Stopped({ current }: { current: StudentCurrent }) {
  return (
    <div class="stack">
      <p class="big-status">老師已停止作答</p>
      <p class="muted">{current.answer === null ? "你這題沒有作答。" : "你送出的答案："}</p>
      <fieldset class="locked" disabled>
        <QuestionView q={current.question} number={current.number} answer={current.answer ?? undefined} />
      </fieldset>
    </div>
  );
}

render(<App />, document.getElementById("app")!);
