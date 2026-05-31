import type { CourtMeta, Endpoint, SupportStatus } from "../types";

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
  endpoint: Endpoint;
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
