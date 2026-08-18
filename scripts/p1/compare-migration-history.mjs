#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { approvedPendingMigrations } from "./approved-pending-migrations.mjs";

function parseCsv(contents) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index];
    if (quoted) {
      if (character === '"' && contents[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/u, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error("Unterminated quoted CSV cell.");
  if (cell !== "" || row.length > 0) {
    row.push(cell.replace(/\r$/u, ""));
    rows.push(row);
  }
  if (rows.length === 0) throw new Error("CSV is empty.");

  const headers = rows[0];
  return rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
}

function canonicalName(value, version) {
  return value
    .replace(/\.sql$/u, "")
    .replace(new RegExp(`^${version}_`, "u"), "");
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((value) => value.startsWith("--")));
const [gitPath, databasePath, label = "database"] = args.filter(
  (value) => !value.startsWith("--"),
);
if (!gitPath || !databasePath) {
  throw new Error(
    "Usage: node compare-migration-history.mjs <git_migrations.csv> <db_migrations.csv> [label] [--allow-declared-pending]",
  );
}
const allowDeclaredPending = flags.has("--allow-declared-pending");

const gitRows = parseCsv(readFileSync(gitPath, "utf8")).map((row) => {
  const match = /^(\d{14})_(.+)\.sql$/u.exec(row.filename);
  if (!match) throw new Error(`Invalid Git migration filename: ${row.filename}`);
  return { version: match[1], name: match[2], filename: row.filename };
});

const databaseRows = parseCsv(readFileSync(databasePath, "utf8")).map((row) => ({
  version: String(row.version ?? "").trim(),
  name: String(row.name ?? "").trim(),
}));

const gitByVersion = new Map(gitRows.map((row) => [row.version, row]));
const databaseByVersion = new Map(databaseRows.map((row) => [row.version, row]));
const gitOnly = gitRows.filter((row) => !databaseByVersion.has(row.version));
const databaseOnly = databaseRows.filter((row) => !gitByVersion.has(row.version));
const nameMismatches = databaseRows.flatMap((databaseRow) => {
  const gitRow = gitByVersion.get(databaseRow.version);
  if (!gitRow || !databaseRow.name) return [];
  return canonicalName(databaseRow.name, databaseRow.version) === gitRow.name
    ? []
    : [{ version: databaseRow.version, gitName: gitRow.name, databaseName: databaseRow.name }];
});

// databaseOnly and nameMismatches are never exempted by declared-pending
// status: an extra migration the database has that Git doesn't, or a
// version whose recorded name doesn't match Git's, is always drift.
// --allow-declared-pending only ever narrows gitOnly (versions Git has that
// the database doesn't), and only when every check below fails to find a
// problem with the exemption itself.
const pendingIssues = [];
let unexplainedGitOnly = gitOnly;

if (allowDeclaredPending) {
  const seenDeclaredVersions = new Set();
  for (const approved of approvedPendingMigrations) {
    if (seenDeclaredVersions.has(approved.version)) {
      pendingIssues.push(
        `approved-pending-migrations.mjs lists version ${approved.version} more than once.`,
      );
    }
    seenDeclaredVersions.add(approved.version);

    const gitRow = gitByVersion.get(approved.version);
    if (!gitRow) {
      pendingIssues.push(
        `Declared pending version ${approved.version} is not present in Git history at all.`,
      );
    } else if (gitRow.filename !== approved.filename) {
      pendingIssues.push(
        `Declared pending version ${approved.version}: Git has \`${gitRow.filename}\`, approved-pending-migrations.mjs expects \`${approved.filename}\`.`,
      );
    }

    if (databaseByVersion.has(approved.version)) {
      pendingIssues.push(
        `Declared pending version ${approved.version} is already present in ${label} -- remove it from approved-pending-migrations.mjs.`,
      );
    }
  }

  const declaredVersions = new Set(approvedPendingMigrations.map((row) => row.version));
  const actualPendingVersions = new Set(gitOnly.map((row) => row.version));

  for (const version of actualPendingVersions) {
    if (!declaredVersions.has(version)) {
      pendingIssues.push(
        `${label} is missing Git migration ${version}, which is not declared in approved-pending-migrations.mjs.`,
      );
    }
  }

  // Exact-trailing-suffix requirement: the pending versions must be
  // precisely the highest-versioned tail of Git's history, never a gap in
  // the middle. Only meaningful once the checks above already agree on
  // exactly which versions are pending.
  if (pendingIssues.length === 0) {
    const gitSorted = [...gitRows].sort((left, right) =>
      left.version.localeCompare(right.version),
    );
    const tailVersions = new Set(
      gitSorted
        .slice(gitSorted.length - actualPendingVersions.size)
        .map((row) => row.version),
    );
    const isExactTrailingSuffix =
      tailVersions.size === actualPendingVersions.size &&
      [...actualPendingVersions].every((version) => tailVersions.has(version));
    if (!isExactTrailingSuffix) {
      pendingIssues.push(
        `${label}'s missing migrations are not an exact trailing suffix of Git's version-ordered history -- an earlier migration may be missing from the middle.`,
      );
    }
  }

  if (pendingIssues.length === 0) {
    unexplainedGitOnly = gitOnly.filter((row) => !declaredVersions.has(row.version));
  }
}

const hasDrift =
  unexplainedGitOnly.length > 0 ||
  databaseOnly.length > 0 ||
  nameMismatches.length > 0 ||
  pendingIssues.length > 0;

const pendingSection = allowDeclaredPending
  ? [
      "",
      "## Approved pending (declared in approved-pending-migrations.mjs; requires explicit owner authorization before execution)",
      "",
      ...(approvedPendingMigrations.length
        ? approvedPendingMigrations.map(
            (row) => `- \`${row.filename}\` (${row.version}): ${row.reason}`,
          )
        : ["- None declared."]),
      "",
      "## Pending-approval issues (fail-closed)",
      "",
      ...(pendingIssues.length ? pendingIssues.map((issue) => `- ${issue}`) : ["- None."]),
    ]
  : [];

const lines = [
  `# Git vs ${label} migration history`,
  "",
  `- Git inventory: ${gitRows.length}`,
  `- ${label} inventory: ${databaseRows.length}`,
  `- Pending-approval mode: ${allowDeclaredPending ? "enabled" : "disabled"}`,
  `- Result: ${hasDrift ? "DRIFT" : "MATCH"}`,
  "",
  "## Git only",
  "",
  ...(gitOnly.length ? gitOnly.map((row) => `- \`${row.filename}\``) : ["- None."]),
  ...pendingSection,
  "",
  `## ${label} only`,
  "",
  ...(databaseOnly.length
    ? databaseOnly.map((row) => `- \`${row.version}${row.name ? `_${row.name}` : ""}\``)
    : ["- None."]),
  "",
  "## Same version, different name",
  "",
  ...(nameMismatches.length
    ? nameMismatches.map(
        (row) => `- \`${row.version}\`: Git \`${row.gitName}\`; ${label} \`${row.databaseName}\`.`,
      )
    : ["- None."]),
  "",
  `Source files: \`${basename(gitPath)}\`, \`${basename(databasePath)}\`.`,
  "",
];

process.stdout.write(lines.join("\n"));
if (hasDrift) process.exitCode = 1;
