// Fetch wrapper for the teacher API. Throws an Error whose message is
// ready to show to the teacher. A 401 sends the app back to the login page.

export const LOGGED_OUT_EVENT = "jushou:logged-out";

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/teacher${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("連不上伺服器，請確認網路後再試一次。");
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401) {
    window.dispatchEvent(new Event(LOGGED_OUT_EVENT));
    throw new Error("登入已過期，請重新登入。");
  }
  if (!res.ok) throw new Error(data.error ?? "發生問題，請重新整理頁面再試一次。");
  return data;
}
