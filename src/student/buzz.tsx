// 搶答 on the phone: 3-2-1 (the server says how long), then one huge 「搶！」.
// Shown over whatever was on screen, which stays mounted underneath so an unsent
// answer is still there when the round ends.
import { useEffect, useMemo, useState } from "preact/hooks";
import { ApiError, studentApi } from "./api";
import type { StudentState } from "../shared/lesson";

type Buzz = NonNullable<StudentState["buzz"]>;

export function BuzzView({ code, buzz, onRefresh }: { code: string; buzz: Buzz; onRefresh: () => void }) {
  // The phone's clock may be off, so only the time left counts, from when it arrived.
  const openAt = useMemo(() => performance.now() + buzz.opensInMs, [buzz]);
  const [now, setNow] = useState(performance.now());
  const [rank, setRank] = useState<number | null>(buzz.rank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const counting = now < openAt;
  useEffect(() => {
    setNow(performance.now());
    if (!counting) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [counting, openAt]);
  useEffect(() => {
    if (buzz.rank !== null) setRank(buzz.rank);
  }, [buzz.rank]);

  const press = async () => {
    if (counting || busy || rank !== null) return;
    setBusy(true);
    setError("");
    try {
      const res = await studentApi<{ rank: number }>("POST", `/buzz/${code}`, { round: buzz.round });
      setRank(res.rank);
    } catch (e) {
      setError((e as Error).message);
      if ((e as ApiError).status === 409) onRefresh(); // the round just ended or restarted
    }
    setBusy(false);
  };

  return (
    <div class="stack center buzz">
      <p class="big-status">搶答</p>
      {rank !== null ? (
        <p class="buzz-rank" role="status">
          你是第 <strong>{rank}</strong> 個按的
        </p>
      ) : counting ? (
        <>
          <p class="buzz-count" aria-live="polite">
            {Math.ceil((openAt - now) / 1000)}
          </p>
          <button class="buzz-button" disabled aria-disabled="true">
            搶！
          </button>
        </>
      ) : (
        <button class="buzz-button buzz-go" disabled={busy} onClick={press}>
          搶！
        </button>
      )}
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
