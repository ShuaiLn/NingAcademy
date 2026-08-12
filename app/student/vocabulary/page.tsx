import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { StartPracticeButton } from "./start-practice-button";
import { DueDateBadge } from "@/app/_components/due-date-badge";

export default async function StudentVocabularyPage() {
  const supabase = await createClient();

  const { data: targets } = await supabase
    .from("vocabulary_targets")
    .select("set_id, vocabulary_sets(id, title, description, due_at, practice_engine_version)")
    .is("revoked_at", null);

  const assignedSets = (targets ?? [])
    .filter((t) => t.vocabulary_sets !== null)
    .map((t) => ({
      setId: t.set_id,
      title: t.vocabulary_sets!.title,
      description: t.vocabulary_sets!.description,
      dueAt: t.vocabulary_sets!.due_at,
      engineVersion: t.vocabulary_sets!.practice_engine_version,
    }));

  const setIds = assignedSets.map((s) => s.setId);
  const { data: openSessions } =
    setIds.length > 0
      ? await supabase
          .from("practice_sessions")
          .select("set_id")
          .in("set_id", setIds)
          .is("completed_at", null)
      : { data: [] };

  const openSetIds = new Set((openSessions ?? []).map((s) => s.set_id));
  const now = Date.now();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">词汇作业</h1>
      <div className="flex flex-col gap-3">
        {assignedSets.map((s) => {
          const overdue = !!s.dueAt && new Date(s.dueAt).getTime() < now;
          return (
            <div
              key={s.setId}
              className={`flex items-center justify-between rounded-md border p-4 ${overdue ? "border-red-300 bg-red-50" : "border-slate-200"}`}
            >
              <div>
                <p className="font-medium">{s.title}</p>
                {s.description ? <p className="text-sm text-slate-500">{s.description}</p> : null}
                {s.dueAt ? (
                  <p className="text-sm">
                    <DueDateBadge dueAt={s.dueAt} overdue={overdue} />
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                <Link
                  href={`/student/vocabulary/${s.setId}`}
                  aria-label="查看练习记录"
                  title="查看练习记录"
                  className="text-slate-400 hover:text-slate-700"
                >
                  🕐
                </Link>
                <StartPracticeButton setId={s.setId} engineVersion={s.engineVersion} resuming={openSetIds.has(s.setId)} />
              </div>
            </div>
          );
        })}
        {assignedSets.length === 0 ? (
          <p className="text-sm text-slate-400">还没有老师布置的词汇作业。</p>
        ) : null}
      </div>
    </div>
  );
}
