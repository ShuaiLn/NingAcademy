"use client";

import { useEffect, useState } from "react";
import type { LastSignInLookup } from "@/utils/supabase/last-sign-in-lookup";

// "use client" doesn't mean browser-only -- this is still SSR'd then
// hydrated, and toLocaleString() depends on the runtime's local timezone
// (server vs. viewer's browser can differ), so formatting is deferred to a
// post-mount effect to avoid a hydration mismatch.
export function LastSignInBadge({ lookup }: { lookup: LastSignInLookup }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (lookup.status === "signed_in") setLabel(new Date(lookup.at).toLocaleString("zh-CN"));
  }, [lookup]);

  if (lookup.status === "lookup_failed") return <span className="text-amber-600">登录记录读取失败</span>;
  if (lookup.status === "never_signed_in") return <span className="text-slate-400">从未登录</span>;
  return <span className="text-slate-600">{label ?? "…"}</span>;
}
