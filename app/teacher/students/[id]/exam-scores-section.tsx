import Link from "next/link";

function formatExamDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

export type ExamScoreRow = {
  id: string;
  examId: string;
  examTitle: string;
  examDate: string;
  fullMarks: number | null;
  archived: boolean;
  score: number | null;
  feedbackText: string | null;
};

export function ExamScoresSection({ failed, rows }: { failed: boolean; rows: ExamScoreRow[] }) {
  if (failed) {
    return <p className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">考试成绩加载失败。</p>;
  }
  if (rows.length === 0) {
    return <p className="text-sm text-slate-400">还没有考试成绩记录。</p>;
  }

  return (
    <>
      <table className="hidden w-full border-collapse text-sm sm:table">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-2">考试</th>
            <th className="py-2">日期</th>
            <th className="py-2">成绩</th>
            <th className="py-2">评语</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-slate-100">
              <td className="py-2">
                <Link href={`/teacher/exams/${row.examId}`} className="hover:underline">
                  {row.examTitle}
                </Link>
                {row.archived ? <span className="ml-2 text-xs text-slate-400">已归档</span> : null}
              </td>
              <td className="py-2 text-slate-600">{formatExamDate(row.examDate)}</td>
              <td className="py-2">{row.score === null ? <span className="text-slate-400">未录入</span> : `${row.score}${row.fullMarks ? ` / ${row.fullMarks}` : ""}`}</td>
              <td className="py-2 text-slate-600">{row.feedbackText || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-col gap-2 sm:hidden">
        {rows.map((row) => (
          <div key={row.id} className="rounded-md border border-slate-200 p-3">
            <Link href={`/teacher/exams/${row.examId}`} className="font-medium hover:underline">
              {row.examTitle}
            </Link>
            {row.archived ? <span className="ml-2 text-xs text-slate-400">已归档</span> : null}
            <p className="text-sm text-slate-600">{formatExamDate(row.examDate)}</p>
            <p className="text-sm">{row.score === null ? <span className="text-slate-400">未录入</span> : `成绩：${row.score}${row.fullMarks ? ` / ${row.fullMarks}` : ""}`}</p>
            {row.feedbackText ? <p className="text-sm text-slate-600">评语：{row.feedbackText}</p> : null}
          </div>
        ))}
      </div>
    </>
  );
}
