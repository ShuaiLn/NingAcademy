import { createClient } from "@/utils/supabase/server";
import { StretchedRowLink } from "@/app/_components/stretched-row-link";
import { CreateClassForm } from "./create-class-form";

export default async function ClassesPage() {
  const supabase = await createClient();
  const { data: classes } = await supabase
    .from("classes")
    .select("id, name, archived_at, created_at")
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">班级</h1>
      <CreateClassForm />

      <table className="hidden w-full border-collapse text-sm sm:table">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-2">名称</th>
            <th className="py-2">状态</th>
            <th className="py-2">创建时间</th>
          </tr>
        </thead>
        <tbody>
          {classes?.map((c) => (
            <tr key={c.id} className="relative border-b border-slate-100">
              <td className="py-2">
                <StretchedRowLink href={`/teacher/classes/${c.id}`} label={`班级：${c.name}`} />
                <span>{c.name}</span>
              </td>
              <td className="py-2">
                {c.archived_at ? (
                  <span className="text-slate-400">已归档</span>
                ) : (
                  <span className="text-green-700">正常</span>
                )}
              </td>
              <td className="py-2 text-slate-600">{new Date(c.created_at).toLocaleDateString("zh-CN")}</td>
            </tr>
          ))}
          {!classes || classes.length === 0 ? (
            <tr>
              <td colSpan={3} className="py-6 text-center text-slate-400">
                还没有班级，先创建一个吧。
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="flex flex-col gap-3 sm:hidden">
        {classes?.map((c) => (
          <div key={c.id} className="relative rounded-md border border-slate-200 p-4">
            <StretchedRowLink href={`/teacher/classes/${c.id}`} label={`班级：${c.name}`} />
            <p className="font-medium">{c.name}</p>
            <p className="text-sm">
              {c.archived_at ? (
                <span className="text-slate-400">已归档</span>
              ) : (
                <span className="text-green-700">正常</span>
              )}
            </p>
          </div>
        ))}
        {!classes || classes.length === 0 ? (
          <p className="text-sm text-slate-400">还没有班级，先创建一个吧。</p>
        ) : null}
      </div>
    </div>
  );
}
