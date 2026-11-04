// Live updates for one lesson, used by both the student and the teacher page.
// The socket only says "something changed"; `onChange` then refetches over HTTP.
// It is also called after every (re)connect and when the page comes back to
// the foreground (phone screen on, switching back from another app), because
// events sent while away are lost.
import { useEffect, useRef, useState } from "preact/hooks";
import type { LiveEvent } from "../shared/lesson";

const RETRY_SECONDS = [1, 2, 4, 8]; // then every 10 seconds
const PING_MS = 25_000;

export function useLive(lessonId: string | null, role: "teacher" | "student", onChange: (t: LiveEvent | "sync") => void) {
  const [connected, setConnected] = useState(true);
  const handler = useRef(onChange);
  handler.current = onChange;

  useEffect(() => {
    if (!lessonId) return;
    let ws: WebSocket | null = null;
    let tries = 0;
    let retry = 0;
    let awaitingPong = false;
    let stopped = false;

    const connect = () => {
      clearTimeout(retry);
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${scheme}://${location.host}/api/lessons/${lessonId}/ws?role=${role}`);
      ws = socket;
      awaitingPong = false;
      socket.onopen = () => {
        tries = 0;
        setConnected(true);
        handler.current("sync");
      };
      socket.onmessage = (e) => {
        if (e.data === "pong") awaitingPong = false;
        else {
          try {
            handler.current(JSON.parse(e.data).t);
          } catch {
            // Not ours; ignore.
          }
        }
      };
      socket.onclose = () => drop(socket);
    };

    // Give up on a socket (closed, or silently dead) and try again later.
    const drop = (socket: WebSocket) => {
      if (ws !== socket) return;
      socket.onclose = socket.onmessage = socket.onopen = null;
      socket.close();
      ws = null;
      if (stopped) return;
      setConnected(false);
      retry = setTimeout(connect, (RETRY_SECONDS[tries++] ?? 10) * 1000);
    };

    // A socket can look open after the phone slept but be dead; no pong = dead.
    const check = () => {
      if (ws?.readyState !== WebSocket.OPEN) return;
      if (awaitingPong) return drop(ws);
      awaitingPong = true;
      ws.send("ping");
    };
    const ping = setInterval(check, PING_MS);

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      handler.current("sync");
      if (!ws) {
        tries = 0;
        connect();
      } else {
        check();
        setTimeout(() => awaitingPong && ws && drop(ws), 5000);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    connect();

    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(ping);
      document.removeEventListener("visibilitychange", onVisible);
      if (ws) drop(ws);
    };
  }, [lessonId, role]);

  return connected;
}

export function OfflineNote({ connected }: { connected: boolean }) {
  return connected ? null : (
    <p class="offline-note" role="status">
      連線中斷，重新連線中…
    </p>
  );
}
