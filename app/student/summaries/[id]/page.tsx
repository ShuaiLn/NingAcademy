import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { PhotoGallery } from "@/app/_components/photo-gallery";

function formatSessionDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

// RLS on lesson_summaries (lesson_summaries_select_own_or_targeted) already
// gates visibility on "a lesson_summary_targets row exists for the caller"
// -- no separate authorization check needed here.
export default async function StudentSummaryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: summary } = await supabase
    .from("lesson_summaries")
    .select("id, title, content, session_date")
    .eq("id", id)
    .maybeSingle();

  if (!summary) {
    notFound();
  }

  const { data: files } = await supabase
    .from("lesson_summary_files")
    .select("id, file_name, storage_object_key, mime_type, size_bytes")
    .eq("summary_id", id);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{summary.title || "（无标题）"}</h1>
        <p className="text-sm text-slate-500">{formatSessionDate(summary.session_date)}</p>
      </div>

      <div className="rounded-md border border-slate-200 p-4">
        <p className="whitespace-pre-wrap text-sm text-slate-700">{summary.content}</p>
      </div>

      <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
        <h2 className="font-medium">照片</h2>
        <PhotoGallery files={files ?? []} />
      </div>
    </div>
  );
}
