import { useEffect, useMemo, useRef, useState } from "react";
import courtsMetaRaw from "./data/courts_meta.json";
import type { CountResult, CourtsMeta, Endpoint, RunResult } from "./types";
import { JuscraperClient } from "./pyodide/client";
import { LiveSearchNotice } from "./components/LiveSearchNotice";
import { SearchTabs } from "./components/SearchTabs";
import { TribunalSelect } from "./components/TribunalSelect";
import { DynamicForm, initialValues, type FormValues } from "./components/DynamicForm";
import { EstimateDialog } from "./components/EstimateDialog";
import { ProgressBar } from "./components/ProgressBar";
import { ResultsTable } from "./components/ResultsTable";
import { ErrorIssueCard } from "./components/ErrorIssueCard";
import { Footer } from "./components/Footer";
import { buildCode } from "./lib/utils";
import { track } from "./lib/analytics";

const meta = courtsMetaRaw as CourtsMeta;
const PROXY_URL = (import.meta.env.VITE_PROXY_URL as string | undefined) ?? "";
// Pasta dos wheels vendorizados; o worker le o manifest.json para descobrir a
// versao corrente (atualizada pela Action diaria que rebuilda o juscraper).
const WHEELS_BASE_URL = new URL(`${import.meta.env.BASE_URL}wheels/`, window.location.href).href;

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
  const [values, setValues] = useState<FormValues>({});

  const [phase, setPhase] = useState<Phase>("form");
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

  const court = useMemo(() => meta.courts.find((c) => c.sigla === sigla) ?? null, [sigla]);
  const fields = court?.endpoints[endpoint]?.fields ?? [];

  // Reinicia o formulário quando muda tribunal/endpoint.
  useEffect(() => {
    setValues(initialValues(fields));
    setPhase("form");
    setResult(null);
    setError(null);
    setCount(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sigla, endpoint]);

  const requiredOk = fields
    .filter((f) => f.required)
    .every((f) => String(values[f.name] ?? "").trim() !== "");

  const canRun = boot === "ready" && sigla != null && court?.support.status !== "unsupported" && requiredOk;

  async function handleCalcular() {
    if (!clientRef.current || !sigla) return;
    track("calcular", { tribunal: sigla, endpoint });
    setError(null);
    setPhase("counting");
    const res = await clientRef.current.count(sigla, endpoint, values).catch((e) => ({
      ok: false,
      n_pags: null,
      sleep_time: 1,
      error: String(e),
      traceback: String(e),
    } as CountResult));
    if (!res.ok) {
      track("erro", { tribunal: sigla, endpoint, etapa: "calcular" });
      setError({
        error: res.error ?? "Erro ao calcular páginas",
        traceback: res.traceback ?? "",
        sigla,
        endpoint,
        params: values,
      });
      setPhase("form");
      return;
    }
    setCount(res);
    setPhase("estimate");
  }

  async function handleConfirm(paginas: number | null) {
    if (!clientRef.current || !sigla) return;
    setPhase("running");
    setProgress({ done: 0, total: paginas ?? count?.n_pags ?? 0 });
    const res = await clientRef.current
      .run(sigla, endpoint, values, paginas, (done, total) => setProgress({ done, total }))
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
      track("erro", { tribunal: sigla, endpoint, etapa: "busca" });
      setError({
        error: res.error ?? "Erro na busca",
        traceback: res.traceback ?? "",
        sigla,
        endpoint,
        params: values,
      });
      setPhase("form");
      return;
    }
    track("busca", { tribunal: sigla, endpoint, paginas: paginas ?? 0, linhas: res.n_rows });
    setRanPaginas(paginas);
    setResult(res);
    setPhase("done");
  }

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

        <div className="card p-5">
          <SearchTabs value={endpoint} onChange={setEndpoint} />
          <div className="mt-5 space-y-5">
            <TribunalSelect courts={meta.courts} endpoint={endpoint} value={sigla} onChange={setSigla} />

            {court && fields.length > 0 && (
              <>
                <DynamicForm fields={fields} values={values} onChange={setValues} />
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
              </>
            )}

            {court && fields.length === 0 && (
              <p className="text-sm text-fgv-500">
                Este tribunal não oferece {meta.endpoint_labels[endpoint]} no juscraper.
              </p>
            )}
          </div>
        </div>

        {phase === "running" && (
          <ProgressBar
            done={progress.done}
            total={progress.total}
            label={`Baixando ${sigla?.toUpperCase()} · ${meta.endpoint_labels[endpoint]}`}
          />
        )}

        {phase === "done" && result && sigla && (
          <ResultsTable
            result={result}
            sigla={sigla}
            endpoint={endpoint}
            code={buildCode({ sigla, endpoint, params: values, paginas: ranPaginas })}
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
