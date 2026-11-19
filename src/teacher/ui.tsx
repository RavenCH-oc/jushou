import type { ComponentChild, ComponentChildren } from "preact";
import { useCallback, useEffect, useId, useState } from "preact/hooks";
import { href } from "./router";

const SHOWN = 5;

// The first 5 items, plus a button under them to show/hide the rest.
// `keepOpen`: show everything (e.g. the chosen item is past the first 5).
export function Capped<T extends { id: string }>(props: {
  items: T[];
  noun: string; // 「顯示全部 14 個題組」
  row: (item: T) => ComponentChild;
  listClass?: string;
  moreClass?: string;
  keepOpen?: boolean;
}) {
  const [all, setAll] = useState(false);
  const open = all || !!props.keepOpen;
  const shown = open ? props.items : props.items.slice(0, SHOWN);
  return (
    <>
      <ul class={props.listClass ?? "list"}>
        {shown.map((x) => (
          <li key={x.id}>{props.row(x)}</li>
        ))}
      </ul>
      {props.items.length > SHOWN && !props.keepOpen && (
        <button type="button" class={`btn-text ${props.moreClass ?? "panel-more"}`} aria-expanded={open} onClick={() => setAll(!open)}>
          {open ? `只顯示 ${SHOWN} 個` : `顯示全部 ${props.items.length} ${props.noun}`}
        </button>
      )}
    </>
  );
}

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

// `bare`: the full-screen lesson/projection pages, which have no AppBar.
export function Loading({ error, bare }: { error: string; bare?: boolean }) {
  return (
    <>
      {!bare && <AppBar />}
      <main class="page">{error ? <ErrorText message={error} /> : <p>載入中…</p>}</main>
    </>
  );
}

// A small 「？」 button that shows/hides a short explanation (tap, not hover).
// The button and the text go in different places (button next to a title,
// text under that row), so this returns both.
export function useHelp(label: string, text: ComponentChildren) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return {
    button: (
      <button type="button" class="help-button" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        ？
      </button>
    ),
    text: (
      <p id={id} class="help-text" hidden={!open}>
        {text}
      </p>
    ),
  };
}

export type Crumb ={ label: string; href?: string };

// Dark bar on top of every normal teacher page: 舉手 › 首頁 › … › this page.
// The last crumb is the current page (not a link). Narrow screens show only
// 「‹ <parent>」. `children` go on the right (e.g. 登出).
export function AppBar({ crumbs = [], children }: { crumbs?: Crumb[]; children?: ComponentChildren }) {
  const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2] : null;
  return (
    <header class="appbar">
      {crumbs.length ? (
        <a class="appbar-name" href={href("/")}>
          舉手
        </a>
      ) : (
        <span class="appbar-name">舉手</span>
      )}
      {crumbs.length > 0 && (
        <nav class="crumbs" aria-label="目前位置">
          <ol>
            {crumbs.map((c, i) =>
              i === crumbs.length - 1 ? (
                <li key={i}>
                  <span aria-current="page">{c.label}</span>
                </li>
              ) : (
                <li key={i}>
                  <a href={c.href}>{c.label}</a>
                </li>
              ),
            )}
          </ol>
          {parent && (
            <a class="crumb-up" href={parent.href}>
              ‹ {parent.label}
            </a>
          )}
        </nav>
      )}
      {children && <div class="appbar-actions">{children}</div>}
    </header>
  );
}

export function Modal(props: { title: string; onClose: () => void; wide?: boolean; full?: boolean; children: ComponentChildren }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onClose]);
  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class={`modal${props.wide ? " modal-wide" : ""}${props.full ? " modal-full" : ""}`} role="dialog" aria-modal="true" aria-label={props.title}>
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
