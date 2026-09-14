"""Testa a aba Processos (DataJud) PELO PROXY CORS, como o app publicado faz.

A API publica do DataJud (CNJ) e um POST com corpo JSON e cabecalho
``Authorization: APIKey ...``. Este teste garante que o proxy repassa metodo,
corpo e Authorization, e que o glue achata a resposta real do CNJ.

Rodar:
    .venv/Scripts/python.exe -m pytest tests/test_datajud.py -v
    JUSCRAPER_PROXY_URL=http://localhost:8787 pytest tests/test_datajud.py -v
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

import juscraper as jus

GLUE_PATH = Path(__file__).resolve().parent.parent / "web" / "src" / "pyodide" / "glue.py"

# Usucapiao (classe TPU 49) ajuizada no TJSP em janeiro de 2024.
FILTROS = dict(
    tribunal="TJSP",
    classe="49",
    data_ajuizamento_inicio="2024-01-01",
    data_ajuizamento_fim="2024-01-31",
)


def _glue():
    spec = importlib.util.spec_from_file_location("juscraper_app_glue_net", GLUE_PATH)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


@pytest.mark.network
def test_datajud_pelo_proxy():
    dj = jus.scraper("datajud")

    contagem = dj.contar_processos(**FILTROS)
    assert contagem["error"].isna().all(), contagem.to_dict("records")
    assert int(contagem["count"].iloc[0]) > 0

    df = dj.listar_processos(paginas=1, tamanho_pagina=10, mostrar_movs=True, **FILTROS)
    assert len(df) == 10

    processos, movs = _glue().datajud_tabelas(df, mostrar_movs=True)
    assert processos["classe_codigo"].eq(49).all()
    assert processos["data_ajuizamento"].str.startswith("2024-01").all()
    assert processos["numero_processo"].str.fullmatch(r"\d{7}-\d{2}\.2024\.8\.26\.\d{4}").all()
    assert len(movs) > 0
    assert movs["data_hora"].notna().all()
