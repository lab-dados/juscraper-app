import type { CourtEndpoint, CourtMeta, DatajudTribunal, SupportStatus } from "../types";

const STATUS_BADGE: Record<SupportStatus, { label: string; cls: string }> = {
  supported: { label: "", cls: "" },
  experimental: { label: "experimental", cls: "bg-amber-100 text-amber-700" },
  unsupported: { label: "indisponível", cls: "bg-rose-100 text-rose-700" },
};

export function TribunalSelect({
  courts,
  endpoint,
  value,
  onChange,
}: {
  courts: CourtMeta[];
  endpoint: CourtEndpoint;
  value: string | null;
  onChange: (sigla: string) => void;
}) {
  // Só tribunais que têm o endpoint atual.
  const available = courts.filter((c) => c.endpoints[endpoint]);
  const selected = courts.find((c) => c.sigla === value);
  const badge = selected ? STATUS_BADGE[selected.support.status] : null;

  return (
    <div>
      <label className="label" htmlFor="tribunal">
        Tribunal
      </label>
      <select
        id="tribunal"
        className="input"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="" disabled>
          Selecione um tribunal…
        </option>
        {available.map((c) => {
          const disabled = c.support.status === "unsupported";
          return (
            <option key={c.sigla} value={c.sigla} disabled={disabled}>
              {c.nome}
              {disabled ? " (indisponível: captcha)" : ""}
              {c.support.status === "experimental" ? " (experimental)" : ""}
            </option>
          );
        })}
      </select>

      {selected && badge?.label && (
        <div className="mt-2 flex items-start gap-2 text-xs">
          <span className={`rounded-full px-2 py-0.5 font-semibold ${badge.cls}`}>
            {badge.label}
          </span>
          <span className="text-fgv-500">{selected.support.reason}</span>
        </div>
      )}
    </div>
  );
}

/** Seletor de tribunal da aba DataJud: todos os índices da API pública do CNJ. */
export function DatajudTribunalSelect({
  tribunais,
  value,
  onChange,
}: {
  tribunais: DatajudTribunal[];
  value: string | null;
  onChange: (sigla: string) => void;
}) {
  const grupos: { grupo: string; itens: DatajudTribunal[] }[] = [];
  for (const t of tribunais) {
    const g = grupos.find((x) => x.grupo === t.grupo);
    if (g) g.itens.push(t);
    else grupos.push({ grupo: t.grupo, itens: [t] });
  }

  return (
    <div>
      <label className="label" htmlFor="tribunal-datajud">
        Tribunal
      </label>
      <select
        id="tribunal-datajud"
        className="input"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="" disabled>
          Selecione um tribunal…
        </option>
        {grupos.map((g) => (
          <optgroup key={g.grupo} label={g.grupo}>
            {g.itens.map((t) => (
              <option key={t.sigla} value={t.sigla}>
                {t.sigla}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
