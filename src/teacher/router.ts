import { useEffect, useState } from "preact/hooks";

// Hash routing (/t/#/class/<id>) so F5 on any teacher page stays on that page:
// the server only knows /t/, everything after # stays in the browser.

function currentPath() {
  return location.hash.replace(/^#/, "") || "/";
}

export function useHashPath() {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onChange = () => {
      setPath(currentPath());
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
