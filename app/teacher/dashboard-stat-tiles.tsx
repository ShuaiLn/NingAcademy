import Link from "next/link";

export type StatTile = {
  label: string;
  // null means the underlying query failed -- rendered distinctly from a
  // real 0 so a teacher never mistakes "failed to load" for "nothing here".
  value: number | null;
  href?: string;
};

export function DashboardStatTiles({ tiles }: { tiles: StatTile[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile) => {
        const body = (
          <>
            <p className="text-sm text-slate-500">{tile.label}</p>
            {tile.value === null ? (
              <p className="text-sm text-amber-600">加载失败</p>
            ) : (
              <p className="text-3xl font-semibold">{tile.value}</p>
            )}
          </>
        );
        const className = "rounded-md border border-slate-200 p-5";
        return tile.href ? (
          <Link key={tile.label} href={tile.href} className={`${className} hover:border-slate-400`}>
            {body}
          </Link>
        ) : (
          <div key={tile.label} className={className}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
