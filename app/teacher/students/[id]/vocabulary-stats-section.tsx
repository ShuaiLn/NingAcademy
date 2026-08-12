import Link from "next/link";

export type VocabStatRow = {
  setId: string;
  title: string;
  started: number;
  completed: number;
  correct: number;
  total: number;
};

// 开始次数/完整完成次数/正确率 definitions match
// app/teacher/vocabulary/[id]/page.tsx exactly -- see AGENTS.md's
// "Student-stats definitions" section.
export function VocabularyStatsSection({ failed, rows }: { failed: boolean; rows: VocabStatRow[] }) {
  if (failed) {
    return <p className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">词汇作业统计加载失败。</p>;
  }
  if (rows.length === 0) {
    return <p className="text-sm text-slate-400">还没有分配任何词汇作业。</p>;
  }

  return (
    <>
      <table className="hidden w-full border-collapse text-sm sm:table">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-2">作业</th>
            <th className="py-2">开始次数</th>
            <th className="py-2">完整完成次数</th>
            <th className="py-2">正确率</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const accuracy = row.total === 0 ? "—" : `${Math.round((row.correct / row.total) * 100)}%`;
            return (
              <tr key={row.setId} className="border-b border-slate-100">
                <td className="py-2">
                  <Link href={`/teacher/vocabulary/${row.setId}`} className="hover:underline">
                    {row.title || "（未命名）"}
                  </Link>
                </td>
                <td className="py-2">{row.started}</td>
                <td className="py-2">{row.completed}</td>
                <td className="py-2">{accuracy}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-col gap-2 sm:hidden">
        {rows.map((row) => {
          const accuracy = row.total === 0 ? "—" : `${Math.round((row.correct / row.total) * 100)}%`;
          return (
            <div key={row.setId} className="rounded-md border border-slate-200 p-3">
              <Link href={`/teacher/vocabulary/${row.setId}`} className="font-medium hover:underline">
                {row.title || "（未命名）"}
              </Link>
              <p className="text-sm text-slate-600">
                开始 {row.started} 次 · 完成 {row.completed} 次 · 正确率 {accuracy}
              </p>
            </div>
          );
        })}
      </div>
    </>
  );
}
