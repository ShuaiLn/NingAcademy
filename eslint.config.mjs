import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Async Server Components intentionally compute request-time deadlines,
    // while a few hydration-only client labels synchronize browser locale.
    // These React Compiler heuristics cannot distinguish those boundaries.
    rules: {
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { paths: [
        { name: "@huggingface/transformers", message: "NeuroBERT may run only in the dedicated NER Worker." },
        { name: "tesseract.js", message: "Tesseract may be imported only by the dedicated OCR runtime." },
      ] }],
    },
  },
  {
    files: [
      "app/_lib/local-ai/workers/ner.worker.ts",
      "app/_lib/local-ai/models/ocr-runtime.ts",
    ],
    rules: { "no-restricted-imports": "off" },
  },
  globalIgnores([
    ".next/**",
    ".next-phase2-browser/**",
    "test-results/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/local-ai-assets/**",
  ]),
]);
