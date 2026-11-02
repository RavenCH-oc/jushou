import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import "../shared/base.css";

type View = "loading" | "login" | "home" | "offline";

function App() {
  const [view, setView] = useState<View>("loading");

  const check = async () => {
    try {
      const res = await fetch("/api/teacher/me");
      setView(res.ok ? "home" : "login");
    } catch {
      setView("offline");
    }
  };

  useEffect(() => {
    check();
  }, []);

  if (view === "loading") return <main class="page">載入中…</main>;
  if (view === "offline") {
    return (
      <main class="page narrow stack">
        <p class="error">連不上伺服器，請確認網路後再試一次。</p>
        <button class="btn" onClick={check}>重新連線</button>
      </main>
    );
  }
  if (view === "login") return <Login onDone={() => setView("home")} />;
  return <Home onLogout={() => setView("login")} />;
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
        {error && <p class="error" role="alert">{error}</p>}
        <button class="btn btn-block" type="submit" disabled={busy || !password}>
          {busy ? "登入中…" : "登入"}
        </button>
      </form>
    </main>
  );
}

function Home({ onLogout }: { onLogout: () => void }) {
  const logout = async () => {
    await fetch("/api/teacher/logout", { method: "POST" }).catch(() => {});
    onLogout();
  };

  return (
    <main class="page">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px" }}>
        <h1 style={{ margin: 0 }}>舉手</h1>
        <button class="btn btn-secondary" onClick={logout}>登出</button>
      </header>
      <section class="card" style={{ marginTop: "var(--space-4)" }}>
        <h2>班級</h2>
        <p class="muted">還沒有班級</p>
      </section>
    </main>
  );
}

render(<App />, document.getElementById("app")!);
