import { createClient } from "@/utils/supabase/server";
import { TeacherNav } from "./teacher-nav";

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle()
    : { data: null };

  return (
    <div className="min-h-screen">
      <TeacherNav fullName={profile?.full_name ?? null} />
      <main className="p-6">{children}</main>
    </div>
  );
}
