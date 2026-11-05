// The QR code on the projector opens `/?code=123456`: join straight away,
// then drop the code from the address bar so a reload or a shared link doesn't carry it.
export function readJoinLink(href: string): { code: string | null; cleanUrl: string | null } {
  const url = new URL(href);
  if (!url.searchParams.has("code")) return { code: null, cleanUrl: null };
  const code = (url.searchParams.get("code") ?? "").trim();
  url.searchParams.delete("code");
  return { code: /^\d{6}$/.test(code) ? code : null, cleanUrl: url.pathname + url.search + url.hash };
}
