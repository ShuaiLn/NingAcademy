import { createClient } from "@/utils/supabase/server";

// Exists only for navigator.sendBeacon(), which POSTs a fixed body/
// content-type directly to a URL and can't invoke a Next.js Server Action
// (those rely on a POST to the page URL with an action-id header).
// sendBeacon carries same-origin cookies by default, so this reuses the
// same cookie-based Supabase session as logPracticeSessionTabEvent
// (app/actions/practice.ts) -- no new auth mechanism needed.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.sessionId !== "string" || (body.eventType !== "hidden" && body.eventType !== "visible")) {
    return new Response(null, { status: 400 });
  }
  const supabase = await createClient();
  await supabase.rpc("log_practice_session_tab_event", {
    p_session_id: body.sessionId,
    p_event_type: body.eventType,
  });
  return new Response(null, { status: 204 });
}
