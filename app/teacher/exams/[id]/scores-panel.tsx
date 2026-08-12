import { createClient } from "@/utils/supabase/server";
import { PhotoGallery } from "@/app/_components/photo-gallery";
import { ExamScoreRow } from "./exam-score-row";

export async function ScoresPanel({ examId }: { examId: string }) {
  const supabase = await createClient();
  const { data: scores } = await supabase
    .from("exam_scores")
    .select(
      "id, student_id, score, feedback_text, students(profiles(full_name)), exam_score_files(id, file_name, storage_object_key, mime_type, size_bytes)"
    )
    .eq("exam_id", examId)
    .order("created_at", { ascending: true });

  if (!scores || scores.length === 0) {
    return <p className="text-sm text-slate-400">还没有学生。</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {scores.map((s) => (
        <ExamScoreRow
          key={s.id}
          examId={examId}
          examScoreId={s.id}
          studentId={s.student_id}
          studentName={s.students?.profiles?.full_name ?? "未知学生"}
          score={s.score}
          feedbackText={s.feedback_text}
          files={s.exam_score_files ?? []}
          gallery={<PhotoGallery files={s.exam_score_files ?? []} />}
        />
      ))}
    </div>
  );
}
