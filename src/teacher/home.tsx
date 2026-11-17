import { useState } from "preact/hooks";
import { api } from "./api";
import { go, href } from "./router";
import { AppBar, ErrorText, formatTime, Loading, useAction, useLoad } from "./ui";
import { MAX_CLASS_NAME } from "../shared/limits";
import { MAX_SET_NAME } from "../shared/questions";
import type { ClassSummary, QuestionSetSummary } from "../shared/types";
import type { ActiveLesson } from "../shared/lesson";
import type { LessonSummary } from "../shared/records";
import { RecentRecords } from "./records";

export function Home({ onLogout }: { onLogout: () => void }) {
  const { data, error } = useLoad(
    () =>
      Promise.all([
        api<ClassSummary[]>("GET", "/classes"),
        api<QuestionSetSummary[]>("GET", "/sets"),
        api<ActiveLesson | null>("GET", "/lessons/active"),
        api<LessonSummary[]>("GET", "/records/recent"),
      ]),
    [],
  );

  const logout = async () => {
    await fetch("/api/teacher/logout", { method: "POST" }).catch(() => {});
    onLogout();
  };

  if (!data) return <Loading error={error} />;
  const [classes, sets, active, recent] = data;
  return (
    <>
      <AppBar>
        <button class="appbar-button" onClick={logout}>
          登出
        </button>
      </AppBar>
      <main class="page">
        {active ? (
          <section class="card home-start home-start-active">
            <h2>上課中：{active.className}</h2>
            <div class="row row-center">
              <a class="btn btn-secondary" href={href("/start")}>
                開始上課
              </a>
              <a class="btn" href={href(`/lesson/${active.id}`)}>
                回到課堂
              </a>
            </div>
          </section>
        ) : (
          <section class="card home-start">
            <div>
              <h2>開始上課</h2>
              <p class="muted">選班級和題組，學生用手機加入</p>
            </div>
            <a class="btn" href={href("/start")}>
              開始上課
            </a>
          </section>
        )}
        <div class="home-cols">
          <div class="home-col">
            <section class="card panel">
              <div class="panel-head">
                <h2>班級</h2>
                <a class="btn btn-secondary btn-small" href={href("/new")}>
                  新增班級
                </a>
              </div>
              {classes.length === 0 ? (
                <p class="panel-empty">還沒有班級。按「新增班級」開始。</p>
              ) : (
                <ul class="list">
                  {classes.map((c) => (
                    <li key={c.id}>
                      <a class="list-row" href={href(`/class/${c.id}`)}>
                        <strong class="list-main">{c.name}</strong>
                        <span class="list-meta">{c.studentCount} 位學生</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <RecentRecords list={recent} />
          </div>
          <section class="card panel">
            <div class="panel-head">
              <h2>題組</h2>
              <a class="btn btn-secondary btn-small" href={href("/new-set")}>
                新增題組
              </a>
            </div>
            {sets.length === 0 ? (
              <p class="panel-empty">還沒有題組。按「新增題組」開始出題。</p>
            ) : (
              <ul class="list">
                {sets.map((s) => (
                  <li key={s.id}>
                    <a class="list-row" href={href(`/set/${s.id}`)}>
                      <strong class="list-main">{s.name}</strong>
                      <span class="list-meta">
                        {s.questionCount} 題・{formatTime(s.updatedAt)} 修改
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </>
  );
}

export function NewSet() {
  const [name, setName] = useState("");
  const { busy, error, run } = useAction();

  const submit = (e: Event) => {
    e.preventDefault();
    run(async () => {
      const set = await api<QuestionSetSummary>("POST", "/sets", { name });
      location.replace(href(`/set/${set.id}`));
    });
  };

  return (
    <>
      <AppBar crumbs={[{ label: "首頁", href: href("/") }, { label: "新增題組" }]} />
      <main class="page narrow">
        <form class="card stack form-card" onSubmit={submit}>
          <h1>新增題組</h1>
          <div>
            <label for="name">題組名稱</label>
            <input
              id="name"
              class="field"
              placeholder="例如：〈出師表〉課後練習"
              maxLength={MAX_SET_NAME}
              autoFocus
              value={name}
              onInput={(e) => setName(e.currentTarget.value)}
            />
          </div>
          <p class="muted">題組不屬於任何班級，之後每個班上課都可以用。</p>
          <ErrorText message={error} />
          <button class="btn btn-block" type="submit" disabled={busy || !name.trim()}>
            建立題組
          </button>
          <button class="btn btn-secondary btn-block" type="button" onClick={() => go("/")}>
            取消
          </button>
        </form>
      </main>
    </>
  );
}

export function NewClass() {
  const [name, setName] = useState("");
  const { busy, error, run } = useAction();

  const submit = (e: Event) => {
    e.preventDefault();
    run(async () => {
      const cls = await api<ClassSummary>("POST", "/classes", { name });
      // Replace so "上一頁" from the new class goes home, not back to this form.
      location.replace(href(`/class/${cls.id}`));
    });
  };

  return (
    <>
      <AppBar crumbs={[{ label: "首頁", href: href("/") }, { label: "新增班級" }]} />
      <main class="page narrow">
        <form class="card stack form-card" onSubmit={submit}>
          <h1>新增班級</h1>
          <div>
            <label for="name">班級名稱</label>
            <input
              id="name"
              class="field"
              placeholder="例如：高二孝班"
              maxLength={MAX_CLASS_NAME}
              autoFocus
              value={name}
              onInput={(e) => setName(e.currentTarget.value)}
            />
          </div>
          <p class="muted">加入碼會自動產生，建立後可以在班級頁看到。</p>
          <ErrorText message={error} />
          <button class="btn btn-block" type="submit" disabled={busy || !name.trim()}>
            建立班級
          </button>
          <button class="btn btn-secondary btn-block" type="button" onClick={() => go("/")}>
            取消
          </button>
        </form>
      </main>
    </>
  );
}
