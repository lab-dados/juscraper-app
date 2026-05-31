// Utilidades pequenas: link de issue no juscraper, download de arquivo, tempo.

const REPO = "jtrecenti/juscraper";

export function buildIssueUrl(opts: {
  error: string;
  traceback: string;
  sigla: string;
  endpoint: string;
  params: Record<string, unknown>;
}): string {
  const title = `[app] Erro em ${opts.sigla} / ${opts.endpoint}: ${opts.error.slice(0, 80)}`;
  const body = [
    "**Origem:** juscraper-app (busca no navegador via Pyodide)",
    "",
    `**Tribunal:** ${opts.sigla}`,
    `**Endpoint:** ${opts.endpoint}`,
    "",
    "**Parâmetros:**",
    "```json",
    JSON.stringify(opts.params, null, 2),
    "```",
    "",
    "**Erro:**",
    "```",
    opts.error,
    "```",
    "",
    "**Traceback:**",
    "```",
    opts.traceback,
    "```",
  ].join("\n");
  const q = new URLSearchParams({ title, body });
  return `https://github.com/${REPO}/issues/new?${q.toString()}`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadText(filename: string, content: string, mime = "text/csv") {
  triggerDownload(new Blob([content], { type: `${mime};charset=utf-8` }), filename);
}

export function downloadBase64(filename: string, b64: string, mime: string) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  triggerDownload(new Blob([bytes], { type: mime }), filename);
}

/** Monta o snippet Python equivalente, para copiar/colar no Colab. */
export function buildCode(opts: {
  sigla: string;
  endpoint: string;
  params: Record<string, unknown>;
  paginas: number | null;
}): string {
  const { sigla, endpoint, params, paginas } = opts;

  const fmt = (v: unknown): string => {
    if (typeof v === "boolean") return v ? "True" : "False";
    if (typeof v === "number") return String(v);
    if (Array.isArray(v)) return `[${v.map((x) => fmt(x)).join(", ")}]`;
    return JSON.stringify(String(v));
  };

  // pesquisa vai como 1o argumento posicional; demais como keyword.
  const pesquisa = params.pesquisa;
  const kwargs: string[] = [];
  if (paginas != null) kwargs.push(`paginas=range(1, ${paginas + 1})`);
  for (const [k, v] of Object.entries(params)) {
    if (k === "pesquisa") continue;
    if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    kwargs.push(`${k}=${fmt(v)}`);
  }

  const firstArg = pesquisa != null && pesquisa !== "" ? fmt(pesquisa) : null;
  const callArgs = [firstArg, ...kwargs].filter(Boolean).join(",\n    ");

  return [
    "# pip install juscraper",
    "import juscraper as jus",
    "",
    `scraper = jus.scraper(${JSON.stringify(sigla)})`,
    `df = scraper.${endpoint}(`,
    `    ${callArgs},`,
    ")",
    "",
    "df.to_csv('resultado.csv', index=False)",
    "df.head()",
  ].join("\n");
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  if (min < 60) return sec ? `${min} min ${sec} s` : `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h} h ${m} min`;
}
