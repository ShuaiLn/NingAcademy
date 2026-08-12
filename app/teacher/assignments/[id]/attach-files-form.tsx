"use client";

import { useRouter } from "next/navigation";
import { FileUploader } from "@/app/_components/file-uploader";

export function AttachFilesForm({ assignmentId }: { assignmentId: string }) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-2">
      <FileUploader
        purpose="assignment_file"
        subjectId={assignmentId}
        accept="image/jpeg,image/png,application/pdf,audio/mpeg,audio/mp4,audio/webm"
        onUploaded={() => router.refresh()}
      />
    </div>
  );
}
