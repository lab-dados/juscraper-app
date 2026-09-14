import { useState, type ReactNode } from "react";
import { formatDuration } from "../lib/utils";
import { COLAB_URL, LABDADOS_URL, MAX_PAGINAS } from "../lib/links";

/** Parâmetros da estimativa na aba DataJud (conta processos, não páginas). */
export interface DatajudEstimate {
  total: number;
  exato: boolean;
  tamanhoPagina: number;
  maxProcessos: number;
  segPorPagina: number;
}

/**
 * Mostra a estimativa antes de baixar tudo. A ferramenta web baixa no máximo
 * MAX_PAGINAS páginas; para mais que isso, oferece os caminhos alternativos.
 * Na aba DataJud a unidade é o processo (e o teto, `maxProcessos`).
 */
export function EstimateDialog({
  nPags,
  sleepTime,
  onConfirm,
  onCancel,
  datajud,
}: {
  nPags: number | null;
  sleepTime: number;
  onConfirm: (paginas: number | null) => void;
  onCancel: () => void;
  datajud?: DatajudEstimate;
}) {
  if (datajud) {
    return (
      <DatajudBody est={datajud} sleepTime={sleepTime} onConfirm={onConfirm} onCancel={onCancel} />
    );
  }
  return <PaginasBody nPags={nPags} sleepTime={sleepTime} onConfirm={onConfirm} onCancel={onCancel} />;
}

function PaginasBody({
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
  const overLimit = !unknown && nPags! > MAX_PAGINAS;
  const [cap, setCap] = useState<string>(unknown ? "5" : "");

  // ~ tempo por página: sleep entre requests + folga de rede.
  const perPage = (sleepTime || 1) + 1.2;
  const capNum = parseInt(cap, 10);
  const hasCap = Number.isFinite(capNum) && capNum > 0;

  // Quantas páginas vão de fato ser baixadas (respeitando o teto).
  const willFetch = hasCap
    ? Math.min(capNum, MAX_PAGINAS)
    : unknown
      ? MAX_PAGINAS
      : Math.min(nPags!, MAX_PAGINAS);

  // null = baixar todas (só quando o total conhecido cabe no teto e sem cap manual).
  const paginasArg = !hasCap && !unknown && nPags! <= MAX_PAGINAS ? null : willFetch;

  return (
    <Shell
      onCancel={onCancel}
      onConfirm={() => onConfirm(paginasArg)}
      confirmDisabled={unknown && !hasCap}
      limitNote={overLimit || unknown ? `A ferramenta baixa no máximo ${MAX_PAGINAS} páginas por busca.` : null}
    >
      {unknown ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-fgv-600">
            Este tribunal não informa o total de páginas antecipadamente. Defina quantas
            páginas baixar (cada página leva cerca de {perPage.toFixed(1)}s).
          </p>
          <div>
            <label className="label" htmlFor="cap">
              Número de páginas <span className="text-rose-500">*</span>
            </label>
            <input
              id="cap"
              className="input"
              type="number"
              min={1}
              max={MAX_PAGINAS}
              value={cap}
              onChange={(e) => setCap(e.target.value)}
            />
            {hasCap && (
              <p className="mt-1 text-xs text-fgv-400">
                Tempo estimado: cerca de {formatDuration(willFetch * perPage)}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <Row label="Páginas encontradas" value={nPags!.toLocaleString("pt-BR")} />
          <Row label="Será baixado" value={`${willFetch} página(s)`} />
          <Row label="Tempo estimado" value={`cerca de ${formatDuration(willFetch * perPage)}`} />
          <p className="text-xs text-fgv-400">
            Estimativa aproximada ({perPage.toFixed(1)}s por página). Pode variar conforme o
            tribunal.
          </p>
          <div>
            <label className="label" htmlFor="cap">
              Limite de páginas (até {MAX_PAGINAS})
            </label>
            <input
              id="cap"
              className="input"
              type="number"
              min={1}
              max={MAX_PAGINAS}
              placeholder={overLimit ? String(MAX_PAGINAS) : `todas (${Math.min(nPags!, MAX_PAGINAS)})`}
              value={cap}
              onChange={(e) => setCap(e.target.value)}
            />
          </div>
        </div>
      )}
    </Shell>
  );
}

function DatajudBody({
  est,
  sleepTime,
  onConfirm,
  onCancel,
}: {
  est: DatajudEstimate;
  sleepTime: number;
  onConfirm: (paginas: number | null) => void;
  onCancel: () => void;
}) {
  const { total, exato, tamanhoPagina, maxProcessos, segPorPagina } = est;
  const [cap, setCap] = useState("");
  const fmt = (n: number) => n.toLocaleString("pt-BR");

  const capNum = parseInt(cap, 10);
  const hasCap = Number.isFinite(capNum) && capNum > 0;
  const teto = Math.min(hasCap ? capNum : Infinity, maxProcessos);
  // A API pagina em blocos de `tamanhoPagina`: o limite arredonda para cima.
  const paginas = Math.ceil(Math.min(total, teto) / tamanhoPagina);
  const willFetch = Math.min(total, paginas * tamanhoPagina);
  const todas = willFetch >= total;
  const perPage = segPorPagina + (sleepTime || 0.5);

  if (total === 0) {
    return (
      <Shell onCancel={onCancel} onConfirm={() => undefined} confirmDisabled limitNote={null}>
        <p className="mt-4 text-sm text-fgv-600">
          Nenhum processo encontrado no DataJud com esses filtros. Revise o tribunal, as datas
          e os códigos de classe/assunto.
        </p>
      </Shell>
    );
  }

  return (
    <Shell
      onCancel={onCancel}
      onConfirm={() => onConfirm(todas ? null : paginas)}
      confirmDisabled={paginas === 0}
      limitNote={total > maxProcessos ? `A ferramenta baixa no máximo ${fmt(maxProcessos)} processos por busca (com estes filtros).` : null}
    >
      <div className="mt-4 space-y-3">
        <Row label="Processos encontrados" value={`${exato ? "" : "mais de "}${fmt(total)}`} />
        <Row
          label="Será baixado"
          value={`${fmt(willFetch)} processo(s) em ${paginas} requisição(ões)`}
        />
        <Row label="Tempo estimado" value={`cerca de ${formatDuration(paginas * perPage)}`} />
        <p className="text-xs text-fgv-400">
          Estimativa aproximada (cerca de {Math.round(perPage)}s por requisição de{" "}
          {fmt(tamanhoPagina)} processos). A API do DataJud varia bastante conforme a carga.
        </p>
        <div>
          <label className="label" htmlFor="cap">
            Limite de processos (até {fmt(maxProcessos)})
          </label>
          <input
            id="cap"
            className="input"
            type="number"
            min={1}
            max={maxProcessos}
            placeholder={`todos (${fmt(Math.min(total, maxProcessos))})`}
            value={cap}
            onChange={(e) => setCap(e.target.value)}
          />
        </div>
      </div>
    </Shell>
  );
}

function Shell({
  children,
  onCancel,
  onConfirm,
  confirmDisabled,
  limitNote,
}: {
  children: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  confirmDisabled: boolean;
  limitNote: string | null;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-fgv-900/40 p-4">
      <div className="card w-full max-w-md p-6">
        <h3 className="text-lg font-semibold text-fgv-800">Confirmar busca</h3>

        {children}

        {limitNote && (
          <div className="mt-4 rounded-md border border-fgv-100 bg-fgv-50 p-3 text-xs text-fgv-600">
            <p className="font-semibold text-fgv-700">{limitNote}</p>
            <p className="mt-1">Precisa de mais do que isso? Você pode:</p>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              <li>
                rodar via código (aba <strong>Código</strong> nos resultados ou{" "}
                <a className="text-accent hover:underline" href={COLAB_URL} target="_blank" rel="noreferrer">
                  abrir no Colab
                </a>
                ), ou
              </li>
              <li>
                <a className="text-accent hover:underline" href={LABDADOS_URL} target="_blank" rel="noreferrer">
                  entrar em contato com o LabDados
                </a>
                .
              </li>
            </ul>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button className="btn-primary" disabled={confirmDisabled} onClick={onConfirm}>
            Baixar
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-fgv-50 px-3 py-2">
      <span className="text-sm text-fgv-500">{label}</span>
      <span className="text-right text-sm font-semibold text-fgv-800">{value}</span>
    </div>
  );
}
