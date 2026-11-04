// Where the phone keeps its token and the last join code, and calls to the student API.

function pickStorage(): { store: Storage | null; persistent: boolean } {
  for (const [name, persistent] of [
    ["localStorage", true],
    ["sessionStorage", false],
  ] as const) {
    try {
      const store = window[name];
      store.setItem("jushou.check", "1");
      store.removeItem("jushou.check");
      return { store, persistent };
    } catch {
      // Private mode or blocked storage: try the next one.
    }
  }
  return { store: null, persistent: false };
}

const { store, persistent } = pickStorage();
const memory = new Map<string, string>();

// false = this phone forgets who it is when the tab closes (無痕模式 etc.).
export const remembers = persistent;

export function load(key: string) {
  return store?.getItem(`jushou.${key}`) ?? memory.get(key) ?? null;
}

export function save(key: string, value: string | null) {
  if (value === null) {
    store?.removeItem(`jushou.${key}`);
    memory.delete(key);
  } else {
    memory.set(key, value);
    store?.setItem(`jushou.${key}`, value);
  }
}

// A random token that says "this phone". The server only keeps its SHA-256.
function deviceToken() {
  let token = load("token");
  if (!token) {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    save("token", token);
  }
  return token;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function studentApi<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/student${path}`, {
      method,
      headers: { "Content-Type": "application/json", "X-Device-Token": deviceToken() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("連不上伺服器，請確認網路後再試一次。", 0);
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? "發生問題，請重新整理頁面再試一次。", res.status);
  return data;
}
