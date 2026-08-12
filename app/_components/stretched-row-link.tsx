import Link from "next/link";

// Deliberate, narrow exception to this codebase's colocated-components
// convention: this exact "stretched link" pattern is needed 6+ times (3
// list types x desktop/mobile) and encodes an accessibility-sensitive
// incantation worth centralizing so it can't silently drift -- never nest a
// <button>/interactive control inside an <a>. The caller gives its row
// (<tr> or a mobile <div> card) `position: relative`; this anchor is empty
// and absolutely positioned to cover the entire row, because an
// absolutely-positioned element's containing block is the nearest
// positioned ancestor (the row), not its immediate parent. Action-button
// cells need `className="relative z-10"` so they intercept clicks ahead of
// this anchor. On a desktop table this must live inside a <td>, never as a
// direct child of <tr> -- browsers foster-parent a stray <a> out of tables,
// silently breaking layout.
export function StretchedRowLink({ href, label }: { href: string; label: string }) {
  return <Link href={href} aria-label={label} className="absolute inset-0" />;
}
