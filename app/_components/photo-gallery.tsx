import { createClient } from "@/utils/supabase/server";

const INLINE_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

// 6th shared component -- justified by 4 near-identical call sites (teacher
// exam grading, teacher lesson summary, student exam, student lesson
// summary), a stronger case than app/_components' usual cap. Same signed-URL
// pattern as attached-files-list.tsx (createSignedUrl(key, 600), regenerated
// per page load -- the short TTL bounds exposure after issuance, RLS on
// createSignedUrl() itself is what gates who can ever obtain a working link).
//
// Only image/jpeg and image/png render as an inline <img> thumbnail.
// application/pdf and image/heic/image/heif render as a plain link instead:
// HEIC/HEIF commonly fails to decode in an <img> tag on Chrome/Edge on
// Windows even though the upload itself succeeded, so a MIME type accepted
// for upload cannot be assumed safely renderable inline.
export async function PhotoGallery({
  files,
}: {
  files: { id: string; file_name: string; storage_object_key: string; mime_type: string; size_bytes: number }[];
}) {
  if (files.length === 0) {
    return <p className="text-sm text-slate-400">还没有照片。</p>;
  }

  const supabase = await createClient();
  const signed = await Promise.all(
    files.map(async (f) => {
      const { data } = await supabase.storage.from("attachments").createSignedUrl(f.storage_object_key, 600);
      return { ...f, url: data?.signedUrl ?? null };
    })
  );

  return (
    <div className="flex flex-wrap gap-3">
      {signed.map((f) => {
        if (!f.url) {
          return (
            <span key={f.id} className="text-sm text-slate-400">
              {f.file_name}（链接生成失败）
            </span>
          );
        }

        if (INLINE_IMAGE_MIME_TYPES.has(f.mime_type)) {
          return (
            <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="block">
              {/* next/image's remote optimizer/cache is built for stable asset URLs; these are short-lived, per-request signed URLs with a one-time token, which is not a good fit. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={f.url}
                alt={f.file_name}
                width={120}
                height={120}
                loading="lazy"
                className="h-[120px] w-[120px] rounded-md border border-slate-200 object-cover"
              />
            </a>
          );
        }

        return (
          <a
            key={f.id}
            href={f.url}
            target="_blank"
            rel="noreferrer"
            className="flex h-[120px] w-[120px] flex-col items-center justify-center gap-1 rounded-md border border-slate-200 p-2 text-center text-xs text-slate-600 hover:border-slate-400"
          >
            <span className="break-all">{f.file_name}</span>
            <span className="text-slate-400">{(f.size_bytes / 1024).toFixed(0)} KB</span>
          </a>
        );
      })}
    </div>
  );
}
