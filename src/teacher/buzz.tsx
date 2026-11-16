// 搶答 on the lesson screen (projected): 3-2-1, then who pressed first.
// It refetches a light ranking (not the whole lesson) on every "buzz" event, one
// request at a time: presses that arrive while fetching are picked up by one more fetch.
import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "./api";
import { ErrorText, useAction } from "./ui";
import type { BuzzBoard } from "../shared/lesson";

export function BuzzScreen(props: { lessonId: string; poke: { current: () => void }; onEnd: () => Promise<void> }) {
  const [board, setBoard] = useState<BuzzBoard | null>(null);
  const [openAt, setOpenAt] = useState(0); // performance.now() when 「搶！」 opens
  const [now, setNow] = useState(performance.now());
  const [error, setError] = useState("");
  const busy = useRef(false);
  const again = useRef(false);
  const action = useAction();

  const fetchBoard = async () => {
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    try {
      do {
        again.current = false;
        const b = await api<BuzzBoard>("GET", `/lessons/${props.lessonId}/buzz`);
        setBoard(b);
        setOpenAt(performance.now() + b.opensInMs);
        setError("");
      } while (again.current);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
    }
  };
  props.poke.current = fetchBoard;
  useEffect(() => {
    fetchBoard();
  }, []);

  // Tick only during the countdown.
  const counting = now < openAt;
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [counting, openAt]);
  useEffect(() => setNow(performance.now()), [openAt]);

  const again1 = () =>
    action.run(async () => {
      await api("POST", `/lessons/${props.lessonId}/buzz`);
      await fetchBoard();
    });

  let body;
  if (!board) body = <p class="buzz-big">…</p>;
  else if (counting) body = <p class="buzz-big buzz-countdown">{Math.ceil((openAt - now) / 1000)}</p>;
  else if (!board.count) body = <p class="buzz-big">搶！</p>;
  else
    body = (
      <ol class="buzz-ranking">
        {board.top.map((s, i) => (
          <li key={s.seat} class={`buzz-rank buzz-rank-${i < 1 ? 1 : i < 3 ? 2 : 3}`}>
            <span class="buzz-place">第 {i + 1} 名</span>
            <span>
              {s.seat} 號 {s.name}
            </span>
          </li>
        ))}
        {board.count > board.top.length && <li class="buzz-more">還有 {board.count - board.top.length} 人也按了</li>}
      </ol>
    );

  return (
    <div class="buzz-screen" role="dialog" aria-modal="true" aria-label="搶答">
      <div class="buzz-main" aria-live="polite">
        {body}
      </div>
      <p class="buzz-status">
        {board && !board.joined ? "還沒有學生加入" : board ? `已加入 ${board.joined} 人，已經有 ${board.count} 人按了` : ""}
      </p>
      <ErrorText message={error || action.error} />
      <div class="buzz-actions">
        <button class="btn btn-secondary" disabled={action.busy} onClick={again1}>
          再搶一次
        </button>
        <button class="btn btn-main" disabled={action.busy} onClick={() => action.run(props.onEnd)}>
          結束搶答
        </button>
      </div>
    </div>
  );
}
