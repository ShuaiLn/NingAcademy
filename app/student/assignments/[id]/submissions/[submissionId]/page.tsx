import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { AttachedFilesList } from "../../attached-files-list";
import { UploadSubmissionFile } from "./upload-submission-file";
import { FinishSubmissionButton } from "./finish-submission-button";

export default async function SubmissionDraftPage({
  params,
}: {
  params: Promise<{ id: string; submissionId: string }>;
}) {
  const { id, submissionId } = await params;
  const supabase = await createClient();

  const { data: submission } = await supabase
    .from("submissions")
    .select("id, note, submitted_at, assignment_id")
    .eq("id", submissionId)
    .maybeSingle();

  if (!submission || submission.assignment_id !== id) {
    notFound();
  }

  const { data: files } = await supabase
    .from("submission_files")
    .select("id, file_name, storage_object_key, size_bytes")
    .eq("submission_id", submissionId);

  if (submission.submitted_at) {
    return (
      <div className="flex max-w-xl flex-col gap-4">
        <h1 className="text-2xl font-semibold">提交详情</h1>
        <p className="text-sm text-slate-500">已提交</p>
        {submission.note ? <p className="text-sm text-slate-600">{submission.note}</p> : null}
        <AttachedFilesList files={files ?? []} />
      </div>
    );
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">编辑提交</h1>
      {submission.note ? <p className="text-sm text-slate-600">备注：{submission.note}</p> : null}
      <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-4">
        <h2 className="font-medium">已上传文件</h2>
        <AttachedFilesList files={files ?? []} />
        <UploadSubmissionFile submissionId={submissionId} />
      </div>
      <FinishSubmissionButton submissionId={submissionId} assignmentId={id} />
    </div>
  );
}
