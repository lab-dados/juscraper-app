import { useEffect, useMemo, useRef, useState } from "react";
import courtsMetaRaw from "./data/courts_meta.json";
import type { CountResult, CourtEndpoint, CourtsMeta, Endpoint, RunResult } from "./types";
import { JuscraperClient } from "./pyodide/client";
import { LiveSearchNotice } from "./components/LiveSearchNotice";
import { SearchTabs } from "./components/SearchTabs";
import { DatajudTribunalSelect, TribunalSelect } from "./components/TribunalSelect";
import { DynamicForm, initialValues, type FormValues } from "./components/DynamicForm";
import { EstimateDialog } from "./components/EstimateDialog";
import { ProgressBar } from "./components/ProgressBar";
import { ResultsTable } from "./components/ResultsTable";
import { AmostraDatajud } from "./components/AmostraDatajud";
import { CodePreview } from "./components/CodePreview";
import { ErrorIssueCard } from "./components/ErrorIssueCard";
import { Footer } from "./components/Footer";
import { buildCode, buildDatajudCode, callParams, datajudProblem } from "./lib/utils";
import { DATAJUD } from "./lib/links";
import { track } from "./lib/analytics";

const meta = courtsMetaRaw as CourtsMeta;
const PROXY_URL = (import.meta.env.VITE_PROXY_URL as string | undefined) ?? "";
// Pasta dos wheels vendorizados; o worker le o manifest.json para descobrir a
// versao corrente (atualizada pela Action diaria que rebuilda o juscraper).
const WHEELS_BASE_URL = new URL(`${import.meta.env.BASE_URL}wheels/`, window.location.href).href;

// Aba DataJud: o juscraper e chamado como jus.scraper("datajud").listar_processos(...)
const DJ_SIGLA = "datajud";
const DJ_METODO = "listar_processos";

type Phase = "form" | "counting" | "estimate" | "running" | "done";
type BootState = "loading" | "ready" | "error";

interface ErrorInfo {
  error: string;
  traceback: string;
  sigla: string;
  endpoint: string;
  params: Record<string, unknown>;
}

export default function App() {
  const clientRef = useRef<JuscraperClient | null>(null);
  const [boot, setBoot] = useState<BootState>("loading");
  const [bootMsg, setBootMsg] = useState("Carregando o Python no navegador…");

  const [endpoint, setEndpoint] = useState<Endpoint>("cjsg");
  const [sigla, setSigla] = useState<string | null>(null);
  // Tribunal da aba DataJud (sigla do CNJ, ex.: "TJSP", "TRT2", "TRE-SP").
  const [djSigla, setDjSigla] = useState<string | null>(null);
  const [values, setValues] = useState<FormValues>({});

  const [phase, setPhase] = useState<Phase>("form");
  const [configOpen, setConfigOpen] = useState(true);
  const [count, setCount] = useState<CountResult | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<RunResult | null>(null);
  const [ranPaginas, setRanPaginas] = useState<number | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);

  // Inicializa o Pyodide uma vez.
  useEffect(() => {
    const client = new JuscraperClient(PROXY_URL, WHEELS_BASE_URL);
    clientRef.current = client;
    client
      .bootstrap()
      .then(({ version }) => {
        setBoot("ready");
        setBootMsg(`juscraper ${version}`);
      })
      .catch((e) => {
        setBoot("error");
        setBootMsg(String(e));
      });
  }, []);

  const isDj = endpoint === "datajud";
  const djMeta = meta.datajud;
  const court = useMemo(() => meta.courts.find((c) => c.sigla === sigla) ?? null, [sigla]);
  const fields = isDj ? djMeta?.fields ?? [] : court?.endpoints[endpoint as CourtEndpoint]?.fields ?? [];
  // Tribunal escolhido na aba atual.
  const activeSigla = isDj ? djSigla : sigla;

  // Reinicia o formulário quando muda tribunal/endpoint.
  useEffect(() => {
    setValues(initialValues(fields));
    setPhase("form");
    setConfigOpen(true);
    setResult(null);
    setError(null);
    setCount(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sigla, djSigla, endpoint]);

  // DataJud: parâmetros tipados (tribunal primeiro, para o código ficar legível).
  const djParams = useMemo<Record<string, unknown>>(
    () => (isDj && djSigla ? { tribunal: djSigla, ...callParams(fields, values) } : {}),
    [isDj, djSigla, fields, values]
  );
  const djCfg = values.mostrar_movs ? DATAJUD.comMovs : DATAJUD.semMovs;
  const djProblem = isDj ? datajudProblem(djParams) : null;

  const requiredOk = fields
    .filter((f) => f.required)
    .every((f) => String(values[f.name] ?? "").trim() !== "");

  const canRun = isDj
    ? boot === "ready" && djSigla != null && djMeta != null && !djProblem
    : boot === "ready" && sigla != null && court?.support.status !== "unsupported" && requiredOk;

  // O que vai para o Pyodide (e para o card de erro): sigla, método e parâmetros.
  const target = isDj
    ? { sigla: DJ_SIGLA, endpoint: DJ_METODO, params: djParams }
    : { sigla: sigla ?? "", endpoint, params: values };

  const code = (paginas: number | null) =>
    isDj
      ? buildDatajudCode({ params: djParams, paginas, tamanhoPagina: count?.tamanho_pagina })
      : buildCode({ sigla: sigla ?? "", endpoint, params: values, paginas });

  async function handleCalcular() {
    if (!clientRef.current || !activeSigla) return;
    track("calcular", { tribunal: activeSigla, endpoint });
    setError(null);
    setPhase("counting");
    const params = isDj ? { ...target.params, tamanho_pagina: djCfg.tamanhoPagina } : target.params;
    const res = await clientRef.current.count(target.sigla, target.endpoint, params).catch((e) => ({
      ok: false,
      n_pags: null,
      sleep_time: 1,
      error: String(e),
      traceback: String(e),
    } as CountResult));
    if (!res.ok) {
      track("erro", { tribunal: activeSigla, endpoint, etapa: "calcular" });
      setError({
        error: res.error ?? "Erro ao calcular páginas",
        traceback: res.traceback ?? "",
        sigla: target.sigla,
        endpoint: target.endpoint,
        params: target.params,
      });
      setPhase("form");
      return;
    }
    setCount(res);
    setPhase("estimate");
  }

  async function handleConfirm(paginas: number | null) {
    if (!clientRef.current || !activeSigla) return;
    // DataJud: sempre manda o nº de requisições, para a barra de progresso ter total.
    const runPaginas = isDj ? paginas ?? count?.n_pags ?? null : paginas;
    const params = isDj
      ? { ...target.params, tamanho_pagina: count?.tamanho_pagina ?? djCfg.tamanhoPagina }
      : target.params;
    setPhase("running");
    setConfigOpen(false);
    setProgress({ done: 0, total: runPaginas ?? count?.n_pags ?? 0 });
    const res = await clientRef.current
      .run(target.sigla, target.endpoint, params, runPaginas, (done, total) => setProgress({ done, total }))
      .catch((e) => ({
        ok: false,
        columns: [],
        records: [],
        csv: "",
        xlsx_b64: "",
        n_rows: 0,
        error: String(e),
        traceback: String(e),
      } as RunResult));
    if (!res.ok) {
      track("erro", { tribunal: activeSigla, endpoint, etapa: "busca" });
      setError({
        error: res.error ?? "Erro na busca",
        traceback: res.traceback ?? "",
        sigla: target.sigla,
        endpoint: target.endpoint,
        params: target.params,
      });
      setPhase("form");
      setConfigOpen(true);
      return;
    }
    track("busca", { tribunal: activeSigla, endpoint, paginas: paginas ?? 0, linhas: res.n_rows });
    setRanPaginas(paginas);
    setResult(res);
    setPhase("done");
  }

  const showForm = isDj ? djSigla != null && djMeta != null : court != null;
  const djFilePrefix = `datajud_${activeSigla ?? ""}_processos`;

  return (
    <div className="min-h-screen">
      <header className="border-b border-fgv-100 bg-fgv-700 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-lg font-bold tracking-tight">juscraper</h1>
            <p className="text-xs text-fgv-100/80">
              Ferramenta de apoio para busca de jurisprudência nos tribunais brasileiros
            </p>
          </div>
          <BootBadge state={boot} msg={bootMsg} />
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <LiveSearchNotice />

        {!PROXY_URL && (
          <div className="card border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            <strong>Proxy não configurado.</strong> Defina <code>VITE_PROXY_URL</code> em{" "}
            <code>web/.env</code> (veja <code>proxy/README.md</code>). Sem ele as buscas falham
            por CORS.
          </div>
        )}

        <div className="card">
          <button
            type="button"
            onClick={() => setConfigOpen((o) => !o)}
            aria-expanded={configOpen}
            className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
          >
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-fgv-800">Configurações da busca</h2>
              {!configOpen && (
                <p className="mt-0.5 truncate text-xs text-fgv-500">
                  {activeSigla
                    ? `${activeSigla.toUpperCase()} · ${meta.endpoint_labels[endpoint]}`
                    : "Configure o tribunal e os filtros"}
                </p>
              )}
            </div>
            <svg
              className={`h-5 w-5 flex-shrink-0 text-fgv-400 transition-transform ${
                configOpen ? "rotate-180" : ""
              }`}
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </button>

          {configOpen && (
            <div className="border-t border-fgv-100 px-5 pb-5 pt-4">
              <SearchTabs value={endpoint} onChange={setEndpoint} hasDatajud={djMeta != null} />
              <div className="mt-5 space-y-5">
                {isDj ? (
                  <>
                    <div className="space-y-2">
                      <p className="text-sm text-fgv-600">
                        Lista processos pela <strong>data de ajuizamento</strong>, a partir da API
                        pública do DataJud (CNJ), com classe, assuntos, órgão julgador e, se quiser,
                        as movimentações. Serve para desenhos prospectivos (ex.: todos os processos
                        de usucapião distribuídos no TJSP em 2022), inclusive os que ainda não têm
                        decisão.
                      </p>
                      <ul className="list-disc space-y-0.5 pl-5 text-xs text-fgv-500">
                        <li>
                          A ordem da lista não é aleatória (agrupa os processos por vara): para
                          amostrar, baixe a lista inteira e use o sorteio da tela de resultados.
                        </li>
                        <li>
                          O mesmo número CNJ tem um registro por grau (ex.: a execução fiscal no 1º
                          grau e a apelação, classe 198, no 2º); o filtro de classe traz só o
                          registro daquela classe.
                        </li>
                        <li>
                          Os tribunais mandam os dados ao CNJ com atraso de 3 a 4 semanas, e o
                          DataJud não traz valor da causa nem partes.
                        </li>
                        <li>
                          Para filtrar por movimentação, prefira os códigos TPU: os atalhos de tipo
                          de movimentação são incompletos.
                        </li>
                      </ul>
                    </div>
                    <DatajudTribunalSelect
                      tribunais={djMeta?.tribunais ?? []}
                      value={djSigla}
                      onChange={setDjSigla}
                    />
                  </>
                ) : (
                  <TribunalSelect
                    courts={meta.courts}
                    endpoint={endpoint as CourtEndpoint}
                    value={sigla}
                    onChange={setSigla}
                  />
                )}

                {showForm && fields.length > 0 && (
                  <>
                    <DynamicForm
                      fields={fields}
                      values={values}
                      onChange={setValues}
                      sigla={activeSigla ?? ""}
                      showCheckboxHelp={isDj}
                    />
                    {djProblem && <p className="text-sm text-rose-600">{djProblem}</p>}
                    <div className="flex items-center gap-3">
                      <button
                        className="btn-primary"
                        disabled={!canRun || phase === "counting"}
                        onClick={handleCalcular}
                      >
                        {phase === "counting" ? "Calculando…" : "Calcular e estimar"}
                      </button>
                      {boot === "loading" && (
                        <span className="text-sm text-fgv-400">Aguarde o Python carregar…</span>
                      )}
                    </div>
                    {activeSigla && (
                      <CodePreview code={code(null)} sigla={target.sigla} endpoint={target.endpoint} />
                    )}
                  </>
                )}

                {!isDj && court && fields.length === 0 && (
                  <p className="text-sm text-fgv-500">
                    Este tribunal não oferece {meta.endpoint_labels[endpoint]} no juscraper.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {phase === "running" && (
          <ProgressBar
            done={progress.done}
            total={progress.total}
            label={`Baixando ${activeSigla?.toUpperCase()} · ${meta.endpoint_labels[endpoint]}`}
          />
        )}

        {phase === "done" && result && activeSigla && isDj && (
          <AmostraDatajud
            result={result}
            total={count?.n_itens ?? null}
            sigla={activeSigla}
            filePrefix={djFilePrefix}
          />
        )}

        {phase === "done" && result && activeSigla && (
          <ResultsTable
            result={result}
            sigla={activeSigla}
            endpoint={endpoint}
            code={code(ranPaginas)}
            filePrefix={isDj ? djFilePrefix : undefined}
          />
        )}

        {error && (
          <ErrorIssueCard
            error={error.error}
            traceback={error.traceback}
            sigla={error.sigla}
            endpoint={error.endpoint}
            params={error.params}
            onDismiss={() => setError(null)}
          />
        )}
      </main>

      {phase === "estimate" && count && (
        <EstimateDialog
          nPags={count.n_pags}
          sleepTime={count.sleep_time}
          onConfirm={handleConfirm}
          onCancel={() => setPhase("form")}
          datajud={
            isDj
              ? {
                  total: count.n_itens ?? 0,
                  exato: count.relation !== "gte",
                  tamanhoPagina: count.tamanho_pagina ?? djCfg.tamanhoPagina,
                  maxProcessos: djCfg.maxProcessos,
                  segPorPagina: djCfg.segPorPagina,
                }
              : undefined
          }
        />
      )}

      <Footer />
    </div>
  );
}

function BootBadge({ state, msg }: { state: BootState; msg: string }) {
  const dot =
    state === "ready" ? "bg-emerald-400" : state === "error" ? "bg-rose-400" : "bg-amber-300 animate-pulse";
  return (
    <div className="flex items-center gap-2 rounded-full bg-fgv-800/40 px-3 py-1.5 text-xs">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span className="max-w-[16rem] truncate text-fgv-50/90" title={msg}>
        {state === "ready" ? msg : state === "error" ? "Falha ao carregar" : msg}
      </span>
    </div>
  );
}
