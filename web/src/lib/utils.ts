// Utilidades pequenas: link de issue no juscraper, download de arquivo, tempo.
import type { Field } from "../types";

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

/** Valor JS -> literal Python. */
function pyLiteral(v: unknown): string {
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return `[${v.map((x) => pyLiteral(x)).join(", ")}]`;
  return JSON.stringify(String(v));
}

const vazio = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0);

/** Monta o snippet Python equivalente, para copiar/colar no Colab. */
export function buildCode(opts: {
  sigla: string;
  endpoint: string;
  params: Record<string, unknown>;
  paginas: number | null;
}): string {
  const { sigla, endpoint, params, paginas } = opts;

  // pesquisa vai como 1o argumento posicional; demais como keyword.
  const pesquisa = params.pesquisa;
  const kwargs: string[] = [];
  if (paginas != null) kwargs.push(`paginas=range(1, ${paginas + 1})`);
  for (const [k, v] of Object.entries(params)) {
    if (k === "pesquisa") continue;
    if (vazio(v)) continue;
    kwargs.push(`${k}=${pyLiteral(v)}`);
  }

  const firstArg = pesquisa != null && pesquisa !== "" ? pyLiteral(pesquisa) : null;
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

/**
 * Converte os valores do formulário para os tipos que o juscraper espera:
 * árvore de seleção única vira string, campo numérico vira número e listas
 * marcadas com value_type "int" viram listas de inteiros.
 */
export function callParams(fields: Field[], values: Record<string, unknown>): Record<string, unknown> {
  const byName = new Map(fields.map((f) => [f.name, f]));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    const f = byName.get(k);
    if (f?.type === "tree" && f.tree && !f.tree.multiple) {
      out[k] = Array.isArray(v) ? (v[0] ?? "") : v;
    } else if (f?.type === "number") {
      const s = String(v ?? "").trim();
      out[k] = s === "" || !Number.isFinite(Number(s)) ? "" : Number(s);
    } else if (f?.value_type === "int" && Array.isArray(v)) {
      out[k] = v.map((x) => Number(x)).filter((n) => Number.isFinite(n));
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Problema de preenchimento na aba DataJud (null = ok). */
export function datajudProblem(params: Record<string, unknown>): string | null {
  const ini = String(params.data_ajuizamento_inicio ?? "");
  const fim = String(params.data_ajuizamento_fim ?? "");
  if (!vazio(params.ano_ajuizamento) && (ini || fim)) {
    return "Use o ano de ajuizamento OU o intervalo de datas, não os dois.";
  }
  if (ini && fim && ini > fim) return "A data inicial do ajuizamento é posterior à final.";
  return null;
}

/**
 * Código Python da aba DataJud: a chamada ao juscraper + as mesmas tabelas que
 * o app oferece para download (uma linha por processo e, com movimentações,
 * uma linha por movimentação).
 */
export function buildDatajudCode(opts: {
  params: Record<string, unknown>;
  paginas: number | null;
  tamanhoPagina?: number;
}): string {
  const { params, paginas, tamanhoPagina } = opts;
  const movs = params.mostrar_movs === true;
  const kwargs: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (vazio(v) || v === false) continue;
    kwargs.push(`${k}=${pyLiteral(v)}`);
  }
  if (paginas != null) {
    kwargs.push(`paginas=${paginas}`);
    if (tamanhoPagina) kwargs.push(`tamanho_pagina=${tamanhoPagina}`);
  }
  const call =
    kwargs.length === 0
      ? "df = dj.listar_processos()"
      : ["df = dj.listar_processos(", `    ${kwargs.join(",\n    ")},`, ")"].join("\n");

  const lines = [
    "# pip install juscraper",
    "import juscraper as jus",
    "import pandas as pd",
    "",
    'dj = jus.scraper("datajud")',
    call,
    "",
    "",
    "def data(s):",
    '    """O DataJud mistura datas ISO (2024-01-30T12:46:42Z) e AAAAMMDDhhmmss."""',
    '    return pd.to_datetime(s, format="mixed", utc=True, errors="coerce").dt.tz_localize(None)',
    "",
    "",
    "def cnj(s):",
    '    """20 digitos -> NNNNNNN-DD.AAAA.J.TR.OOOO."""',
    '    return s.str.replace(r"^(\\d{7})(\\d{2})(\\d{4})(\\d)(\\d{2})(\\d{4})$", r"\\1-\\2.\\3.\\4.\\5.\\6", regex=True)',
    "",
    "",
    "# Uma linha por processo (o mesmo número pode aparecer uma vez por grau)",
    "processos = pd.DataFrame({",
    '    "numero_processo": cnj(df["numeroProcesso"]),',
    '    "grau": df["grau"],',
    '    "classe_codigo": df["classe"].str["codigo"],',
    '    "classe_nome": df["classe"].str["nome"],',
    '    "assuntos_nomes": df["assuntos"].map(',
    '        lambda xs: "; ".join(a.get("nome", "") for a in xs if isinstance(a, dict))',
    "        if isinstance(xs, list) else None",
    "    ),",
    '    "orgao_julgador_nome": df["orgaoJulgador"].str["nome"],',
    '    "data_ajuizamento": data(df["dataAjuizamento"]),',
    "})",
    "processos.to_csv('processos.csv', index=False)",
  ];
  if (movs) {
    lines.push(
      "",
      "# Movimentações em formato longo: uma linha por movimentação",
      'movs = df[["numeroProcesso", "grau", "movimentos"]].explode("movimentos", ignore_index=True)',
      'movs = movs.dropna(subset=["movimentos"]).reset_index(drop=True)',
      "movs = pd.concat([",
      '    movs[["numeroProcesso", "grau"]],',
      '    pd.json_normalize(movs["movimentos"].tolist()).reindex(columns=["dataHora", "codigo", "nome"]),',
      "], axis=1)",
      'movs.columns = ["numero_processo", "grau", "data_hora", "codigo", "nome"]',
      'movs["numero_processo"] = cnj(movs["numero_processo"])',
      'movs["data_hora"] = data(movs["data_hora"])',
      'movs = movs.sort_values(["numero_processo", "grau", "data_hora"])',
      "movs.to_csv('movimentacoes.csv', index=False)",
    );
  }
  lines.push("processos.head()");
  return lines.join("\n");
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
