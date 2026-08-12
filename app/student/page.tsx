import Link from "next/link";
import { createClient } from "@/utils/supabase/server";

export default async function StudentHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle()
    : { data: null };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">欢迎，{profile?.full_name ?? ""}</h1>
      <Link
        href="/student/assignments"
        className="w-fit rounded-md border border-slate-200 px-4 py-3 hover:border-slate-400"
      >
        <p className="text-sm text-slate-500">查看老师布置的所有内容</p>
        <p className="text-lg font-medium">进入作业</p>
      </Link>
    </div>
  );
}
