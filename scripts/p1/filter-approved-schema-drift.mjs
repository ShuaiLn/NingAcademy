#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const [inputPath] = process.argv.slice(2);
if (!inputPath) {
  throw new Error(
    "Usage: node filter-approved-schema-drift.mjs <normalized-schema.sql>",
  );
}

// Every accepted application-schema difference is identified by an exact
// pg_dump object header and the SHA-256 of its complete normalized block. A
// changed body is deliberately preserved so the unresolved-drift diff fails.
// Raw dumps and raw diffs are never passed through this filter.
const approvedObjects = [
  {
    id: "IA-2",
    header:
      "-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -",
    sha256: "7934281d71e6f47c7f1fcbaaa8d6be2496b77d6f34dca21994264cdcc2b9718e",
    reason: "Supabase Dashboard automatically-enable-RLS function",
  },
  // Known gap, not yet an entry here (see docs/p1/MIGRATION_DRIFT_REPORT.md,
  // "2026-08-17 P-1 CI gate fixed"): migration 29 revoked this function's
  // default PUBLIC EXECUTE grant, so its ACL is no longer default and
  // pg_dump now emits a "Type: ACL" object block for it that did not exist
  // when IA-2 above was pinned. That block is unaccounted for and will show
  // up as unresolved ACL drift on the next real protected-audit run,
  // independent of any migration-30 mechanism. Not added here because no
  // session has captured real pg_dump output for it to hash-pin correctly.
];

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function findObjectBlock(schema, header) {
  const marker = `--\n${header}\n--\n`;
  const start = schema.indexOf(marker);
  if (start === -1) return null;
  if (schema.indexOf(marker, start + marker.length) !== -1) {
    throw new Error(`Approved schema object appears more than once: ${header}`);
  }

  const nextObject = schema.indexOf("\n--\n-- Name:", start + marker.length);
  const dumpComplete = schema.indexOf(
    "\n--\n-- PostgreSQL database dump complete",
    start + marker.length,
  );
  const candidates = [nextObject, dumpComplete].filter(
    (position) => position !== -1,
  );
  const end = candidates.length > 0 ? Math.min(...candidates) : schema.length;

  return {
    start,
    end,
    value: schema.slice(start, end).trimEnd(),
  };
}

let filtered = readFileSync(inputPath, "utf8")
  .replaceAll("\r\n", "\n")
  .replaceAll("\r", "\n")
  .trimEnd();

for (const approved of approvedObjects) {
  const block = findObjectBlock(filtered, approved.header);
  if (!block) {
    process.stderr.write(`NOT_PRESENT ${approved.id} ${approved.header}\n`);
    continue;
  }

  const observedHash = sha256(block.value);
  if (observedHash !== approved.sha256) {
    process.stderr.write(
      `UNAPPROVED_PRESERVED ${approved.id} expected=${approved.sha256} observed=${observedHash} ${approved.header}\n`,
    );
    continue;
  }

  filtered = `${filtered.slice(0, block.start)}${filtered.slice(block.end)}`
    .replace(/\n{3,}/gu, "\n\n")
    .trimEnd();
  process.stderr.write(
    `APPROVED_REMOVED ${approved.id} sha256=${observedHash} reason=${approved.reason}\n`,
  );
}

process.stdout.write(`${filtered}\n`);
