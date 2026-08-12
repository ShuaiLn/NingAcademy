"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { submitVocabularyAttempt, finishPracticeSession } from "@/app/actions/practice";

type Word = { word_id: string; prompt_text: string; prompt_image_url: string | null; sort_order: number };

// The legacy, one-shot practice engine -- moved to this filename by the v1/
// v2 engine split (app/student/vocabulary/practice/[sessionId]/page.tsx),
// otherwise untouched: still calls the original startPracticeSession/
// submitVocabularyAttempt/finishPracticeSession actions, one-shot grading,
// no retry queue, no audio. Only rendered for a session whose
// practice_engine_version is 1.
export function PracticeQuizV1({
  sessionId,
  words,
  alreadyCompleted,
  audioOnly,
  promptField,
}: {
  sessionId: string;
  words: Word[];
  alreadyCompleted: boolean;
  audioOnly: boolean;
  promptField: "meaning" | "term";
}) {
  const [index, setIndex] = useState(0);
  const [spelling, setSpelling] = useState("");
  const [feedback, setFeedback] = useState<{ isCorrect: boolean; correctAnswer: string } | null>(null);
  const [results, setResults] = useState<boolean[]>([]);
  const [finished, setFinished] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const currentWord = words[index];

  // Only ever triggered from a manual button click, never on mount -- see
  // the migration's audio_only column comment.
  function speakPrompt() {
    if (!currentWord || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(currentWord.prompt_text);
    utterance.lang = promptField === "term" ? "en-US" : "zh-CN";
    window.speechSynthesis.speak(utterance);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!currentWord || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await submitVocabularyAttempt(sessionId, currentWord.word_id, spelling);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFeedback({ isCorrect: result.isCorrect, correctAnswer: result.correctAnswer });
      setResults((prev) => [...prev, result.isCorrect]);
    });
  }

  function finish() {
    startTransition(async () => {
      const result = await finishPracticeSession(sessionId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFinished(true);
    });
  }

  function handleNext() {
    setFeedback(null);
    setSpelling("");
    if (index + 1 >= words.length) {
      finish();
    } else {
      setIndex((prev) => prev + 1);
    }
  }

  // A session completed in a previous visit (e.g. bookmarked/back button)
  // has no client-side tally to show -- distinct from `finished`, which
  // only becomes true after finishing live in this render.
  if (alreadyCompleted && !finished) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
        <h2 className="font-medium">本轮练习已结束</h2>
        <Link
          href="/student/vocabulary"
          className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm text-white"
        >
          返回词汇作业列表
        </Link>
      </div>
    );
  }

  if (finished) {
    const correctCount = results.filter(Boolean).length;
    return (
      <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
        <h2 className="font-medium">本轮已结束</h2>
        <p className="text-sm text-slate-600">
          共作答 {results.length} 个单词，正确 {correctCount} 个。
        </p>
        <Link
          href="/student/vocabulary"
          className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm text-white"
        >
          返回词汇作业列表
        </Link>
      </div>
    );
  }

  if (!currentWord) {
    return <p className="text-sm text-slate-400">该作业暂无可练习的单词。</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-500">
        第 {index + 1} / {words.length} 个
      </p>
      <div className="flex flex-col items-center gap-3 rounded-md border border-slate-200 p-6">
        {currentWord.prompt_image_url ? (
          <img src={currentWord.prompt_image_url} alt="" className="max-h-40 rounded-md object-contain" />
        ) : null}
        {audioOnly ? (
          <button
            type="button"
            onClick={speakPrompt}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white"
          >
            🔊 播放
          </button>
        ) : (
          <p className="text-xl font-medium">{currentWord.prompt_text}</p>
        )}
      </div>

      {feedback ? (
        <div className="flex flex-col gap-3">
          <p className={feedback.isCorrect ? "text-sm text-green-700" : "text-sm text-red-600"}>
            {feedback.isCorrect ? "回答正确" : `回答错误，正确答案：${feedback.correctAnswer}`}
          </p>
          <button
            type="button"
            onClick={handleNext}
            className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm text-white"
          >
            {index + 1 >= words.length ? "完成" : "下一个"}
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex items-end gap-3">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-slate-700">{promptField === "term" ? "请输入释义" : "请输入拼写"}</span>
            <input
              type="text"
              value={spelling}
              onChange={(e) => setSpelling(e.target.value)}
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
        onClick={finish}
        disabled={pending}
        className="w-fit text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50"
      >
        结束练习
      </button>
    </div>
  );
}
