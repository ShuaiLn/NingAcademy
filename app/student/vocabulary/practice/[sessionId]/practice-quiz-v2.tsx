"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent, type SyntheticEvent } from "react";
import Link from "next/link";
import {
  submitVocabularyAttemptV2,
  finishPracticeSessionV2,
  startVocabularyAudioSubmission,
  setPracticeSessionWordOrder,
  logPracticeSessionTabEvent,
} from "@/app/actions/practice";
import { AudioRecorder } from "@/app/_components/audio-recorder";

export type WordV2 = {
  word_id: string;
  source_sort_order: number;
  prompt_term: string | null;
  prompt_meaning: string | null;
  prompt_image_url: string | null;
  show_english: boolean;
  show_chinese: boolean;
  play_audio: boolean;
  autoplay_audio: boolean;
  input_mode: "type_english" | "type_chinese" | "audio" | "multiple_choice";
  prompt_question: string | null;
  choices: string[] | null;
};

export type SessionStateV2 = {
  totalWords: number;
  audioWordCount: number;
  completedTypedCount: number;
  completedAudioCount: number;
  completedAt: string | null;
  defaultWordOrder: "sequential" | "random";
  allowStudentOrderChoice: boolean;
  selectedWordOrder: "sequential" | "random" | null;
};

type Feedback = { kind: "correct" } | { kind: "incorrect"; correctAnswers: string[] } | { kind: "submitted" };

function orderWords(words: WordV2[], order: "sequential" | "random"): WordV2[] {
  if (order === "sequential") {
    return [...words].sort((a, b) => a.source_sort_order - b.source_sort_order || a.word_id.localeCompare(b.word_id));
  }
  const arr = [...words];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function blockCopyOutsideInputs(e: SyntheticEvent) {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  e.preventDefault();
}

function speak(text: string) {
  if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  window.speechSynthesis.speak(utterance);
}

// The retry-until-correct practice engine. Rendered only for a session
// whose practice_engine_version is 2. get_practice_session_state_v2()/
// get_practice_words_v2() are fetched exactly once, server-side, by
// page.tsx and passed down as props -- the retry queue lives entirely in
// this component's React state for the duration of one page visit; wrong
// words are reinserted locally, never re-fetched. A browser refresh simply
// re-runs the server component.
export function PracticeQuizV2({
  sessionId,
  initialWords,
  state,
}: {
  sessionId: string;
  initialWords: WordV2[];
  state: SessionStateV2;
}) {
  const needsOrderChoice = state.allowStudentOrderChoice && state.selectedWordOrder === null;

  const [orderChosen, setOrderChosen] = useState(!needsOrderChoice);
  const [orderPending, startOrderTransition] = useTransition();
  const [queue, setQueue] = useState<WordV2[]>(() =>
    needsOrderChoice ? [] : orderWords(initialWords, state.selectedWordOrder ?? state.defaultWordOrder)
  );
  const [completedCount, setCompletedCount] = useState(state.completedTypedCount + state.completedAudioCount);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [finished, setFinished] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [audioSubmissionId, setAudioSubmissionId] = useState<string | null>(null);
  const [audioUploading, setAudioUploading] = useState(false);
  const autoFinishedRef = useRef(false);
  const alreadyCompleted = state.completedAt !== null;

  const current = queue[0] as WordV2 | undefined;
  const totalWords = state.totalWords;

  // Autoplay fires the instant a question appears, no click needed.
  useEffect(() => {
    if (current && current.autoplay_audio && current.prompt_term) {
      speak(current.prompt_term);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.word_id]);

  // Tab-switch/away logging. visibilitychange is the authoritative signal --
  // it fires immediately on the real transition, unaffected by the timer
  // throttling browsers apply to backgrounded tabs, so it must never be
  // debounced. blur/focus are a secondary fallback only, for OS-level focus
  // loss that doesn't flip document.hidden (e.g. another app overlapping the
  // browser without covering the tab); independently debounced, and a no-op
  // via logIfChanged when visibilitychange already logged the same
  // transition (the common tab-switch case fires both almost together --
  // this must not double-log it). pagehide sends a best-effort
  // navigator.sendBeacon, since a normal fetch/server-action call can be
  // aborted mid-flight when the page actually unloads.
  useEffect(() => {
    if (typeof document === "undefined") return;
    let lastLogged: "hidden" | "visible" = document.hidden ? "hidden" : "visible";
    let blurTimer: ReturnType<typeof setTimeout> | null = null;

    function logIfChanged(next: "hidden" | "visible") {
      if (next === lastLogged) return;
      lastLogged = next;
      logPracticeSessionTabEvent(sessionId, next).catch(() => {});
    }

    function onVisibilityChange() {
      logIfChanged(document.hidden ? "hidden" : "visible");
    }

    function onBlurOrFocus() {
      if (blurTimer) clearTimeout(blurTimer);
      blurTimer = setTimeout(() => {
        logIfChanged(document.hidden || !document.hasFocus() ? "hidden" : "visible");
      }, 400);
    }

    // Deliberately UNCONDITIONAL -- do not gate this on lastLogged !==
    // "hidden". visibilitychange typically fires before pagehide and sets
    // lastLogged synchronously, but the server-action request it kicked off
    // is asynchronous and can still be aborted by the browser mid-flight a
    // moment later when the page actually unloads -- gating the beacon on
    // lastLogged would then skip the one fallback meant to cover exactly
    // that failure. The RPC's own dedup makes a redundant "hidden" beacon a
    // safe no-op when the original request did land, so there is no cost to
    // always sending it here.
    function onPageHide() {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/practice-tab-event",
          new Blob([JSON.stringify({ sessionId, eventType: "hidden" })], { type: "application/json" })
        );
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onBlurOrFocus);
    window.addEventListener("focus", onBlurOrFocus);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onBlurOrFocus);
      window.removeEventListener("focus", onBlurOrFocus);
      window.removeEventListener("pagehide", onPageHide);
      if (blurTimer) clearTimeout(blurTimer);
    };
  }, [sessionId]);

  // Lazily create (or resume) the one audio submission for this session the
  // moment the student reaches the first audio-input word.
  useEffect(() => {
    if (current?.input_mode !== "audio" || audioSubmissionId || pending) return;
    startTransition(async () => {
      const result = await startVocabularyAudioSubmission(sessionId);
      if (result.ok) {
        setAudioSubmissionId(result.audioSubmissionId);
      } else {
        setError(result.error);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.word_id]);

  // Loop ends when the queue empties -- fires automatically, exactly once.
  // Also covers the "reconciliation on load" case: a session whose
  // remaining-words list is already empty (every word handled, but a prior
  // finishPracticeSessionV2 call never completed, e.g. a network failure
  // right after the last answer) auto-recovers instead of rendering a
  // stuck "no more words but not done" state -- safe because
  // complete_practice_session_v2 is idempotent.
  useEffect(() => {
    if (alreadyCompleted || finished || !orderChosen || queue.length > 0 || autoFinishedRef.current) return;
    autoFinishedRef.current = true;
    startTransition(async () => {
      const result = await finishPracticeSessionV2(sessionId);
      if (result.ok) {
        setFinished(true);
      } else {
        setError(result.error);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.length, orderChosen, alreadyCompleted, finished]);

  function chooseOrder(order: "sequential" | "random") {
    startOrderTransition(async () => {
      const result = await setPracticeSessionWordOrder(sessionId, order);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setQueue(orderWords(initialWords, order));
      setOrderChosen(true);
    });
  }

  function handleSubmit(eOrValue: FormEvent | string) {
    const value = typeof eOrValue === "string" ? eOrValue : answer;
    if (typeof eOrValue !== "string") eOrValue.preventDefault();
    if (!current || current.input_mode === "audio" || pending || feedback) return;
    setError(null);
    startTransition(async () => {
      const result = await submitVocabularyAttemptV2(sessionId, current.word_id, value);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFeedback(result.isCorrect ? { kind: "correct" } : { kind: "incorrect", correctAnswers: result.correctAnswers });
    });
  }

  function handleAdvance() {
    if (!feedback) return;
    setAnswer("");
    if (feedback.kind === "incorrect") {
      setQueue((prev) => {
        const [word, ...rest] = prev;
        const pos = rest.length === 0 ? 0 : 1 + Math.floor(Math.random() * Math.min(4, rest.length));
        return [...rest.slice(0, pos), word, ...rest.slice(pos)];
      });
    } else {
      setCompletedCount((c) => c + 1);
      setQueue((prev) => prev.slice(1));
    }
    setFeedback(null);
  }

  function finishNow() {
    if (audioUploading || pending) return;
    startTransition(async () => {
      const result = await finishPracticeSessionV2(sessionId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFinished(true);
    });
  }

  const outerClass =
    "mx-auto flex min-h-[calc(100dvh-4rem)] w-full flex-col items-center justify-center gap-6 px-4 py-8 sm:px-6 lg:px-8";
  const cardClass =
    "practice-card-enter w-full max-w-screen-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:max-w-screen-md sm:p-8 lg:max-w-screen-lg lg:p-10 xl:max-w-screen-xl";

  if (alreadyCompleted && !finished) {
    return (
      <div className={outerClass}>
        <div className={cardClass}>
          <div className="flex flex-col gap-3">
            <h2 className="text-xl font-medium">本轮练习已结束</h2>
            <Link href="/student/vocabulary" className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm text-white">
              返回词汇作业列表
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (finished) {
    return (
      <div className={outerClass}>
        <div className={cardClass}>
          <div className="flex flex-col gap-3">
            <h2 className="text-xl font-medium">本轮已结束</h2>
            <p className="text-sm text-slate-600">
              已完成 {completedCount} / {totalWords} 个
            </p>
            <Link href="/student/vocabulary" className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm text-white">
              返回词汇作业列表
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!orderChosen) {
    return (
      <div className={outerClass}>
        <div className={cardClass}>
          <div className="flex flex-col items-center gap-4 text-center">
            <h2 className="text-xl font-medium sm:text-2xl">选择练习顺序</h2>
            <p className="text-sm text-slate-500">这个选择只能进行一次，之后不能更改。</p>
            <div className="flex gap-3">
              <button
                type="button"
                disabled={orderPending}
                onClick={() => chooseOrder("sequential")}
                className="rounded-md bg-slate-900 px-5 py-3 text-sm text-white disabled:opacity-50"
              >
                顺序练习
              </button>
              <button
                type="button"
                disabled={orderPending}
                onClick={() => chooseOrder("random")}
                className="rounded-md border border-slate-300 px-5 py-3 text-sm text-slate-700 hover:border-slate-400 disabled:opacity-50"
              >
                随机练习
              </button>
            </div>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </div>
        </div>
      </div>
    );
  }

  if (!current) {
    // Queue briefly empty while the auto-finish effect above is in flight.
    return (
      <div className={outerClass}>
        <div className={cardClass}>
          <p className="text-sm text-slate-400">正在结束本轮练习…</p>
        </div>
      </div>
    );
  }

  const feedbackBanner = feedback ? (
    <div
      key={feedback.kind}
      className={`rounded-lg px-4 py-3 text-center text-xl font-bold sm:text-2xl ${
        feedback.kind === "correct"
          ? "practice-feedback-correct bg-green-50 text-green-700"
          : feedback.kind === "incorrect"
            ? "practice-feedback-incorrect bg-red-50 text-red-600"
            : "bg-slate-50 text-slate-600"
      }`}
    >
      {feedback.kind === "correct" ? "回答正确 ✓" : feedback.kind === "incorrect" ? "回答错误 ✗" : "已提交，等待老师批改"}
      {feedback.kind === "incorrect" ? (
        <p className="mt-1 text-sm font-normal">正确答案：{feedback.correctAnswers.join("、")}</p>
      ) : null}
    </div>
  ) : null;

  return (
    <div className={outerClass}>
      <div
        key={current.word_id}
        className={`${cardClass} practice-no-select`}
        onCopy={blockCopyOutsideInputs}
        onContextMenu={blockCopyOutsideInputs}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-slate-500">
            已完成 {completedCount} / {totalWords} 个
          </p>

          {feedbackBanner}

          <div className="flex flex-col items-center gap-3 rounded-md border border-slate-200 p-6 sm:p-8">
            {current.prompt_image_url ? (
              <img src={current.prompt_image_url} alt="" className="max-h-48 rounded-md object-contain" />
            ) : null}
            {current.show_english && current.prompt_term ? (
              <p className="text-xl font-medium sm:text-2xl lg:text-4xl">{current.prompt_term}</p>
            ) : null}
            {current.show_chinese && current.prompt_meaning ? (
              <p className="text-xl font-medium sm:text-2xl lg:text-4xl">{current.prompt_meaning}</p>
            ) : null}
            {current.input_mode === "multiple_choice" && current.prompt_question ? (
              <p className="text-xl font-medium sm:text-2xl lg:text-4xl">{current.prompt_question}</p>
            ) : null}
            {current.play_audio && current.prompt_term ? (
              <button
                type="button"
                onClick={() => speak(current.prompt_term!)}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white"
              >
                🔊 播放发音
              </button>
            ) : null}
          </div>

          {feedback ? (
            <button
              type="button"
              onClick={handleAdvance}
              className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm text-white"
            >
              下一个
            </button>
          ) : current.input_mode === "audio" ? (
            audioSubmissionId ? (
              <AudioRecorder
                purpose="vocabulary_audio_submission_file"
                audioSubmissionId={audioSubmissionId}
                wordId={current.word_id}
                onUploaded={() => setFeedback({ kind: "submitted" })}
                onUploadingChange={setAudioUploading}
              />
            ) : (
              <p className="text-sm text-slate-400">正在准备录音…</p>
            )
          ) : current.input_mode === "multiple_choice" ? (
            <div className="flex flex-col gap-2">
              {(current.choices ?? []).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  disabled={pending || feedback !== null}
                  onClick={() => handleSubmit(choice)}
                  className="rounded-md border border-slate-300 px-4 py-3 text-left text-sm hover:border-slate-500 disabled:opacity-50"
                >
                  {choice}
                </button>
              ))}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex items-end gap-3">
              <label className="flex flex-1 flex-col gap-1 text-sm">
                <span className="text-slate-700">{current.input_mode === "type_chinese" ? "请输入中文释义" : "请输入英文拼写"}</span>
                <input
                  type="text"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  autoFocus
                  className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                />
              </label>
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {pending ? "提交中…" : "提交"}
              </button>
            </form>
          )}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <button
            type="button"
            onClick={finishNow}
            disabled={audioUploading || pending}
            className="w-fit text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50"
          >
            结束练习
          </button>
        </div>
      </div>
    </div>
  );
}
