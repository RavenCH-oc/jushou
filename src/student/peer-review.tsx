// 互評 on the student's phone: reviewing a classmate's 簡答 (anonymous), and the
// review this student got once the teacher ends it.
import { useState } from "preact/hooks";
import { ApiError, studentApi } from "./api";
import { REVIEW_MAX_LENGTH, REVIEW_MAX_SCORE, checkReview, commentLength } from "../shared/peer-review";
import type { StudentCurrent } from "../shared/lesson";

export function Reviewing({ code, current, onRefresh }: { code: string; current: StudentCurrent; onRefresh: () => void }) {
  const task = current.review;
  const [score, setScore] = useState<number | null>(task?.score ?? null);
  const [comment, setComment] = useState(task?.comment ?? "");
  const [sent, setSent] = useState(task?.score ? JSON.stringify([task.score, task.comment]) : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!task) {
    return (
      <div class="stack center">
        <p class="big-status">同學互評中</p>
        <p class="wait">{current.answer === null ? "這題你沒有作答，這次不用互評，等老師下一步" : "這次沒有分配到你評，等老師下一步"}</p>
      </div>
    );
  }
  if (task.deleted) {
    return (
      <div class="stack center">
        <p class="big-status">同學互評中</p>
        <p class="wait">老師刪除了你這則評語，這題不用再評，等老師下一步</p>
      </div>
    );
  }

  const changed = JSON.stringify([score, comment.trim()]) !== sent;
  const left = REVIEW_MAX_LENGTH - commentLength(comment);
  const send = async () => {
    setBusy(true);
    setError("");
    try {
      await studentApi("POST", `/review/${code}`, { questionId: current.question.id, score, comment });
      setSent(JSON.stringify([score, comment.trim()]));
    } catch (e) {
      setError((e as Error).message);
      if ((e as ApiError).status === 409 || (e as ApiError).status === 403) onRefresh(); // e.g. the teacher just ended it
    }
    setBusy(false);
  };

  return (
    <div class="stack">
      <h1 class="review-title">請評這位同學的答案</h1>
      <p class="muted">
        第 {current.number} 題：{current.question.text}
      </p>
      <div class="review-answer">{task.text}</div>
      <fieldset class="review-scores">
        <legend>給幾分？</legend>
        <div class="review-score-row">
          {Array.from({ length: REVIEW_MAX_SCORE }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              class={`review-score${score === n ? " review-score-on" : ""}`}
              aria-pressed={score === n}
              onClick={() => setScore(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <label for="review-comment">評語（一定要寫）</label>
        <textarea
          id="review-comment"
          class="field review-comment"
          rows={4}
          value={comment}
          onInput={(e) => setComment(e.currentTarget.value)}
        />
        <p class={`review-count${left < 0 ? " error" : ""}`}>{left >= 0 ? `還可以寫 ${left} 字` : `超過 ${-left} 字，請刪短一點`}</p>
      </div>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {sent !== null &&
        (changed ? (
          <p class="notice">評語改了，記得再按一次「送出評語」。</p>
        ) : (
          <p class="sent" role="status">
            ✓ 已送出，在老師結束互評前可以修改
          </p>
        ))}
      <button class="btn btn-block btn-send" disabled={busy || !changed || checkReview(score, comment) !== null} onClick={send}>
        {busy ? "送出中…" : "送出評語"}
      </button>
    </div>
  );
}

// Shown above the usual result once the teacher ends 互評. Never says who wrote it.
export function ReceivedReview({ received }: { received: { score: number; comment: string } | null }) {
  return (
    <section class="review-received">
      <h2>你收到的互評</h2>
      {received ? (
        <>
          <p class="review-received-score">
            {received.score} 分<span class="muted">（滿分 {REVIEW_MAX_SCORE} 分）</span>
          </p>
          <p class="review-received-comment">{received.comment}</p>
        </>
      ) : (
        <p>這次沒有收到互評</p>
      )}
    </section>
  );
}
