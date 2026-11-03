import { Hono } from "hono";
import type { AppEnv } from "./env";
import { endSession, passwordMatches, requireTeacher, startSession } from "./auth";
import classes from "./classes";
import groupings from "./groupings";
import questionSets from "./question-sets";

const app = new Hono<AppEnv>();

app.post("/api/teacher/login", async (c) => {
  const { TEACHER_PASSWORD: expected, SESSION_SECRET: secret } = c.env;
  if (!expected || !secret) {
    return c.json({ error: "尚未設定老師密碼，請依說明文件設定後再登入。" }, 503);
  }
  const body = await c.req.json<{ password?: unknown }>().catch(() => ({ password: undefined }));
  const password = typeof body.password === "string" ? body.password : "";
  if (!(await passwordMatches(password, expected))) {
    return c.json({ error: "密碼不正確，請再試一次。" }, 401);
  }
  await startSession(c, secret);
  return c.json({ ok: true });
});

app.post("/api/teacher/logout", (c) => {
  endSession(c);
  return c.json({ ok: true });
});

// Everything else under /api/teacher/ needs a valid session.
app.use("/api/teacher/*", requireTeacher);

app.get("/api/teacher/me", (c) => c.json({ ok: true }));
app.route("/api/teacher", classes);
app.route("/api/teacher", groupings);
app.route("/api/teacher", questionSets);

app.notFound((c) => c.json({ error: "找不到這個功能。" }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "伺服器發生問題，請稍後再試。" }, 500);
});

export default app;
