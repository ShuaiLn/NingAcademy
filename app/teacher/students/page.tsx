import { createClient } from "@/utils/supabase/server";
import { getLastSignInTimes } from "@/utils/supabase/admin";
import { CreateStudentForm } from "./create-student-form";
import { StudentActiveToggle } from "./student-active-toggle";
import { LastSignInBadge } from "./last-sign-in-badge";
import { StretchedRowLink } from "@/app/_components/stretched-row-link";

export default async function StudentsPage() {
  const supabase = await createClient();
  const { data: students } = await supabase
    .from("students")
    .select("id, created_at, profiles(username, full_name, is_active)")
    .order("created_at", { ascending: false });

  // Ids come from the RLS-scoped query above, so they're already proven to
  // belong to this teacher's own students before being handed to the
  // service_role lookup.
  const lastSignInMap = await getLastSignInTimes((students ?? []).map((s) => s.id));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">学生管理</h1>
      <CreateStudentForm />

      <table className="hidden w-full border-collapse text-sm sm:table">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-2">姓名</th>
            <th className="py-2">用户名</th>
            <th className="py-2">状态</th>
            <th className="py-2">最近登录</th>
            <th className="py-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {students?.map((student) => (
            <tr key={student.id} className="relative border-b border-slate-100">
              <td className="py-2">
                <StretchedRowLink
                  href={`/teacher/students/${student.id}`}
                  label={`学生：${student.profiles?.full_name}`}
                />
                <span>{student.profiles?.full_name}</span>
              </td>
              <td className="py-2 text-slate-600">{student.profiles?.username}</td>
              <td className="py-2">
                {student.profiles?.is_active ? (
                  <span className="text-green-700">启用</span>
                ) : (
                  <span className="text-slate-400">停用</span>
                )}
              </td>
              <td className="py-2">
                <LastSignInBadge lookup={lastSignInMap.get(student.id) ?? { status: "lookup_failed" }} />
              </td>
              <td className="relative z-10 py-2">
                <StudentActiveToggle
                  studentId={student.id}
                  initialActive={student.profiles?.is_active ?? false}
                />
              </td>
            </tr>
          ))}
          {!students || students.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-6 text-center text-slate-400">
                还没有学生，先在上面添加一个吧。
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="flex flex-col gap-3 sm:hidden">
        {students?.map((student) => (
          <div key={student.id} className="relative rounded-md border border-slate-200 p-4">
            <StretchedRowLink
              href={`/teacher/students/${student.id}`}
              label={`学生：${student.profiles?.full_name}`}
            />
            <p className="font-medium">{student.profiles?.full_name}</p>
            <p className="text-sm text-slate-600">{student.profiles?.username}</p>
            <p className="text-sm">
              {student.profiles?.is_active ? (
                <span className="text-green-700">启用</span>
              ) : (
                <span className="text-slate-400">停用</span>
              )}
            </p>
            <p className="text-sm">
              最近登录：<LastSignInBadge lookup={lastSignInMap.get(student.id) ?? { status: "lookup_failed" }} />
            </p>
            <div className="relative z-10 mt-2 w-fit">
              <StudentActiveToggle
                studentId={student.id}
                initialActive={student.profiles?.is_active ?? false}
              />
            </div>
          </div>
        ))}
        {!students || students.length === 0 ? (
          <p className="text-sm text-slate-400">还没有学生，先在上面添加一个吧。</p>
        ) : null}
      </div>
    </div>
  );
}
