import { OcrImportClient } from "./ocr-import-client";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PERSONAL_WORD_OCR_ENABLED } from "@/app/_lib/ocr-import/feature";
export const metadata: Metadata = { title: "拍照导入生词 · NingAcademy", robots: { index: false, follow: false } };
export default function OcrImportPage() {
  if (!PERSONAL_WORD_OCR_ENABLED) notFound();
  return <div className="mx-auto w-full max-w-3xl"><OcrImportClient /></div>;
}
