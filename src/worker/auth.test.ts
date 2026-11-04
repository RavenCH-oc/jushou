import { describe, expect, it } from "vitest";
import app from "./index";
import type { Bindings } from "./env";
import { passwordMatches, SESSION_COOKIE } from "./auth";

const env: Bindings = {
  DB: {} as D1Database,
  LESSON_HUB: {} as DurableObjectNamespace,
  TEACHER_PASSWORD: "correct horse",
  SESSION_SECRET: "test-secret-0123456789",
};

function login(password: unknown, bindings: Bindings = env) {
  return app.request(
    "/api/teacher/login",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) },
    bindings,
  );
}

function me(cookie?: string, bindings: Bindings = env) {
  return app.request("/api/teacher/me", { headers: cookie ? { Cookie: cookie } : {} }, bindings);
}

// "name=value; Path=/; ..." -> "name=value"
function cookieFrom(res: Response) {
  return (res.headers.get("Set-Cookie") ?? "").split(";")[0];
}

describe("passwordMatches", () => {
  it("compares exactly", async () => {
    expect(await passwordMatches("abc", "abc")).toBe(true);
    expect(await passwordMatches("abc", "abd")).toBe(false);
    expect(await passwordMatches("", "abc")).toBe(false);
  });
});

describe("teacher login", () => {
  it("accepts the right password and sets a secure session cookie", async () => {
    const res = await login("correct horse");
    expect(res.status).toBe(200);
    const header = res.headers.get("Set-Cookie") ?? "";
    expect(header).toContain(`${SESSION_COOKIE}=`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain(`Max-Age=${30 * 24 * 60 * 60}`);

    expect((await me(cookieFrom(res))).status).toBe(200);
  });

  it("rejects a wrong or missing password", async () => {
    for (const pw of ["wrong", "", undefined, 123]) {
      const res = await login(pw);
      expect(res.status).toBe(401);
      expect(res.headers.get("Set-Cookie")).toBeNull();
    }
  });

  it("refuses all logins when TEACHER_PASSWORD is not set", async () => {
    for (const unset of [undefined, ""]) {
      const bindings = { ...env, TEACHER_PASSWORD: unset };
      for (const pw of ["", "anything", undefined]) {
        const res = await login(pw, bindings);
        expect(res.status).toBe(503);
        expect(((await res.json()) as { error: string }).error).toContain("尚未設定老師密碼");
      }
    }
  });

  it("refuses logins when SESSION_SECRET is not set", async () => {
    const res = await login("correct horse", { ...env, SESSION_SECRET: undefined });
    expect(res.status).toBe(503);
  });

  it("rejects a malformed body", async () => {
    const res = await app.request("/api/teacher/login", { method: "POST", body: "not json" }, env);
    expect(res.status).toBe(401);
  });
});

describe("teacher API guard", () => {
  it("returns 401 without a cookie", async () => {
    expect((await me()).status).toBe(401);
  });

  it("returns 401 for a tampered cookie", async () => {
    const cookie = cookieFrom(await login("correct horse"));
    const [name, value] = cookie.split("=");
    const decoded = decodeURIComponent(value);
    const [expires, sig] = decoded.split(".");
    // Push the expiry far into the future but keep the old signature.
    const forged = `${name}=${encodeURIComponent(`${Number(expires) + 1e12}.${sig}`)}`;
    expect((await me(forged)).status).toBe(401);
    // Unsigned value.
    expect((await me(`${name}=${Date.now() + 1e9}`)).status).toBe(401);
  });

  it("returns 401 for a cookie signed with a different secret", async () => {
    const cookie = cookieFrom(await login("correct horse", { ...env, SESSION_SECRET: "other-secret" }));
    expect((await me(cookie)).status).toBe(401);
  });

  it("returns 401 for an expired session", async () => {
    const realNow = Date.now;
    Date.now = () => realNow() - 31 * 24 * 60 * 60 * 1000;
    const cookie = cookieFrom(await login("correct horse"));
    Date.now = realNow;
    expect((await me(cookie)).status).toBe(401);
  });

  it("logout clears the cookie", async () => {
    const res = await app.request("/api/teacher/logout", { method: "POST" }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });
});
