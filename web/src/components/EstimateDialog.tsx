import { useState } from "react";
import { formatDuration } from "../lib/utils";

/**
 * Mostra a estimativa antes de baixar tudo.
 * - Quando o tribunal expõe o total de páginas, mostra nº de páginas + tempo.
 * - Quando não expõe (n_pags = null), pede um limite de páginas ao usuário.
 */
export function EstimateDialog({
  nPags,
  sleepTime,
  onConfirm,
  onCancel,
}: {
  nPags: number | null;
  sleepTime: number;
  onConfirm: (paginas: number | null) => void;
  onCancel: () => void;
}) {
  const unknown = nPags == null;
  const [cap, setCap] = useState<string>(unknown ? "5" : "");

  // ~ tempo por página: sleep entre requests + folga de rede.
  const perPage = (sleepTime || 1) + 1.2;
  const known = !unknown && nPags! > 0;
  const estSeconds = known ? nPags! * perPage : 0;

  const capNum = parseInt(cap, 10);
  const validCap = Number.isFinite(capNum) && capNum > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-fgv-900/40 p-4">
      <div className="card w-full max-w-md p-6">
        <h3 className="text-lg font-semibold text-fgv-800">Confirmar busca</h3>

        {known ? (
          <div className="mt-4 space-y-3">
            <Row label="Páginas encontradas" value={String(nPags)} />
            <Row label="Tempo estimado" value={`~ ${formatDuration(estSeconds)}`} />
            <p className="text-xs text-fgv-400">
              Estimativa aproximada ({perPage.toFixed(1)}s por página). Pode variar conforme o
              tribunal. Você pode limitar o número de páginas abaixo.
            </p>
            <div>
              <label className="label" htmlFor="cap">
                Limite de páginas (opcional)
              </label>
              <input
                id="cap"
                className="input"
                type="number"
                min={1}
                max={nPags!}
                placeholder={`todas (${nPags})`}
                value={cap}
                onChange={(e) => setCap(e.target.value)}
              />
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-fgv-600">
              Este tribunal não informa o total de páginas antecipadamente. Defina quantas
              páginas baixar (cada página ~ {perPage.toFixed(1)}s).
            </p>
            <div>
              <label className="label" htmlFor="cap2">
                Número de páginas <span className="text-rose-500">*</span>
              </label>
              <input
                id="cap2"
                className="input"
                type="number"
                min={1}
                value={cap}
                onChange={(e) => setCap(e.target.value)}
              />
              {validCap && (
                <p className="mt-1 text-xs text-fgv-400">
                  Tempo estimado: ~ {formatDuration(capNum * perPage)}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button
            className="btn-primary"
            disabled={unknown && !validCap}
            onClick={() => {
              if (validCap) onConfirm(capNum);
              else onConfirm(null); // todas (caso conhecido sem limite)
            }}
          >
            Baixar
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-fgv-50 px-3 py-2">
      <span className="text-sm text-fgv-500">{label}</span>
      <span className="text-sm font-semibold text-fgv-800">{value}</span>
    </div>
  );
}
