import { useState } from "react";
import { COLAB_URL } from "../lib/links";
import { createColabGist } from "../lib/utils";
import { track } from "../lib/analytics";

const PROXY_URL = (import.meta.env.VITE_PROXY_URL as string | undefined) ?? "";

export function CodeView({
  code,
  sigla,
  endpoint,
}: {
  code: string;
  sigla: string;
  endpoint: string;
}) {
  const [copied, setCopied] = useState(false);
  const [colab, setColab] = useState<"idle" | "loading" | "error">("idle");

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Gera um notebook .ipynb com a busca exata e abre no Colab (via Gist no proxy).
  const openColab = async () => {
    // Abre a aba já no clique (gesto do usuário) para não ser bloqueada por popup.
    const tab = window.open("", "_blank");
    setColab("loading");
    track("colab", { tribunal: sigla, endpoint });
    try {
      const url = await createColabGist(PROXY_URL, code);
      if (tab) tab.location.href = url;
      else window.open(url, "_blank");
      setColab("idle");
    } catch {
      // Fallback: abre o notebook template genérico.
      if (tab) tab.location.href = COLAB_URL;
      else window.open(COLAB_URL, "_blank");
      setColab("error");
    }
  };

  return (
    <div className="p-4">
      <p className="mb-3 text-sm text-fgv-600">
        Este é o código Python equivalente à sua busca. Abra no Colab um notebook já com esses
        parâmetros, ou copie o código para rodar em qualquer ambiente com o juscraper instalado,
        sem o limite de páginas da ferramenta web.
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

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn-primary" onClick={openColab} disabled={colab === "loading"}>
          {colab === "loading" ? "Gerando notebook…" : "Abrir no Colab com esta busca"}
        </button>
        <button className="btn-secondary" onClick={copy}>
          {copied ? "Copiado!" : "Copiar código"}
        </button>
      </div>

      {colab === "error" && (
        <p className="mt-2 text-xs text-amber-700">
          Não consegui gerar o notebook customizado agora. Abri o notebook genérico do Colab;
          você pode colar o código acima nele.
        </p>
      )}
    </div>
  );
}
