import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";

// Load data for a page; `reload` re-fetches after a change.
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(() => {
    setError("");
    load().then(setData, (e: Error) => setError(e.message));
  }, deps);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

// Run a change; while it runs `busy` is true, failures land in `error`.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

export function ErrorText({ message }: { message: string }) {
  return message ? (
    <p class="error" role="alert">
      {message}
    </p>
  ) : null;
}

export function Loading({ error }: { error: string }) {
  return <main class="page">{error ? <ErrorText message={error} /> : <p>載入中…</p>}</main>;
}

export function Modal(props: { title: string; onClose: () => void; wide?: boolean; children: ComponentChildren }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onClose]);
  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class={`modal${props.wide ? " modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={props.title}>
        <h2>{props.title}</h2>
        {props.children}
      </div>
    </div>
  );
}

// Confirm an irreversible action; `message` should say what will happen.
export function Confirm(props: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  const { busy, error, run } = useAction();
  return (
    <Modal title={props.title} onClose={props.onClose}>
      <p>{props.message}</p>
      <ErrorText message={error} />
      <div class="stack">
        <button
          class={`btn btn-block${props.danger ? " btn-danger" : ""}`}
          disabled={busy}
          onClick={async () => (await run(props.onConfirm)) && props.onClose()}
        >
          {props.confirmLabel}
        </button>
        <button class="btn btn-secondary btn-block" onClick={props.onClose}>
          取消
        </button>
      </div>
    </Modal>
  );
}

// Ask for one line of text (e.g. renaming a group).
export function Rename(props: {
  title: string;
  label: string;
  value: string;
  maxLength: number;
  onSave: (value: string) => Promise<unknown>;
  onClose: () => void;
  children?: ComponentChildren; // extra actions shown under 取消
}) {
  const [value, setValue] = useState(props.value);
  const { busy, error, run } = useAction();
  return (
    <Modal title={props.title} onClose={props.onClose}>
      <form
        class="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => props.onSave(value))) props.onClose();
        }}
      >
        <div>
          <label for="rename">{props.label}</label>
          <input
            id="rename"
            class="field"
            value={value}
            maxLength={props.maxLength}
            autoFocus
            onInput={(e) => setValue(e.currentTarget.value)}
          />
        </div>
        <ErrorText message={error} />
        <button class="btn btn-block" type="submit" disabled={busy || !value.trim()}>
          儲存
        </button>
        <button class="btn btn-secondary btn-block" type="button" onClick={props.onClose}>
          取消
        </button>
        {props.children}
      </form>
    </Modal>
  );
}

// "11/3 14:05", with the year in front when it isn't this year.
export function formatTime(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.getFullYear() === new Date().getFullYear() ? day : `${d.getFullYear()}/${day}`;
}
