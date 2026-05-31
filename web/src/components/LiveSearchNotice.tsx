import { useState } from "react";

export function LiveSearchNotice() {
  const [open, setOpen] = useState(true);
  if (!open) return null;

  return (
    <div className="card border-amber-200 bg-amber-50 p-4">
      <div className="flex gap-3">
        <span className="mt-0.5 text-amber-600" aria-hidden>
          ⚠️
        </span>
        <div className="flex-1 text-sm text-amber-900">
          <p className="font-semibold">A busca é feita ao vivo, na hora.</p>
          <p className="mt-1 text-amber-800">
            Não há base de dados pré-baixada. Cada consulta acessa o site do tribunal no
            momento em que você roda, então o tempo depende do número de páginas e da
            velocidade do tribunal. Os dados são processados no seu navegador; nada é enviado
            para um servidor nosso.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Fechar aviso"
          className="ml-2 text-amber-500 transition hover:text-amber-700"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
