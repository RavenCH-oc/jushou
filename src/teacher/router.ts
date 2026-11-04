import { useEffect, useState } from "preact/hooks";

// Hash routing (/t/#/class/<id>) so F5 on any teacher page stays on that page:
// the server only knows /t/, everything after # stays in the browser.

function currentPath() {
  return location.hash.replace(/^#/, "") || "/";
}

let shownPath = currentPath();
let previousPath: string | null = null;
let leaveGuard: (() => boolean) | null = null;

// While `guard` is set, leaving the page (in-app link, 上一頁, F5, closing the tab)
// asks first; `guard` returns true when it's fine to leave.
export function useLeaveGuard(guard: () => boolean, message: string) {
  useEffect(() => {
    leaveGuard = () => guard() || confirm(message);
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!guard()) e.preventDefault(); // the browser shows its own wording here
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      leaveGuard = null;
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);
}

export function useHashPath() {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onChange = () => {
      const next = currentPath();
      if (next === shownPath) return;
      if (leaveGuard && !leaveGuard()) {
        // Stay: put the page we were on back into the address bar.
        history.pushState(null, "", `#${shownPath}`);
        return;
      }
      previousPath = shownPath;
      shownPath = next;
      setPath(next);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return path;
}

export function go(path: string) {
  location.hash = path;
}

// Go back to `path`: a real "上一頁" if that's where we came from (keeps history
// tidy), otherwise replace this page with it (e.g. opened after F5).
export function goBackTo(path: string) {
  if (previousPath === path) history.back();
  else location.replace(href(path));
}

export function href(path: string) {
  return `#${path}`;
}

// match("/class/:id/:tab?", "/class/abc") -> { id: "abc", tab: "" }
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/");
  const s = path.split("/");
  if (s.length > p.length || s.length < p.filter((x) => !x.endsWith("?")).length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) params[p[i].slice(1).replace("?", "")] = decodeURIComponent(s[i] ?? "");
    else if (p[i] !== s[i]) return null;
  }
  return params;
}
