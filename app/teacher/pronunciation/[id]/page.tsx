import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { EditTaskForm } from "./edit-task-form";
import { TaskActionsPanel } from "./task-actions-panel";
import { PromptRow } from "./prompt-row";
import { AddPromptsForm } from "./add-prompts-form";
import { AssignPanel } from "./assign-panel";
import { SubmissionsPanel } from "./submissions-panel";
import { DueDateBadge } from "@/app/_components/due-date-badge";

export default async function PronunciationTaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: task } = await supabase
    .from("pronunciation_tasks")
    .select("id, title, description, published_at, archived_at, due_at")
    .eq("id", id)
    .maybeSingle();

  if (!task) {
    notFound();
  }

  const { data: words } = await supabase
    .from("pronunciation_task_words")
    .select("id, text_prompt, archived_at")
    .eq("task_id", id)
    .order("sort_order", { ascending: true });

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
    .from("pronunciation_targets")
    .select("id, class_id, student_id")
    .eq("task_id", id)
    .is("revoked_at", null);

  const targetRows = (targets ?? []).map((t) => ({ id: t.id, classId: t.class_id, studentId: t.student_id }));

  const overdue = !!task.due_at && !task.archived_at && new Date(task.due_at) < new Date();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{task.title}</h1>
        <p className="text-sm text-slate-500">
          {task.archived_at ? "已归档" : task.published_at ? "已发布" : "草稿"}
        </p>
        {task.due_at ? (
          <p className="text-sm">
            <DueDateBadge dueAt={task.due_at} overdue={overdue} />
          </p>
        ) : null}
      </div>

      <EditTaskForm task={task} />

      <div className="rounded-md border border-slate-200 p-4">
        <TaskActionsPanel taskId={task.id} published={!!task.published_at} archived={!!task.archived_at} />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">跟读内容</h2>
        <table className="w-full border-collapse text-sm">
          <tbody>
            {words?.map((word) => <PromptRow key={word.id} taskId={task.id} word={word} />)}
            {!words || words.length === 0 ? (
              <tr>
                <td className="py-6 text-center text-slate-400">还没有跟读内容。</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <AddPromptsForm taskId={task.id} />
      </div>

      <AssignPanel taskId={task.id} allClasses={allClasses} allStudents={allStudents} targets={targetRows} />

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">学生提交</h2>
        <SubmissionsPanel taskId={task.id} />
      </div>
    </div>
  );
}
