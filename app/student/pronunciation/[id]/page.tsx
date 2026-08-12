import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { StartAudioSubmissionForm } from "./start-audio-submission-form";
import { DueDateBadge } from "@/app/_components/due-date-badge";

export default async function StudentPronunciationTaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: task } = await supabase
    .from("pronunciation_tasks")
    .select("id, title, description, due_at")
    .eq("id", id)
    .maybeSingle();

  if (!task) {
    notFound();
  }

  const { data: words } = await supabase
    .from("pronunciation_task_words")
    .select("id, text_prompt")
    .eq("task_id", id)
    .is("archived_at", null)
    .order("sort_order", { ascending: true });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: draft } = user
    ? await supabase
        .from("audio_submissions")
        .select("id")
        .eq("task_id", id)
        .eq("student_id", user.id)
        .is("submitted_at", null)
        .maybeSingle()
    : { data: null };

  const { data: pastSubmissions } = user
    ? await supabase
        .from("audio_submissions")
        .select("id, attempt_no, score, feedback_text")
        .eq("task_id", id)
        .eq("student_id", user.id)
        .not("submitted_at", "is", null)
        .order("attempt_no", { ascending: false })
    : { data: [] };

  const overdue = !!task.due_at && new Date(task.due_at) < new Date();

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{task.title}</h1>
        {task.description ? <p className="text-sm text-slate-600">{task.description}</p> : null}
        {task.due_at ? (
          <p className="text-sm">
            <DueDateBadge dueAt={task.due_at} overdue={overdue} />
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-4">
        <h2 className="font-medium">跟读内容</h2>
        {!words || words.length === 0 ? (
          <p className="text-sm text-slate-400">老师还未添加内容，请稍候再来。</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {words.map((w) => (
              <li key={w.id}>{w.text_prompt}</li>
            ))}
          </ul>
        )}
      </div>

      {draft ? (
        <Link
          href={`/student/pronunciation/${id}/submissions/${draft.id}`}
          className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm text-white"
        >
          继续录音
        </Link>
      ) : (
        <StartAudioSubmissionForm taskId={id} />
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
