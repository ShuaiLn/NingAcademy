import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { getNextDueItem } from "./_lib/next-due-item";
import { DueDateBadge } from "@/app/_components/due-date-badge";

const TYPE_LABELS = {
  vocabulary: "词汇作业",
  assignment: "作业",
  game: "游戏作业",
  pronunciation: "朗读作业",
} as const;

export default async function StudentHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle()
    : { data: null };

  const dueResult = user ? await getNextDueItem(supabase, user.id) : { ok: true as const, item: null };
  const nextDue = dueResult.ok ? dueResult.item : null;
  const now = Date.now();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">欢迎，{profile?.full_name ?? ""}</h1>

      {!dueResult.ok ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">到期提醒加载失败，请稍后刷新重试。</p>
      ) : nextDue ? (
        <Link
          href={nextDue.href}
          className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-5 shadow-sm hover:border-slate-400"
        >
          <span className="text-xs font-medium text-slate-400">最近待完成</span>
          <span className="text-lg font-semibold">{nextDue.title}</span>
          <span className="text-sm text-slate-500">{TYPE_LABELS[nextDue.type]}</span>
          <DueDateBadge dueAt={nextDue.dueAt} overdue={new Date(nextDue.dueAt).getTime() < now} />
        </Link>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
          目前没有待完成的到期事项，做得很棒！
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link
          href="/student/assignments"
          className="flex flex-col gap-1 rounded-md border border-slate-200 p-4 hover:border-slate-400"
        >
          <p className="text-sm text-slate-500">查看老师布置的所有内容</p>
          <p className="text-lg font-medium">作业</p>
        </Link>
        <Link
          href="/student/exams"
          className="flex flex-col gap-1 rounded-md border border-slate-200 p-4 hover:border-slate-400"
        >
          <p className="text-sm text-slate-500">查看考试成绩与老师评语</p>
          <p className="text-lg font-medium">考试</p>
        </Link>
        <Link
          href="/student/summaries"
          className="flex flex-col gap-1 rounded-md border border-slate-200 p-4 hover:border-slate-400"
        >
          <p className="text-sm text-slate-500">查看老师的课后总结</p>
          <p className="text-lg font-medium">总结</p>
        </Link>
      </div>
    </div>
  );
}
