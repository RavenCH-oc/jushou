import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import "../shared/base.css";
import "./teacher.css";
import { LOGGED_OUT_EVENT } from "./api";
import { match, useHashPath } from "./router";
import { Home, NewClass, NewSet } from "./home";
import { ClassPage } from "./class-page";
import { GroupingPage, NewGrouping, Projection } from "./grouping";
import { SetPage, SetPreview } from "./question-set";
import { QuestionEditor } from "./question-editor";
import { LessonPage, StartLesson } from "./lesson";

type View = "loading" | "login" | "app" | "offline";

function App() {
  const [view, setView] = useState<View>("loading");

  const check = async () => {
    try {
      const res = await fetch("/api/teacher/me");
      setView(res.ok ? "app" : "login");
    } catch {
      setView("offline");
    }
  };

  useEffect(() => {
    check();
    const onLoggedOut = () => setView("login");
    window.addEventListener(LOGGED_OUT_EVENT, onLoggedOut);
    return () => window.removeEventListener(LOGGED_OUT_EVENT, onLoggedOut);
  }, []);

  if (view === "loading") return <main class="page">載入中…</main>;
  if (view === "offline") {
    return (
      <main class="page narrow stack">
        <p class="error">連不上伺服器，請確認網路後再試一次。</p>
        <button class="btn" onClick={check}>
          重新連線
        </button>
      </main>
    );
  }
  if (view === "login") return <Login onDone={() => setView("app")} />;
  return <Routes onLogout={() => setView("login")} />;
}

function Routes({ onLogout }: { onLogout: () => void }) {
  const path = useHashPath();
  let m;
  if ((m = match("/new", path))) return <NewClass />;
  if ((m = match("/start/:classId?", path))) return <StartLesson classId={m.classId} />;
  if ((m = match("/lesson/:id", path))) return <LessonPage key={m.id} id={m.id} />;
  if ((m = match("/class/:id/new-grouping", path))) return <NewGrouping classId={m.id} />;
  if ((m = match("/class/:id/:tab?", path))) return <ClassPage id={m.id} tab={m.tab} />;
  if ((m = match("/grouping/:id/show", path))) return <Projection id={m.id} />;
  if ((m = match("/grouping/:id", path))) return <GroupingPage id={m.id} />;
  if ((m = match("/new-set", path))) return <NewSet />;
  if ((m = match("/set/:id/preview", path))) return <SetPreview id={m.id} />;
  if ((m = match("/set/:id/add/:type", path))) return <QuestionEditor key={path} setId={m.id} type={m.type} />;
  if ((m = match("/set/:id/q/:qid", path))) return <QuestionEditor key={path} setId={m.id} questionId={m.qid} />;
  if ((m = match("/set/:id", path))) return <SetPage id={m.id} />;
  return <Home onLogout={onLogout} />;
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/teacher/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) return onDone();
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "登入失敗，請再試一次。");
    } catch {
      setError("連不上伺服器，請確認網路後再試一次。");
    }
    setBusy(false);
  };

  return (
    <main class="page narrow">
      <h1>舉手・老師登入</h1>
      <form class="stack" onSubmit={submit}>
        <div>
          <label for="pw">密碼</label>
          <input
            id="pw"
            class="field"
            type="password"
            autoComplete="current-password"
            value={password}
            onInput={(e) => setPassword(e.currentTarget.value)}
          />
        </div>
        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
        <button class="btn btn-block" type="submit" disabled={busy || !password}>
          {busy ? "登入中…" : "登入"}
        </button>
      </form>
    </main>
  );
}

render(<App />, document.getElementById("app")!);
