import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { PracticeQuiz } from "./practice-quiz";

export default async function PracticeSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("practice_sessions")
    .select("id, completed_at, set_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) {
    notFound();
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
      <PracticeQuiz
        sessionId={sessionId}
        words={words}
        alreadyCompleted={!!session.completed_at}
        audioOnly={set?.audio_only ?? false}
        promptField={set?.prompt_field === "term" ? "term" : "meaning"}
      />
    </div>
  );
}
