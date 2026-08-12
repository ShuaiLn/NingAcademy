import { createClient } from "@/utils/supabase/server";

// Signed URLs are generated server-side per page load, short TTL (~10 min).
// The new storage.objects SELECT RLS policy gates *generation*: createSignedUrl()
// runs as the requesting user and is rejected if they can't read this
// object. Once issued, the URL itself is a bearer credential until it
// expires -- the short TTL bounds that exposure window, it does not make
// the link access-controlled after issuance.
export async function AttachedFilesList({
  files,
}: {
  files: { id: string; file_name: string; storage_object_key: string; size_bytes: number }[];
}) {
  if (files.length === 0) {
    return <p className="text-sm text-slate-400">还没有附件。</p>;
  }

  const supabase = await createClient();
  const signed = await Promise.all(
    files.map(async (f) => {
      const { data } = await supabase.storage.from("attachments").createSignedUrl(f.storage_object_key, 600);
      return { ...f, url: data?.signedUrl ?? null };
    })
  );

  return (
    <ul className="flex flex-col gap-1 text-sm">
      {signed.map((f) => (
        <li key={f.id} className="flex items-center gap-2">
          {f.url ? (
            <a href={f.url} target="_blank" rel="noreferrer" className="text-slate-700 hover:underline">
              {f.file_name}
            </a>
          ) : (
            <span className="text-slate-400">{f.file_name}（链接生成失败）</span>
          )}
          <span className="text-xs text-slate-400">{(f.size_bytes / 1024).toFixed(0)} KB</span>
        </li>
      ))}
    </ul>
  );
}
