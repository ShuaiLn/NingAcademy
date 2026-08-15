import { StretchedRowLink } from "@/app/_components/stretched-row-link";
import { DueDateBadge } from "@/app/_components/due-date-badge";
import type { DueItem, ItemType } from "./_lib/due-items";

const TYPE_LABELS: Record<ItemType, string> = {
  vocabulary: "词汇作业",
  assignment: "普通作业",
  game: "游戏作业",
  pronunciation: "朗读作业",
};

function studentLabel(ids: string[], names: Map<string, string>) {
  return ids.map((id) => names.get(id) ?? "未知学生").join("、");
}

function ReminderRows({ items, names, overdue }: { items: DueItem[]; names: Map<string, string>; overdue: boolean }) {
  if (items.length === 0) {
    return (
      <tr>
        <td colSpan={4} className="py-4 text-center text-sm text-slate-400">
          没有{overdue ? "逾期" : "即将到期"}的未完成事项。
        </td>
      </tr>
    );
  }
  return (
    <>
      {items.map((item) => (
        <tr key={`${item.type}-${item.id}`} className="relative border-b border-slate-100">
          <td className="py-2">
            <StretchedRowLink
              href={item.href}
              label={`${TYPE_LABELS[item.type]}：${item.title}，${item.incompleteStudentIds.length} 名学生未完成`}
            />
            <span>{item.title}</span>
            <span className="ml-2 text-xs text-slate-500">{TYPE_LABELS[item.type]}</span>
            {item.type === "vocabulary" ? (
              <p className="text-xs text-slate-400">完成标准：完整练习一遍且正确率≥60%</p>
            ) : null}
          </td>
          <td className="py-2">
            <DueDateBadge dueAt={item.dueAt} overdue={overdue} />
          </td>
          <td className="py-2 text-slate-600">{item.incompleteStudentIds.length} 人</td>
          <td className="py-2 text-slate-600">{studentLabel(item.incompleteStudentIds, names)}</td>
        </tr>
      ))}
    </>
  );
}

function ReminderCards({ items, names, overdue }: { items: DueItem[]; names: Map<string, string>; overdue: boolean }) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-400">没有{overdue ? "逾期" : "即将到期"}的未完成事项。</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <div key={`${item.type}-${item.id}`} className="relative rounded-md border border-slate-200 p-4">
          <StretchedRowLink
            href={item.href}
            label={`${TYPE_LABELS[item.type]}：${item.title}，${item.incompleteStudentIds.length} 名学生未完成`}
          />
          <p className="font-medium">{item.title}</p>
          <p className="text-sm text-slate-600">{TYPE_LABELS[item.type]}</p>
          <p className="text-sm">
            <DueDateBadge dueAt={item.dueAt} overdue={overdue} />
          </p>
          {item.type === "vocabulary" ? (
            <p className="text-xs text-slate-400">完成标准：完整练习一遍且正确率≥60%</p>
          ) : null}
          <p className="text-sm text-slate-600">
            {item.incompleteStudentIds.length} 人未完成：{studentLabel(item.incompleteStudentIds, names)}
          </p>
        </div>
      ))}
    </div>
  );
}

export function DueRemindersSection({
  failed,
  overdueItems,
  upcomingItems,
  studentNames,
}: {
  failed: boolean;
  overdueItems: DueItem[];
  upcomingItems: DueItem[];
  studentNames: Map<string, string>;
}) {
  if (failed) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
        截止提醒加载失败，请刷新页面重试。
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-red-700">已逾期（{overdueItems.length}）</h2>
        <table className="hidden w-full border-collapse text-sm sm:table">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2">名称</th>
              <th className="py-2">截止时间</th>
              <th className="py-2">未完成人数</th>
              <th className="py-2">未完成学生</th>
            </tr>
          </thead>
          <tbody>
            <ReminderRows items={overdueItems} names={studentNames} overdue />
          </tbody>
        </table>
        <div className="sm:hidden">
          <ReminderCards items={overdueItems} names={studentNames} overdue />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">即将到期（未来 3 天内，{upcomingItems.length}）</h2>
        <table className="hidden w-full border-collapse text-sm sm:table">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2">名称</th>
              <th className="py-2">截止时间</th>
              <th className="py-2">未完成人数</th>
              <th className="py-2">未完成学生</th>
            </tr>
          </thead>
          <tbody>
            <ReminderRows items={upcomingItems} names={studentNames} overdue={false} />
          </tbody>
        </table>
        <div className="sm:hidden">
          <ReminderCards items={upcomingItems} names={studentNames} overdue={false} />
        </div>
      </div>
    </div>
  );
}
