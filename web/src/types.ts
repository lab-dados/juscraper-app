// Tipos compartilhados entre a UI e o bridge do Pyodide.

export type FieldType =
  | "text"
  | "textarea"
  | "checkbox"
  | "select"
  | "date"
  | "list"
  | "tree"
  | "number" // inteiro (ex.: ano_ajuizamento)
  | "isodate" // data AAAA-MM-DD (seletor nativo do navegador)
  | "multiselect"; // varias opcoes fixas (caixas de marcar)

export interface TreeMeta {
  endpoint: string;
  campo: string;
  multiple: boolean;
  // Arquivo em web/public/trees/ quando a arvore nao depende do tribunal
  // (ex.: TPU do CNJ na aba DataJud). Sem ele: <sigla>.<endpoint>.<campo>.json.
  file?: string;
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
  option_labels?: Record<string, string>;
  format?: string;
  tree?: TreeMeta;
  help_url?: string;
  // "int": os itens da lista vao como numeros para o juscraper.
  value_type?: "int";
}

export interface EndpointMeta {
  fields: Field[];
}

export type SupportStatus = "supported" | "experimental" | "unsupported";

export interface CourtMeta {
  sigla: string;
  nome: string;
  endpoints: Partial<Record<CourtEndpoint, EndpointMeta>>;
  support: { status: SupportStatus; reason: string };
}

export interface DatajudTribunal {
  sigla: string;
  grupo: string;
}

export interface DatajudMeta {
  fields: Field[];
  tribunais: DatajudTribunal[];
}

export interface CourtsMeta {
  juscraper_version: string;
  endpoint_labels: Record<string, string>;
  courts: CourtMeta[];
  datajud?: DatajudMeta;
}

// Endpoints por tribunal (cjsg/cjpg) + a aba do agregador DataJud.
export type CourtEndpoint = "cjsg" | "cjpg";
export type Endpoint = CourtEndpoint | "datajud";

export interface CountResult {
  ok: boolean;
  n_pags: number | null;
  sleep_time: number;
  // DataJud: total de processos, se e exato ("eq") e processos por requisicao.
  n_itens?: number;
  relation?: string;
  tamanho_pagina?: number;
  error?: string;
  traceback?: string;
  sigla?: string;
  endpoint?: string;
}

export interface ExtraTable {
  key: string;
  label: string;
  csv: string;
  n_rows: number;
}

export interface RunResult {
  ok: boolean;
  columns: string[];
  records: Record<string, unknown>[];
  csv: string;
  xlsx_b64: string;
  n_rows: number;
  // DataJud: tabelas extras para download (movimentacoes) e avisos da API.
  extras?: ExtraTable[];
  avisos?: string[];
  error?: string;
  traceback?: string;
  sigla?: string;
  endpoint?: string;
}
