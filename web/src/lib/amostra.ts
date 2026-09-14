// Sorteio reproduzivel (com semente) de uma amostra aleatoria simples, feito no
// navegador sobre a lista ja baixada. Funcoes puras, sem React, para poder
// testar no Node.

/** Gerador pseudoaleatorio mulberry32: a mesma semente gera a mesma sequencia. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** k indices distintos de 0..n-1, na ordem do sorteio (Fisher-Yates parcial). */
export function sortearIndices(n: number, k: number, seed: number): number[] {
  const rand = mulberry32(seed);
  const idx = Array.from({ length: n }, (_, i) => i);
  const m = Math.max(0, Math.min(k, n));
  for (let i = 0; i < m; i++) {
    const j = i + Math.floor(rand() * (n - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, m);
}

export function novaSemente(): number {
  return 1 + Math.floor(Math.random() * 999999);
}

/**
 * Ordem canonica da lista antes do sorteio (por uma coluna-chave, comparacao
 * por codigo de caractere). Assim, a mesma lista com a mesma semente da a
 * mesma amostra, mesmo que a tabela tenha sido reordenada na tela.
 */
export function ordenarPor<T extends Record<string, unknown>>(rows: T[], chave: string): T[] {
  return [...rows].sort((a, b) => {
    const x = String(a[chave] ?? "");
    const y = String(b[chave] ?? "");
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

function campoCsv(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Monta um CSV (separador virgula, aspas quando preciso), como o pandas. */
export function paraCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const linhas = [columns.map(campoCsv).join(",")];
  for (const r of rows) linhas.push(columns.map((c) => campoCsv(r[c])).join(","));
  return `${linhas.join("\n")}\n`;
}

/** Divide um CSV em registros, respeitando aspas (campos com quebra de linha). */
export function registrosCsv(csv: string): string[] {
  const out: string[] = [];
  let ini = 0;
  let aspas = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv.charCodeAt(i);
    if (ch === 34) aspas = !aspas; // "
    else if (ch === 10 && !aspas) {
      out.push(csv.slice(ini, i).replace(/\r$/, ""));
      ini = i + 1;
    }
  }
  if (ini < csv.length) out.push(csv.slice(ini));
  return out;
}

/**
 * Mantem o cabecalho e os registros cujos dois primeiros campos formam uma
 * chave de `chaves` ("numero_processo,grau"). Esses dois campos nunca levam
 * virgula nem aspas (numero CNJ formatado e sigla do grau).
 */
export function filtrarCsvPorChave(csv: string, chaves: Set<string>): string {
  const regs = registrosCsv(csv);
  if (regs.length === 0) return csv;
  const out = [regs[0]];
  for (const r of regs.slice(1)) {
    const p1 = r.indexOf(",");
    const p2 = p1 < 0 ? -1 : r.indexOf(",", p1 + 1);
    if (p2 < 0) continue;
    if (chaves.has(r.slice(0, p2))) out.push(r);
  }
  return `${out.join("\n")}\n`;
}
