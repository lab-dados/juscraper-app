"""Testes offline do glue Python que roda no navegador (web/src/pyodide/glue.py).

O glue so importa ``js`` (Pyodide) dentro das funcoes de transporte, entao da
para carrega-lo no CPython e exercitar ``run()`` com um scraper falso, sem rede
nem navegador.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pandas as pd
import pytest

GLUE_PATH = Path(__file__).resolve().parent.parent / "web" / "src" / "pyodide" / "glue.py"


@pytest.fixture(scope="module")
def glue():
    spec = importlib.util.spec_from_file_location("juscraper_app_glue", GLUE_PATH)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


class _FakeScraper:
    """Imita um scraper cujo endpoint devolve um valor fixo."""

    def __init__(self, value):
        self._value = value

    def cjsg(self, paginas=None, **kwargs):  # noqa: ARG002
        return self._value


def _run(glue, monkeypatch, value, params):
    monkeypatch.setattr(glue, "_to_scraper", lambda sigla: _FakeScraper(value))
    return json.loads(glue.run("tjsp", "cjsg", params, None, lambda done, total: None))


def test_run_count_only_int_nao_quebra(glue, monkeypatch):
    # Regressao: com count_only=True o juscraper devolve int e o glue quebrava
    # com AttributeError("'int' object has no attribute 'to_json'").
    out = _run(glue, monkeypatch, 132853, {"pesquisa": "dano moral", "count_only": True})
    assert out["ok"], out.get("traceback")
    assert out["columns"] == ["total_resultados"]
    assert out["records"] == [{"total_resultados": 132853}]


def test_run_dataframe_segue_normal(glue, monkeypatch):
    df = pd.DataFrame({"processo": ["1", "2"], "ementa": ["a", "b"]})
    out = _run(glue, monkeypatch, df, {"pesquisa": "dano moral"})
    assert out["ok"], out.get("traceback")
    assert out["n_rows"] == 2
    assert out["columns"] == ["processo", "ementa"]
