import { useState } from "preact/hooks";
import { api } from "./api";
import { href } from "./router";
import { Confirm, ErrorText, Modal, useAction } from "./ui";
import { parseRoster, type RosterRow } from "../shared/roster";
import { MAX_SEAT, MAX_STUDENT_NAME } from "../shared/limits";
import type { ClassDetail, ImportResult, Student } from "../shared/types";

export function Roster({ cls, reload }: { cls: ClassDetail; reload: () => void }) {
  const [pasting, setPasting] = useState(cls.students.length === 0);
  const [notice, setNotice] = useState("");

  return (
    <section>
      <div class="section-head">
        <h2>學生名冊（{cls.students.length} 人）</h2>
        {!pasting && (
          <button class="btn" onClick={() => (setPasting(true), setNotice(""))}>
            貼上名冊
          </button>
        )}
      </div>
      {notice && <p class="ok">{notice}</p>}
      {pasting && (
        <PasteRoster
          cls={cls}
          onCancel={cls.students.length ? () => setPasting(false) : undefined}
          onDone={(r) => {
            setPasting(false);
            setNotice(`已加入 ${r.added} 人` + (r.updated ? `，更新 ${r.updated} 人` : "") + (r.skipped ? `，略過 ${r.skipped} 人` : "") + "。");
            reload();
          }}
        />
      )}
      {cls.students.length > 0 && <StudentTable cls={cls} reload={reload} />}
      {!pasting && <AddStudent cls={cls} reload={reload} />}
    </section>
  );
}

function PasteRoster(props: { cls: ClassDetail; onCancel?: () => void; onDone: (r: ImportResult) => void }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<RosterRow[] | null>(null);
  const [askConflict, setAskConflict] = useState(false);
  const { busy, error, run } = useAction();

  const existing = new Map(props.cls.students.map((s) => [s.seat, s.name]));
  const good = (rows ?? []).filter((r) => !r.error);
  const bad = (rows ?? []).length - good.length;
  const conflicts = good.filter((r) => existing.has(r.seat!));

  const save = (onConflict: "update" | "skip") =>
    run(async () => {
      const result = await api<ImportResult>("POST", `/classes/${props.cls.id}/students/import`, {
        rows: good.map((r) => ({ seat: r.seat, name: r.name })),
        onConflict,
      });
      props.onDone(result);
    });

  if (!rows) {
    return (
      <div class="card stack">
        <label for="paste">從 Excel 複製「座號」和「姓名」兩欄，貼在下面</label>
        <p class="muted">一行一位學生。也可以自己打，例如「1 王小明」。</p>
        <textarea
          id="paste"
          class="field textarea"
          rows={10}
          placeholder={"1\t王小明\n2\t李小華\n3\t陳大文"}
          value={text}
          onInput={(e) => setText(e.currentTarget.value)}
        />
        <div class="row">
          <button class="btn" disabled={!text.trim()} onClick={() => setRows(parseRoster(text))}>
            預覽
          </button>
          {props.onCancel && (
            <button class="btn btn-secondary" onClick={props.onCancel}>
              取消
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div class="card stack">
      <p>
        <strong>可以加入 {good.length} 人</strong>
        {bad > 0 && <span class="error">，有 {bad} 行有問題（不會加入，請看紅色說明）</span>}
        {conflicts.length > 0 && <span>，其中 {conflicts.length} 人的座號已經在名冊裡</span>}
      </p>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>座號</th>
              <th>姓名</th>
              <th>說明</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.line} class={r.error ? "row-error" : undefined}>
                <td>{r.seat ?? "—"}</td>
                <td>{r.name || "—"}</td>
                <td>
                  {r.error
                    ? `第 ${r.line} 行：${r.error}`
                    : existing.has(r.seat!)
                      ? `座號已存在（目前是「${existing.get(r.seat!)}」）`
                      : "新同學"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorText message={error} />
      <div class="row">
        <button
          class="btn"
          disabled={busy || good.length === 0}
          onClick={() => (conflicts.length ? setAskConflict(true) : save("skip"))}
        >
          加入名冊
        </button>
        <button class="btn btn-secondary" onClick={() => setRows(null)}>
          回去修改
        </button>
      </div>
      {askConflict && (
        <Modal title={`有 ${conflicts.length} 位的座號已經在名冊裡`} onClose={() => setAskConflict(false)}>
          <p>例如座號 {conflicts[0].seat}：名冊裡是「{existing.get(conflicts[0].seat!)}」，這次貼上的是「{conflicts[0].name}」。</p>
          <div class="stack">
            <button class="btn btn-block" disabled={busy} onClick={() => (setAskConflict(false), save("update"))}>
              更新成這次貼上的姓名
            </button>
            <button class="btn btn-secondary btn-block" disabled={busy} onClick={() => (setAskConflict(false), save("skip"))}>
              略過這些人，名冊不變
            </button>
            <button class="btn btn-secondary btn-block" onClick={() => setAskConflict(false)}>
              取消
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function StudentTable({ cls, reload }: { cls: ClassDetail; reload: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Student | null>(null);

  return (
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>座號</th>
            <th>姓名</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {cls.students.map((s) =>
            editing === s.id ? (
              <EditRow key={s.id} student={s} onDone={() => (setEditing(null), reload())} onCancel={() => setEditing(null)} />
            ) : (
              <tr key={s.id}>
                <td>{s.seat}</td>
                <td>
                  <a href={href(`/student/${s.id}`)} title="看這位學生的歷次表現">
                    {s.name}
                  </a>
                </td>
                <td class="actions">
                  <button class="btn btn-secondary btn-small" onClick={() => setEditing(s.id)}>
                    修改
                  </button>
                  <button class="btn btn-secondary btn-small" onClick={() => setDeleting(s)}>
                    刪除
                  </button>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
      {deleting && (
        <Confirm
          title={`刪除 ${deleting.seat} 號 ${deleting.name}？`}
          message="這位學生會從名冊和所有分組中移除。之後要再加回來，需要重新新增。"
          confirmLabel="刪除這位學生"
          danger
          onConfirm={async () => {
            await api("DELETE", `/students/${deleting.id}`);
            reload();
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function EditRow(props: { student: Student; onDone: () => void; onCancel: () => void }) {
  const [seat, setSeat] = useState(String(props.student.seat));
  const [name, setName] = useState(props.student.name);
  const { busy, error, run } = useAction();
  const save = () => run(() => api("PATCH", `/students/${props.student.id}`, { seat: Number(seat.normalize("NFKC")), name })).then((ok) => ok && props.onDone());

  return (
    <tr>
      <td>
        <input class="field field-seat" aria-label="座號" inputMode="numeric" value={seat} onInput={(e) => setSeat(e.currentTarget.value)} />
      </td>
      <td>
        <input class="field" aria-label="姓名" maxLength={MAX_STUDENT_NAME} value={name} onInput={(e) => setName(e.currentTarget.value)} />
        <ErrorText message={error} />
      </td>
      <td class="actions">
        <button class="btn btn-small" disabled={busy} onClick={save}>
          儲存
        </button>
        <button class="btn btn-secondary btn-small" onClick={props.onCancel}>
          取消
        </button>
      </td>
    </tr>
  );
}

function AddStudent({ cls, reload }: { cls: ClassDetail; reload: () => void }) {
  const nextSeat = Math.min(MAX_SEAT, Math.max(0, ...cls.students.map((s) => s.seat)) + 1);
  const [seat, setSeat] = useState("");
  const [name, setName] = useState("");
  const { busy, error, run } = useAction();
  const seatValue = seat.trim() || String(nextSeat);

  return (
    <form
      class="card add-student"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run(() =>
          api("POST", `/classes/${cls.id}/students`, { seat: Number(seatValue.normalize("NFKC")), name }),
        );
        if (ok) {
          setSeat("");
          setName("");
          reload();
        }
      }}
    >
      <h3>新增一位學生</h3>
      <div class="row">
        <div>
          <label for="new-seat">座號</label>
          <input id="new-seat" class="field field-seat" inputMode="numeric" placeholder={String(nextSeat)} value={seat} onInput={(e) => setSeat(e.currentTarget.value)} />
        </div>
        <div class="grow">
          <label for="new-name">姓名</label>
          <input id="new-name" class="field" maxLength={MAX_STUDENT_NAME} value={name} onInput={(e) => setName(e.currentTarget.value)} />
        </div>
      </div>
      <ErrorText message={error} />
      <button class="btn btn-secondary" type="submit" disabled={busy || !name.trim()}>
        新增學生
      </button>
    </form>
  );
}
