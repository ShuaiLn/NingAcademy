import Link from "next/link";
import { DueDateBadge } from "@/app/_components/due-date-badge";
import type { WorkStatRow, WorkStatus } from "./work-stats-section";

export type VocabStatRow = {
  setId: string;
  title: string;
  started: number;
  completed: number;
  correct: number;
  total: number;
};

const STATUS_CLASSES: Record<WorkStatus, string> = {
  未提交: "text-slate-400",
  草稿中: "text-amber-600",
  已提交待批改: "text-amber-600",
  已批改: "text-green-700",
};

type MergedRow =
  | {
      kind: "vocabulary";
      key: string;
      title: string;
      href: string;
      progress: string;
      scoreOrAccuracy: string;
    }
  | {
      kind: "pronunciation";
      key: string;
      title: string;
      href: string;
      archived: boolean;
      dueAt: string | null;
      status: WorkStatus;
      scoreOrAccuracy: string;
    };

// 词汇作业统计 and 朗读作业统计 share one section/table (merged per teacher
// request -- both read as "读/练习类" homework from the student's
// perspective) even though they stay separate systems at the data layer
// (see AGENTS.md's "Vocabulary vs. pronunciation"). vocabFailed/
// pronunciationFailed stay independent so one query failing doesn't hide
// the other's rows. 开始次数/完整完成次数/正确率 definitions for
// vocabulary rows match app/teacher/vocabulary/[id]/page.tsx exactly.
export function VocabularyStatsSection({
  vocabFailed,
  pronunciationFailed,
  vocabRows,
  pronunciationRows,
  now,
}: {
  vocabFailed: boolean;
  pronunciationFailed: boolean;
  vocabRows: VocabStatRow[];
  pronunciationRows: WorkStatRow[];
  now: number;
}) {
  const rows: MergedRow[] = [
    ...vocabRows.map((row): MergedRow => ({
      kind: "vocabulary",
      key: `vocabulary-${row.setId}`,
      title: row.title || "（未命名）",
      href: `/teacher/vocabulary/${row.setId}`,
      progress: `开始 ${row.started} 次 · 完成 ${row.completed} 次`,
      scoreOrAccuracy: row.total === 0 ? "—" : `${Math.round((row.correct / row.total) * 100)}%`,
    })),
    ...pronunciationRows.map((row): MergedRow => ({
      kind: "pronunciation",
      key: `pronunciation-${row.id}`,
      title: row.title,
      href: `/teacher/pronunciation/${row.id}`,
      archived: row.archived,
      dueAt: row.dueAt,
      status: row.status,
      scoreOrAccuracy: row.score !== null ? `${row.score} 分` : "—",
    })),
  ];

  return (
    <div className="flex flex-col gap-3">
      {vocabFailed ? <p className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">词汇作业统计加载失败。</p> : null}
      {pronunciationFailed ? <p className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">朗读作业统计加载失败。</p> : null}
      {rows.length === 0 ? (
        vocabFailed || pronunciationFailed ? null : (
          <p className="text-sm text-slate-400">还没有分配任何词汇或朗读作业。</p>
        )
      ) : (
        <>
          <table className="hidden w-full border-collapse text-sm sm:table">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-2">作业</th>
                <th className="py-2">类型</th>
                <th className="py-2">截止时间</th>
                <th className="py-2">进度/状态</th>
                <th className="py-2">正确率/分数</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const overdue = row.kind === "pronunciation" && !!row.dueAt && !row.archived && new Date(row.dueAt).getTime() < now;
                return (
                  <tr key={row.key} className="border-b border-slate-100">
                    <td className="py-2">
                      <Link href={row.href} className="hover:underline">
                        {row.title}
                      </Link>
                      {row.kind === "pronunciation" && row.archived ? <span className="ml-2 text-xs text-slate-400">已归档</span> : null}
                    </td>
                    <td className="py-2 text-slate-600">{row.kind === "vocabulary" ? "词汇作业" : "朗读作业"}</td>
                    <td className="py-2">
                      {row.kind === "pronunciation" && row.dueAt ? <DueDateBadge dueAt={row.dueAt} overdue={overdue} /> : <span className="text-slate-400">—</span>}
                    </td>
                    <td className={`py-2 ${row.kind === "pronunciation" ? STATUS_CLASSES[row.status] : ""}`}>
                      {row.kind === "vocabulary" ? row.progress : row.status}
                    </td>
                    <td className="py-2">{row.scoreOrAccuracy}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex flex-col gap-2 sm:hidden">
            {rows.map((row) => {
              const overdue = row.kind === "pronunciation" && !!row.dueAt && !row.archived && new Date(row.dueAt).getTime() < now;
              return (
                <div key={row.key} className="rounded-md border border-slate-200 p-3">
                  <Link href={row.href} className="font-medium hover:underline">
                    {row.title}
                  </Link>
                  <span className="ml-2 text-xs text-slate-500">{row.kind === "vocabulary" ? "词汇作业" : "朗读作业"}</span>
                  {row.kind === "pronunciation" && row.archived ? <span className="ml-2 text-xs text-slate-400">已归档</span> : null}
                  {row.kind === "pronunciation" && row.dueAt ? (
                    <p className="text-sm">
                      <DueDateBadge dueAt={row.dueAt} overdue={overdue} />
                    </p>
                  ) : null}
                  <p className={`text-sm ${row.kind === "pronunciation" ? STATUS_CLASSES[row.status] : "text-slate-600"}`}>
                    {row.kind === "vocabulary" ? row.progress : row.status} · {row.scoreOrAccuracy}
                  </p>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
