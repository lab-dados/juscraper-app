export function ProgressBar({
  done,
  total,
  label,
}: {
  done: number;
  total: number;
  label?: string;
}) {
  const indeterminate = total <= 0;
  const pct = indeterminate ? 0 : Math.min(100, Math.round((done / total) * 100));

  return (
    <div className="card p-5">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium text-fgv-700">{label ?? "Baixando…"}</span>
        <span className="text-fgv-500">
          {indeterminate ? `${done} página(s)` : `${done} / ${total} (${pct}%)`}
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-fgv-100">
        {indeterminate ? (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
        ) : (
          <div
            className="h-full rounded-full bg-accent transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </div>
  );
}
