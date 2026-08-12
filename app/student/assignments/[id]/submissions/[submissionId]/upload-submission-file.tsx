"use client";

import { useRouter } from "next/navigation";
import { FileUploader } from "@/app/_components/file-uploader";

export function UploadSubmissionFile({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  return (
    <FileUploader
      purpose="submission_file"
      subjectId={submissionId}
      accept="image/jpeg,image/png,application/pdf,audio/mpeg,audio/mp4,audio/webm"
      onUploaded={() => router.refresh()}
    />
  );
}
