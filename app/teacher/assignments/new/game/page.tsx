import { createClient } from "@/utils/supabase/server";
import { listMyGameUnlockCandidates } from "@/app/_lib/game-unlock";
import { CreateGameAssignmentForm } from "./create-game-assignment-form";

export default async function NewGameAssignmentPage() {
  const supabase = await createClient();
  const [classesResult, studentsResult, sourcesResult, unlockCandidates] =
    await Promise.all([
      supabase
        .from("classes")
        .select("id, name")
        .is("archived_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("students")
        .select("id, profiles(full_name)")
        .order("created_at", { ascending: false }),
      supabase
        .from("vocabulary_sets")
        .select("id, title")
        .not("published_at", "is", null)
        .is("archived_at", null)
        .order("created_at", { ascending: false }),
      listMyGameUnlockCandidates(supabase),
    ]);

  const classes = (classesResult.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
  }));
  const students = (studentsResult.data ?? []).map((row) => ({
    id: row.id,
    fullName: row.profiles?.full_name ?? "",
  }));
  const vocabularySources = (sourcesResult.data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
  }));

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <p className="text-sm font-medium text-violet-700">NingAcademy Games</p>
        <h1 className="text-2xl font-semibold">新建游戏作业</h1>
        <p className="mt-1 text-sm text-slate-600">
          解锁要求支持普通作业、词汇和朗读；发布后仍可在详情页创建新版本。
        </p>
      </div>
      {unlockCandidates === null ? (
        <p className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          暂时无法加载解锁候选作业，请稍后重试。
        </p>
      ) : (
        <CreateGameAssignmentForm
          classes={classes}
          students={students}
          vocabularySources={vocabularySources}
          unlockCandidates={unlockCandidates}
        />
      )}
    </div>
  );
}
