import type { Endpoint } from "../types";

interface Tab {
  key: Endpoint | "soon";
  label: string;
  soon?: boolean;
}

const TABS: Tab[] = [
  { key: "cjsg", label: "Jurisprudência (2º grau)" },
  { key: "cjpg", label: "Banco de Sentenças (1º grau)" },
  { key: "soon", label: "Consulta processual", soon: true },
];

export function SearchTabs({
  value,
  onChange,
}: {
  value: Endpoint;
  onChange: (e: Endpoint) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-fgv-100">
      {TABS.map((tab) => {
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            type="button"
            disabled={tab.soon}
            onClick={() => !tab.soon && onChange(tab.key as Endpoint)}
            className={[
              "relative -mb-px rounded-t-md px-4 py-2.5 text-sm font-medium transition",
              tab.soon
                ? "cursor-not-allowed text-fgv-300"
                : active
                  ? "border-b-2 border-fgv-700 text-fgv-800"
                  : "text-fgv-500 hover:text-fgv-700",
            ].join(" ")}
          >
            {tab.label}
            {tab.soon && (
              <span className="ml-2 rounded-full bg-fgv-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-fgv-400">
                em breve
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
