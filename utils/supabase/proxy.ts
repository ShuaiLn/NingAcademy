import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/supabase/database.types";

// Refreshes the auth session for the request/response pair. Used by the
// root proxy.ts on every non-public route. Keeping this out of the root
// file makes the cookie-forwarding plumbing reusable and testable on its
// own, separate from the route-allowlist/redirect policy.
export async function refreshSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
          Object.entries(headers).forEach(([key, value]) => {
            response.headers.set(key, value);
          });
        },
      },
    }
  );

  // Do not add logic between createServerClient and getUser(): it revalidates
  // the JWT against the Auth server and must run before anything else reads
  // or mutates the response, or session refreshes can be silently dropped.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user, supabase };
}
