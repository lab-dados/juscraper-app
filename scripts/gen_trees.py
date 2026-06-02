"""Gera as arvores de classes/assuntos/orgaos/varas em web/public/trees/.

Roda no .venv (Python real, NAO no browser). Para cada tribunal da familia
eSAJ que exponha os metodos ``listar_*`` (juscraper #228), baixa as arvores de
selecao e grava um JSON achatado por (tribunal, endpoint, campo) que o
componente TreeSelect do front carrega sob demanda.

Tolerante a juscraper sem os metodos: se nenhum tribunal expuser ``listar_classes``
(versao anterior ao PR #228), loga um aviso e sai com codigo 0 sem mexer nos
arquivos existentes — assim a Action diaria nao quebra antes do PR ser mergeado.

    .venv/Scripts/python.exe scripts/gen_trees.py

Para testar localmente contra uma branch do juscraper ainda nao publicada:

    PYTHONPATH=/caminho/para/juscraper/src python scripts/gen_trees.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

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


def main() -> int:
    siglas = _esaj_courts()
    if not siglas:
        print(
            "AVISO: nenhum tribunal expoe listar_classes "
            f"(juscraper {juscraper.__version__} anterior ao PR #228). "
            "Nada a gerar; arvores existentes preservadas.",
            file=sys.stderr,
        )
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
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
                out = OUT_DIR / f"{sigla}.{endpoint}.{campo}.json"
                text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
                out.write_text(text, encoding="utf-8")
                size = len(text.encode("utf-8"))
                total_bytes += size
                gerados += 1
                print(f"  OK {out.name}: {len(payload['nodes'])} nos, {size/1024:.0f} KB")

    print(f"\n{gerados} arvores | {total_bytes/1024/1024:.1f} MB (sem gzip) -> {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
