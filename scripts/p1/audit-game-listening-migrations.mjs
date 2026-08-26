#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const migrationDirectory = resolve(repoRoot, "supabase/migrations");
const queue = [
  ["20260822205440_allow_running_p2p_late_join_v2.sql", "892115517594d1911f0d86e0288dc1a3a16c5b62143be21fb98cd673f0e49ffb"],
  ["20260822230000_p2p_question_broker.sql", "278711a8161971a28ee84b314bc3f779a6c99452128ac1e551a7214b59af66db"],
  ["20260823120000_p2p_question_owner_privacy.sql", "3740b9301a749fec9d752ded8bb2fdcd5db42fcbeb15030866f6437e163deb5a"],
  ["20260823230000_private_listening_delivery_contract.sql", null],
];

function fail(message) { throw new Error(message); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

const filenames = readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql")).sort();
for (let index = 1; index < queue.length; index += 1) {
  if (filenames.indexOf(queue[index - 1][0]) >= filenames.indexOf(queue[index][0])) {
    fail(`Listening migration queue is out of order at ${queue[index][0]}`);
  }
}

const contents = new Map();
for (const [filename, frozenHash] of queue) {
  const bytes = readFileSync(resolve(migrationDirectory, filename));
  const actualHash = sha256(bytes);
  contents.set(filename, bytes.toString("utf8"));
  if (frozenHash !== null && actualHash !== frozenHash) {
    fail(`${filename} was silently rewritten: ${actualHash}`);
  }
}

const migration34 = contents.get(queue[3][0]);
if (!migration34) fail("Migration 34 is missing");
if (/create\s+or\s+replace\s+function/iu.test(migration34)) {
  fail("Migration 34 must use new sibling functions rather than replacing history");
}

for (const match of migration34.matchAll(/create\s+function\s+([^\s(]+)[\s\S]*?\n\$\$;/giu)) {
  const block = match[0];
  if (/security\s+definer/iu.test(block) && !/set\s+search_path\s*=\s*''/iu.test(block)) {
    fail(`SECURITY DEFINER function lacks empty search_path: ${match[1]}`);
  }
}

const requiredFragments = [
  "game.consume_p2p_listening_delivery_v1",
  "game.authorize_p2p_listening_audio_v2",
  "game.freeze_p2p_question_v2",
  "game.get_p2p_assignment_requirements_v2",
  "public.create_and_publish_game_assignment_v3",
  "public.set_game_assignment_accommodation_v2",
  "pg_catalog.unnest(v_item.accepted_terms)",
  "from public, anon, authenticated, service_role, game_server, games_api",
];
for (const fragment of requiredFragments) {
  if (!migration34.includes(fragment)) fail(`Migration 34 lacks required fragment: ${fragment}`);
}
if (/grant\s+execute[\s\S]{0,180}consume_p2p_listening_delivery_v1[\s\S]{0,80}authenticated/iu.test(migration34)) {
  fail("Worker-only listening resolution was granted to authenticated");
}
if (/grant\s+(?:select|insert|update|delete|all)[\s\S]{0,160}game_private\.[\s\S]{0,80}authenticated/iu.test(migration34)) {
  fail("Migration 34 directly grants a game_private table to authenticated");
}
if (/pg_catalog\.unnest\(v_question\.correct_answers\)\s+answer/iu.test(migration34)) {
  fail("Text-alternative safety must compare its clue with accepted spellings, not the v1 seed answer direction");
}

const migration33 = contents.get(queue[2][0]);
if (!migration33?.includes("verify_p2p_frozen_question_v1")
    || !migration33.includes("verify_p2p_frozen_question_metadata_v1")) {
  fail("Migration 33 owner-only prompt revocation/metadata sibling is missing");
}

const approvedPending = readFileSync(
  resolve(repoRoot, "scripts/p1/approved-pending-migrations.mjs"),
  "utf8",
);
for (const [filename] of queue) {
  if (approvedPending.includes(filename)) {
    fail(`${filename} must not enter approved-pending before protected audit and approval`);
  }
}

const inventory = readFileSync(resolve(repoRoot, "docs/p1/git_migrations.csv"), "utf8");
for (const [filename] of queue) {
  const actualHash = sha256(readFileSync(resolve(migrationDirectory, filename)));
  if (!inventory.includes(`,${filename},${actualHash}`)) {
    fail(`Migration inventory is missing the exact hash for ${filename}`);
  }
}

process.stdout.write(`Verified migrations 31-34 ordering, frozen hashes, SECURITY DEFINER search paths, private grants, and fail-closed approval inventory.\n`);
