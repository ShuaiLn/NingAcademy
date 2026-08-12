import { createClient } from "@/utils/supabase/server";
import { StretchedRowLink } from "@/app/_components/stretched-row-link";

// exam_date is a plain date string -- see app/teacher/exams/page.tsx's
// formatExamDate comment.
function formatExamDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

// RLS on exam_scores already scopes rows to "mine" -- existence of a row is
// what makes an exam visible to this student at all (no separate
// published/assigned gate, see the exams migration header).
export default async function StudentExamsPage() {
  const supabase = await createClient();
  const { data: scores } = await supabase
    .from("exam_scores")
    .select("id, score, exams(id, title, exam_date, full_marks)")
    .order("created_at", { ascending: false });

  const rows = (scores ?? []).filter((s) => s.exams);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">考试成绩</h1>

      <table className="hidden w-full border-collapse text-sm sm:table">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-2">名称</th>
            <th className="py-2">日期</th>
            <th className="py-2">成绩</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const exam = s.exams!;
            return (
              <tr key={s.id} className="relative border-b border-slate-100">
                <td className="py-2">
                  <StretchedRowLink href={`/student/exams/${exam.id}`} label={`考试：${exam.title}`} />
                  <span>{exam.title}</span>
                </td>
                <td className="py-2 text-slate-600">{formatExamDate(exam.exam_date)}</td>
                <td className="py-2">
                  {s.score !== null ? (
                    <span className="text-green-700">
                      {s.score}
                      {exam.full_marks ? ` / ${exam.full_marks}` : ""}
                    </span>
                  ) : (
                    <span className="text-amber-600">尚未评分</span>
                  )}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="py-6 text-center text-slate-400">
                还没有考试成绩。
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="flex flex-col gap-3 sm:hidden">
        {rows.map((s) => {
          const exam = s.exams!;
          return (
            <div key={s.id} className="relative rounded-md border border-slate-200 p-4">
              <StretchedRowLink href={`/student/exams/${exam.id}`} label={`考试：${exam.title}`} />
              <p className="font-medium">{exam.title}</p>
              <p className="text-sm text-slate-600">{formatExamDate(exam.exam_date)}</p>
              <p className="text-sm">
                {s.score !== null ? (
                  <span className="text-green-700">
                    {s.score}
                    {exam.full_marks ? ` / ${exam.full_marks}` : ""}
                  </span>
                ) : (
                  <span className="text-amber-600">尚未评分</span>
                )}
              </p>
            </div>
          );
        })}
        {rows.length === 0 ? <p className="text-sm text-slate-400">还没有考试成绩。</p> : null}
      </div>
    </div>
  );
}
