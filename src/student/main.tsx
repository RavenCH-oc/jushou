import { render } from "preact";
import { useState } from "preact/hooks";
import "../shared/base.css";

function App() {
  const [code, setCode] = useState("");
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <main class="page narrow stack">
        <h1>舉手</h1>
        <p>加入上課的功能製作中，請稍候。</p>
        <button class="btn btn-secondary btn-block" onClick={() => setSubmitted(false)}>
          回上一步
        </button>
      </main>
    );
  }

  return (
    <main class="page narrow">
      <h1>舉手</h1>
      <form
        class="stack"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
        }}
      >
        <div>
          <label for="code">輸入老師給的加入碼</label>
          <input
            id="code"
            class="field"
            style={{ fontSize: "var(--fs-title)", letterSpacing: "0.2em", textAlign: "center" }}
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            placeholder="6 位數字"
            value={code}
            onInput={(e) => setCode(e.currentTarget.value.replace(/\D/g, ""))}
          />
        </div>
        <button class="btn btn-block" type="submit" disabled={code.length !== 6}>
          加入
        </button>
      </form>
    </main>
  );
}

render(<App />, document.getElementById("app")!);
