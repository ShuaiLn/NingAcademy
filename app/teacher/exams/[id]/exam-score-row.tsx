"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { deleteExamScore, deleteExamScoreFile } from "@/app/actions/exams";
import { StretchedRowLink } from "@/app/_components/stretched-row-link";
import { FileUploader } from "@/app/_components/file-uploader";
import { ScoreGradingForm } from "./score-grading-form";

type FileRow = { id: string; file_name: string; storage_object_key: string; mime_type: string; size_bytes: number };

// StretchedRowLink + relative z-10 composition, mirroring app/teacher/
// students/page.tsx: the whole card links out to the student's own detail
// page (there is no dedicated per-score detail route -- grading happens
// inline here), and every interactive control sits in a `relative z-10`
// wrapper so it intercepts clicks ahead of the stretched anchor.
//
// `gallery` is pre-rendered server JSX (a <PhotoGallery /> instance) passed
// down from scores-panel.tsx, not imported here directly -- PhotoGallery is
// a server component (it calls createSignedUrl() via the server Supabase
// client, which depends on next/headers) and a 'use client' module can
// never import and render a server component inline; it can only receive
// one as already-rendered children/props from its server-component parent.
export function ExamScoreRow({
  examId,
  examScoreId,
  studentId,
  studentName,
  score,
  feedbackText,
  files,
  gallery,
}: {
  examId: string;
  examScoreId: string;
  studentId: string;
  studentName: string;
  score: number | null;
  feedbackText: string | null;
  files: FileRow[];
  gallery: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDeleteScore() {
    setError(null);
    startTransition(async () => {
      const result = await deleteExamScore(examId, examScoreId);
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function handleDeleteFile(fileId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteExamScoreFile(examId, fileId);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  return (
    <div className="relative flex flex-col gap-3 rounded-md border border-slate-200 p-4">
      <StretchedRowLink href={`/teacher/students/${studentId}`} label={`学生：${studentName}`} />
      <div className="flex items-center justify-between">
        <p className="font-medium">{studentName}</p>
        <p className={`text-sm ${score !== null ? "text-green-700" : "text-amber-600"}`}>
          {score !== null ? `${score} 分` : "尚未评分"}
        </p>
      </div>

      <div className="relative z-10 flex flex-col gap-3">
        <ScoreGradingForm examScoreId={examScoreId} score={score} feedbackText={feedbackText} />

        <div className="flex flex-col gap-2">
          <span className="text-sm text-slate-700">试卷照片</span>
          {gallery}
          {files.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {files.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  disabled={pending}
                  onClick={() => handleDeleteFile(f.id)}
                  className="text-xs text-red-600 hover:underline disabled:opacity-50"
                >
                  删除「{f.file_name}」
                </button>
              ))}
            </div>
          ) : null}
          <FileUploader
            purpose="exam_score_file"
            subjectId={examScoreId}
            accept="image/jpeg,image/png,image/heic,image/heif,application/pdf"
            onUploaded={() => router.refresh()}
          />
          <p className="text-xs text-slate-400">
            删除照片会立即无法访问该照片，文件本身会在后台清理任务中被移除。
          </p>
        </div>

        <button
          type="button"
          disabled={pending}
          onClick={handleDeleteScore}
          className="w-fit text-xs text-red-600 hover:underline disabled:opacity-50"
        >
          移除该学生（将删除其考试记录）
        </button>
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
      </div>
    </div>
  );
}
