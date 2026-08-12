import { createClient } from "@/utils/supabase/server";
import { StretchedRowLink } from "@/app/_components/stretched-row-link";
import { DueDateBadge } from "@/app/_components/due-date-badge";

type AssignmentType = "vocabulary" | "assignment" | "pronunciation";

const TYPE_LABELS: Record<AssignmentType, string> = {
  vocabulary: "词汇作业",
  assignment: "普通作业",
  pronunciation: "朗读作业",
};

type HubRow = {
  id: string;
  title: string;
  type: AssignmentType;
  dueAt: string | null;
  createdAt: string;
  href: string;
};

// Same merge-3-queries-in-JS shape as app/teacher/assignments/page.tsx, but
// querying each *_targets table (matching how student/vocabulary/page.tsx
// already queries vocabulary_targets) -- RLS on assignment_targets/
// pronunciation_targets/vocabulary_targets already scopes rows to "mine or
// reachable via an enrolled class" with no extra client-side filter needed.
// Vocabulary rows link to /student/vocabulary/[id] (not the generic list)
// so "click the row -> land on that specific assignment" holds uniformly.
export default async function StudentAssignmentsHubPage() {
  const supabase = await createClient();

  const { data: vocabTargets } = await supabase
    .from("vocabulary_targets")
    .select("set_id, vocabulary_sets(id, title, due_at, created_at)")
    .is("revoked_at", null);

  const { data: assignmentTargets } = await supabase
    .from("assignment_targets")
    .select("assignment_id, assignments(id, title, due_at, created_at)")
    .is("revoked_at", null);

  const { data: pronunciationTargets } = await supabase
    .from("pronunciation_targets")
    .select("task_id, pronunciation_tasks(id, title, due_at, created_at)")
    .is("revoked_at", null);

  const rowsById = new Map<string, HubRow>();

  for (const t of vocabTargets ?? []) {
    const s = t.vocabulary_sets;
    if (!s) continue;
    rowsById.set(`vocabulary-${s.id}`, {
      id: s.id,
      title: s.title,
      type: "vocabulary",
      dueAt: s.due_at,
      createdAt: s.created_at,
      href: `/student/vocabulary/${s.id}`,
    });
  }
  for (const t of assignmentTargets ?? []) {
    const a = t.assignments;
    if (!a) continue;
    rowsById.set(`assignment-${a.id}`, {
      id: a.id,
      title: a.title,
      type: "assignment",
      dueAt: a.due_at,
      createdAt: a.created_at,
      href: `/student/assignments/${a.id}`,
    });
  }
  for (const t of pronunciationTargets ?? []) {
    const p = t.pronunciation_tasks;
    if (!p) continue;
    rowsById.set(`pronunciation-${p.id}`, {
      id: p.id,
      title: p.title,
      type: "pronunciation",
      dueAt: p.due_at,
      createdAt: p.created_at,
      href: `/student/pronunciation/${p.id}`,
    });
  }

  const rows = Array.from(rowsById.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const now = Date.now();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">作业</h1>

      <table className="hidden w-full border-collapse text-sm sm:table">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-2">名称</th>
            <th className="py-2">类型</th>
            <th className="py-2">截止时间</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const overdue = !!row.dueAt && new Date(row.dueAt).getTime() < now;
            return (
              <tr
                key={`${row.type}-${row.id}`}
                className={`relative border-b border-slate-100 ${overdue ? "bg-red-50" : ""}`}
              >
                <td className="py-2">
                  <StretchedRowLink href={row.href} label={`作业：${row.title}，${TYPE_LABELS[row.type]}`} />
                  <span>{row.title}</span>
                </td>
                <td className="py-2 text-slate-600">{TYPE_LABELS[row.type]}</td>
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
              <td colSpan={3} className="py-6 text-center text-slate-400">
                还没有老师布置的作业。
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="flex flex-col gap-3 sm:hidden">
        {rows.map((row) => {
          const overdue = !!row.dueAt && new Date(row.dueAt).getTime() < now;
          return (
            <div
              key={`${row.type}-${row.id}`}
              className={`relative rounded-md border p-4 ${overdue ? "border-red-300 bg-red-50" : "border-slate-200"}`}
            >
              <StretchedRowLink href={row.href} label={`作业：${row.title}，${TYPE_LABELS[row.type]}`} />
              <p className="font-medium">{row.title}</p>
              <p className="text-sm text-slate-600">{TYPE_LABELS[row.type]}</p>
              {row.dueAt ? (
                <p className="text-sm">
                  <DueDateBadge dueAt={row.dueAt} overdue={overdue} />
                </p>
              ) : null}
            </div>
          );
        })}
        {rows.length === 0 ? <p className="text-sm text-slate-400">还没有老师布置的作业。</p> : null}
      </div>
    </div>
  );
}
