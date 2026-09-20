import { notFound } from "next/navigation";
import { DiagnosticsClient } from "./diagnostics-client";

export default function LocalRuntimeDiagnosticsPage() {
  if (process.env.LOCAL_AI_DIAGNOSTICS_ENABLED !== "true") notFound();
  return <DiagnosticsClient />;
}

