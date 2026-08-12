import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { StartPracticeButton } from "../start-practice-button";
import { DueDateBadge } from "@/app/_components/due-date-badge";

// Per-set detail landing page -- this is what the assignment hub's
// vocabulary rows link to (app/student/assignments/page.tsx), not the
// generic /student/vocabulary list, so "row click lands on that specific
// assignment" holds uniformly across all three assignment types.
export default async function StudentVocabularySetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: set } = await supabase
    .from("vocabulary_sets")
    .select("id, title, description, due_at")
    .eq("id", id)
    .maybeSingle();

  if (!set) {
    notFound();
  }

  const { data: openSession } = await supabase
    .from("practice_sessions")
    .select("id")
    .eq("set_id", id)
    .is("completed_at", null)
    .maybeSingle();

  const { data: pastSessions } = await supabase
    .from("practice_sessions")
    .select("id, completed_at, total_words")
    .eq("set_id", id)
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(10);

  const overdue = !!set.due_at && new Date(set.due_at) < new Date();

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{set.title}</h1>
        {set.description ? <p className="text-sm text-slate-600">{set.description}</p> : null}
        {set.due_at ? (
          <p className="text-sm">
            <DueDateBadge dueAt={set.due_at} overdue={overdue} />
          </p>
        ) : null}
      </div>

      <StartPracticeButton setId={set.id} resuming={!!openSession} />

      {pastSessions && pastSessions.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-4">
          <h2 className="font-medium">练习记录</h2>
          {pastSessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between text-sm">
              <span>{new Date(s.completed_at!).toLocaleString("zh-CN")}</span>
              <span className="text-slate-500">共 {s.total_words} 个单词</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
