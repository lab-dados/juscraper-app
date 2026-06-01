import { useState } from "react";
import { CodeView } from "./CodeView";

/**
 * Previa do codigo juscraper equivalente ao formulario, atualizada ao vivo
 * (antes de rodar). Deixa a pessoa escolher entre rodar aqui ou levar o
 * codigo / abrir no Colab. Recolhivel para nao ocupar espaco demais.
 */
export function CodePreview({
  code,
  sigla,
  endpoint,
}: {
  code: string;
  sigla: string;
  endpoint: string;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-lg border border-fgv-100 bg-fgv-50/40">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-2 text-sm font-medium text-fgv-600 hover:text-fgv-800"
        onClick={() => setOpen((s) => !s)}
      >
        <span>{open ? "▾" : "▸"} Código equivalente (rodar em outro lugar ou no Colab)</span>
        <span className="text-xs font-normal text-fgv-400">atualiza conforme você preenche</span>
      </button>
      {open && <CodeView code={code} sigla={sigla} endpoint={endpoint} />}
    </div>
  );
}
