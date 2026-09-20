import { spawnSync } from "node:child_process";

const environment = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:4320",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-local-test-key",
  NEXT_PUBLIC_PERSONAL_WORD_OCR_ENABLED: "true",
  NEXT_TELEMETRY_DISABLED: "1",
};

const result = spawnSync(
  process.execPath,
  ["node_modules/next/dist/bin/next", "build"],
  { cwd: process.cwd(), env: environment, stdio: "inherit", windowsHide: true },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
