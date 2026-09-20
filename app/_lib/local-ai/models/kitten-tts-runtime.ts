import { WorkerManagedModel } from "./worker-model";
import { createBrowserModelCache } from "../model-cache";
import type { ModelProgressUpdate } from "../contracts";

export class KittenTtsRuntime extends WorkerManagedModel {
  readonly kind = "tts" as const;

  async initialize(signal: AbortSignal, reportProgress?: (update: ModelProgressUpdate) => void) {
    const cache = createBrowserModelCache();
    try {
      await cache.ensureModel(this.kind, {
        signal,
        onProgress: (loadedBytes, totalBytes, assetId) => reportProgress?.({
          phase: "downloading", loadedBytes, totalBytes, message: `正在准备 TTS 资源：${assetId}`,
        }),
      });
      reportProgress?.({ phase: "initializing", message: "正在初始化 KittenTTS Worker" });
      await super.initialize(signal, reportProgress);
    } catch (error) {
      if (!signal.aborted) await cache.clearModel(this.kind);
      throw error;
    }
  }

  protected createWorker() {
    return new Worker(new URL("../workers/kitten-tts.worker.ts", import.meta.url), {
      type: "module",
      name: "ning-local-kitten-tts",
    });
  }
}
