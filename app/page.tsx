import { redirect } from "next/navigation";

// proxy.ts redirects "/" to /login or /teacher|/student before this ever
// renders; this is just a safety net for the rare case it doesn't run.
export default function RootPage() {
  redirect("/login");
}
