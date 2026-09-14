"""Testes offline da aba DataJud no glue (web/src/pyodide/glue.py).

Cobrem o achatamento dos campos aninhados do CNJ (tabela de processos e
movimentacoes em formato longo) e o roteamento de count()/run() para
``contar_processos``/``listar_processos``, com um scraper falso (sem rede).
"""
from __future__ import annotations

import importlib.util
import json
import warnings
from pathlib import Path

import pandas as pd
import pytest

GLUE_PATH = Path(__file__).resolve().parent.parent / "web" / "src" / "pyodide" / "glue.py"


@pytest.fixture(scope="module")
def glue():
    spec = importlib.util.spec_from_file_location("juscraper_app_glue_dj", GLUE_PATH)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _df_exemplo() -> pd.DataFrame:
    """Dois documentos no formato do ``_source`` do DataJud (camelCase aninhado)."""
    return pd.DataFrame([
        {
            "numeroProcesso": "10002675320248260441",
            "tribunal": "TJSP",
            "grau": "G1",
            "classe": {"codigo": 49, "nome": "Usucapião"},
            "assuntos": [{"codigo": 10458, "nome": "Usucapião Extraordinária"}],
            "orgaoJulgador": {"codigoMunicipioIBGE": 3537602, "codigo": 10044,
                              "nome": "02 CUMULATIVA DE PERUIBE"},
            "sistema": {"codigo": 3, "nome": "SAJ"},
            "formato": {"codigo": 1, "nome": "Eletrônico"},
            "dataAjuizamento": "20240130123451",
            "dataHoraUltimaAtualizacao": "2024-03-26T02:07:00.565Z",
            "nivelSigilo": 0,
            "id": "TJSP_49_G1_10044_10002675320248260441",
            # Fora de ordem de proposito: o glue ordena por data.
            "movimentos": [
                {"codigo": 51, "nome": "Conclusão", "dataHora": "2024-01-30T18:52:48.000Z",
                 "complementosTabelados": [{"codigo": 3, "valor": 5, "nome": "para despacho",
                                            "descricao": "tipo_de_conclusao"}]},
                {"codigo": 26, "nome": "Distribuição", "dataHora": "2024-01-30T12:46:42.000Z"},
            ],
        },
        {
            # Formato ISO, assuntos aninhados ([[...]]) e sem orgaoJulgador,
            # quirks reais de alguns tribunais.
            "numeroProcesso": "00012345620248260100",
            "tribunal": "TJSP",
            "grau": "G2",
            "classe": {"codigo": 49, "nome": "Usucapião"},
            "assuntos": [[{"codigo": 10458, "nome": "Usucapião Extraordinária"}],
                         {"codigo": 10459, "nome": "Usucapião Ordinária"}],
            "dataAjuizamento": "2024-01-15T00:00:00.000Z",
            "id": "TJSP_49_G2_x",
            "movimentos": [],
        },
    ])


def test_tabelas_com_movimentacoes(glue):
    proc, movs = glue.datajud_tabelas(_df_exemplo(), mostrar_movs=True)

    assert list(proc.columns) == (
        glue.DATAJUD_COLS + glue.DATAJUD_COLS_MOVS + ["id_datajud"]
    )
    a, b = proc.iloc[0], proc.iloc[1]
    # CNJ formatado (evita notacao cientifica no Excel).
    assert a["numero_processo"] == "1000267-53.2024.8.26.0441"
    # Datas nos dois formatos do CNJ viram 'AAAA-MM-DD hh:mm:ss'.
    assert a["data_ajuizamento"] == "2024-01-30 12:34:51"
    assert b["data_ajuizamento"] == "2024-01-15 00:00:00"
    assert a["classe_codigo"] == 49 and a["classe_nome"] == "Usucapião"
    assert a["orgao_julgador_nome"] == "02 CUMULATIVA DE PERUIBE"
    assert pd.isna(b["orgao_julgador_nome"])
    assert b["assuntos_codigos"] == "10458; 10459"
    assert a["n_movimentacoes"] == 2 and b["n_movimentacoes"] == 0
    assert a["data_primeira_movimentacao"] == "2024-01-30 12:46:42"
    assert a["data_ultima_movimentacao"] == "2024-01-30 18:52:48"

    # Movimentacoes: uma linha por movimentacao, em ordem cronologica.
    assert list(movs.columns) == glue.DATAJUD_MOV_COLS
    assert movs["nome"].tolist() == ["Distribuição", "Conclusão"]
    assert movs["complementos"].tolist() == ["", "tipo de conclusao: para despacho"]

    # Inteiros com lacuna nao viram "49.0" no CSV.
    csv = proc.to_csv(index=False)
    assert ",49," in csv and "49.0" not in csv


def test_tabelas_sem_movimentacoes(glue):
    proc, movs = glue.datajud_tabelas(_df_exemplo(), mostrar_movs=False)
    assert movs is None
    assert "n_movimentacoes" not in proc.columns
    assert len(proc) == 2


def test_tabelas_vazias(glue):
    proc, movs = glue.datajud_tabelas(pd.DataFrame(), mostrar_movs=True)
    assert len(proc) == 0 and len(movs) == 0
    assert "numero_processo" in proc.columns


class _FakeDatajud:
    sleep_time = 0.5

    def __init__(self, contagem=1136, relation="eq"):
        self.contagem = contagem
        self.relation = relation
        self.kwargs_contar: dict | None = None
        self.kwargs_listar: dict | None = None

    def contar_processos(self, **kwargs):
        self.kwargs_contar = kwargs
        return pd.DataFrame([{"tribunal": "TJSP", "alias": "api_publica_tjsp",
                              "count": self.contagem, "relation": self.relation,
                              "error": None}])

    def listar_processos(self, paginas=None, **kwargs):
        self.kwargs_listar = {"paginas": paginas, **kwargs}
        warnings.warn("DataJud: falha ao consultar alias 'api_publica_tjsp' na página 3. "
                      "Resultados parciais retornados.", UserWarning)
        return _df_exemplo()


def test_count_datajud(glue, monkeypatch):
    fake = _FakeDatajud()
    monkeypatch.setattr(glue, "_to_scraper", lambda sigla: fake)
    params = {"tribunal": "TJSP", "classe": "49", "mostrar_movs": True,
              "tamanho_pagina": 500, "assunto": []}
    out = json.loads(glue.count("datajud", "listar_processos", params))
    assert out["ok"], out.get("traceback")
    assert out["n_itens"] == 1136 and out["n_pags"] == 3 and out["tamanho_pagina"] == 500
    # contar_processos nao aceita paginacao nem mostrar_movs (extra=forbid).
    assert fake.kwargs_contar == {"tribunal": "TJSP", "classe": "49"}


def test_count_datajud_falha_da_api(glue, monkeypatch):
    monkeypatch.setattr(glue, "_to_scraper", lambda sigla: _FakeDatajud(contagem=None))
    out = json.loads(glue.count("datajud", "listar_processos", {"tribunal": "TJSP"}))
    assert not out["ok"]
    assert "DataJud" in out["error"]


# Simula o Pyodide: browser_cookie3 nao tem wheel e o jwt quebra porque importa
# ssl. ``sys.modules[x] = None`` faz ``import x`` levantar ModuleNotFoundError.
_SIMULA_PYODIDE = """
import importlib.util, sys
sys.modules["browser_cookie3"] = None
sys.modules["jwt"] = None
spec = importlib.util.spec_from_file_location("glue", {glue!r})
glue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(glue)
{isola}
import juscraper as jus
dj = jus.scraper("datajud")
assert type(dj).__name__ == "DatajudScraper"
assert "juscraper.aggregators.jusbr" not in sys.modules, "jusbr foi importado"
print("ok")
"""


def _roda_simulacao(isola: str):
    import subprocess
    import sys

    code = _SIMULA_PYODIDE.format(glue=str(GLUE_PATH), isola=isola)
    # Processo separado: nao suja o sys.modules da suite.
    return subprocess.run([sys.executable, "-c", code], capture_output=True,
                          text=True, timeout=120)


def test_datajud_importa_sem_dependencias_do_jusbr():
    # Regressao do navegador: o import do DataJud passava por
    # aggregators/__init__ -> jusbr -> browser_cookie3 / jwt -> ssl.
    r = _roda_simulacao(
        "assert glue._isolate_aggregators() is True\n"
        "assert glue._isolate_aggregators() is False  # idempotente"
    )
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "ok"


def test_simulacao_reproduz_o_bug_sem_isolar():
    # Controle negativo: sem o isolamento, a simulacao quebra como no navegador.
    r = _roda_simulacao("pass")
    assert r.returncode != 0
    assert "ModuleNotFoundError" in r.stderr


def test_run_datajud(glue, monkeypatch):
    fake = _FakeDatajud()
    monkeypatch.setattr(glue, "_to_scraper", lambda sigla: fake)
    params = {"tribunal": "TJSP", "classe": "49", "mostrar_movs": True, "tamanho_pagina": 500}
    out = json.loads(glue.run("datajud", "listar_processos", params, 3, lambda d, t: None))
    assert out["ok"], out.get("traceback")
    assert fake.kwargs_listar["paginas"] == 3
    assert fake.kwargs_listar["tamanho_pagina"] == 500
    assert out["n_rows"] == 2
    assert out["columns"][0] == "numero_processo"
    assert out["xlsx_b64"]
    (extra,) = out["extras"]
    assert extra["key"] == "movimentacoes" and extra["n_rows"] == 2
    assert extra["csv"].splitlines()[0] == ",".join(glue.DATAJUD_MOV_COLS)
    # Aviso de resultado parcial chega na UI.
    assert any("Resultados parciais" in a for a in out["avisos"])
