import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import type { AppEnv } from "./env";

export const SESSION_COOKIE = "jushou_teacher";
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

// Hash both sides first so the comparison always runs over 32 bytes,
// regardless of input length, then compare without early exit.
export async function passwordMatches(input: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(input)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function startSession(c: Context<AppEnv>, secret: string) {
  const expires = Date.now() + SESSION_MS;
  await setSignedCookie(c, SESSION_COOKIE, String(expires), secret, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: SESSION_MS / 1000,
  });
}

export function endSession(c: Context<AppEnv>) {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
}

export const requireTeacher: MiddlewareHandler<AppEnv> = async (c, next) => {
  const secret = c.env.SESSION_SECRET;
  const value = secret ? await getSignedCookie(c, secret, SESSION_COOKIE) : undefined;
  const expires = value ? Number(value) : 0;
  if (!(expires > Date.now())) {
    return c.json({ error: "請先登入。" }, 401);
  }
  await next();
};
