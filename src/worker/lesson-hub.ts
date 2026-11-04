// One Durable Object per lesson. It only keeps the WebSocket connections and
// passes on "something changed" events; it stores nothing and never reads D1.
// Uses the Hibernation API, so idle connections cost no running time.
import type { Bindings } from "./env";
import type { LiveEvent } from "../shared/lesson";

type Target = "teacher" | "student" | "all";

export class LessonHub {
  constructor(private ctx: DurableObjectState) {
    // Answer keep-alive pings without waking the object up.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(req: Request) {
    if (req.headers.get("Upgrade") === "websocket") {
      const role = new URL(req.url).searchParams.get("role") === "teacher" ? "teacher" : "student";
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server, [role]);
      return new Response(null, { status: 101, webSocket: client });
    }
    const { t, to } = (await req.json()) as { t: LiveEvent; to: Target };
    const message = JSON.stringify({ t });
    for (const ws of this.ctx.getWebSockets(to === "all" ? undefined : to)) {
      try {
        ws.send(message);
      } catch {
        // Already closing; that client refetches when it reconnects.
      }
    }
    return new Response("ok");
  }

  webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code === 1005 ? 1000 : code, "bye");
    } catch {
      // Already closed.
    }
  }

  webSocketError() {}
}

function hub(env: Bindings, lessonId: string) {
  return env.LESSON_HUB.get(env.LESSON_HUB.idFromName(lessonId));
}

// Tell everyone in the lesson (or only the teacher / students) to refetch.
// A failed broadcast must not fail the request: clients refetch on reconnect anyway.
export async function notify(env: Bindings, lessonId: string, t: LiveEvent, to: Target = "all") {
  try {
    await hub(env, lessonId).fetch("https://hub/notify", { method: "POST", body: JSON.stringify({ t, to }) });
  } catch (e) {
    console.error("broadcast failed", e);
  }
}

export function connect(env: Bindings, lessonId: string, req: Request) {
  return hub(env, lessonId).fetch(req);
}
