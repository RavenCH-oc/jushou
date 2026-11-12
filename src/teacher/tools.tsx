// 上課小工具 on the lesson screen: 臨時出題, 抽人, 計時器.
// 抽人 and 計時器 live only on the teacher's page: nothing is sent or stored on the server.
import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "./api";
import { ErrorText, Modal, useAction, useLoad } from "./ui";
import { QUICK_DEFAULT_OPTIONS, QUICK_MAX_OPTIONS, QUICK_MAX_TEXT, QUICK_MIN_OPTIONS, QUICK_TYPES, type QuickType } from "../shared/quick";
import type { LessonStudent } from "../shared/lesson";
import type { ClassDetail, GroupingDetail } from "../shared/types";

// --- 臨時出題 ---

export type QuickRequest = { type: QuickType; optionCount?: number; text: string };

export function QuickDialog({ onCreate, onClose }: { onCreate: (q: QuickRequest) => Promise<void>; onClose: () => void }) {
  const [type, setType] = useState<QuickType>("single");
  const [count, setCount] = useState(QUICK_DEFAULT_OPTIONS);
  const [text, setText] = useState("");
  const action = useAction();
  const create = () => action.run(() => onCreate({ type, text, ...(type === "single" ? { optionCount: count } : {}) }));

  return (
    <Modal title="臨時出題" onClose={onClose}>
      <div class="stack">
        <div class="quick-types" role="group" aria-label="題型">
          {QUICK_TYPES.map((t) => (
            <button
              key={t.type}
              class={`btn quick-type${type === t.type ? "" : " btn-secondary"}`}
              aria-pressed={type === t.type}
              onClick={() => setType(t.type)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {type === "single" && (
          <div class="stepper">
            <span class="stepper-label">選項數：</span>
            <button
              class="btn btn-secondary stepper-button"
              aria-label="少一個選項"
              disabled={count <= QUICK_MIN_OPTIONS}
              onClick={() => setCount(count - 1)}
            >
              －
            </button>
            <strong class="stepper-value" aria-live="polite">
              {count}
            </strong>
            <button
              class="btn btn-secondary stepper-button"
              aria-label="多一個選項"
              disabled={count >= QUICK_MAX_OPTIONS}
              onClick={() => setCount(count + 1)}
            >
              ＋
            </button>
            <span class="muted">（A～{String.fromCharCode(64 + count)}）</span>
          </div>
        )}
        <div>
          <label for="quick-text">題目（可以不填）</label>
          <input id="quick-text" class="field" maxLength={QUICK_MAX_TEXT} value={text} onInput={(e) => setText(e.currentTarget.value)} />
          <p class="muted field-hint">不填的話，學生手機只會看到選項，請口頭說題目或寫在黑板上</p>
        </div>
        <ErrorText message={action.error} />
        <button class="btn btn-block btn-main" disabled={action.busy} onClick={create}>
          {action.busy ? "出題中…" : "出題"}
        </button>
        <button class="btn btn-secondary btn-block" onClick={onClose}>
          取消
        </button>
      </div>
    </Modal>
  );
}

// --- 抽人 ---

type Drawn = { people: string[]; groups: Record<string, string[]> }; // ids already drawn
const EMPTY: Drawn = { people: [], groups: {} };

function loadDrawn(key: string): Drawn {
  try {
    const raw = JSON.parse(sessionStorage.getItem(key) ?? "null");
    return raw && Array.isArray(raw.people) && raw.groups ? raw : EMPTY;
  } catch {
    return EMPTY;
  }
}
function saveDrawn(key: string, drawn: Drawn) {
  try {
    sessionStorage.setItem(key, JSON.stringify(drawn));
  } catch {
    // Private mode etc.: it just won't survive a reload.
  }
}

type Candidate = { id: string; label: string; detail?: string };

export function PickerDialog(props: { lessonId: string; classId: string; students: LessonStudent[]; onClose: () => void }) {
  const key = `jushou-drawn-${props.lessonId}`;
  const joined = props.students.filter((s) => s.joined);
  const [mode, setMode] = useState<"person" | "group">("person");
  const [scope, setScope] = useState<"joined" | "all">(joined.length ? "joined" : "all");
  const [groupingId, setGroupingId] = useState<string | null>(null);
  const [noRepeat, setNoRepeat] = useState(true);
  const [drawn, setDrawn] = useState<Drawn>(() => loadDrawn(key));
  const [shown, setShown] = useState<Candidate | null>(null);
  const [spinning, setSpinning] = useState(false);
  const spin = useRef(0);
  useEffect(() => () => clearInterval(spin.current), []);

  const { data: cls } = useLoad(() => api<ClassDetail>("GET", `/classes/${props.classId}`), [props.classId]);
  const groupings = cls?.groupings ?? [];
  const chosenGrouping = groupingId ?? groupings[groupings.length - 1]?.id ?? null; // the newest by default
  const { data: grouping } = useLoad(
    () => (mode === "group" && chosenGrouping ? api<GroupingDetail>("GET", `/groupings/${chosenGrouping}`) : Promise.resolve(null)),
    [mode, chosenGrouping],
  );

  let pool: Candidate[] = [];
  if (mode === "person") {
    pool = (scope === "joined" ? joined : props.students).map((s) => ({ id: s.id, label: `${s.seat} 號 ${s.name}` }));
  } else if (grouping) {
    const names = new Map(grouping.students.map((s) => [s.id, s.name]));
    pool = grouping.groups
      .filter((g) => g.studentIds.length)
      .map((g) => ({ id: g.id, label: g.name, detail: g.studentIds.map((id) => names.get(id) ?? "").join("、") }));
  }
  const already = mode === "person" ? drawn.people : (drawn.groups[chosenGrouping ?? ""] ?? []);
  const left = noRepeat ? pool.filter((c) => !already.includes(c.id)) : pool;
  const unit = mode === "person" ? "人" : "組";

  const remember = (id: string) => {
    const next: Drawn =
      mode === "person"
        ? { ...drawn, people: [...drawn.people, id] }
        : { ...drawn, groups: { ...drawn.groups, [chosenGrouping!]: [...already, id] } };
    setDrawn(next);
    saveDrawn(key, next);
  };
  const restart = () => {
    const next: Drawn = mode === "person" ? { ...drawn, people: [] } : { ...drawn, groups: { ...drawn.groups, [chosenGrouping!]: [] } };
    setDrawn(next);
    saveDrawn(key, next);
    setShown(null);
  };
  const draw = () => {
    if (!left.length) return;
    const winner = left[Math.floor(Math.random() * left.length)];
    setSpinning(true);
    let ticks = 0;
    // About a second of names flicking past, then the result.
    spin.current = setInterval(() => {
      ticks++;
      if (ticks < 14) return setShown(pool[Math.floor(Math.random() * pool.length)]);
      clearInterval(spin.current);
      setShown(winner);
      setSpinning(false);
      if (noRepeat) remember(winner.id);
    }, 70);
  };

  return (
    <Modal title="抽人" wide onClose={props.onClose}>
      <div class="stack">
        <div class="segmented" role="group" aria-label="抽什麼">
          <button
            class={`btn btn-small${mode === "person" ? "" : " btn-secondary"}`}
            aria-pressed={mode === "person"}
            onClick={() => (setMode("person"), setShown(null))}
          >
            抽一人
          </button>
          <button
            class={`btn btn-small${mode === "group" ? "" : " btn-secondary"}`}
            aria-pressed={mode === "group"}
            onClick={() => (setMode("group"), setShown(null))}
          >
            抽一組
          </button>
        </div>
        {mode === "person" ? (
          <div class="choices choices-inline">
            <label class={`choice${scope === "joined" ? " choice-on" : ""}`}>
              <input type="radio" name="scope" checked={scope === "joined"} disabled={!joined.length} onChange={() => setScope("joined")} />
              今天已加入的同學（{joined.length} 人）
            </label>
            <label class={`choice${scope === "all" ? " choice-on" : ""}`}>
              <input type="radio" name="scope" checked={scope === "all"} onChange={() => setScope("all")} />
              全班（{props.students.length} 人）
            </label>
          </div>
        ) : !cls ? (
          <p>載入中…</p>
        ) : !groupings.length ? (
          <p class="muted">這個班還沒有分組</p>
        ) : (
          groupings.length > 1 && (
            <div class="choices choices-inline">
              {groupings.map((g) => (
                <label key={g.id} class={`choice${g.id === chosenGrouping ? " choice-on" : ""}`}>
                  <input
                    type="radio"
                    name="grouping"
                    checked={g.id === chosenGrouping}
                    onChange={() => (setGroupingId(g.id), setShown(null))}
                  />
                  {g.name}
                </label>
              ))}
            </div>
          )
        )}

        <div class={`draw-result${spinning ? " draw-spinning" : ""}`} aria-live="polite">
          {shown ? (
            <>
              <p class="draw-name">{shown.label}</p>
              {shown.detail && <p class="draw-detail">{shown.detail}</p>}
            </>
          ) : (
            <p class="muted">按「抽！」開始</p>
          )}
        </div>

        <div class="draw-foot">
          <label class="check">
            <input type="checkbox" checked={noRepeat} onChange={(e) => setNoRepeat(e.currentTarget.checked)} />
            抽過的不再抽
          </label>
          {noRepeat && pool.length > 0 && (
            <span class="muted">
              還有 {left.length} {unit}沒抽到
            </span>
          )}
        </div>
        {noRepeat && pool.length > 0 && left.length === 0 && !spinning ? (
          <>
            <p class="notice-text">全部都抽過了。</p>
            <button class="btn btn-block btn-main" onClick={restart}>
              重新開始
            </button>
          </>
        ) : (
          <button class="btn btn-block btn-main" disabled={spinning || !left.length} onClick={draw}>
            抽！
          </button>
        )}
        <button class="btn btn-secondary btn-block" onClick={props.onClose}>
          關閉
        </button>
      </div>
    </Modal>
  );
}

// --- 計時器 ---

export type TimerState = { total: number; endsAt: number | null; leftWhenPaused: number }; // ms

export function TimerDialog({ onStart, onClose }: { onStart: (seconds: number) => void; onClose: () => void }) {
  const [custom, setCustom] = useState("");
  const minutes = Number(custom);
  const customOk = custom !== "" && Number.isFinite(minutes) && minutes > 0 && minutes <= 120;
  return (
    <Modal title="計時器" onClose={onClose}>
      <div class="stack">
        <div class="timer-presets">
          {[
            [30, "30 秒"],
            [60, "1 分鐘"],
            [180, "3 分鐘"],
            [300, "5 分鐘"],
          ].map(([s, label]) => (
            <button key={s} class="btn btn-secondary timer-preset" onClick={() => onStart(s as number)}>
              {label}
            </button>
          ))}
        </div>
        <form
          class="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (customOk) onStart(Math.round(minutes * 60));
          }}
        >
          <div>
            <label for="timer-custom">自訂（分鐘）</label>
            <input
              id="timer-custom"
              class="field score-input"
              type="number"
              inputMode="decimal"
              min={0.5}
              max={120}
              step={0.5}
              value={custom}
              onInput={(e) => setCustom(e.currentTarget.value)}
            />
          </div>
          <button class="btn" type="submit" disabled={!customOk}>
            開始
          </button>
        </form>
        <button class="btn btn-secondary btn-block" onClick={onClose}>
          取消
        </button>
      </div>
    </Modal>
  );
}

// One short beep with Web Audio (no sound file).
function beep() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.3;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => ctx.close();
  } catch {
    // No sound; the screen still says 時間到.
  }
}

const leftOf = (t: TimerState, now: number) => (t.endsAt === null ? t.leftWhenPaused : Math.max(0, t.endsAt - now));
const clock = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// The countdown at the top right of the lesson screen.
export function TimerDisplay({ timer, onChange, onClose }: { timer: TimerState; onChange: (t: TimerState) => void; onClose: () => void }) {
  const [now, setNow] = useState(Date.now());
  const beeped = useRef(false);
  useEffect(() => {
    if (timer.endsAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [timer.endsAt]);
  const left = leftOf(timer, now);
  const done = left === 0;
  useEffect(() => {
    if (done && !beeped.current) {
      beeped.current = true;
      beep();
    }
  }, [done]);
  const paused = timer.endsAt === null;

  return (
    <div class={`timer${done ? " timer-done" : ""}`} role="timer" aria-live={done ? "assertive" : "off"}>
      <span class="timer-clock">{done ? "時間到" : clock(left)}</span>
      {!done && (
        <button
          class="btn btn-secondary btn-small"
          onClick={() =>
            onChange(paused ? { ...timer, endsAt: Date.now() + timer.leftWhenPaused } : { ...timer, endsAt: null, leftWhenPaused: left })
          }
        >
          {paused ? "繼續" : "暫停"}
        </button>
      )}
      <button class="btn btn-secondary btn-small" onClick={onClose}>
        關閉
      </button>
    </div>
  );
}
