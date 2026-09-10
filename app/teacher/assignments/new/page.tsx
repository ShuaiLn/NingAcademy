import Link from "next/link";

export default function NewAssignmentTypePage() {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">新建作业</h1>
      <div className="flex flex-col gap-3">
        <Link
          href="/teacher/assignments/new/vocabulary"
          className="rounded-md border border-slate-200 p-4 hover:border-slate-400"
        >
          <p className="font-medium">词汇作业</p>
          <p className="text-sm text-slate-500">学生拼写练习，可选图片提示或朗读模式</p>
        </Link>
        <Link
          href="/teacher/assignments/new/plain"
          className="rounded-md border border-slate-200 p-4 hover:border-slate-400"
        >
          <p className="font-medium">普通作业</p>
          <p className="text-sm text-slate-500">附件说明，学生上传文件提交</p>
        </Link>
      </div>
    </div>
  );
}
