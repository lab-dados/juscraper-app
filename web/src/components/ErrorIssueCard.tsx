import { useState } from "react";
import { buildIssueUrl } from "../lib/utils";

export function ErrorIssueCard({
  error,
  traceback,
  sigla,
  endpoint,
  params,
  onDismiss,
}: {
  error: string;
  traceback: string;
  sigla: string;
  endpoint: string;
  params: Record<string, unknown>;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const issueUrl = buildIssueUrl({ error, traceback, sigla, endpoint, params });
  const detail = `Tribunal: ${sigla}\nEndpoint: ${endpoint}\nParâmetros: ${JSON.stringify(
    params
  )}\n\n${error}\n\n${traceback}`;

  const copy = async () => {
    await navigator.clipboard.writeText(detail);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="card border-rose-200 bg-rose-50 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-rose-800">A busca falhou</h3>
          <p className="mt-1 text-sm text-rose-700">{error}</p>
        </div>
        <button className="text-rose-400 hover:text-rose-600" onClick={onDismiss} aria-label="Fechar">
          ✕
        </button>
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium text-rose-700">
          Ver detalhes técnicos
        </summary>
        <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-white p-3 text-xs text-fgv-700">
          {traceback}
        </pre>
      </details>

      <div className="mt-4 flex flex-wrap gap-2">
        <a className="btn-primary" href={issueUrl} target="_blank" rel="noreferrer">
          Abrir issue no juscraper
        </a>
        <button className="btn-secondary" onClick={copy}>
          {copied ? "Copiado!" : "Copiar erro"}
        </button>
      </div>
      <p className="mt-2 text-xs text-rose-600">
        O link já vem preenchido com o erro e os parâmetros. Revise antes de enviar (pode conter
        sua busca).
      </p>
    </div>
  );
}
