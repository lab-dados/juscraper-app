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
  const args = [firstArg, ...kwargs].filter(Boolean) as string[];

  // Sem nenhum argumento ainda (preview do formulario vazio): chamada limpa.
  const call =
    args.length === 0
      ? `df = scraper.${endpoint}()`
      : [`df = scraper.${endpoint}(`, `    ${args.join(",\n    ")},`, ")"].join("\n");

  return [
    "# pip install juscraper",
    "import juscraper as jus",
    "",
    `scraper = jus.scraper(${JSON.stringify(sigla)})`,
    call,
    "",
    "df.to_csv('resultado.csv', index=False)",
    "df.head()",
  ].join("\n");
}

/** Monta um notebook .ipynb (string JSON) com a busca da pessoa, para o Colab. */
export function buildNotebookIpynb(code: string): string {
  const lines = (text: string) => text.split("\n").map((l) => `${l}\n`);
  // Remove a 1a linha "# pip install ..." do snippet; o install vira célula própria.
  const queryCode = code.replace(/^# pip install[^\n]*\n/, "");

  const nb = {
    cells: [
      {
        cell_type: "markdown",
        metadata: {},
        source: [
          "# Busca juscraper\n",
          "\n",
          "Notebook gerado pela [ferramenta do LabDados FGV](https://lab-dados.github.io/juscraper-app/) ",
          "com os parametros exatos da sua busca. Rode as celulas em ordem.\n",
        ],
      },
      {
        cell_type: "code",
        metadata: {},
        execution_count: null,
        outputs: [],
        source: ["%pip install -q juscraper openpyxl"],
      },
      {
        cell_type: "code",
        metadata: {},
        execution_count: null,
        outputs: [],
        source: lines(queryCode),
      },
    ],
    metadata: {
      colab: { provenance: [] },
      kernelspec: { name: "python3", display_name: "Python 3" },
      language_info: { name: "python" },
    },
    nbformat: 4,
    nbformat_minor: 0,
  };
  return JSON.stringify(nb, null, 1);
}

/** Cria um Gist (via proxy) com o notebook e retorna a URL do Colab. */
export async function createColabGist(proxyUrl: string, code: string): Promise<string> {
  const content = buildNotebookIpynb(code);
  const res = await fetch(`${proxyUrl.replace(/\/$/, "")}/gist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: "juscraper_busca.ipynb",
      content,
      description: "Busca gerada pela ferramenta juscraper-app (LabDados FGV)",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.colabUrl) throw new Error(data.error || "Falha ao gerar o notebook.");
  return data.colabUrl as string;
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
