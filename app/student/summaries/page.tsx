import { createClient } from "@/utils/supabase/server";
import { StretchedRowLink } from "@/app/_components/stretched-row-link";

function formatSessionDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

// RLS on lesson_summary_targets already scopes rows to "mine" -- existence
// of a target row is what makes a summary visible to this student at all.
export default async function StudentSummariesPage() {
  const supabase = await createClient();
  const { data: targets } = await supabase
    .from("lesson_summary_targets")
    .select("summary_id, lesson_summaries(id, title, content, session_date)")
    .order("created_at", { ascending: false });

  const rows = (targets ?? []).filter((t) => t.lesson_summaries);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">课后总结</h1>

      <div className="flex flex-col gap-3">
        {rows.map((t) => {
          const summary = t.lesson_summaries!;
          const label = summary.title || summary.content;
          return (
            <div key={summary.id} className="relative rounded-md border border-slate-200 p-4">
              <StretchedRowLink href={`/student/summaries/${summary.id}`} label={`课后总结：${label}`} />
              <p className="text-sm text-slate-500">{formatSessionDate(summary.session_date)}</p>
              <p className="font-medium">{summary.title || <span className="text-slate-400">（无标题）</span>}</p>
              <p className="line-clamp-2 text-sm text-slate-600">{summary.content}</p>
            </div>
          );
        })}
        {rows.length === 0 ? <p className="text-sm text-slate-400">还没有课后总结。</p> : null}
      </div>
    </div>
  );
}
