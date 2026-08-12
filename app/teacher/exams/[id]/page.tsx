import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { EditExamForm } from "./edit-exam-form";
import { ExamActionsPanel } from "./exam-actions-panel";
import { AddStudentsForm } from "./add-students-form";
import { ScoresPanel } from "./scores-panel";

function formatExamDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

export default async function ExamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: exam } = await supabase
    .from("exams")
    .select("id, title, description, exam_date, full_marks, archived_at")
    .eq("id", id)
    .maybeSingle();

  if (!exam) {
    notFound();
  }

  const { data: classes } = await supabase
    .from("classes")
    .select("id, name")
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  const { data: students } = await supabase
    .from("students")
    .select("id, profiles(full_name)")
    .order("created_at", { ascending: false });

  const allClasses = (classes ?? []).map((c) => ({ id: c.id, name: c.name }));
  const allStudents = (students ?? []).map((s) => ({ id: s.id, fullName: s.profiles?.full_name ?? "" }));

  const { data: existingScores } = await supabase.from("exam_scores").select("student_id").eq("exam_id", id);
  const existingStudentIds = (existingScores ?? []).map((s) => s.student_id);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{exam.title}</h1>
        <p className="text-sm text-slate-500">{formatExamDate(exam.exam_date)}</p>
        {exam.description ? <p className="text-sm text-slate-600">{exam.description}</p> : null}
      </div>

      <EditExamForm exam={exam} />

      <div className="rounded-md border border-slate-200 p-4">
        <ExamActionsPanel examId={exam.id} archived={!!exam.archived_at} />
      </div>

      {!exam.archived_at ? (
        <AddStudentsForm
          examId={exam.id}
          classes={allClasses}
          students={allStudents}
          existingStudentIds={existingStudentIds}
        />
      ) : null}

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">学生成绩</h2>
        <ScoresPanel examId={exam.id} />
      </div>
    </div>
  );
}
