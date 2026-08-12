import Link from "next/link";

export type FeedKind =
  | "vocab_done"
  | "assignment_submitted"
  | "pronunciation_submitted"
  | "assignment_graded"
  | "pronunciation_graded"
  | "exam_graded"
  | "summary_shared";

export type FeedRow = {
  kind: FeedKind;
  occurredAt: string;
  studentId: string;
  studentName: string;
  itemTitle: string;
  itemHref: string;
  detail?: string;
};

const KIND_LABELS: Record<FeedKind, string> = {
  vocab_done: "完成了词汇作业",
  assignment_submitted: "提交了普通作业",
  pronunciation_submitted: "提交了朗读作业",
  assignment_graded: "普通作业获得批改",
  pronunciation_graded: "朗读作业获得批改",
  exam_graded: "考试成绩已录入",
  summary_shared: "收到课堂总结",
};

// A "recent state" view, not an audit log -- graded_at/score can be edited
// after the fact, so this shows current values sorted by last-touch time,
// not a historical trail of every past edit.
export function RecentActivityFeed({ rows, partialFailure }: { rows: FeedRow[]; partialFailure: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-400">
        显示各项最新状态，非完整历史记录。{partialFailure ? "（部分数据加载失败）" : ""}
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">还没有活动记录。</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <li key={`${row.kind}-${row.studentId}-${row.itemHref}-${i}`} className="rounded-md border border-slate-200 p-3 text-sm">
              <Link href={`/teacher/students/${row.studentId}`} className="font-medium hover:underline">
                {row.studentName || "未知学生"}
              </Link>
              <span className="text-slate-600"> {KIND_LABELS[row.kind]}</span>
              {row.detail ? <span className="text-slate-500">（{row.detail}）</span> : null}
              <span className="text-slate-600">：</span>
              <Link href={row.itemHref} className="text-slate-700 hover:underline">
                {row.itemTitle}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
