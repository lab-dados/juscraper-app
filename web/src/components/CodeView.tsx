import { useState } from "react";
import { COLAB_URL } from "../lib/links";

export function CodeView({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-4">
      <p className="mb-3 text-sm text-fgv-600">
        Este é o código Python equivalente à sua busca. Cole no{" "}
        <a className="text-accent hover:underline" href={COLAB_URL} target="_blank" rel="noreferrer">
          Colab
        </a>{" "}
        (ou em qualquer ambiente com o juscraper instalado) para reproduzir e baixar quantas
        páginas quiser, sem o limite da ferramenta web.
      </p>

      <div className="relative">
        <pre className="max-h-[50vh] overflow-auto rounded-lg bg-fgv-900 p-4 text-xs leading-relaxed text-fgv-50">
          <code>{code}</code>
        </pre>
        <button
          className="absolute right-3 top-3 rounded-md bg-white/10 px-3 py-1 text-xs font-semibold text-white backdrop-blur transition hover:bg-white/20"
          onClick={copy}
        >
          {copied ? "Copiado!" : "Copiar"}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn-secondary" onClick={copy}>
          {copied ? "Copiado!" : "Copiar código"}
        </button>
        <a className="btn-secondary" href={COLAB_URL} target="_blank" rel="noreferrer">
          Abrir no Colab
        </a>
      </div>
    </div>
  );
}
