import { useState } from "react";
import type { Field } from "../types";
import { TreeSelect } from "./TreeSelect";

export type FormValues = Record<string, unknown>;

function HelpLink({ url }: { url?: string }) {
  if (!url) return null;
  return (
    <a
      className="mt-1 inline-block text-xs text-accent hover:underline"
      href={url}
      target="_blank"
      rel="noreferrer"
    >
      Consultar os códigos na TPU (site do CNJ)
    </a>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  sigla,
  showCheckboxHelp,
}: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
  sigla: string;
  showCheckboxHelp: boolean;
}) {
  const id = `f-${field.name}`;

  if (field.type === "tree" && field.tree) {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div>
        <TreeSelect
          key={field.tree.file ?? `${sigla}.${field.tree.endpoint}.${field.tree.campo}`}
          sigla={sigla}
          tree={field.tree}
          value={arr}
          onChange={onChange}
          label={field.label}
          help={field.help}
        />
        <HelpLink url={field.help_url} />
      </div>
    );
  }

  if (field.type === "checkbox") {
    return (
      <div>
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
        {showCheckboxHelp && field.help && (
          <p className="mt-1 pl-6 text-xs text-fgv-400">{field.help}</p>
        )}
      </div>
    );
  }

  if (field.type === "multiselect") {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    return (
      <fieldset>
        <legend className="label">{field.label}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {field.options?.map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm text-fgv-800">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-fgv-300 text-fgv-700 focus:ring-accent/40"
                checked={arr.includes(opt)}
                onChange={(e) =>
                  onChange(e.target.checked ? [...arr, opt] : arr.filter((x) => x !== opt))
                }
              />
              {field.option_labels?.[opt] ?? opt}
            </label>
          ))}
        </div>
        {field.help && <p className="mt-1 text-xs text-fgv-400">{field.help}</p>}
      </fieldset>
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
        <HelpLink url={field.help_url} />
      </div>
    );
  }

  // text / date / number / isodate (este usa o seletor de data do navegador,
  // que ja devolve AAAA-MM-DD, o formato que o DataJud espera)
  const inputType = field.type === "isodate" ? "date" : field.type === "number" ? "number" : "text";
  return (
    <div>
      <label className="label" htmlFor={id}>
        {field.label}
        {field.required && <span className="ml-1 text-rose-500">*</span>}
      </label>
      <input
        id={id}
        type={inputType}
        inputMode={field.type === "number" ? "numeric" : undefined}
        className="input"
        placeholder={field.type === "date" ? field.format ?? "DD/MM/AAAA" : ""}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      />
      {field.help && <p className="mt-1 text-xs text-fgv-400">{field.help}</p>}
      <HelpLink url={field.help_url} />
    </div>
  );
}

export function DynamicForm({
  fields,
  values,
  onChange,
  sigla,
  showCheckboxHelp = false,
}: {
  fields: Field[];
  values: FormValues;
  onChange: (v: FormValues) => void;
  sigla: string;
  // Mostra a ajuda embaixo das caixas de marcar (aba DataJud, onde a ajuda e
  // escrita para o usuario final e nao copiada da docstring).
  showCheckboxHelp?: boolean;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const main = fields.filter((f) => !f.advanced);
  const advanced = fields.filter((f) => f.advanced);

  const set = (name: string, v: unknown) => onChange({ ...values, [name]: v });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {main.map((f) => (
          <div
            key={f.name}
            className={(f.type === "text" && f.name === "pesquisa") || f.type === "tree" ? "md:col-span-2" : ""}
          >
            <FieldInput
              field={f}
              value={values[f.name]}
              onChange={(v) => set(f.name, v)}
              sigla={sigla}
              showCheckboxHelp={showCheckboxHelp}
            />
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
                <FieldInput
                  key={f.name}
                  field={f}
                  value={values[f.name]}
                  onChange={(v) => set(f.name, v)}
                  sigla={sigla}
                  showCheckboxHelp={showCheckboxHelp}
                />
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
    else if (f.type === "list" || f.type === "tree" || f.type === "multiselect") v[f.name] = [];
    else if (f.type === "select") v[f.name] = (f.default as string) ?? f.options?.[0] ?? "";
    else v[f.name] = (f.default as string) ?? "";
  }
  return v;
}
