import { createClient } from "@/utils/supabase/server";
import { CreateSummaryForm } from "./create-summary-form";

export default async function NewSummaryPage() {
  const supabase = await createClient();
  const { data: classes } = await supabase
    .from("classes")
    .select("id, name")
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  const { data: students } = await supabase
    .from("students")
    .select("id, profiles(full_name)")
    .order("created_at", { ascending: false });

  const classOptions = (classes ?? []).map((c) => ({ id: c.id, name: c.name }));
  const studentOptions = (students ?? []).map((s) => ({ id: s.id, fullName: s.profiles?.full_name ?? "" }));

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">新建课后总结</h1>
      <CreateSummaryForm classes={classOptions} students={studentOptions} />
    </div>
  );
}
