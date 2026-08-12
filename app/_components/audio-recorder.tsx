"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { uploadAttachment } from "./file-uploader";

// Feature-detects MediaRecorder + webm support; when unsupported (or mic
// permission denied), falls back to a plain file-picker accepting the same
// audio MIME whitelist finalize_upload() enforces server-side for
// audio_submission_file. The DB/upload pipeline is identical either way --
// the fallback isn't a parallel system, just this component minus the
// record button.
const AUDIO_ACCEPT = "audio/mpeg,audio/mp4,audio/webm";

function recorderSupported() {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    MediaRecorder.isTypeSupported("audio/webm")
  );
}

export function AudioRecorder({
  audioSubmissionId,
  taskWordId,
  onUploaded,
}: {
  audioSubmissionId: string;
  taskWordId?: string;
  onUploaded: (fileId: string) => void;
}) {
  const [supported] = useState(recorderSupported);
  const [recording, setRecording] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!blob) {
      setAudioUrl(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        setBlob(new Blob(chunksRef.current, { type: "audio/webm" }));
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      setError("无法访问麦克风，请检查权限设置，或改用文件上传");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  function upload(file: File) {
    setError(null);
    startTransition(async () => {
      // begin_upload()'s audio_submission_file branch requires p_subject_id
      // to be the audio_submissions row's own id (the in-progress draft),
      // not the parent pronunciation_tasks id -- see its ownership check.
      const result = await uploadAttachment(file, "audio_submission_file", audioSubmissionId, taskWordId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onUploaded(result.fileId);
      setBlob(null);
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  if (!supported) {
    return (
      <div className="flex flex-col gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={AUDIO_ACCEPT}
          disabled={pending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
          }}
          className="text-sm"
        />
        <p className="text-xs text-slate-500">当前浏览器不支持录音，请上传音频文件。</p>
        {pending ? <p className="text-xs text-slate-500">上传中…</p> : null}
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {blob ? (
        <div className="flex flex-col gap-2">
          {audioUrl ? <audio controls src={audioUrl} /> : null}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => upload(new File([blob], "recording.webm", { type: "audio/webm" }))}
              className="rounded-md bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              {pending ? "上传中…" : "上传录音"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setBlob(null)}
              className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:border-slate-400 disabled:opacity-50"
            >
              重新录制
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={recording ? stopRecording : startRecording}
          className={`w-fit rounded-md px-4 py-2 text-sm text-white ${recording ? "bg-red-600" : "bg-slate-900"}`}
        >
          {recording ? "■ 停止录音" : "● 开始录音"}
        </button>
      )}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
