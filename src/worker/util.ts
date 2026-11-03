import type { Context } from "hono";
import type { AppEnv } from "./env";

export function fail(c: Context<AppEnv>, message: string, status: 400 | 404 | 409 = 400) {
  return c.json({ error: message }, status);
}

export async function readBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const body = await c.req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? body : {};
}

export function now() {
  return new Date().toISOString();
}

export function cryptoRandom() {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

// Pick a 6-digit join code no other class is using.
export async function uniqueJoinCode(db: D1Database): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = String(Math.floor(cryptoRandom() * 1_000_000)).padStart(6, "0");
    const taken = await db.prepare("SELECT 1 FROM classes WHERE join_code = ?").bind(code).first();
    if (!taken) return code;
  }
  throw new Error("Could not find a free join code");
}
