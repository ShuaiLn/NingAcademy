import type { AssetDescriptor, LocalModelKind } from "./contracts";
import { DICTIONARY_ASSETS } from "../ocr-import/dictionary-assets.generated";

const CACHE_SCHEMA_VERSION = 1;

export const LOCAL_AI_ASSETS: readonly AssetDescriptor[] = [
  ...DICTIONARY_ASSETS,
  asset("ocr-worker-7.0.0", "ocr", "7.0.0", "tesseract.js worker", 111_307, "576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d", "Apache-2.0", "/local-ai-assets/ocr/tesseract-7.0.0/worker.min.js"),
  asset("ocr-core-lstm-7.0.0", "ocr", "7.0.0", "tesseract.js-core", 3_896_484, "eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680", "Apache-2.0", "/local-ai-assets/ocr/tesseract-7.0.0/tesseract-core-lstm.wasm.js"),
  asset("ocr-core-relaxedsimd-lstm-7.0.0", "ocr", "7.0.0", "tesseract.js-core", 3_905_767, "861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3", "Apache-2.0", "/local-ai-assets/ocr/tesseract-7.0.0/tesseract-core-relaxedsimd-lstm.wasm.js"),
  asset("ocr-core-simd-lstm-7.0.0", "ocr", "7.0.0", "tesseract.js-core", 3_899_472, "c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38", "Apache-2.0", "/local-ai-assets/ocr/tesseract-7.0.0/tesseract-core-simd-lstm.wasm.js"),
  asset("ocr-eng-fast-4.0.0", "ocr", "4.0.0", "tessdata.projectnaptha.com", 2_952_873, "45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91", "Apache-2.0", "/local-ai-assets/ocr/tesseract-7.0.0/eng.traineddata.gz"),
  asset("ner-config-neurobert-e3a6a29", "ner", "e3a6a290e438a506d2ba7bbb0f5875b7f034cebf", "onnx-community/NeuroBERT-NER-ONNX", 2_280, "75287d17bc1b625afc686332f16aaeddaa129deb1b5fca2d128153fa4b0b17ab", "Apache-2.0", "/local-ai-assets/ner/neurobert-e3a6a29/config.json"),
  asset("ner-tokenizer-neurobert-e3a6a29", "ner", "e3a6a290e438a506d2ba7bbb0f5875b7f034cebf", "onnx-community/NeuroBERT-NER-ONNX", 711_396, "d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66", "Apache-2.0", "/local-ai-assets/ner/neurobert-e3a6a29/tokenizer.json"),
  asset("ner-tokenizer-config-neurobert-e3a6a29", "ner", "e3a6a290e438a506d2ba7bbb0f5875b7f034cebf", "onnx-community/NeuroBERT-NER-ONNX", 1_300, "e711904cac23112776b678356ccf702cf934babaa01125f698ac43bf9ad38e73", "Apache-2.0", "/local-ai-assets/ner/neurobert-e3a6a29/tokenizer_config.json"),
  asset("ner-model-neurobert-q8-e3a6a29", "ner", "e3a6a290e438a506d2ba7bbb0f5875b7f034cebf", "onnx-community/NeuroBERT-NER-ONNX", 9_659_067, "17dbf6ccfe500ee8a5da9177ebcdbb1c7394626e077e70571adebae8833c9709", "Apache-2.0", "/local-ai-assets/ner/neurobert-e3a6a29/onnx/model_quantized.onnx"),
  asset("ner-ort-loader-1.26.0-dev", "ner", "1.26.0-dev.20260416-b7804b056c", "onnxruntime-web", 47_389, "5959c6733039619c9af710d8e1bae8d6e84402787990637be987c2b1bd6c5fa9", "MIT", "/local-ai-assets/ner/ort-1.26.0-dev/ort-wasm-simd-threaded.asyncify.mjs"),
  asset("ner-ort-wasm-1.26.0-dev", "ner", "1.26.0-dev.20260416-b7804b056c", "onnxruntime-web", 23_567_050, "e0c0c6d3e73d43b8a249972f8358f845b08cc16fec3c80efafdf8bed40366786", "MIT", "/local-ai-assets/ner/ort-1.26.0-dev/ort-wasm-simd-threaded.asyncify.wasm"),
  asset("tts-kitten-nano-int8-model-84781d7", "tts", "84781d74e29ee25217551556398b42f80593a813", "KittenML/kitten-tts-nano-0.8-int8", 24_369_971, "f7b0afcbee92870b32b8e0276d855b954dc25470c9f051b376ac7eee537c76fc", "Apache-2.0", "/local-ai-assets/tts/kitten-nano-int8-84781d7/kitten_tts_nano_v0_8.onnx"),
  asset("tts-kitten-voices-84781d7", "tts", "84781d74e29ee25217551556398b42f80593a813", "KittenML/kitten-tts-nano-0.8-int8", 3_278_902, "8aa7cee235abb0739cb51e6559685f65a4dacd95568833d05699b1633f519b3f", "Apache-2.0", "/local-ai-assets/tts/kitten-nano-int8-84781d7/voices.npz"),
] as const;

function asset(
  id: string,
  kind: LocalModelKind,
  version: string,
  sourceName: string,
  bytes: number,
  sha256: string,
  license: string,
  url: string,
): AssetDescriptor {
  return {
    id,
    kind,
    version,
    source: sourceName,
    bytes,
    sha256,
    license,
    url,
    cacheSchemaVersion: CACHE_SCHEMA_VERSION,
  };
}

export function assetsFor(kind: LocalModelKind) {
  return LOCAL_AI_ASSETS.filter((assetEntry) => assetEntry.kind === kind);
}

export function requiredBytesFor(kind: LocalModelKind) {
  return assetsFor(kind).reduce((total, assetEntry) => total + assetEntry.bytes, 0);
}

export function findAsset(assetId: string) {
  return LOCAL_AI_ASSETS.find((assetEntry) => assetEntry.id === assetId);
}
