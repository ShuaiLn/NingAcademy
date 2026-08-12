import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { StretchedRowLink } from "@/app/_components/stretched-row-link";

// session_date is a plain date string -- see app/teacher/exams/page.tsx's
// formatExamDate comment for why this must stay a string split, never
// `new Date(dateStr)`.
function formatSessionDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

export default async function SummariesPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const { archived } = await searchParams;
  const showArchived = archived === "1";
  const supabase = await createClient();

  const baseQuery = supabase
    .from("lesson_summaries")
    .select("id, title, content, session_date, archived_at")
    .order("session_date", { ascending: false });
  const { data: summaries } = await (showArchived
    ? baseQuery.not("archived_at", "is", null)
    : baseQuery.is("archived_at", null));

  const emptyMessage = showArchived ? "没有已归档的总结。" : "还没有课后总结，先创建一个吧。";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">课后总结</h1>
        <Link href="/teacher/summaries/new" className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white">
          新建总结
        </Link>
      </div>

      <Link
        href={showArchived ? "/teacher/summaries" : "/teacher/summaries?archived=1"}
        className="w-fit text-sm text-slate-500 hover:text-slate-700 hover:underline"
      >
        {showArchived ? "查看进行中的总结" : "查看已归档的总结"}
      </Link>

      <div className="flex flex-col gap-3">
        {(summaries ?? []).map((s) => {
          const label = s.title || s.content;
          return (
            <div key={s.id} className="relative rounded-md border border-slate-200 p-4">
              <StretchedRowLink href={`/teacher/summaries/${s.id}`} label={`课后总结：${label}`} />
              <p className="text-sm text-slate-500">{formatSessionDate(s.session_date)}</p>
              <p className="font-medium">{s.title || <span className="text-slate-400">（无标题）</span>}</p>
              <p className="line-clamp-2 text-sm text-slate-600">{s.content}</p>
            </div>
          );
        })}
        {!summaries || summaries.length === 0 ? <p className="text-sm text-slate-400">{emptyMessage}</p> : null}
      </div>
    </div>
  );
}
