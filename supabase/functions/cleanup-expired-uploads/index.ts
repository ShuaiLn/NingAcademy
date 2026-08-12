// Periodic cleanup for the two-phase upload pipeline (see
// supabase/migrations/20260811120000_classes_assignments_reading.sql and
// .../20260811121500_uploads_cleanup_and_scheduling.sql). Invoked every 15
// minutes by pg_cron via pg_net (net.http_post), authenticated with the
// service_role key stored in Supabase Vault -- never committed to git.
//
// This function is the only thing in the whole system that actually removes
// bytes from the `attachments` bucket. Nothing in Postgres can: a plain
// `delete from storage.objects` only removes the metadata row and leaves the
// underlying object permanently unreachable, which is worse than doing
// nothing. Removal has to go through the Storage API's remove(), which
// requires service_role -- that's why this needs its own client instead of
// running as a database function.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const BATCH_SIZE = 100;

type CleanupCandidate = {
  intent_id: string | null;
  storage_object_key: string;
};

Deno.serve(async (_req: Request) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: candidates, error: listError } = await supabase.rpc(
    "list_expired_upload_cleanup_candidates"
  );

  if (listError) {
    return new Response(JSON.stringify({ ok: false, error: listError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rows = (candidates ?? []) as CleanupCandidate[];
  const purgedIntentIds: string[] = [];
  let removedCount = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    // The real Storage API delete -- not SQL. Missing objects are not an
    // error here (a slow first pass and a fast second pass can both pick up
    // the same still-pending intent before either one purges it).
    const { data: removed, error: removeError } = await supabase.storage
      .from("attachments")
      .remove(batch.map((row) => row.storage_object_key));

    if (removeError) {
      // A transient error on one batch should not block cleanup of the rest.
      continue;
    }

    const removedNames = new Set((removed ?? []).map((f) => f.name));
    for (const row of batch) {
      if (!removedNames.has(row.storage_object_key)) continue;
      removedCount += 1;
      // Pure orphaned storage.objects rows (no matching upload_intents row
      // at all) have no intent_id and nothing left to purge in Postgres.
      if (row.intent_id) purgedIntentIds.push(row.intent_id);
    }
  }

  if (purgedIntentIds.length > 0) {
    const { error: purgeError } = await supabase.rpc("purge_expired_upload_intents", {
      p_intent_ids: purgedIntentIds,
    });

    if (purgeError) {
      return new Response(
        JSON.stringify({ ok: false, error: purgeError.message, removedCount }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      candidates: rows.length,
      removedCount,
      purgedIntents: purgedIntentIds.length,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
});
