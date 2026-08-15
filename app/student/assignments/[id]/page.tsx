import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { AttachedFilesList } from "./attached-files-list";
import { StartSubmissionForm } from "./start-submission-form";
import { LaunchGameButton } from "./launch-game-button";
import { DueDateBadge } from "@/app/_components/due-date-badge";

export default async function StudentAssignmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: assignment } = await supabase
    .from("assignments")
    .select("id, title, description, due_at, assignment_kind")
    .eq("id", id)
    .maybeSingle();

  if (!assignment) {
    notFound();
  }

  const overdue = !!assignment.due_at && new Date(assignment.due_at) < new Date();

  // Game assignments never enter the plain-submission flow. In particular,
  // do not create/read submissions or render file-upload controls here.
  if (assignment.assignment_kind === "game") {
    return (
      <div className="flex max-w-2xl flex-col gap-6">
        <div>
          <p className="text-sm font-medium text-violet-700">NingAcademy 游戏作业</p>
          <h1 className="text-2xl font-semibold">{assignment.title}</h1>
          {assignment.description ? (
            <p className="text-sm text-slate-600">{assignment.description}</p>
          ) : null}
          {assignment.due_at ? (
            <p className="text-sm">
              <DueDateBadge dueAt={assignment.due_at} overdue={overdue} />
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 rounded-md border border-violet-200 bg-violet-50 p-4">
          <p className="text-sm text-slate-700">
            点击后会创建一个 60 秒内有效的一次性票据，并通过安全 POST
            进入游戏；票据不会出现在网址或浏览器历史中。
          </p>
          <LaunchGameButton assignmentId={assignment.id} />
        </div>
      </div>
    );
  }

  const { data: files } = await supabase
    .from("assignment_files")
    .select("id, file_name, storage_object_key, size_bytes")
    .eq("assignment_id", id);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: draft } = user
    ? await supabase
        .from("submissions")
        .select("id")
        .eq("assignment_id", id)
        .eq("student_id", user.id)
        .is("submitted_at", null)
        .maybeSingle()
    : { data: null };

  const { data: pastSubmissions } = user
    ? await supabase
        .from("submissions")
        .select("id, attempt_no, score, feedback_text")
        .eq("assignment_id", id)
        .eq("student_id", user.id)
        .not("submitted_at", "is", null)
        .order("attempt_no", { ascending: false })
    : { data: [] };

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{assignment.title}</h1>
        {assignment.description ? <p className="text-sm text-slate-600">{assignment.description}</p> : null}
        {assignment.due_at ? (
          <p className="text-sm">
            <DueDateBadge dueAt={assignment.due_at} overdue={overdue} />
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-4">
        <h2 className="font-medium">附件</h2>
        <AttachedFilesList files={files ?? []} />
      </div>

      {draft ? (
        <Link
          href={`/student/assignments/${id}/submissions/${draft.id}`}
          className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm text-white"
        >
          继续编辑草稿
        </Link>
      ) : (
        <StartSubmissionForm assignmentId={id} />
      )}

      {pastSubmissions && pastSubmissions.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-4">
          <h2 className="font-medium">历史提交</h2>
          {pastSubmissions.map((s) => (
            <div key={s.id} className="flex items-center justify-between text-sm">
              <span>第 {s.attempt_no} 次</span>
              <span>{s.score !== null ? `${s.score} 分` : "未批改"}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
