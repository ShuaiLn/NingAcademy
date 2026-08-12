import Link from "next/link";
import { DueDateBadge } from "@/app/_components/due-date-badge";

export type WorkStatus = "未提交" | "草稿中" | "已提交待批改" | "已批改";

export type WorkStatRow = {
  id: string;
  title: string;
  dueAt: string | null;
  archived: boolean;
  status: WorkStatus;
  score: number | null;
  feedbackText: string | null;
};

const STATUS_CLASSES: Record<WorkStatus, string> = {
  未提交: "text-slate-400",
  草稿中: "text-amber-600",
  已提交待批改: "text-amber-600",
  已批改: "text-green-700",
};

// Shared shape for 普通作业统计 and 朗读作业统计 -- both are
// title/due-date/archived + latest-attempt status/score/feedback, differing
// only in which route their rows link out to.
export function WorkStatsSection({
  failed,
  rows,
  emptyLabel,
  hrefPrefix,
  now,
}: {
  failed: boolean;
  rows: WorkStatRow[];
  emptyLabel: string;
  hrefPrefix: string;
  now: number;
}) {
  if (failed) {
    return <p className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">加载失败，请刷新页面重试。</p>;
  }
  if (rows.length === 0) {
    return <p className="text-sm text-slate-400">{emptyLabel}</p>;
  }

  return (
    <>
      <table className="hidden w-full border-collapse text-sm sm:table">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-2">作业</th>
            <th className="py-2">截止时间</th>
            <th className="py-2">状态</th>
            <th className="py-2">分数</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const overdue = !!row.dueAt && !row.archived && new Date(row.dueAt).getTime() < now;
            return (
              <tr key={row.id} className="border-b border-slate-100">
                <td className="py-2">
                  <Link href={`${hrefPrefix}/${row.id}`} className="hover:underline">
                    {row.title}
                  </Link>
                  {row.archived ? <span className="ml-2 text-xs text-slate-400">已归档</span> : null}
                </td>
                <td className="py-2">{row.dueAt ? <DueDateBadge dueAt={row.dueAt} overdue={overdue} /> : <span className="text-slate-400">—</span>}</td>
                <td className={`py-2 ${STATUS_CLASSES[row.status]}`}>{row.status}</td>
                <td className="py-2">{row.score ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-col gap-2 sm:hidden">
        {rows.map((row) => {
          const overdue = !!row.dueAt && !row.archived && new Date(row.dueAt).getTime() < now;
          return (
            <div key={row.id} className="rounded-md border border-slate-200 p-3">
              <Link href={`${hrefPrefix}/${row.id}`} className="font-medium hover:underline">
                {row.title}
              </Link>
              {row.archived ? <span className="ml-2 text-xs text-slate-400">已归档</span> : null}
              {row.dueAt ? (
                <p className="text-sm">
                  <DueDateBadge dueAt={row.dueAt} overdue={overdue} />
                </p>
              ) : null}
              <p className={`text-sm ${STATUS_CLASSES[row.status]}`}>
                {row.status}
                {row.score !== null ? ` · ${row.score} 分` : ""}
              </p>
            </div>
          );
        })}
      </div>
    </>
  );
}
