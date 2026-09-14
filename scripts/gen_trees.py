"""Gera as arvores de classes/assuntos/orgaos/varas em web/public/trees/.

Roda no .venv (Python real, NAO no browser). Duas fontes:

1. **eSAJ**: para cada tribunal da familia eSAJ que exponha os metodos
   ``listar_*`` (juscraper #228), baixa as arvores de selecao e grava um JSON
   achatado por (tribunal, endpoint, campo) que o componente TreeSelect do front
   carrega sob demanda.
2. **TPU do CNJ** (aba Processos/DataJud): classes, assuntos e movimentos da
   Tabela Processual Unificada, baixados da API publica da TPU
   (gateway.cloud.pje.jus.br). Os codigos TPU sao os mesmos que o DataJud usa em
   ``classe.codigo``, ``assuntos.codigo`` e ``movimentos.codigo``. Gera
   ``tpu.classes.json``, ``tpu.assuntos.json`` e ``tpu.movimentos.json``.

Tolerante a falhas: se nenhum tribunal expuser ``listar_classes`` (versao
anterior ao PR #228), ou se a API da TPU estiver fora do ar, loga um aviso e
segue sem mexer nos arquivos existentes. Assim a Action diaria nao quebra; o
front cai no input manual de codigos quando uma arvore nao existe.

    .venv/Scripts/python.exe scripts/gen_trees.py              # tudo
    .venv/Scripts/python.exe scripts/gen_trees.py --tpu-only   # so a TPU (rapido)

Para testar localmente contra uma branch do juscraper ainda nao publicada:

    PYTHONPATH=/caminho/para/juscraper/src python scripts/gen_trees.py
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import requests
import unidecode

import juscraper
from juscraper import _SCRAPERS

# (endpoint, campo do formulario) -> (metodo listar_*, grau).
# Os nomes de campo batem com os de web/src/data/courts_meta.json.
TREE_FIELDS: dict[str, list[tuple[str, str, str]]] = {
    "cjsg": [
        ("classe", "listar_classes", "2"),
        ("assunto", "listar_assuntos", "2"),
        ("orgao_julgador", "listar_orgaos", "2"),
    ],
    "cjpg": [
        ("classe", "listar_classes", "1"),
        ("assunto", "listar_assuntos", "1"),
        ("vara", "listar_varas", "1"),
    ],
}

OUT_DIR = Path(__file__).resolve().parent.parent / "web" / "public" / "trees"

# API publica da TPU (CNJ/PDPJ). ``download/<tabela>`` devolve a tabela inteira
# (lista plana com ``cod_item_pai``). Os nomes de arquivo batem com o campo
# ``tree.file`` que scripts/gen_courts_meta.py grava para a aba DataJud.
TPU_URL = "https://gateway.cloud.pje.jus.br/tpu/api/v1/publico/download/{tabela}"
# tabela TPU -> (chave do codigo no JSON da TPU, arquivo de saida)
TPU_TABLES: dict[str, tuple[str, str]] = {
    "classes": ("cod_item", "tpu.classes.json"),
    "assuntos": ("cod_item", "tpu.assuntos.json"),
    "movimentos": ("id", "tpu.movimentos.json"),
}


def _write_tree(filename: str, payload: dict) -> int:
    out = OUT_DIR / filename
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    out.write_text(text, encoding="utf-8")
    size = len(text.encode("utf-8"))
    print(f"  OK {out.name}: {len(payload['nodes'])} nos, {size/1024:.0f} KB")
    return size


def _build_nodes(df) -> list[dict]:
    """Converte o DataFrame de :func:`listar_*` no formato achatado do front."""
    nodes: list[dict] = []
    for row in df.itertuples(index=False):
        # ``caminho`` ja concatena nome + ancestrais; usamos como indice de
        # busca (minusculo, sem acento) para filtrar barato no cliente.
        busca = unidecode.unidecode(str(row.caminho)).lower()
        nodes.append({
            "id": str(row.id),
            "nome": str(row.nome),
            "pai": None if row.id_pai is None else str(row.id_pai),
            "nivel": int(row.nivel),
            "sel": bool(row.selecionavel),
            "busca": busca,
        })
    return nodes


def build_tpu_nodes(items: list[dict], id_key: str) -> list[dict]:
    """Achata uma tabela da TPU no formato do TreeSelect, em ordem DFS.

    O TreeSelect exige que cada pai venha antes dos filhos (ordem DFS). Irmaos
    ficam em ordem alfabetica. O codigo TPU entra no nome exibido (a pessoa
    aprende o codigo que vai no filtro) e no indice de busca (da para buscar
    por "49" ou por "usucapiao"). Itens inativos continuam na lista, porque
    processos antigos ainda usam esses codigos, mas ficam sinalizados.
    """
    by_id: dict[str, dict] = {}
    for it in items:
        cod = it.get(id_key)
        if cod is None:
            continue
        by_id[str(cod)] = it

    children: dict[str | None, list[str]] = {}
    for cod, it in by_id.items():
        pai = it.get("cod_item_pai")
        pai_id = str(pai) if pai is not None and str(pai) in by_id else None
        children.setdefault(pai_id, []).append(cod)

    def sort_key(cod: str) -> str:
        return unidecode.unidecode(str(by_id[cod].get("nome") or "")).lower()

    nodes: list[dict] = []
    # DFS iterativa (a TPU tem ~6 niveis; pilha explicita evita recursao).
    stack: list[tuple[str, str | None, int]] = [
        (cod, None, 1) for cod in sorted(children.get(None, []), key=sort_key, reverse=True)
    ]
    while stack:
        cod, pai_id, nivel = stack.pop()
        it = by_id[cod]
        nome = str(it.get("nome") or "").strip()
        inativo = str(it.get("situacao") or "").upper() == "I"
        rotulo = f"{nome} ({cod}, inativo)" if inativo else f"{nome} ({cod})"
        nodes.append({
            "id": cod,
            "nome": rotulo,
            "pai": pai_id,
            "nivel": nivel,
            "sel": True,
            "busca": unidecode.unidecode(f"{nome} {cod}").lower(),
        })
        for filho in sorted(children.get(cod, []), key=sort_key, reverse=True):
            stack.append((filho, cod, nivel + 1))
    return nodes


def gen_tpu() -> tuple[int, int]:
    """Baixa classes/assuntos/movimentos da TPU. Retorna (arquivos, bytes)."""
    gerados = 0
    total_bytes = 0
    for tabela, (id_key, filename) in TPU_TABLES.items():
        url = TPU_URL.format(tabela=tabela)
        try:
            resp = requests.get(url, timeout=180)
            resp.raise_for_status()
            items = resp.json()
        except Exception as exc:  # noqa: BLE001
            # rede/API fora do ar: loga e segue; o front cai no input manual.
            print(f"  ! tpu.{tabela}: {exc}", file=sys.stderr)
            continue
        if not isinstance(items, list) or not items:
            print(f"  ! tpu.{tabela}: resposta vazia ou inesperada", file=sys.stderr)
            continue
        payload = {
            "tribunal": "tpu",
            "endpoint": "datajud",
            "campo": tabela,
            "fonte": url,
            "data_versao": items[0].get("data_versao"),
            "nodes": build_tpu_nodes(items, id_key),
        }
        total_bytes += _write_tree(filename, payload)
        gerados += 1
    return gerados, total_bytes


def _esaj_courts() -> list[str]:
    """Siglas tj* cujo scraper expoe os metodos ``listar_*`` (familia eSAJ)."""
    siglas = []
    for sigla in sorted(_SCRAPERS):
        if not sigla.startswith("tj"):
            continue
        path, cls_name = _SCRAPERS[sigla].split(":")
        from importlib import import_module
        cls = getattr(import_module(path), cls_name)
        if hasattr(cls, "listar_classes"):
            siglas.append(sigla)
    return siglas


def gen_esaj() -> tuple[int, int]:
    """Arvores eSAJ via ``listar_*`` do juscraper. Retorna (arquivos, bytes)."""
    siglas = _esaj_courts()
    if not siglas:
        print(
            "AVISO: nenhum tribunal expoe listar_classes "
            f"(juscraper {juscraper.__version__} anterior ao PR #228). "
            "Nada a gerar; arvores eSAJ existentes preservadas.",
            file=sys.stderr,
        )
        return 0, 0

    total_bytes = 0
    gerados = 0
    for sigla in siglas:
        scraper = juscraper.scraper(sigla)
        for endpoint, campos in TREE_FIELDS.items():
            for campo, metodo, grau in campos:
                fn = getattr(scraper, metodo, None)
                if fn is None:
                    continue  # ex.: listar_varas so existe no TJSP
                try:
                    df = fn(grau=grau)
                except ValueError:
                    continue  # arvore inexistente naquele tribunal/grau
                except Exception as exc:  # noqa: BLE001
                    # rede/parse: loga e segue; uma falha nao aborta o lote.
                    print(f"  ! {sigla}.{endpoint}.{campo}: {exc}", file=sys.stderr)
                    continue
                if df.empty:
                    continue
                payload = {
                    "tribunal": sigla,
                    "endpoint": endpoint,
                    "campo": campo,
                    "nodes": _build_nodes(df),
                }
                total_bytes += _write_tree(f"{sigla}.{endpoint}.{campo}.json", payload)
                gerados += 1
    return gerados, total_bytes


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--tpu-only",
        action="store_true",
        help="gera so as arvores da TPU (aba DataJud), sem as do eSAJ",
    )
    args = parser.parse_args(argv)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    gerados, total_bytes = gen_tpu()
    if not args.tpu_only:
        n, b = gen_esaj()
        gerados += n
        total_bytes += b

    print(f"\n{gerados} arvores | {total_bytes/1024/1024:.1f} MB (sem gzip) -> {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
