import { useState } from "react";
import type { Field } from "../types";

export type FormValues = Record<string, unknown>;

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const id = `f-${field.name}`;

  if (field.type === "checkbox") {
    return (
      <label htmlFor={id} className="flex items-center gap-2 text-sm text-fgv-800">
        <input
          id={id}
          type="checkbox"
          className="h-4 w-4 rounded border-fgv-300 text-fgv-700 focus:ring-accent/40"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        {field.label}
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <div>
        <label className="label" htmlFor={id}>
          {field.label}
        </label>
        <select id={id} className="input" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {field.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type === "list") {
    const text = Array.isArray(value) ? value.join(", ") : String(value ?? "");
    return (
      <div>
        <label className="label" htmlFor={id}>
          {field.label}
        </label>
        <input
          id={id}
          className="input"
          placeholder="IDs separados por vírgula"
          value={text}
          onChange={(e) =>
            onChange(
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            )
          }
        />
        {field.help && <p className="mt-1 text-xs text-fgv-400">{field.help}</p>}
      </div>
    );
  }

  // text / date
  return (
    <div>
      <label className="label" htmlFor={id}>
        {field.label}
        {field.required && <span className="ml-1 text-rose-500">*</span>}
      </label>
      <input
        id={id}
        className="input"
        placeholder={field.type === "date" ? field.format ?? "DD/MM/AAAA" : ""}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      />
      {field.help && <p className="mt-1 text-xs text-fgv-400">{field.help}</p>}
    </div>
  );
}

export function DynamicForm({
  fields,
  values,
  onChange,
}: {
  fields: Field[];
  values: FormValues;
  onChange: (v: FormValues) => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const main = fields.filter((f) => !f.advanced);
  const advanced = fields.filter((f) => f.advanced);

  const set = (name: string, v: unknown) => onChange({ ...values, [name]: v });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {main.map((f) => (
          <div key={f.name} className={f.type === "text" && f.name === "pesquisa" ? "md:col-span-2" : ""}>
            <FieldInput field={f} value={values[f.name]} onChange={(v) => set(f.name, v)} />
          </div>
        ))}
      </div>

      {advanced.length > 0 && (
        <div className="border-t border-fgv-100 pt-3">
          <button
            type="button"
            className="text-sm font-medium text-fgv-500 hover:text-fgv-700"
            onClick={() => setShowAdvanced((s) => !s)}
          >
            {showAdvanced ? "▾" : "▸"} Opções avançadas
          </button>
          {showAdvanced && (
            <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
              {advanced.map((f) => (
                <FieldInput key={f.name} field={f} value={values[f.name]} onChange={(v) => set(f.name, v)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Valores iniciais a partir dos defaults dos campos. */
export function initialValues(fields: Field[]): FormValues {
  const v: FormValues = {};
  for (const f of fields) {
    if (f.type === "checkbox") v[f.name] = Boolean(f.default);
    else if (f.type === "list") v[f.name] = [];
    else if (f.type === "select") v[f.name] = (f.default as string) ?? f.options?.[0] ?? "";
    else v[f.name] = (f.default as string) ?? "";
  }
  return v;
}
