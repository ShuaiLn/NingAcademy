import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { RenameForm } from "./rename-form";
import { ArchiveButton } from "./archive-button";
import { RosterPanel } from "./roster-panel";

export default async function ClassDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: klass } = await supabase.from("classes").select("id, name, archived_at").eq("id", id).maybeSingle();

  if (!klass) {
    notFound();
  }

  const { data: students } = await supabase
    .from("students")
    .select("id, profiles(full_name)")
    .order("created_at", { ascending: false });

  const allStudents = (students ?? []).map((s) => ({ id: s.id, fullName: s.profiles?.full_name ?? "" }));

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("student_id")
    .eq("class_id", id)
    .is("unenrolled_at", null);

  const enrolledStudentIds = (enrollments ?? []).map((e) => e.student_id);

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{klass.name}</h1>
        <p className="text-sm text-slate-500">{klass.archived_at ? "已归档" : "正常"}</p>
      </div>

      <RenameForm classId={klass.id} currentName={klass.name} />

      <div className="rounded-md border border-slate-200 p-4">
        <ArchiveButton classId={klass.id} archived={!!klass.archived_at} />
      </div>

      <RosterPanel classId={klass.id} allStudents={allStudents} enrolledStudentIds={enrolledStudentIds} />
    </div>
  );
}
