import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { EditAssignmentForm } from "./edit-assignment-form";
import { AssignmentActionsPanel } from "./assignment-actions-panel";
import { AssignPanel } from "./assign-panel";
import { AttachedFilesList } from "./attached-files-list";
import { AttachFilesForm } from "./attach-files-form";
import { SubmissionsPanel } from "./submissions-panel";
import { DueDateBadge } from "@/app/_components/due-date-badge";

export default async function AssignmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: assignment } = await supabase
    .from("assignments")
    .select("id, title, description, published_at, archived_at, due_at")
    .eq("id", id)
    .maybeSingle();

  if (!assignment) {
    notFound();
  }

  const { data: files } = await supabase
    .from("assignment_files")
    .select("id, file_name, storage_object_key, size_bytes")
    .eq("assignment_id", id);

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

  const { data: targets } = await supabase
    .from("assignment_targets")
    .select("id, class_id, student_id")
    .eq("assignment_id", id)
    .is("revoked_at", null);

  const targetRows = (targets ?? []).map((t) => ({ id: t.id, classId: t.class_id, studentId: t.student_id }));

  const overdue = !!assignment.due_at && !assignment.archived_at && new Date(assignment.due_at) < new Date();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{assignment.title}</h1>
        <p className="text-sm text-slate-500">
          {assignment.archived_at ? "已归档" : assignment.published_at ? "已发布" : "草稿"}
        </p>
        {assignment.due_at ? (
          <p className="text-sm">
            <DueDateBadge dueAt={assignment.due_at} overdue={overdue} />
          </p>
        ) : null}
      </div>

      <EditAssignmentForm assignment={assignment} />

      <div className="rounded-md border border-slate-200 p-4">
        <AssignmentActionsPanel
          assignmentId={assignment.id}
          published={!!assignment.published_at}
          archived={!!assignment.archived_at}
        />
      </div>

      <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
        <h2 className="font-medium">附件</h2>
        <AttachedFilesList files={files ?? []} />
        <AttachFilesForm assignmentId={assignment.id} />
      </div>

      <AssignPanel
        assignmentId={assignment.id}
        allClasses={allClasses}
        allStudents={allStudents}
        targets={targetRows}
      />

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">学生提交</h2>
        <SubmissionsPanel assignmentId={assignment.id} />
      </div>
    </div>
  );
}
