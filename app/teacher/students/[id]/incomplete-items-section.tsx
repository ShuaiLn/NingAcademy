import Link from "next/link";
import { DueDateBadge } from "@/app/_components/due-date-badge";
import type { DueItem, ItemType } from "@/app/teacher/_lib/due-items";

const TYPE_LABELS: Record<ItemType, string> = {
  vocabulary: "词汇作业",
  assignment: "普通作业",
  game: "游戏作业",
  pronunciation: "朗读作业",
};

export function IncompleteItemsSection({ failed, items, now }: { failed: boolean; items: DueItem[]; now: number }) {
  if (failed) {
    return <p className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">加载失败，请刷新页面重试。</p>;
  }
  if (items.length === 0) {
    return <p className="text-sm text-slate-400">没有未完成或临期的作业。</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => {
        const overdue = new Date(item.dueAt).getTime() < now;
        return (
          <div key={`${item.type}-${item.id}`} className="rounded-md border border-slate-200 p-3">
            <Link href={item.href} className="font-medium hover:underline">
              {item.title}
            </Link>
            <span className="ml-2 text-xs text-slate-500">{TYPE_LABELS[item.type]}</span>
            <p className="text-sm">
              <DueDateBadge dueAt={item.dueAt} overdue={overdue} />
            </p>
            {item.type === "vocabulary" ? (
              <p className="text-xs text-slate-400">完成标准：完整练习一遍且正确率≥60%</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
