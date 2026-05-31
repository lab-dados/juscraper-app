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

export function downloadText(filename: string, content: string, mime = "text/csv") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
