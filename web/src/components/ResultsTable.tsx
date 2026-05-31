import { useMemo, useState } from "react";
import type { RunResult } from "../types";
import { downloadBase64, downloadText } from "../lib/utils";
import { CodeView } from "./CodeView";

const PAGE_SIZE = 20;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function ResultsTable({
  result,
  sigla,
  endpoint,
  code,
}: {
  result: RunResult;
  sigla: string;
  endpoint: string;
  code: string;
}) {
  const [tab, setTab] = useState<"tabela" | "codigo">("tabela");
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
      {/* Cabeçalho + abas */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-fgv-100 px-4 pt-3">
        <div className="flex gap-1">
          {(["tabela", "codigo"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                "-mb-px rounded-t-md px-4 py-2 text-sm font-medium transition",
                tab === t
                  ? "border-b-2 border-fgv-700 text-fgv-800"
                  : "text-fgv-500 hover:text-fgv-700",
              ].join(" ")}
            >
              {t === "tabela" ? "Tabela" : "Código"}
            </button>
          ))}
        </div>
        <p className="pb-2 text-sm text-fgv-500">
          {result.n_rows} linha(s) · {result.columns.length} coluna(s)
        </p>
      </div>

      {tab === "codigo" ? (
        <CodeView code={code} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-end gap-2 border-b border-fgv-100 p-3">
            <input
              className="input mr-auto w-56"
              placeholder="Filtrar resultados..."
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(0);
              }}
            />
            <button
              className="btn-secondary"
              onClick={() => downloadText(`${sigla}_${endpoint}.csv`, result.csv)}
            >
              ⬇ CSV
            </button>
            <button
              className="btn-primary"
              onClick={() => downloadBase64(`${sigla}_${endpoint}.xlsx`, result.xlsx_b64, XLSX_MIME)}
            >
              ⬇ XLSX
            </button>
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
                      <td
                        key={c}
                        className="max-w-md truncate border-b border-fgv-50 px-3 py-2 text-fgv-700"
                        title={String(row[c] ?? "")}
                      >
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
        </>
      )}
    </div>
  );
}
