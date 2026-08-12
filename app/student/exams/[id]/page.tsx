import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { PhotoGallery } from "@/app/_components/photo-gallery";

function formatExamDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

// RLS on exams (exams_select_own_or_scored) already gates visibility on
// "an exam_scores row exists for the caller" -- if this student has no
// score row for this exam, the select below returns nothing and we 404,
// with no separate authorization check needed.
export default async function StudentExamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: exam } = await supabase
    .from("exams")
    .select("id, title, description, exam_date, full_marks")
    .eq("id", id)
    .maybeSingle();

  if (!exam) {
    notFound();
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: score } = user
    ? await supabase
        .from("exam_scores")
        .select(
          "id, score, feedback_text, exam_score_files(id, file_name, storage_object_key, mime_type, size_bytes)"
        )
        .eq("exam_id", id)
        .eq("student_id", user.id)
        .maybeSingle()
    : { data: null };

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{exam.title}</h1>
        <p className="text-sm text-slate-500">{formatExamDate(exam.exam_date)}</p>
        {exam.description ? <p className="text-sm text-slate-600">{exam.description}</p> : null}
      </div>

      <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
        <h2 className="font-medium">我的成绩</h2>
        {score?.score !== null && score?.score !== undefined ? (
          <p className="text-2xl font-semibold text-green-700">
            {score.score}
            {exam.full_marks ? <span className="text-base text-slate-500"> / {exam.full_marks}</span> : null}
          </p>
        ) : (
          <p className="text-sm text-amber-600">尚未评分</p>
        )}
        {score?.feedback_text ? <p className="text-sm text-slate-600">{score.feedback_text}</p> : null}
      </div>

      <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
        <h2 className="font-medium">试卷照片</h2>
        <PhotoGallery files={score?.exam_score_files ?? []} />
      </div>
    </div>
  );
}
