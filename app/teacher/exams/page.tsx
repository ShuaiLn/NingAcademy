import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { StretchedRowLink } from "@/app/_components/stretched-row-link";

// exam_date is a plain date string ("2026-08-11") -- new Date(dateStr) parses
// a date-only ISO string as UTC midnight, which renders as the *previous*
// day in any timezone behind UTC. A plain string-split avoids that entirely
// (see the migration/plan's note on why a date column plus string
// formatting is genuinely simpler than a due-date-badge-style component
// here: there is no instant to get wrong, only a string to reformat).
function formatExamDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

export default async function ExamsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const { archived } = await searchParams;
  const showArchived = archived === "1";
  const supabase = await createClient();

  const baseQuery = supabase
    .from("exams")
    .select("id, title, exam_date, full_marks, archived_at")
    .order("exam_date", { ascending: false });
  const { data: exams } = await (showArchived
    ? baseQuery.not("archived_at", "is", null)
    : baseQuery.is("archived_at", null));

  const examIds = (exams ?? []).map((e) => e.id);
  const { data: scores } =
    examIds.length > 0
      ? await supabase.from("exam_scores").select("exam_id, score").in("exam_id", examIds)
      : { data: [] as { exam_id: string; score: number | null }[] };

  const statsByExam = new Map<string, { total: number; graded: number }>();
  for (const s of scores ?? []) {
    const entry = statsByExam.get(s.exam_id) ?? { total: 0, graded: 0 };
    entry.total += 1;
    if (s.score !== null) entry.graded += 1;
    statsByExam.set(s.exam_id, entry);
  }

  const emptyMessage = showArchived ? "没有已归档的考试。" : "还没有考试，先创建一个吧。";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">考试成绩</h1>
        <Link href="/teacher/exams/new" className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white">
          新建考试
        </Link>
      </div>

      <Link
        href={showArchived ? "/teacher/exams" : "/teacher/exams?archived=1"}
        className="w-fit text-sm text-slate-500 hover:text-slate-700 hover:underline"
      >
        {showArchived ? "查看进行中的考试" : "查看已归档的考试"}
      </Link>

      <table className="hidden w-full border-collapse text-sm sm:table">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-2">名称</th>
            <th className="py-2">日期</th>
            <th className="py-2">满分</th>
            <th className="py-2">批改进度</th>
          </tr>
        </thead>
        <tbody>
          {(exams ?? []).map((e) => {
            const stat = statsByExam.get(e.id) ?? { total: 0, graded: 0 };
            return (
              <tr key={e.id} className="relative border-b border-slate-100">
                <td className="py-2">
                  <StretchedRowLink href={`/teacher/exams/${e.id}`} label={`考试：${e.title}`} />
                  <span>{e.title}</span>
                </td>
                <td className="py-2 text-slate-600">{formatExamDate(e.exam_date)}</td>
                <td className="py-2 text-slate-600">{e.full_marks ?? "—"}</td>
                <td className="py-2 text-slate-600">
                  {stat.graded} / {stat.total}
                </td>
              </tr>
            );
          })}
          {!exams || exams.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-6 text-center text-slate-400">
                {emptyMessage}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="flex flex-col gap-3 sm:hidden">
        {(exams ?? []).map((e) => {
          const stat = statsByExam.get(e.id) ?? { total: 0, graded: 0 };
          return (
            <div key={e.id} className="relative rounded-md border border-slate-200 p-4">
              <StretchedRowLink href={`/teacher/exams/${e.id}`} label={`考试：${e.title}`} />
              <p className="font-medium">{e.title}</p>
              <p className="text-sm text-slate-600">{formatExamDate(e.exam_date)}</p>
              <p className="text-sm text-slate-600">
                批改进度 {stat.graded} / {stat.total}
              </p>
            </div>
          );
        })}
        {!exams || exams.length === 0 ? <p className="text-sm text-slate-400">{emptyMessage}</p> : null}
      </div>
    </div>
  );
}
