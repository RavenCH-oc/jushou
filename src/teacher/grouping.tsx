import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "./api";
import { go, href } from "./router";
import { Confirm, ErrorText, Loading, Modal, Rename, useAction, useLoad } from "./ui";
import { groupCountFor } from "../shared/grouping";
import { MAX_GROUP_NAME, MAX_GROUPING_NAME } from "../shared/limits";
import type { ClassDetail, GroupingDetail, GroupingSummary, Student } from "../shared/types";

function toInt(value: string) {
  const n = Number(value.normalize("NFKC").trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Plain-language description of the group sizes, e.g. "每組 7～8 人".
function sizeText(students: number, groups: number) {
  const small = Math.floor(students / groups);
  const big = Math.ceil(students / groups);
  return small === big ? `每組 ${small} 人` : `每組 ${small}～${big} 人`;
}

export function NewGrouping({ classId }: { classId: string }) {
  const { data: cls, error: loadError } = useLoad(() => api<ClassDetail>("GET", `/classes/${classId}`), [classId]);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"random" | "manual">("random");
  const [splitBy, setSplitBy] = useState<"count" | "size">("count");
  const [number, setNumber] = useState("");
  const { busy, error, run } = useAction();

  if (!cls) return <Loading error={loadError} />;
  const total = cls.students.length;
  const n = toInt(number);
  const groupCount = n === null ? null : mode === "manual" || splitBy === "count" ? n : groupCountFor(total, { groupSize: n });
  const defaultName = `分組 ${cls.groupings.length + 1}`;

  let hint = "";
  if (mode === "random" && total === 0) hint = "名冊裡還沒有學生，請先到「學生名冊」加入學生，或改用手動分組。";
  else if (groupCount !== null && mode === "random") {
    hint = groupCount > total ? `組數不能比學生人數（${total} 人）多。` : `${total} 人分成 ${groupCount} 組，${sizeText(total, groupCount)}。`;
  } else if (groupCount !== null) hint = `建立 ${groupCount} 個空的組，再一個一個把學生放進去。`;

  const submit = (e: Event) => {
    e.preventDefault();
    run(async () => {
      const body =
        mode === "random" && splitBy === "size"
          ? { name: name.trim() || defaultName, mode, groupSize: n }
          : { name: name.trim() || defaultName, mode, groupCount: n };
      const g = await api<GroupingSummary>("POST", `/classes/${classId}/groupings`, body);
      location.replace(href(`/grouping/${g.id}`));
    });
  };

  return (
    <main class="page narrow">
      <a class="back" href={href(`/class/${classId}/groups`)}>
        ← 回到 {cls.name}
      </a>
      <h1>新增分組</h1>
      <form class="stack" onSubmit={submit}>
        <div>
          <label for="gname">分組名稱</label>
          <input
            id="gname"
            class="field"
            placeholder={defaultName}
            maxLength={MAX_GROUPING_NAME}
            value={name}
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </div>
        <fieldset class="choices">
          <legend>怎麼分？</legend>
          <Choice checked={mode === "random"} onSelect={() => setMode("random")} title="隨機分組" text="電腦幫你平均分配" />
          <Choice checked={mode === "manual"} onSelect={() => setMode("manual")} title="手動分組" text="自己決定誰在哪一組" />
        </fieldset>
        {mode === "random" && (
          <fieldset class="choices choices-row">
            <legend>依照</legend>
            <Choice checked={splitBy === "count"} onSelect={() => setSplitBy("count")} title="分成幾組" />
            <Choice checked={splitBy === "size"} onSelect={() => setSplitBy("size")} title="每組幾人" />
          </fieldset>
        )}
        <div>
          <label for="num">{mode === "random" && splitBy === "size" ? "每組幾人" : "分成幾組"}</label>
          <input id="num" class="field field-seat" inputMode="numeric" value={number} onInput={(e) => setNumber(e.currentTarget.value)} />
        </div>
        {hint && <p class={hint.startsWith("組數不能") || hint.startsWith("名冊") ? "error" : "muted"}>{hint}</p>}
        <ErrorText message={error} />
        <button class="btn btn-block" type="submit" disabled={busy || n === null}>
          建立分組
        </button>
      </form>
    </main>
  );
}

function Choice(props: { checked: boolean; onSelect: () => void; title: string; text?: string }) {
  return (
    <label class={`choice${props.checked ? " choice-on" : ""}`}>
      <input type="radio" checked={props.checked} onChange={props.onSelect} />
      <span>
        <strong>{props.title}</strong>
        {props.text && <span class="muted"> — {props.text}</span>}
      </span>
    </label>
  );
}

type Dialog =
  | { kind: "student"; student: Student; groupId: string | null }
  | { kind: "rename-group"; id: string; name: string }
  | { kind: "rename" }
  | { kind: "shuffle" }
  | { kind: "delete" };

export function GroupingPage({ id }: { id: string }) {
  const { data: g, error, reload } = useLoad(() => api<GroupingDetail>("GET", `/groupings/${id}`), [id]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const action = useAction();
  const close = () => setDialog(null);

  if (!g) return <Loading error={error} />;
  const byId = new Map(g.students.map((s) => [s.id, s]));
  const placed = new Set(g.groups.flatMap((x) => x.studentIds));
  const unplaced = g.students.filter((s) => !placed.has(s.id));

  const move = (studentId: string, groupId: string | null) =>
    action.run(async () => {
      await api("PUT", `/groupings/${g.id}/members/${studentId}`, { groupId });
      close();
      reload();
    });

  const copy = () =>
    action.run(async () => {
      const c = await api<GroupingSummary>("POST", `/groupings/${g.id}/copy`);
      go(`/grouping/${c.id}`);
    });

  return (
    <main class="page">
      <a class="back" href={href(`/class/${g.classId}/groups`)}>
        ← 回到 {g.className}
      </a>
      <header class="topbar">
        <h1>{g.name}</h1>
        <a class="btn" href={href(`/grouping/${g.id}/show`)} onClick={enterFullscreen}>
          投影顯示
        </a>
      </header>
      <p class="muted">點學生可以換組，點組名可以改名。</p>
      <ErrorText message={action.error} />

      <div class="group-grid">
        {g.groups.map((group) => (
          <section key={group.id} class="card group">
            <button class="group-name" onClick={() => setDialog({ kind: "rename-group", id: group.id, name: group.name })}>
              {group.name}
              <span class="muted">{group.studentIds.length} 人</span>
            </button>
            {group.studentIds.length === 0 && <p class="muted">還沒有人</p>}
            {group.studentIds.map((sid) => {
              const s = byId.get(sid)!;
              return (
                <button key={sid} class="member" onClick={() => setDialog({ kind: "student", student: s, groupId: group.id })}>
                  {s.seat} {s.name}
                </button>
              );
            })}
          </section>
        ))}
      </div>

      {unplaced.length > 0 && (
        <section class="card unplaced">
          <h2>未分組（{unplaced.length} 人）</h2>
          <div class="member-wrap">
            {unplaced.map((s) => (
              <button key={s.id} class="member" onClick={() => setDialog({ kind: "student", student: s, groupId: null })}>
                {s.seat} {s.name}
              </button>
            ))}
          </div>
        </section>
      )}

      <div class="row tools">
        <button class="btn btn-secondary" onClick={() => setDialog({ kind: "rename" })}>
          改分組名稱
        </button>
        <button class="btn btn-secondary" onClick={() => setDialog({ kind: "shuffle" })}>
          重新隨機
        </button>
        <button class="btn btn-secondary" disabled={action.busy} onClick={copy}>
          複製這套分組
        </button>
        <button class="btn btn-secondary" onClick={() => setDialog({ kind: "delete" })}>
          刪除
        </button>
      </div>

      {dialog?.kind === "student" && (
        <Modal title={`${dialog.student.seat} 號 ${dialog.student.name}`} onClose={close}>
          <div class="stack">
            {g.groups
              .filter((x) => x.id !== dialog.groupId)
              .map((x) => (
                <button key={x.id} class="btn btn-block" disabled={action.busy} onClick={() => move(dialog.student.id, x.id)}>
                  移到{x.name}
                </button>
              ))}
            {dialog.groupId && (
              <button class="btn btn-secondary btn-block" disabled={action.busy} onClick={() => move(dialog.student.id, null)}>
                移出分組
              </button>
            )}
            <button class="btn btn-secondary btn-block" onClick={close}>
              取消
            </button>
          </div>
        </Modal>
      )}
      {dialog?.kind === "rename-group" && (
        <Rename
          title="修改組名"
          label="組名"
          value={dialog.name}
          maxLength={MAX_GROUP_NAME}
          onSave={async (name) => {
            await api("PATCH", `/groups/${dialog.id}`, { name });
            reload();
          }}
          onClose={close}
        />
      )}
      {dialog?.kind === "rename" && (
        <Rename
          title="修改分組名稱"
          label="分組名稱"
          value={g.name}
          maxLength={MAX_GROUPING_NAME}
          onSave={async (name) => {
            await api("PATCH", `/groupings/${g.id}`, { name });
            reload();
          }}
          onClose={close}
        />
      )}
      {dialog?.kind === "shuffle" && (
        <Confirm
          title="重新隨機分組？"
          message={`全班 ${g.students.length} 人會重新平均分到這 ${g.groups.length} 組，現在的分法會被取代。組名不會變。`}
          confirmLabel="重新隨機"
          onConfirm={async () => {
            await api("POST", `/groupings/${g.id}/shuffle`);
            reload();
          }}
          onClose={close}
        />
      )}
      {dialog?.kind === "delete" && (
        <Confirm
          title={`刪除「${g.name}」？`}
          message="這套分組會被刪除，無法復原。學生名冊和其他分組不受影響。"
          confirmLabel="刪除這套分組"
          danger
          onConfirm={async () => {
            await api("DELETE", `/groupings/${g.id}`);
            location.replace(href(`/class/${g.classId}/groups`));
          }}
          onClose={close}
        />
      )}
    </main>
  );
}

// True when the projection was opened from the grouping page in this tab,
// so closing it can simply go back one step in history.
let openedFromGroupingPage = false;

// Fullscreen must be requested from a click, so the link does it on the way in.
function enterFullscreen() {
  openedFromGroupingPage = true;
  document.documentElement.requestFullscreen?.().catch(() => {});
}

export function Projection({ id }: { id: string }) {
  const { data: g, error } = useLoad(() => api<GroupingDetail>("GET", `/groupings/${id}`), [id]);
  const closed = useRef(false);

  const close = () => {
    if (closed.current) return;
    closed.current = true;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (openedFromGroupingPage) {
      openedFromGroupingPage = false;
      history.back();
    } else {
      // Opened directly (e.g. after F5): nothing to go back to.
      location.replace(href(`/grouping/${id}`));
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    // In fullscreen the browser swallows Esc and just leaves fullscreen;
    // treat that as closing too.
    const onFs = () => !document.fullscreenElement && close();
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
      // Left some other way (e.g. the browser's back button).
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [id]);

  if (!g) return <Loading error={error} />;
  const byId = new Map(g.students.map((s) => [s.id, s]));
  const most = Math.max(1, ...g.groups.map((x) => x.studentIds.length));
  // Shrink the text when there are many groups or big groups, so it fits one screen.
  const fontSize = Math.max(20, Math.min(40, Math.floor(260 / Math.max(most, g.groups.length / 2))));

  return (
    <div class="projection">
      <header class="projection-head">
        <h1>{g.name}</h1>
        <button class="btn btn-secondary" onClick={close}>
          關閉
        </button>
      </header>
      <div class="projection-grid" style={{ fontSize: `${fontSize}px` }}>
        {g.groups.map((group) => (
          <section key={group.id} class="projection-group">
            <h2>{group.name}</h2>
            <ul>
              {group.studentIds.map((sid) => {
                const s = byId.get(sid)!;
                return (
                  <li key={sid}>
                    <span class="seat">{s.seat}</span> {s.name}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
