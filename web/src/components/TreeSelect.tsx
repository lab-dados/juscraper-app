import { useEffect, useMemo, useState } from "react";
import type { TreeMeta } from "../types";

interface TreeNode {
  id: string;
  nome: string;
  pai: string | null;
  nivel: number;
  sel: boolean;
  busca: string;
}

interface TreeFile {
  tribunal: string;
  endpoint: string;
  campo: string;
  nodes: TreeNode[];
}

type LoadState = "idle" | "loading" | "ready" | "missing";

const ROW_H = 30; // px, altura fixa por linha (virtualizacao)
const VIEWPORT_H = 288; // px (~18rem)
const OVERSCAN = 6;

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function TreeSelect({
  sigla,
  tree,
  value,
  onChange,
  label,
  help,
}: {
  sigla: string;
  tree: TreeMeta;
  value: string[];
  onChange: (v: string[]) => void;
  label: string;
  help?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>("idle");
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [manual, setManual] = useState(false);
  const [query, setQuery] = useState("");
  const [dquery, setDquery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [scrollTop, setScrollTop] = useState(0);

  const selected = useMemo(() => new Set(value), [value]);

  // Carrega o JSON da arvore na primeira abertura (lazy).
  useEffect(() => {
    if (!open || state !== "idle") return;
    const url = `${import.meta.env.BASE_URL}trees/${sigla}.${tree.endpoint}.${tree.campo}.json`;
    setState("loading");
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<TreeFile>;
      })
      .then((data) => {
        setNodes(data.nodes);
        setState("ready");
      })
      .catch(() => {
        // Sem arvore estatica disponivel: cai no modo manual (digitar IDs).
        setState("missing");
        setManual(true);
      });
  }, [open, state, sigla, tree.endpoint, tree.campo]);

  // Debounce da busca.
  useEffect(() => {
    const t = setTimeout(() => setDquery(norm(query.trim())), 150);
    return () => clearTimeout(t);
  }, [query]);

  const byId = useMemo(() => {
    const m = new Map<string, TreeNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const childrenByParent = useMemo(() => {
    const m = new Map<string, TreeNode[]>();
    for (const n of nodes) {
      if (n.pai == null) continue;
      const a = m.get(n.pai);
      if (a) a.push(n);
      else m.set(n.pai, [n]);
    }
    return m;
  }, [nodes]);

  // Para cada no, os IDs selecionaveis na sua subarvore (inclusive ele mesmo).
  // Marcar/desmarcar um pai cascateia para todos esses IDs. Como os nos vem em
  // ordem DFS (pai antes dos filhos), iterar de tras pra frente garante que os
  // filhos ja estao computados ao montar o pai.
  const selSubtree = useMemo(() => {
    const m = new Map<string, string[]>();
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const acc: string[] = n.sel ? [n.id] : [];
      const kids = childrenByParent.get(n.id);
      if (kids) for (const k of kids) for (const id of m.get(k.id) ?? []) acc.push(id);
      m.set(n.id, acc);
    }
    return m;
  }, [nodes, childrenByParent]);

  // Lista achatada visivel (em ordem DFS, que e a ordem do proprio array).
  const visible = useMemo(() => {
    const out: TreeNode[] = [];
    if (dquery) {
      // Busca: inclui nos que casam + todos os ancestrais (para alcanca-los).
      const include = new Set<string>();
      for (const n of nodes) {
        if (n.busca.includes(dquery)) {
          let cur: string | null = n.id;
          while (cur != null && !include.has(cur)) {
            include.add(cur);
            cur = byId.get(cur)?.pai ?? null;
          }
        }
      }
      for (const n of nodes) if (include.has(n.id)) out.push(n);
      return out;
    }
    // Navegacao: mostra um no se todos os ancestrais estao expandidos.
    const openForChildren = new Map<string, boolean>();
    for (const n of nodes) {
      const vis = n.pai == null ? true : openForChildren.get(n.pai) === true;
      if (vis) out.push(n);
      openForChildren.set(n.id, vis && expanded.has(n.id));
    }
    return out;
  }, [nodes, dquery, expanded, byId]);

  // Janela de virtualizacao.
  const total = visible.length;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(total, Math.ceil((scrollTop + VIEWPORT_H) / ROW_H) + OVERSCAN);
  const slice = visible.slice(start, end);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Marca/desmarca o no e TODA a sua subarvore selecionavel (comportamento do
  // eSAJ: marcar o pai marca os filhos). Se ja esta tudo marcado, desmarca tudo.
  const toggleSubtree = (id: string) => {
    const ids = selSubtree.get(id) ?? [];
    if (ids.length === 0) return;
    const next = new Set(selected);
    const allOn = ids.every((x) => next.has(x));
    for (const x of ids) (allOn ? next.delete(x) : next.add(x));
    onChange([...next]);
  };

  const chips = value.map((id) => ({ id, nome: byId.get(id)?.nome ?? id }));

  return (
    <div>
      <label className="label">{label}</label>

      {/* Selecionados: chips quando poucos, resumo quando muitos */}
      {chips.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {chips.length <= 8 ? (
            chips.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1 rounded-full bg-fgv-100 px-2 py-0.5 text-xs text-fgv-800"
              >
                <span className="max-w-[18rem] truncate" title={`${c.nome} (${c.id})`}>
                  {c.nome}
                </span>
                <button
                  type="button"
                  className="text-fgv-400 hover:text-rose-600"
                  onClick={() => {
                    const next = new Set(selected);
                    next.delete(c.id);
                    onChange([...next]);
                  }}
                  aria-label={`Remover ${c.nome}`}
                >
                  &times;
                </button>
              </span>
            ))
          ) : (
            <span className="rounded-full bg-fgv-100 px-2 py-0.5 text-xs text-fgv-800">
              {chips.length} itens selecionados
            </span>
          )}
          <button
            type="button"
            className="text-xs text-fgv-400 underline hover:text-fgv-700"
            onClick={() => onChange([])}
          >
            limpar
          </button>
        </div>
      )}

      {!open && (
        <button
          type="button"
          className="btn-secondary w-full justify-center text-sm"
          onClick={() => setOpen(true)}
        >
          {value.length > 0 ? `Selecionar (${value.length} marcado${value.length > 1 ? "s" : ""})` : "Selecionar na arvore"}
        </button>
      )}

      {open && (
        <div className="rounded-lg border border-fgv-200 bg-white">
          {state === "loading" && <p className="p-3 text-sm text-fgv-400">Carregando a arvore...</p>}

          {(state === "missing" || manual) && (
            <div className="p-3">
              {state === "missing" && (
                <p className="mb-1 text-xs text-amber-700">
                  Arvore indisponivel para este tribunal. Digite os IDs internos separados por virgula.
                </p>
              )}
              <input
                className="input"
                placeholder="IDs separados por virgula"
                value={value.join(", ")}
                onChange={(e) =>
                  onChange(
                    e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean)
                  )
                }
              />
              {state !== "missing" && (
                <button
                  type="button"
                  className="mt-2 text-xs text-fgv-500 underline hover:text-fgv-700"
                  onClick={() => setManual(false)}
                >
                  Voltar para a arvore
                </button>
              )}
            </div>
          )}

          {state === "ready" && !manual && (
            <>
              <div className="flex items-center gap-2 border-b border-fgv-100 p-2">
                <input
                  className="input flex-1"
                  placeholder="Buscar por nome..."
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setScrollTop(0);
                  }}
                />
                <button
                  type="button"
                  className="text-xs text-fgv-400 underline hover:text-fgv-700"
                  onClick={() => setManual(true)}
                  title="Digitar IDs manualmente"
                >
                  IDs
                </button>
              </div>

              <div
                className="overflow-auto"
                style={{ height: VIEWPORT_H }}
                onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
              >
                {total === 0 ? (
                  <p className="p-3 text-sm text-fgv-400">Nenhum resultado para a busca.</p>
                ) : (
                  <div style={{ height: total * ROW_H, position: "relative" }}>
                    <div style={{ transform: `translateY(${start * ROW_H}px)` }}>
                      {slice.map((n) => {
                        const depth = n.nivel - 1;
                        const expandable = childrenByParent.has(n.id);
                        const isOpen = expanded.has(n.id) || Boolean(dquery);
                        const sub = selSubtree.get(n.id) ?? [];
                        const onCount = sub.reduce((c, x) => c + (selected.has(x) ? 1 : 0), 0);
                        const checked = sub.length > 0 && onCount === sub.length;
                        const indeterminate = onCount > 0 && onCount < sub.length;
                        return (
                          <div
                            key={`${n.id}-${n.pai ?? "r"}`}
                            className="flex items-center gap-1 px-2 text-sm hover:bg-fgv-50"
                            style={{ height: ROW_H, paddingLeft: 8 + depth * 16 }}
                          >
                            {expandable ? (
                              <button
                                type="button"
                                className="w-4 shrink-0 text-fgv-400"
                                onClick={() => toggleExpand(n.id)}
                                aria-label={isOpen ? "Recolher" : "Expandir"}
                              >
                                {isOpen ? "▾" : "▸"}
                              </button>
                            ) : (
                              <span className="w-4 shrink-0" />
                            )}
                            {sub.length > 0 ? (
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 shrink-0 rounded border-fgv-300 text-fgv-700"
                                checked={checked}
                                ref={(el) => {
                                  if (el) el.indeterminate = indeterminate;
                                }}
                                onChange={() => toggleSubtree(n.id)}
                              />
                            ) : (
                              <span className="w-3.5 shrink-0" />
                            )}
                            <span
                              className="cursor-pointer truncate text-fgv-800"
                              title={`${n.nome} (${n.id})`}
                              onClick={() => (expandable ? toggleExpand(n.id) : toggleSubtree(n.id))}
                            >
                              {n.nome}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          <div className="flex justify-end border-t border-fgv-100 p-2">
            <button
              type="button"
              className="text-xs font-medium text-fgv-500 hover:text-fgv-700"
              onClick={() => setOpen(false)}
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {help && <p className="mt-1 text-xs text-fgv-400">{help}</p>}
    </div>
  );
}
