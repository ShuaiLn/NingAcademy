#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { basename } from "node:path";

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

const [gitPath, databasePath, label = "database"] = process.argv.slice(2);
if (!gitPath || !databasePath) {
  throw new Error(
    "Usage: node compare-migration-history.mjs <git_migrations.csv> <db_migrations.csv> [label]",
  );
}

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
const hasDrift = gitOnly.length > 0 || databaseOnly.length > 0 || nameMismatches.length > 0;

const lines = [
  `# Git vs ${label} migration history`,
  "",
  `- Git inventory: ${gitRows.length}`,
  `- ${label} inventory: ${databaseRows.length}`,
  `- Result: ${hasDrift ? "DRIFT" : "MATCH"}`,
  "",
  "## Git only",
  "",
  ...(gitOnly.length ? gitOnly.map((row) => `- \`${row.filename}\``) : ["- None."]),
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
