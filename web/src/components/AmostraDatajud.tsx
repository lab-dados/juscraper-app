import { useMemo, useState } from "react";
import type { RunResult } from "../types";
import { filtrarCsvPorChave, novaSemente, ordenarPor, paraCsv, sortearIndices } from "../lib/amostra";
import { downloadText } from "../lib/utils";
import { track } from "../lib/analytics";

interface Amostra {
  rows: Record<string, unknown>[];
  semente: number;
  k: number;
}

/**
 * Aba DataJud: aviso de que a ordem da lista NAO e aleatoria (o DataJud ordena
 * por um id interno que agrupa os processos por vara) e sorteio de uma amostra
 * aleatoria simples, com semente, sobre a lista baixada.
 */
export function AmostraDatajud({
  result,
  total,
  sigla,
  filePrefix,
}: {
  result: RunResult;
  // Total encontrado na estimativa (para avisar quando a lista veio cortada).
  total: number | null;
  sigla: string;
  filePrefix: string;
}) {
  const n = result.records.length;
  const [k, setK] = useState(String(Math.min(100, n)));
  const [semente, setSemente] = useState(String(novaSemente()));
  const [amostra, setAmostra] = useState<Amostra | null>(null);
  const incompleta = total != null && total > n;
  const movs = result.extras?.find((e) => e.key === "movimentacoes");
  const fmt = (x: number) => x.toLocaleString("pt-BR");

  // Ordem canonica (id_datajud): mesma lista + mesma semente = mesma amostra.
  const ordenados = useMemo(() => ordenarPor(result.records, "id_datajud"), [result]);

  const sortear = () => {
    const kn = Math.max(1, Math.min(n, parseInt(k, 10) || 0));
    const s = (parseInt(semente, 10) || 0) >>> 0;
    const rows = sortearIndices(n, kn, s).map((i, pos) => ({ ordem_sorteio: pos + 1, ...ordenados[i] }));
    setAmostra({ rows, semente: s, k: kn });
    setK(String(kn));
    track("amostra", { tribunal: sigla, k: kn });
  };

  const baixarAmostra = () => {
    if (!amostra) return;
    downloadText(
      `${filePrefix}_amostra_${amostra.k}_semente_${amostra.semente}.csv`,
      paraCsv(["ordem_sorteio", ...result.columns], amostra.rows)
    );
  };

  const baixarMovsAmostra = () => {
    if (!amostra || !movs) return;
    const chaves = new Set(amostra.rows.map((r) => `${r.numero_processo ?? ""},${r.grau ?? ""}`));
    downloadText(
      `${filePrefix}_amostra_${amostra.k}_semente_${amostra.semente}_movimentacoes.csv`,
      filtrarCsvPorChave(movs.csv, chaves)
    );
  };

  if (n === 0) return null;

  return (
    <div className="card space-y-3 p-5">
      <h3 className="text-sm font-semibold text-fgv-800">Amostra aleatória</h3>
      <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        <strong>A ordem da lista não é aleatória.</strong> O DataJud devolve os processos na
        ordem de um identificador interno que agrupa por vara (e concentra, no começo, registros
        atípicos, como processos sem movimentação). Os primeiros N da lista não formam uma
        amostra: para amostrar, sorteie da lista inteira.
      </p>
      {incompleta && (
        <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          A lista baixada tem {fmt(n)} de {fmt(total!)} processos (limite da ferramenta). Uma
          amostra dela <strong>não</strong> representa o total. Baixe a lista inteira (aba Código
          ou Colab) antes de sortear.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="amostra-k">
            Tamanho da amostra
          </label>
          <input
            id="amostra-k"
            className="input w-32"
            type="number"
            min={1}
            max={n}
            value={k}
            onChange={(e) => setK(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="amostra-semente">
            Semente
          </label>
          <input
            id="amostra-semente"
            className="input w-32"
            type="number"
            min={0}
            value={semente}
            onChange={(e) => setSemente(e.target.value)}
          />
        </div>
        <button className="btn-primary" onClick={sortear}>
          Sortear
        </button>
        <button
          className="text-xs text-fgv-500 underline hover:text-fgv-700"
          onClick={() => setSemente(String(novaSemente()))}
          type="button"
        >
          outra semente
        </button>
      </div>

      {amostra && (
        <div className="space-y-2 rounded-md bg-fgv-50 p-3">
          <p className="text-sm text-fgv-700">
            Amostra de <strong>{fmt(amostra.k)}</strong> de {fmt(n)} processos, sorteada com a
            semente <strong>{amostra.semente}</strong>. Com a mesma lista e a mesma semente, o
            sorteio sai igual (anote a semente no seu plano de pesquisa).
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={baixarAmostra}>
              ⬇ CSV da amostra
            </button>
            {movs && (
              <button className="btn-secondary" onClick={baixarMovsAmostra}>
                ⬇ CSV das movimentações da amostra
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
