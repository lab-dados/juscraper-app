// Tipos compartilhados entre a UI e o bridge do Pyodide.

export type FieldType = "text" | "textarea" | "checkbox" | "select" | "date" | "list" | "tree";

export interface TreeMeta {
  endpoint: string;
  campo: string;
  multiple: boolean;
}

export interface Field {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  advanced: boolean;
  help: string | null;
  default?: unknown;
  options?: string[];
  format?: string;
  tree?: TreeMeta;
}

export interface EndpointMeta {
  fields: Field[];
}

export type SupportStatus = "supported" | "experimental" | "unsupported";

export interface CourtMeta {
  sigla: string;
  nome: string;
  endpoints: Partial<Record<"cjsg" | "cjpg", EndpointMeta>>;
  support: { status: SupportStatus; reason: string };
}

export interface CourtsMeta {
  juscraper_version: string;
  endpoint_labels: Record<string, string>;
  courts: CourtMeta[];
}

export type Endpoint = "cjsg" | "cjpg";

export interface CountResult {
  ok: boolean;
  n_pags: number | null;
  sleep_time: number;
  error?: string;
  traceback?: string;
  sigla?: string;
  endpoint?: string;
}

export interface RunResult {
  ok: boolean;
  columns: string[];
  records: Record<string, unknown>[];
  csv: string;
  xlsx_b64: string;
  n_rows: number;
  error?: string;
  traceback?: string;
  sigla?: string;
  endpoint?: string;
}
