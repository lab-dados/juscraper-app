import { useMemo, useState } from "react";
import type { RunResult } from "../types";
import { downloadText } from "../lib/utils";

const PAGE_SIZE = 20;

export function ResultsTable({ result, sigla, endpoint }: { result: RunResult; sigla: string; endpoint: string }) {
  const [filter, setFilter] = useState("");
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let rows = result.records;
    if (q) {
      rows = rows.filter((r) =>
        result.columns.some((c) => String(r[c] ?? "").toLowerCase().includes(q))
      );
    }
    if (sortCol) {
      rows = [...rows].sort((a, b) => {
        const av = String(a[sortCol] ?? "");
        const bv = String(b[sortCol] ?? "");
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    return rows;
  }, [result, filter, sortCol, sortDir]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const slice = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const toggleSort = (col: string) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-fgv-100 p-4">
        <div>
          <h3 className="font-semibold text-fgv-800">Resultados</h3>
          <p className="text-sm text-fgv-500">
            {result.n_rows} linha(s) · {result.columns.length} coluna(s)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="input w-56"
            placeholder="Filtrar resultados…"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(0);
            }}
          />
          <button
            className="btn-primary"
            onClick={() => downloadText(`${sigla}_${endpoint}.csv`, result.csv)}
          >
            ⬇ Baixar CSV
          </button>
        </div>
      </div>

      <div className="max-h-[60vh] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-fgv-50">
            <tr>
              {result.columns.map((c) => (
                <th
                  key={c}
                  onClick={() => toggleSort(c)}
                  className="cursor-pointer border-b border-fgv-100 px-3 py-2 text-left font-semibold text-fgv-700 hover:bg-fgv-100"
                >
                  {c}
                  {sortCol === c && <span className="ml-1">{sortDir === "asc" ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((row, i) => (
              <tr key={i} className="odd:bg-white even:bg-fgv-50/40">
                {result.columns.map((c) => (
                  <td key={c} className="max-w-md truncate border-b border-fgv-50 px-3 py-2 text-fgv-700" title={String(row[c] ?? "")}>
                    {String(row[c] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
            {slice.length === 0 && (
              <tr>
                <td colSpan={result.columns.length} className="px-3 py-8 text-center text-fgv-400">
                  Nenhum resultado para o filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between border-t border-fgv-100 p-3 text-sm">
          <button className="btn-secondary" disabled={current === 0} onClick={() => setPage(current - 1)}>
            ← Anterior
          </button>
          <span className="text-fgv-500">
            Página {current + 1} de {pages}
          </span>
          <button className="btn-secondary" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            Próxima →
          </button>
        </div>
      )}
    </div>
  );
}
