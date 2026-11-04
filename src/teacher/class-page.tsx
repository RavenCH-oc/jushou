import { useState } from "preact/hooks";
import { api } from "./api";
import { href } from "./router";
import { Confirm, ErrorText, Loading, useAction, useLoad } from "./ui";
import { Roster } from "./roster";
import { MAX_CLASS_NAME } from "../shared/limits";
import type { ClassDetail } from "../shared/types";

const TABS = [
  { key: "", label: "學生名冊" },
  { key: "groups", label: "分組" },
  { key: "settings", label: "班級設定" },
];

export function ClassPage({ id, tab }: { id: string; tab: string }) {
  const { data: cls, error, reload } = useLoad(() => api<ClassDetail>("GET", `/classes/${id}`), [id]);
  if (!cls) return <Loading error={error} />;

  return (
    <main class="page">
      <a class="back" href={href("/")}>
        ← 回首頁
      </a>
      <header class="topbar">
        <h1>{cls.name}</h1>
        <div class="row row-center">
          <p class="join-code">
            加入碼 <strong>{cls.joinCode}</strong>
          </p>
          <a class="btn" href={href(`/start/${cls.id}`)}>
            開始上課
          </a>
        </div>
      </header>
      <nav class="tabs">
        {TABS.map((t) => (
          <a
            key={t.key}
            class={`tab${t.key === tab ? " tab-active" : ""}`}
            aria-current={t.key === tab ? "page" : undefined}
            href={href(`/class/${id}${t.key ? `/${t.key}` : ""}`)}
          >
            {t.label}
          </a>
        ))}
      </nav>
      {tab === "groups" ? (
        <Groupings cls={cls} />
      ) : tab === "settings" ? (
        <Settings cls={cls} reload={reload} />
      ) : (
        <Roster cls={cls} reload={reload} />
      )}
    </main>
  );
}

function Groupings({ cls }: { cls: ClassDetail }) {
  return (
    <section>
      <div class="section-head">
        <h2>分組</h2>
        <a class="btn" href={href(`/class/${cls.id}/new-grouping`)}>
          新增分組
        </a>
      </div>
      {cls.groupings.length === 0 ? (
        <p class="muted">還沒有分組。按「新增分組」可以隨機分組或自己分。</p>
      ) : (
        <ul class="card-list">
          {cls.groupings.map((g) => (
            <li key={g.id}>
              <a class="card card-link" href={href(`/grouping/${g.id}`)}>
                <strong>{g.name}</strong>
                <span class="muted">{g.groupCount} 組</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Settings({ cls, reload }: { cls: ClassDetail; reload: () => void }) {
  const [name, setName] = useState(cls.name);
  const [saved, setSaved] = useState(false);
  const [confirmCode, setConfirmCode] = useState(false);
  const [deleteName, setDeleteName] = useState("");
  const rename = useAction();
  const remove = useAction();

  return (
    <div class="stack-lg">
      <section class="card">
        <h2>班級名稱</h2>
        <form
          class="row"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaved(false);
            if (await rename.run(() => api("PATCH", `/classes/${cls.id}`, { name }))) {
              setSaved(true);
              reload();
            }
          }}
        >
          <input
            class="field"
            aria-label="班級名稱"
            maxLength={MAX_CLASS_NAME}
            value={name}
            onInput={(e) => setName(e.currentTarget.value)}
          />
          <button class="btn" type="submit" disabled={rename.busy || !name.trim() || name.trim() === cls.name}>
            儲存
          </button>
        </form>
        <ErrorText message={rename.error} />
        {saved && <p class="ok">已儲存。</p>}
      </section>

      <section class="card">
        <h2>加入碼</h2>
        <p class="join-code-big">{cls.joinCode}</p>
        <p class="muted">學生上課時輸入這組數字加入。如果加入碼外流，可以換一組新的。</p>
        <div class="row row-center">
          <button class="btn btn-secondary" disabled={cls.inLesson} onClick={() => setConfirmCode(true)}>
            重新產生加入碼
          </button>
          {cls.inLesson && <span class="muted">上課中不能更換，下課後再換</span>}
        </div>
      </section>

      <section class="card card-danger">
        <h2>刪除班級</h2>
        <p>刪除後，這個班的學生名冊和所有分組都會一起刪除，之後的上課紀錄也會一併消失，無法復原。</p>
        <label for="del">請輸入班級名稱「{cls.name}」確認刪除</label>
        <input id="del" class="field" value={deleteName} onInput={(e) => setDeleteName(e.currentTarget.value)} />
        <ErrorText message={remove.error} />
        <button
          class="btn btn-danger"
          style={{ marginTop: "var(--space-2)" }}
          disabled={remove.busy || deleteName.trim() !== cls.name}
          onClick={() =>
            remove.run(async () => {
              await api("DELETE", `/classes/${cls.id}`);
              location.replace(href("/"));
            })
          }
        >
          刪除班級
        </button>
      </section>

      {confirmCode && (
        <Confirm
          title="重新產生加入碼？"
          message="已經發給學生的舊加入碼會失效，學生要改用新的加入碼。"
          confirmLabel="產生新的加入碼"
          onConfirm={async () => {
            await api("POST", `/classes/${cls.id}/join-code`);
            reload();
          }}
          onClose={() => setConfirmCode(false)}
        />
      )}
    </div>
  );
}
