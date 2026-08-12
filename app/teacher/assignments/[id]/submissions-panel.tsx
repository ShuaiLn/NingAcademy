import { createClient } from "@/utils/supabase/server";
import { AttachedFilesList } from "./attached-files-list";
import { GradingForm } from "./grading-form";

export async function SubmissionsPanel({ assignmentId }: { assignmentId: string }) {
  const supabase = await createClient();
  const { data: submissions } = await supabase
    .from("submissions")
    .select(
      "id, attempt_no, note, submitted_at, score, feedback_text, students(profiles(full_name)), submission_files(id, file_name, storage_object_key, size_bytes)"
    )
    .eq("assignment_id", assignmentId)
    .not("submitted_at", "is", null)
    .order("submitted_at", { ascending: false });

  if (!submissions || submissions.length === 0) {
    return <p className="text-sm text-slate-400">还没有学生提交。</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {submissions.map((s) => (
        <div key={s.id} className="flex flex-col gap-2 rounded-md border border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <p className="font-medium">{s.students?.profiles?.full_name ?? "未知学生"}</p>
            <p className="text-xs text-slate-400">第 {s.attempt_no} 次提交</p>
          </div>
          {s.note ? <p className="text-sm text-slate-600">{s.note}</p> : null}
          <AttachedFilesList files={s.submission_files ?? []} />
          <GradingForm submissionId={s.id} score={s.score} feedbackText={s.feedback_text} />
        </div>
      ))}
    </div>
  );
}
