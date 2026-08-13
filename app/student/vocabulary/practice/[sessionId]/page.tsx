import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { PracticeQuizV1 } from "./practice-quiz-v1";
import { PracticeQuizV2, type SessionStateV2, type WordV2 } from "./practice-quiz-v2";

// The database enforces v1/v2 engine separation (every practice RPC checks
// practice_engine_version and refuses to run against the other engine's
// session), but that guarantee is only real end-to-end if the frontend also
// routes on it -- a single component that always called the v2 RPCs would
// trip the DB's own guard the instant it opened a legacy session. This page
// reads practice_engine_version and renders PracticeQuizV1/PracticeQuizV2
// accordingly.
export default async function PracticeSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("practice_sessions")
    .select("id, completed_at, set_id, practice_engine_version")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) {
    notFound();
  }

  if (session.practice_engine_version === 2) {
    const [stateRes, wordsRes] = await Promise.all([
      supabase.rpc("get_practice_session_state_v2", { p_session_id: sessionId }),
      supabase.rpc("get_practice_words_v2", { p_session_id: sessionId }),
    ]);

    const stateRow = stateRes.data?.[0];
    if (stateRes.error || !stateRow || wordsRes.error || !wordsRes.data) {
      notFound();
    }

    const state: SessionStateV2 = {
      totalWords: stateRow.total_words,
      audioWordCount: stateRow.audio_word_count,
      completedTypedCount: stateRow.completed_typed_count,
      completedAudioCount: stateRow.completed_audio_count,
      completedAt: stateRow.completed_at,
      defaultWordOrder: stateRow.default_word_order === "random" ? "random" : "sequential",
      allowStudentOrderChoice: stateRow.allow_student_order_choice,
      selectedWordOrder: stateRow.selected_word_order === "random" || stateRow.selected_word_order === "sequential" ? stateRow.selected_word_order : null,
    };

    const words: WordV2[] = wordsRes.data.map((w) => ({
      word_id: w.word_id,
      source_sort_order: w.source_sort_order,
      prompt_term: w.prompt_term,
      prompt_meaning: w.prompt_meaning,
      prompt_image_url: w.prompt_image_url,
      show_english: w.show_english,
      show_chinese: w.show_chinese,
      play_audio: w.play_audio,
      autoplay_audio: w.autoplay_audio,
      input_mode:
        w.input_mode === "type_chinese"
          ? "type_chinese"
          : w.input_mode === "audio"
            ? "audio"
            : w.input_mode === "multiple_choice"
              ? "multiple_choice"
              : "type_english",
      prompt_question: w.prompt_question,
      choices: Array.isArray(w.choices) ? (w.choices as string[]) : null,
    }));

    return <PracticeQuizV2 sessionId={sessionId} initialWords={words} state={state} />;
  }

  const { data: words, error } = await supabase.rpc("get_practice_words", {
    p_session_id: sessionId,
  });

  if (error || !words) {
    notFound();
  }

  // Plain RLS-scoped read, not secret -- audio_only/prompt_field only
  // control how the already-visible prompt is presented client-side.
  const { data: set } = await supabase
    .from("vocabulary_sets")
    .select("audio_only, prompt_field")
    .eq("id", session.set_id)
    .maybeSingle();

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">背单词</h1>
      <PracticeQuizV1
        sessionId={sessionId}
        words={words}
        alreadyCompleted={!!session.completed_at}
        audioOnly={set?.audio_only ?? false}
        promptField={set?.prompt_field === "term" ? "term" : "meaning"}
      />
    </div>
  );
}
