import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { PhotoGallery } from "@/app/_components/photo-gallery";
import { EditSummaryForm } from "./edit-summary-form";
import { SummaryActionsPanel } from "./summary-actions-panel";
import { AddStudentsForm } from "./add-students-form";
import { AttachPhotosForm } from "./attach-photos-form";
import { DeleteSummaryFileButton } from "./delete-summary-file-button";
import { TargetsPanel } from "./targets-panel";

function formatSessionDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

export default async function SummaryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: summary } = await supabase
    .from("lesson_summaries")
    .select("id, title, content, session_date, archived_at")
    .eq("id", id)
    .maybeSingle();

  if (!summary) {
    notFound();
  }

  const { data: files } = await supabase
    .from("lesson_summary_files")
    .select("id, file_name, storage_object_key, mime_type, size_bytes")
    .eq("summary_id", id);

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

  const { data: existingTargets } = await supabase
    .from("lesson_summary_targets")
    .select("student_id")
    .eq("summary_id", id);
  const existingStudentIds = (existingTargets ?? []).map((t) => t.student_id);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{summary.title || "（无标题）"}</h1>
        <p className="text-sm text-slate-500">{formatSessionDate(summary.session_date)}</p>
      </div>

      <EditSummaryForm summary={summary} />

      <div className="rounded-md border border-slate-200 p-4">
        <SummaryActionsPanel summaryId={summary.id} archived={!!summary.archived_at} />
      </div>

      <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
        <h2 className="font-medium">照片</h2>
        <PhotoGallery files={files ?? []} />
        {files && files.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {files.map((f) => (
              <DeleteSummaryFileButton key={f.id} summaryId={summary.id} fileId={f.id} fileName={f.file_name} />
            ))}
          </div>
        ) : null}
        <AttachPhotosForm summaryId={summary.id} />
        <p className="text-xs text-slate-400">删除照片会立即无法访问该照片，文件本身会在后台清理任务中被移除。</p>
      </div>

      {!summary.archived_at ? (
        <AddStudentsForm
          summaryId={summary.id}
          classes={allClasses}
          students={allStudents}
          existingStudentIds={existingStudentIds}
        />
      ) : null}

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">已分享给</h2>
        <TargetsPanel summaryId={summary.id} />
      </div>
    </div>
  );
}
