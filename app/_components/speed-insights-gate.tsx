"use client";
import { usePathname } from "next/navigation";
import { SpeedInsights } from "@vercel/speed-insights/next";
// The installed SDK injects a persistent script and has no effect cleanup. Its
// unmount cannot prove silence after an instrumented -> OCR client transition.
// P2-OBS fallback: disabled globally until a separately reviewed SDK can do so.
export const SPEED_INSIGHTS_ENABLED = false;
export function isOcrImportPath(pathname: string | null) {
  return pathname === "/student/personal-english/import" || pathname?.startsWith("/student/personal-english/import/") === true;
}
export function SpeedInsightsGate() {
  const pathname = usePathname();
  if (!SPEED_INSIGHTS_ENABLED || !pathname || isOcrImportPath(pathname)) return null;
  return <SpeedInsights />;
}
