import type { ProgressSnapshot } from "@/app/_lib/local-ai/contracts";

interface Props {
  snapshot: ProgressSnapshot;
  label: string;
  retryText?: string;
  onRetry?: () => void;
  onCancel?: () => void;
}
export function ModelDownloadProgress({
  snapshot,
  label,
  retryText = "重试",
  onRetry,
  onCancel,
}: Props) {
  const determinate = snapshot.totalBytes !== undefined && snapshot.loadedBytes !== undefined;
  const percent = determinate
    ? Math.min(100, Math.round((snapshot.loadedBytes! / snapshot.totalBytes!) * 100))
    : undefined;

  return (
    <section aria-label={label} className="rounded-lg border border-slate-200 p-4">
      <p aria-live="polite" className="text-sm font-medium">
        {snapshot.message ?? phaseLabel(snapshot.phase)}
      </p>
      {determinate ? (
        <progress className="mt-2 w-full" value={percent} max={100} aria-label={label}>
          {percent}%
        </progress>
      ) : snapshot.phase !== "idle" ? (
        <div role="progressbar" aria-label={label} className="mt-2 h-2 animate-pulse rounded bg-slate-200" />
      ) : null}
      {snapshot.failure ? <p role="alert" className="mt-2 text-sm text-red-700">{snapshot.failure.message}</p> : null}
      <div className="mt-3 flex gap-2">
        {onRetry && snapshot.failure ? (
          <button type="button" onClick={onRetry} className="min-h-11 rounded border px-4 py-2">{retryText}</button>
        ) : null}
        {onCancel && (snapshot.phase === "initializing" || snapshot.phase === "running") ? (
          <button type="button" onClick={onCancel} className="min-h-11 rounded border px-4 py-2">取消</button>
        ) : null}
      </div>
    </section>
  );
}

function phaseLabel(phase: ProgressSnapshot["phase"]) {
  const labels: Record<ProgressSnapshot["phase"], string> = {
    idle: "尚未加载本地模型",
    checking: "正在检查设备",
    downloading: "正在下载本地模型",
    initializing: "正在初始化本地模型",
    ready: "本地模型已就绪",
    running: "正在本地处理",
    disposing: "正在释放本地模型",
    failed: "本地模型运行失败",
  };
  return labels[phase];
}
