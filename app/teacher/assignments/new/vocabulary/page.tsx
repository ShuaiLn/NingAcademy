import { createClient } from "@/utils/supabase/server";
import { CreateVocabularyAssignmentForm } from "./create-vocabulary-assignment-form";

// Fetches students only -- vocabulary targeting is student-only, no classes
// (see target-picker.tsx). Each creation route fetches exactly the data its
// own form needs.
export default async function NewVocabularyAssignmentPage() {
  const supabase = await createClient();
  const { data: students } = await supabase
    .from("students")
    .select("id, profiles(full_name)")
    .order("created_at", { ascending: false });

  const studentOptions = (students ?? []).map((s) => ({ id: s.id, fullName: s.profiles?.full_name ?? "" }));

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">新建词汇作业</h1>
      <CreateVocabularyAssignmentForm students={studentOptions} />
    </div>
  );
}
