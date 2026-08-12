import Link from "next/link";

function formatSessionDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

export type SummaryRow = {
  id: string;
  title: string | null;
  sessionDate: string;
  archived: boolean;
  excerpt: string;
};

export function RecentSummariesSection({ failed, rows }: { failed: boolean; rows: SummaryRow[] }) {
  if (failed) {
    return <p className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">课堂总结加载失败。</p>;
  }
  if (rows.length === 0) {
    return <p className="text-sm text-slate-400">还没有分享过课堂总结。</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <div key={row.id} className="rounded-md border border-slate-200 p-3">
          <Link href={`/teacher/summaries/${row.id}`} className="font-medium hover:underline">
            {row.title || "（无标题）"}
          </Link>
          {row.archived ? <span className="ml-2 text-xs text-slate-400">已归档</span> : null}
          <p className="text-sm text-slate-500">{formatSessionDate(row.sessionDate)}</p>
          {row.excerpt ? <p className="text-sm text-slate-600">{row.excerpt}</p> : null}
        </div>
      ))}
    </div>
  );
}
