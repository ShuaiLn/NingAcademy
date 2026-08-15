import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { StretchedRowLink } from "@/app/_components/stretched-row-link";
import { DueDateBadge } from "@/app/_components/due-date-badge";

type AssignmentType = "vocabulary" | "assignment" | "game" | "pronunciation";

const TYPE_LABELS: Record<AssignmentType, string> = {
  vocabulary: "词汇作业",
  assignment: "普通作业",
  game: "游戏作业",
  pronunciation: "朗读作业",
};

function statusLabel(row: { published_at: string | null; archived_at: string | null }) {
  if (row.archived_at) return { text: "已归档", className: "text-slate-400" };
  if (row.published_at) return { text: "已发布", className: "text-green-700" };
  return { text: "草稿", className: "text-amber-600" };
}

type HubRow = {
  id: string;
  title: string;
  type: AssignmentType;
  publishedAt: string | null;
  archivedAt: string | null;
  dueAt: string | null;
  createdAt: string;
  needsContent: boolean;
  href: string;
};

// Aggregating list only -- rows link out to each type's own native detail
// route (/teacher/vocabulary/[id], /teacher/assignments/[id],
// /teacher/pronunciation/[id]), not a unified sub-route, since vocabulary
// and pronunciation detail pages predate this hub and already own their
// routes.
export default async function AssignmentsHubPage() {
  const supabase = await createClient();

  const { data: sets } = await supabase
    .from("vocabulary_sets")
    .select("id, title, published_at, archived_at, due_at, created_at")
    .order("created_at", { ascending: false });
  const { data: assignments } = await supabase
    .from("assignments")
    .select("id, title, published_at, archived_at, due_at, created_at, assignment_kind")
    .order("created_at", { ascending: false });
  const { data: tasks } = await supabase
    .from("pronunciation_tasks")
    .select("id, title, published_at, archived_at, due_at, created_at")
    .order("created_at", { ascending: false });

  // "已发布但暂无内容" nudge: not derivable from the parent-table selects
  // above, needs its own query. RLS already scopes both to the teacher's
  // own rows via the existing teacher-ALL policies, so no new permission.
  const publishedSetIds = (sets ?? []).filter((s) => s.published_at).map((s) => s.id);
  const publishedTaskIds = (tasks ?? []).filter((t) => t.published_at).map((t) => t.id);

  const { data: activeWords } =
    publishedSetIds.length > 0
      ? await supabase.from("vocabulary_words").select("set_id").is("archived_at", null).in("set_id", publishedSetIds)
      : { data: [] as { set_id: string }[] };
  const { data: activePrompts } =
    publishedTaskIds.length > 0
      ? await supabase
          .from("pronunciation_task_words")
          .select("task_id")
          .is("archived_at", null)
          .in("task_id", publishedTaskIds)
      : { data: [] as { task_id: string }[] };

  const setsWithContent = new Set((activeWords ?? []).map((w) => w.set_id));
  const tasksWithContent = new Set((activePrompts ?? []).map((p) => p.task_id));

  const rows: HubRow[] = [
    ...(sets ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      type: "vocabulary" as const,
      publishedAt: s.published_at,
      archivedAt: s.archived_at,
      dueAt: s.due_at,
      createdAt: s.created_at,
      needsContent: !!s.published_at && !setsWithContent.has(s.id),
      href: `/teacher/vocabulary/${s.id}`,
    })),
    ...(assignments ?? []).map((a) => ({
      id: a.id,
      title: a.title,
      type: a.assignment_kind === "game" ? "game" as const : "assignment" as const,
      publishedAt: a.published_at,
      archivedAt: a.archived_at,
      dueAt: a.due_at,
      createdAt: a.created_at,
      needsContent: false,
      href: `/teacher/assignments/${a.id}`,
    })),
    ...(tasks ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      type: "pronunciation" as const,
      publishedAt: t.published_at,
      archivedAt: t.archived_at,
      dueAt: t.due_at,
      createdAt: t.created_at,
      needsContent: !!t.published_at && !tasksWithContent.has(t.id),
      href: `/teacher/pronunciation/${t.id}`,
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const now = Date.now();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">作业</h1>
        <Link href="/teacher/assignments/new" className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white">
          新建作业
        </Link>
      </div>

      <table className="hidden w-full border-collapse text-sm sm:table">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-2">名称</th>
            <th className="py-2">类型</th>
            <th className="py-2">状态</th>
            <th className="py-2">截止时间</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const status = statusLabel({ published_at: row.publishedAt, archived_at: row.archivedAt });
            const overdue = !!row.dueAt && !row.archivedAt && new Date(row.dueAt).getTime() < now;
            return (
              <tr key={`${row.type}-${row.id}`} className="relative border-b border-slate-100">
                <td className="py-2">
                  <StretchedRowLink
                    href={row.href}
                    label={`作业：${row.title}，${TYPE_LABELS[row.type]}，${status.text}`}
                  />
                  <span>{row.title}</span>
                  {row.needsContent ? <span className="ml-2 text-xs text-amber-600">已发布但暂无内容</span> : null}
                </td>
                <td className="py-2 text-slate-600">{TYPE_LABELS[row.type]}</td>
                <td className={`py-2 ${status.className}`}>{status.text}</td>
                <td className="py-2">
                  {row.dueAt ? (
                    <DueDateBadge dueAt={row.dueAt} overdue={overdue} />
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-6 text-center text-slate-400">
                还没有作业，先创建一个吧。
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="flex flex-col gap-3 sm:hidden">
        {rows.map((row) => {
          const status = statusLabel({ published_at: row.publishedAt, archived_at: row.archivedAt });
          const overdue = !!row.dueAt && !row.archivedAt && new Date(row.dueAt).getTime() < now;
          return (
            <div key={`${row.type}-${row.id}`} className="relative rounded-md border border-slate-200 p-4">
              <StretchedRowLink href={row.href} label={`作业：${row.title}，${TYPE_LABELS[row.type]}，${status.text}`} />
              <p className="font-medium">{row.title}</p>
              <p className="text-sm text-slate-600">{TYPE_LABELS[row.type]}</p>
              <p className={`text-sm ${status.className}`}>{status.text}</p>
              {row.dueAt ? (
                <p className="text-sm">
                  <DueDateBadge dueAt={row.dueAt} overdue={overdue} />
                </p>
              ) : null}
              {row.needsContent ? <p className="text-xs text-amber-600">已发布但暂无内容</p> : null}
            </div>
          );
        })}
        {rows.length === 0 ? <p className="text-sm text-slate-400">还没有作业，先创建一个吧。</p> : null}
      </div>
    </div>
  );
}
