#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const migrationPattern = /^(\d{14})_([^.]+)\.sql$/;

function csvCell(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function normalizeNewlines(value) {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trimEnd();
}

const tracked = execFileSync(
  "git",
  ["ls-files", "--", "supabase/migrations/*.sql"],
  { cwd: repoRoot, encoding: "utf8" },
)
  .split(/\r?\n/u)
  .filter(Boolean)
  // A deliberate migration removal/rename is visible in the working tree
  // before it is staged. Exclude index entries whose files no longer exist so
  // the inventory can be regenerated and reviewed without staging changes.
  .filter((relativePath) => existsSync(resolve(repoRoot, relativePath)))
  .sort((left, right) => left.localeCompare(right, "en"));

const trackedFilenames = new Set(
  tracked.map((relativePath) => relativePath.split("/").at(-1)),
);
const untrackedSql = readdirSync(resolve(repoRoot, "supabase/migrations"), {
  withFileTypes: true,
})
  .filter(
    (entry) =>
      entry.isFile() &&
      entry.name.endsWith(".sql") &&
      !trackedFilenames.has(entry.name),
  )
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right, "en"));

if (untrackedSql.length > 0) {
  throw new Error(
    `Untracked migration SQL must not be omitted from the audit: ${untrackedSql.join(", ")}`,
  );
}

if (tracked.length === 0) {
  throw new Error("No tracked Supabase migrations were found.");
}

const seenVersions = new Set();
const rows = tracked.map((relativePath, index) => {
  const filename = relativePath.split("/").at(-1);
  const match = migrationPattern.exec(filename ?? "");
  if (!match) {
    throw new Error(
      `Migration filename does not use <14-digit timestamp>_<name>.sql: ${relativePath}`,
    );
  }
  if (seenVersions.has(match[1])) {
    throw new Error(`Duplicate migration version: ${match[1]}`);
  }
  seenVersions.add(match[1]);

  const contents = readFileSync(resolve(repoRoot, relativePath));
  const sha256 = createHash("sha256").update(contents).digest("hex");
  return [index + 1, filename, sha256];
});

const output =
  [["execution_order", "filename", "sha256"], ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n") + "\n";

const checkIndex = process.argv.indexOf("--check");
if (checkIndex !== -1) {
  const requestedPath = process.argv[checkIndex + 1];
  if (!requestedPath) {
    throw new Error("--check requires a CSV path.");
  }
  const expectedPath = resolve(repoRoot, requestedPath);
  const expected = readFileSync(expectedPath, "utf8");
  if (normalizeNewlines(expected) !== normalizeNewlines(output)) {
    process.stderr.write(
      `${requestedPath} is stale. Run this script without --check and update the file with its stdout.\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `Verified ${rows.length} tracked migrations against ${requestedPath}.\n`,
    );
  }
} else {
  process.stdout.write(output);
}
