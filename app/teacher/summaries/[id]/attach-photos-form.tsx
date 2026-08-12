"use client";

import { useRouter } from "next/navigation";
import { FileUploader } from "@/app/_components/file-uploader";

export function AttachPhotosForm({ summaryId }: { summaryId: string }) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-2">
      <FileUploader
        purpose="lesson_summary_file"
        subjectId={summaryId}
        accept="image/jpeg,image/png,image/heic,image/heif,application/pdf"
        onUploaded={() => router.refresh()}
      />
    </div>
  );
}
