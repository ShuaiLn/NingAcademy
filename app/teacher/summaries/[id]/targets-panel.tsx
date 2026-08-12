import { createClient } from "@/utils/supabase/server";
import { RemoveTargetButton } from "./remove-target-button";

// Name + "移除" only -- content is shared across every targeted student, so
// unlike scores-panel.tsx there is no per-row grading UI here.
export async function TargetsPanel({ summaryId }: { summaryId: string }) {
  const supabase = await createClient();
  const { data: targets } = await supabase
    .from("lesson_summary_targets")
    .select("student_id, students(profiles(full_name))")
    .eq("summary_id", summaryId)
    .order("created_at", { ascending: true });

  if (!targets || targets.length === 0) {
    return <p className="text-sm text-slate-400">还没有学生。</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {targets.map((t) => (
        <div key={t.student_id} className="flex items-center justify-between rounded-md border border-slate-100 px-3 py-2 text-sm">
          <span>{t.students?.profiles?.full_name ?? "未知学生"}</span>
          <RemoveTargetButton summaryId={summaryId} studentId={t.student_id} />
        </div>
      ))}
    </div>
  );
}
