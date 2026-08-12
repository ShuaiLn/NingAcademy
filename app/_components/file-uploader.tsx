"use client";

import { useRef, useState, useTransition } from "react";
import { createClient } from "@/utils/supabase/client";
import { beginUpload, finalizeUpload, cancelUpload, type UploadPurpose } from "@/app/actions/uploads";

export type UploadAttachmentResult = { ok: true; fileId: string } | { ok: false; error: string };

// Shared by FileUploader below and audio-recorder.tsx: mints an
// upload_intent via beginUpload(), then uploads directly to Supabase
// Storage using the browser client -- bypassing the 1MB Next.js Server
// Action body cap -- and finalizes. See app/actions/uploads.ts and the
// classes_assignments_reading migration header for the full two-phase flow
// and its known limitations.
export async function uploadAttachment(
  file: File,
  purpose: UploadPurpose,
  subjectId: string,
  taskWordId?: string
): Promise<UploadAttachmentResult> {
  const begin = await beginUpload(purpose, subjectId, file.name, file.type, file.size, taskWordId);
  if (!begin.ok) {
    return { ok: false, error: begin.error };
  }

  const supabase = createClient();
  const { data: signed, error: signError } = await supabase.storage
    .from("attachments")
    .createSignedUploadUrl(begin.storageObjectKey);

  if (signError || !signed) {
    await cancelUpload(begin.intentId);
    return { ok: false, error: "上传失败，请稍后重试" };
  }

  const { error: uploadError } = await supabase.storage
    .from("attachments")
    .uploadToSignedUrl(signed.path, signed.token, file);

  if (uploadError) {
    await cancelUpload(begin.intentId);
    return { ok: false, error: "上传失败，请稍后重试" };
  }

  const finalize = await finalizeUpload(purpose, begin.intentId);
  if (!finalize.ok) {
    return { ok: false, error: finalize.error };
  }

  return { ok: true, fileId: finalize.fileId };
}

export function FileUploader({
  purpose,
  subjectId,
  taskWordId,
  accept,
  maxSizeBytes = 200 * 1024 * 1024,
  onUploaded,
}: {
  purpose: UploadPurpose;
  subjectId: string;
  taskWordId?: string;
  accept?: string;
  maxSizeBytes?: number;
  onUploaded: (fileId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleFile(file: File) {
    if (file.size > maxSizeBytes) {
      setError("文件过大");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await uploadAttachment(file, purpose, subjectId, taskWordId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onUploaded(result.fileId);
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={pending}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
        className="text-sm"
      />
      {pending ? <p className="text-xs text-slate-500">上传中…</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
