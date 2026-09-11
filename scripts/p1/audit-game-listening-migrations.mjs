#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const migrationDirectory = resolve(repoRoot, "supabase/migrations");
const retiredEvidenceDirectory = resolve(
  repoRoot,
  "supabase/drafts/retired-games-unapplied",
);
const queue = [
  ["20260822205440_allow_running_p2p_late_join_v2.sql", "892115517594d1911f0d86e0288dc1a3a16c5b62143be21fb98cd673f0e49ffb"],
  ["20260822230000_p2p_question_broker.sql", "278711a8161971a28ee84b314bc3f779a6c99452128ac1e551a7214b59af66db"],
  ["20260823120000_p2p_question_owner_privacy.sql", "3740b9301a749fec9d752ded8bb2fdcd5db42fcbeb15030866f6437e163deb5a"],
  ["20260823230000_private_listening_delivery_contract.sql", "98f6cfcdcefb5ec8120d30216190f55586983c9c3cfaf9b436a8e8bb3f40c121"],
  ["20260825200000_game_runtime_security_convergence.sql", "74112ae68ac47fec403778ad138cce975e4977a42afda953ce9e90453d0c1801"],
];

function fail(message) { throw new Error(message); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

const activeFilenames = new Set(
  readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql")),
);
const filenames = readdirSync(retiredEvidenceDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort();
for (let index = 1; index < queue.length; index += 1) {
  if (filenames.indexOf(queue[index - 1][0]) >= filenames.indexOf(queue[index][0])) {
    fail(`Listening migration queue is out of order at ${queue[index][0]}`);
  }
}

const contents = new Map();
for (const [filename, frozenHash] of queue) {
  if (activeFilenames.has(filename)) {
    fail(`${filename} was restored to the active migration queue`);
  }
  const bytes = readFileSync(resolve(retiredEvidenceDirectory, filename));
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

const migration35 = contents.get(queue[4][0]);
if (!migration35) fail("Migration 35 is missing");
for (const table of [
  "p2p_attempt_requirements",
  "p2p_question_bindings",
  "p2p_run_results",
  "listening_content_releases",
  "listening_audio_assets",
  "listening_audio_deliveries",
  "listening_audio_accesses",
]) {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  if (!new RegExp(`alter\\s+table\\s+game_private\\.${escaped}\\s+enable\\s+row\\s+level\\s+security`, "iu").test(migration35)) {
    fail(`Migration 35 does not explicitly enable RLS on game_private.${table}`);
  }
}
for (const fragment of [
  "game.poll_p2p_room_v3",
  "pg_catalog.jsonb_typeof(v_checkpoint) <> 'object'",
  "game.consume_p2p_listening_delivery_v2",
  "revoke execute on all functions in schema game, game_private",
  "game.verify_p2p_frozen_question_metadata_v1(text,uuid,uuid,text,uuid,uuid,integer)",
]) {
  if (!migration35.includes(fragment)) fail(`Migration 35 lacks required convergence fragment: ${fragment}`);
}
if (!migration35.includes("question_instances -> listening_audio_accesses -> listening_audio_deliveries")) {
  fail("Migration 35 must document and enforce the listening lock order");
}
const expectedRuntimeSignatures = [
  "game.redeem_game_launch_ticket_v1(text,uuid)",
  "game.validate_game_session_v2(text)",
  "game.create_p2p_room_v1(text,uuid,smallint,smallint,text)",
  "game.join_p2p_room_v2(text,uuid,text,smallint)",
  "game.poll_p2p_room_v3(text,uuid,bigint)",
  "game.send_p2p_signal_v1(text,uuid,uuid,uuid,integer,text,jsonb)",
  "game.set_p2p_ready_v1(text,uuid,boolean)",
  "game.start_p2p_room_v1(text,uuid)",
  "game.save_p2p_checkpoint_v1(text,uuid,integer,bigint,jsonb)",
  "game.leave_p2p_room_v1(text,uuid)",
  "game.end_p2p_room_v1(text,uuid)",
  "game.get_p2p_assignment_requirements_v2(text,uuid,uuid)",
  "game.freeze_p2p_question_v2(text,uuid,uuid,integer,uuid,text,text,integer,integer,integer)",
  "game.verify_p2p_frozen_question_metadata_v1(text,uuid,uuid,text,uuid,uuid,integer)",
  "game.authorize_p2p_listening_audio_v2(text,uuid,uuid,integer,uuid)",
  "game.consume_p2p_listening_delivery_v2(text,uuid,uuid,uuid,uuid,integer,text,text,text)",
  "game.submit_p2p_answer_v1(text,uuid,uuid,integer,text,uuid,integer,uuid,text)",
  "game.verify_p2p_answer_settlement_v1(text,uuid,uuid,text,uuid,integer,uuid,uuid)",
  "game.expire_p2p_question_v1(text,uuid,uuid,text,uuid,integer,uuid)",
  "game.record_p2p_run_result_v1(text,uuid,uuid,integer,bigint)",
  "game.finalize_p2p_attempt_v1(text,uuid,uuid,integer,uuid)",
  "game.verify_p2p_attempt_finalization_v1(text,uuid,uuid,uuid,uuid)",
];
const runtimeGrantBlock = /v_signatures\s+constant\s+text\[\]\s*:=\s*array\[([\s\S]*?)\];/iu.exec(migration35)?.[1];
if (!runtimeGrantBlock) fail("Migration 35 exact runtime grant inventory is missing");
const actualRuntimeSignatures = [...runtimeGrantBlock.matchAll(/'([^']+)'/gu)].map((match) => match[1]);
if (JSON.stringify(actualRuntimeSignatures) !== JSON.stringify(expectedRuntimeSignatures)) {
  fail("Migration 35 runtime grant inventory differs from the reviewed exact-signature allowlist");
}

const privilegeAssertion = readFileSync(
  resolve(repoRoot, "scripts/p1/assert-games-runtime-privileges.sql"),
  "utf8",
);
const assertionBlock = /v_expected\s+constant\s+text\[\]\s*:=\s*array\[([\s\S]*?)\];/iu.exec(privilegeAssertion)?.[1];
if (!assertionBlock) fail("Games runtime privilege catalog assertion is missing");
const assertionSignatures = [...assertionBlock.matchAll(/'([^']+)'/gu)]
  .map((match) => match[1])
  .sort();
if (JSON.stringify(assertionSignatures) !== JSON.stringify([...expectedRuntimeSignatures].sort())) {
  fail("Runtime privilege catalog assertion differs from migration 35's reviewed allowlist");
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
  if (inventory.includes(`,${filename},`)) {
    fail(`Retired evidence remains in the active migration inventory: ${filename}`);
  }
}

process.stdout.write(`Verified the five retired, unapplied Games migrations as byte-preserved historical evidence outside the active queue and Production-pending inventory.\n`);
