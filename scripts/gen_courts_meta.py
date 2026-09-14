"""Gera web/src/data/courts_meta.json a partir dos schemas pydantic do juscraper.

Roda no .venv (Python real, NAO no browser). Para cada tribunal (tj*) em
``juscraper._SCRAPERS``, descobre quais endpoints existem (cjsg/cjpg), resolve o
schema pydantic de input de cada um e serializa os campos num formato que o
formulario dinamico do front consegue renderizar sem conhecer pydantic.

Reexecutar sempre que o juscraper for atualizado:

    .venv/Scripts/python.exe scripts/gen_courts_meta.py
"""
from __future__ import annotations

import inspect
import json
import re
import types
import typing
from importlib import import_module
from pathlib import Path
from typing import Any

from pydantic import BaseModel

import juscraper
from juscraper import _SCRAPERS

# Endpoints app-controlados que NAO viram campo de formulario.
#   paginas    -> controlado pelo dialogo de estimativa.
#   count_only -> o app ja estima o total antes de baixar; com True o juscraper
#                 devolve um int (e nao um DataFrame), o que quebrava o download.
HIDDEN_FIELDS = {"paginas", "count_only"}
# Campos que vao para o grupo "avancado" (colapsavel).
ADVANCED_FIELDS = {"auto_chunk"}

# Status de suporte por tribunal no v1 (ver plano).
#   supported    -> funciona pelo proxy
#   experimental -> pode falhar (ex.: TLS custom)
#   unsupported  -> bloqueado no v1 (ex.: captcha)
SUPPORT: dict[str, dict[str, str]] = {
    "tjmg": {"status": "unsupported",
             "reason": "Exige resolver captcha de imagem (txtcaptcha); fora do v1."},
    "tjce": {"status": "experimental",
             "reason": "Usa TLS customizado (SECLEVEL=1); pode falhar pelo proxy."},
}

# Rotulos amigaveis para nomes de campo conhecidos.
LABELS = {
    "pesquisa": "Termo de pesquisa",
    "ementa": "Termo na ementa",
    "classe": "Classe (ID interno)",
    "classes": "Classes (IDs internos)",
    "assunto": "Assunto (ID interno)",
    "assuntos": "Assuntos (IDs internos)",
    "comarca": "Comarca (ID interno)",
    "varas": "Varas (IDs internos)",
    "orgao_julgador": "Orgao julgador (ID interno)",
    "numero_recurso": "Numero do recurso",
    "id_processo": "Numero do processo (CNJ)",
    "origem": "Origem",
    "baixar_sg": "Buscar em segundo grau",
    "tipo_decisao": "Tipo de decisao",
    "auto_chunk": "Dividir intervalos longos automaticamente",
    "data_julgamento_inicio": "Julgamento - inicio",
    "data_julgamento_fim": "Julgamento - fim",
    "data_publicacao_inicio": "Publicacao - inicio",
    "data_publicacao_fim": "Publicacao - fim",
}

# Ajuda contextual para campos de ID (nao ha lookup amigavel no v1).
ID_HELP = "Use o ID interno do tribunal (ex.: copiado da busca avancada do site)."

# Campos que viram seletor em arvore (TreeSelect) nos tribunais eSAJ, que
# expoem os endpoints *TreeSelect.do via os metodos listar_* do juscraper.
# As arvores estaticas ficam em web/public/trees/<sigla>.<endpoint>.<campo>.json
# (geradas por scripts/gen_trees.py). Para tribunais nao-eSAJ, esses campos
# continuam como texto/lista de IDs.
TREE_FIELDS_BY_ENDPOINT: dict[str, set[str]] = {
    "cjsg": {"classe", "assunto", "orgao_julgador"},
    "cjpg": {"classe", "assunto", "vara"},
}


def humanize(name: str) -> str:
    return LABELS.get(name, name.replace("_", " ").capitalize())


def _clean_desc(text: str) -> str:
    """Limpa marcacao RST e travessoes da descricao extraida da docstring."""
    text = re.sub(r"``([^`]*)``", r"\1", text)              # ``x`` -> x
    text = re.sub(r":[a-z]+:`~?([^`]*)`", r"\1", text)       # :class:`X` -> X
    text = re.sub(r"\s+", " ", text).strip()
    text = text.replace("—", "-").replace("–", "-")  # sem travessoes
    return text


def extract_param_docs(method) -> dict[str, str]:
    """Extrai descricoes de parametros da docstring (Google-style) do metodo.

    Cobre tanto os bullets ``* ``nome`` (tipo): desc`` quanto entradas de
    primeiro nivel em Args (ex.: ``pesquisa (str): ...``). Tribunais cuja
    docstring nao documenta os filtros simplesmente nao geram entradas.
    """
    doc = inspect.getdoc(method) or ""
    docs: dict[str, str] = {}
    # bullets dentro de **kwargs
    for m in re.finditer(
        r"``(\w+)``\s*\([^)]*\)\s*:\s*(.+?)(?=\n\s*\*\s*``|\n\s*\n|\Z)", doc, re.DOTALL
    ):
        docs.setdefault(m.group(1), _clean_desc(m.group(2)))
    # entradas de primeiro nivel (pesquisa, etc.)
    for m in re.finditer(
        r"\n\s*(\w+)\s*\([^)]*\)\s*:\s*(.+?)(?=\n\s*\w+\s*\(|\n\s*\*\*|\n\s*\n|\Z)",
        doc,
        re.DOTALL,
    ):
        docs.setdefault(m.group(1), _clean_desc(m.group(2)))
    return docs


def _strip_optional(ann: Any) -> tuple[Any, bool]:
    """Remove ``| None`` de um Union, retornando (tipo_base, era_opcional)."""
    origin = typing.get_origin(ann)
    if origin in (typing.Union, types.UnionType):
        args = [a for a in typing.get_args(ann) if a is not type(None)]
        optional = len(args) != len(typing.get_args(ann))
        if len(args) == 1:
            return args[0], optional
        return tuple(args), optional
    return ann, False


def _literal_options(ann: Any) -> list[Any] | None:
    if typing.get_origin(ann) is typing.Literal:
        return list(typing.get_args(ann))
    return None


def _is_list_type(ann: Any) -> bool:
    return typing.get_origin(ann) in (list, typing.List)


def describe_field(
    name: str,
    field: Any,
    docs: dict[str, str],
    *,
    is_esaj: bool = False,
    endpoint: str = "",
) -> dict[str, Any] | None:
    """Converte um FieldInfo do pydantic num descritor JSON-serializavel."""
    if name in HIDDEN_FIELDS:
        return None

    base, optional = _strip_optional(field.annotation)
    default = field.default
    has_default = default is not None and repr(default) != "PydanticUndefined"
    required = repr(field.default) == "PydanticUndefined"

    # Prioridade da ajuda: docstring do juscraper > description do schema > None.
    help_text = docs.get(name) or field.description or None

    desc: dict[str, Any] = {
        "name": name,
        "label": humanize(name),
        "required": required,
        "advanced": name in ADVANCED_FIELDS,
        "help": help_text,
    }

    # Seletor em arvore: campos de classe/assunto/orgao/vara nos tribunais
    # eSAJ ganham o TreeSelect (arvore estatica em web/public/trees/). O front
    # cai no input de IDs se o JSON nao existir. Emite lista de IDs (string[]).
    if is_esaj and name in TREE_FIELDS_BY_ENDPOINT.get(endpoint, set()):
        desc["type"] = "tree"
        desc["tree"] = {"endpoint": endpoint, "campo": name, "multiple": True}
        desc["default"] = []
        desc["help"] = help_text or "Selecione na arvore ou digite os IDs internos."
        return desc

    # Datas: campos *_inicio / *_fim em string, formato DD/MM/AAAA.
    if name.endswith(("_inicio", "_fim")):
        desc["type"] = "date"
        desc["format"] = "DD/MM/AAAA"
        desc["default"] = default if has_default else ""
        return desc

    # Literal -> select
    options = _literal_options(base)
    if options is not None:
        desc["type"] = "select"
        desc["options"] = options
        desc["default"] = default if has_default else options[0]
        return desc

    # bool -> checkbox
    if base is bool:
        desc["type"] = "checkbox"
        desc["default"] = bool(default) if has_default else False
        return desc

    # list[...] -> entrada de lista (CSV de IDs)
    if _is_list_type(field.annotation) or (isinstance(base, tuple) and any(_is_list_type(b) for b in (base if isinstance(base, tuple) else ()))):
        desc["type"] = "list"
        desc["default"] = []
        if "ID" in desc["label"] or name in {"classes", "assuntos", "varas"}:
            desc["help"] = desc["help"] or ID_HELP
        return desc

    # default: texto
    desc["type"] = "text"
    desc["default"] = default if has_default else ""
    if "ID interno" in desc["label"]:
        desc["help"] = desc["help"] or ID_HELP
    return desc


def schema_to_fields(
    model: type[BaseModel],
    docs: dict[str, str],
    *,
    is_esaj: bool = False,
    endpoint: str = "",
) -> list[dict[str, Any]]:
    fields: list[dict[str, Any]] = []
    for name, field in model.model_fields.items():
        d = describe_field(name, field, docs, is_esaj=is_esaj, endpoint=endpoint)
        if d is not None:
            fields.append(d)
    # pesquisa primeiro, depois principais, datas, depois avancados.
    def sort_key(f: dict[str, Any]) -> tuple[int, str]:
        if f["name"] == "pesquisa":
            return (0, "")
        if f["advanced"]:
            return (3, f["name"])
        if f["type"] == "date":
            return (2, f["name"])
        return (1, f["name"])
    fields.sort(key=sort_key)
    return fields


def _court_scraper_cls(sigla: str) -> type:
    path, cls_name = _SCRAPERS[sigla].split(":")
    mod = import_module(path)
    return getattr(mod, cls_name)


def resolve_cjsg_schema(sigla: str, cls: type) -> type[BaseModel] | None:
    model = getattr(cls, "INPUT_CJSG", None)
    if model is not None and isinstance(model, type) and issubclass(model, BaseModel):
        return model
    # Fallback: procurar InputCJSG* no modulo schemas do tribunal.
    return _find_input_schema(sigla, "CJSG")


def resolve_cjpg_schema(sigla: str) -> type[BaseModel] | None:
    return _find_input_schema(sigla, "CJPG")


def _find_input_schema(sigla: str, kind: str) -> type[BaseModel] | None:
    try:
        mod = import_module(f"juscraper.courts.{sigla}.schemas")
    except ModuleNotFoundError:
        return None
    prefix = f"Input{kind}"
    candidates = [
        getattr(mod, n) for n in dir(mod)
        if n.startswith(prefix)
        and isinstance(getattr(mod, n), type)
        and issubclass(getattr(mod, n), BaseModel)
    ]
    return candidates[0] if candidates else None


# --------------------------------------------------------------------------
# Aba "Processos (DataJud)": agregador da API publica do CNJ
# --------------------------------------------------------------------------
# Os campos saem do schema InputListarProcessosDataJud (fonte da verdade); os
# dicionarios abaixo so ajustam a apresentacao (rotulo, tipo de widget, ajuda
# em linguagem simples). Campo novo no schema aparece com o descritor generico.

# Campos que nao viram widget no formulario:
#   tribunal                 -> seletor proprio acima do formulario
#   paginas / tamanho_pagina -> dialogo de estimativa (o app escolhe o tamanho)
#   query                    -> override Elasticsearch (dict); so via codigo
DATAJUD_HIDDEN = {"tribunal", "paginas", "tamanho_pagina", "query"}

TPU_CONSULTA = "https://www.cnj.jus.br/sgt/consulta_publica_{tabela}.php"

TIPOS_MOVIMENTACAO_LABELS = {
    "decisao": "Decisão",
    "sentenca": "Sentença",
    "julgamento": "Julgamento",
    "tutela": "Tutela provisória",
    "transito_julgado": "Trânsito em julgado",
}


def _tpu_tree(campo: str, arquivo: str, multiple: bool) -> dict[str, Any]:
    # ``file`` aponta para web/public/trees/<arquivo> (gerado por
    # scripts/gen_trees.py a partir da API da TPU). A arvore e a mesma para
    # todos os tribunais, por isso nao depende da sigla.
    return {"endpoint": "datajud", "campo": campo, "multiple": multiple, "file": arquivo}


def _datajud_overrides(tipos_movimentacao: list[str]) -> dict[str, dict[str, Any]]:
    return {
        "data_ajuizamento_inicio": {
            "label": "Ajuizamento: de",
            "type": "isodate",
            "format": "AAAA-MM-DD",
            "help": "Data de ajuizamento (distribuição) do processo.",
        },
        "data_ajuizamento_fim": {
            "label": "Ajuizamento: até",
            "type": "isodate",
            "format": "AAAA-MM-DD",
            "help": None,
        },
        "classe": {
            "label": "Classe processual (TPU/CNJ)",
            "type": "tree",
            "tree": _tpu_tree("classe", "tpu.classes.json", multiple=False),
            "default": [],
            "help": "Uma classe da Tabela Processual Unificada do CNJ. Ex.: Usucapião (49).",
            "help_url": TPU_CONSULTA.format(tabela="classes"),
        },
        "assunto": {
            "label": "Assuntos (TPU/CNJ)",
            "type": "tree",
            "tree": _tpu_tree("assunto", "tpu.assuntos.json", multiple=True),
            "default": [],
            "help": "Traz processos com pelo menos um dos assuntos marcados. "
                    "Marcar um assunto marca também os assuntos filhos.",
            "help_url": TPU_CONSULTA.format(tabela="assuntos"),
        },
        "orgao_julgador": {
            "label": "Órgão julgador (nome)",
            "type": "text",
            "help": "Busca pelo nome, como aparece no DataJud (ex.: 02 CUMULATIVA DE PERUIBE).",
        },
        "tipos_movimentacao": {
            "label": "Com movimentação do tipo",
            "type": "multiselect",
            "options": tipos_movimentacao,
            "option_labels": {
                t: TIPOS_MOVIMENTACAO_LABELS.get(t, t.replace("_", " ").capitalize())
                for t in tipos_movimentacao
            },
            "default": [],
            "help": "Traz só processos com pelo menos uma movimentação dessas categorias.",
        },
        "mostrar_movs": {
            "label": "Incluir movimentações (datas, códigos e nomes)",
            "type": "checkbox",
            "help": "Necessário para calcular durações (ex.: do ajuizamento até a "
                    "sentença). Deixa o download mais lento.",
        },
        "ano_ajuizamento": {
            "label": "Ano de ajuizamento",
            "type": "number",
            "advanced": True,
            "default": "",
            "help": "Atalho para o ano inteiro. Use o ano OU o intervalo de datas, não os dois.",
        },
        "movimentos_codigo": {
            "label": "Com movimentação de código (TPU/CNJ)",
            "type": "tree",
            "advanced": True,
            "tree": _tpu_tree("movimentos_codigo", "tpu.movimentos.json", multiple=True),
            "value_type": "int",
            "default": [],
            "help": "Códigos de movimento da TPU. Somam-se aos tipos marcados acima.",
            "help_url": TPU_CONSULTA.format(tabela="movimentos"),
        },
        "numero_processo": {
            "label": "Números de processo (CNJ)",
            "type": "list",
            "advanced": True,
            "default": [],
            "help": "Restringe a uma lista de processos (números CNJ separados por vírgula).",
        },
    }


# Ordem de exibicao (campos fora da lista vao para o fim, na ordem do schema).
DATAJUD_ORDER = [
    "data_ajuizamento_inicio", "data_ajuizamento_fim", "classe", "assunto",
    "orgao_julgador", "tipos_movimentacao", "mostrar_movs",
    "ano_ajuizamento", "movimentos_codigo", "numero_processo",
]

DATAJUD_GRUPOS = [
    "Justiça Estadual", "Justiça Federal", "Justiça do Trabalho",
    "Justiça Eleitoral", "Justiça Militar", "Tribunais superiores e CNJ",
]


def _datajud_grupo(sigla: str) -> str:
    if sigla in {"STF", "STJ", "CNJ"}:
        return "Tribunais superiores e CNJ"
    if sigla == "STM" or (sigla.startswith("TJM") and len(sigla) == 5):
        return "Justiça Militar"  # TJMMG, TJMRS, TJMSP (TJMA/TJMG/... sao estaduais)
    if sigla.startswith("TRF"):
        return "Justiça Federal"
    if sigla.startswith("TRT") or sigla == "TST":
        return "Justiça do Trabalho"
    if sigla.startswith("TRE") or sigla == "TSE":
        return "Justiça Eleitoral"
    return "Justiça Estadual"


def _datajud_sort_key(sigla: str) -> tuple[int, str, int]:
    # TRT2 antes de TRT10: separa prefixo e numero.
    m = re.match(r"^(\D+?)(\d+)$", sigla)
    prefixo, num = (m.group(1), int(m.group(2))) if m else (sigla, 0)
    return (DATAJUD_GRUPOS.index(_datajud_grupo(sigla)), prefixo, num)


def build_datajud() -> dict[str, Any] | None:
    """Metadados da aba DataJud. ``None`` se o juscraper nao tiver o agregador."""
    try:
        from juscraper.aggregators.datajud.client import DatajudScraper
        from juscraper.aggregators.datajud.mappings import TIPOS_MOVIMENTACAO, TRIBUNAL_TO_ALIAS
        from juscraper.aggregators.datajud.schemas import InputListarProcessosDataJud
    except ImportError:
        return None
    if not hasattr(DatajudScraper, "contar_processos"):
        return None

    docs = extract_param_docs(DatajudScraper.listar_processos)
    overrides = _datajud_overrides(sorted(TIPOS_MOVIMENTACAO))
    fields: list[dict[str, Any]] = []
    for name, field in InputListarProcessosDataJud.model_fields.items():
        if name in DATAJUD_HIDDEN:
            continue
        base, _ = _strip_optional(field.annotation)
        if typing.get_origin(base) is dict or base is dict:
            continue  # dicts (ex.: query) nao tem widget
        desc = describe_field(name, field, docs)
        if desc is None:
            continue
        desc.update(overrides.get(name, {}))
        fields.append(desc)

    ordem = {n: i for i, n in enumerate(DATAJUD_ORDER)}
    fields.sort(key=lambda f: ordem.get(f["name"], len(ordem)))

    # Uma entrada por alias do DataJud (TRE-DF e TRE-DFT sao o mesmo indice:
    # fica a primeira sigla do mapping, a oficial).
    vistos: set[str] = set()
    tribunais: list[dict[str, str]] = []
    for sigla, alias in TRIBUNAL_TO_ALIAS.items():
        if alias in vistos:
            continue
        vistos.add(alias)
        tribunais.append({"sigla": sigla, "grupo": _datajud_grupo(sigla)})
    tribunais.sort(key=lambda t: _datajud_sort_key(t["sigla"]))

    return {"fields": fields, "tribunais": tribunais}


def build() -> dict[str, Any]:
    courts: list[dict[str, Any]] = []
    for sigla in sorted(_SCRAPERS):
        if not sigla.startswith("tj"):
            continue  # agregadores ficam de fora do v1 (sem cjsg/cjpg)
        cls = _court_scraper_cls(sigla)
        endpoints: dict[str, Any] = {}
        # Familia eSAJ expoe listar_* (juscraper #228) -> tem arvores estaticas.
        is_esaj = hasattr(cls, "listar_classes")

        if hasattr(cls, "cjsg"):
            model = resolve_cjsg_schema(sigla, cls)
            if model is not None:
                docs = extract_param_docs(cls.cjsg)
                endpoints["cjsg"] = {
                    "fields": schema_to_fields(model, docs, is_esaj=is_esaj, endpoint="cjsg")
                }

        if hasattr(cls, "cjpg"):
            model = resolve_cjpg_schema(sigla)
            if model is not None:
                docs = extract_param_docs(cls.cjpg)
                endpoints["cjpg"] = {
                    "fields": schema_to_fields(model, docs, is_esaj=is_esaj, endpoint="cjpg")
                }

        support = SUPPORT.get(sigla, {"status": "supported", "reason": ""})
        courts.append({
            "sigla": sigla,
            "nome": sigla.upper(),
            "endpoints": endpoints,
            "support": support,
        })
    data: dict[str, Any] = {
        "juscraper_version": juscraper.__version__,
        "endpoint_labels": {
            "cjsg": "Jurisprudencia (2o grau)",
            "cjpg": "Banco de Sentencas (1o grau)",
            "datajud": "Processos (DataJud)",
        },
        "courts": courts,
    }
    # Aba DataJud: so aparece no front se o juscraper tiver o agregador.
    datajud = build_datajud()
    if datajud is not None:
        data["datajud"] = datajud
    return data


def main() -> None:
    data = build()
    out = Path(__file__).resolve().parent.parent / "web" / "src" / "data" / "courts_meta.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    n_cjsg = sum("cjsg" in c["endpoints"] for c in data["courts"])
    n_cjpg = sum("cjpg" in c["endpoints"] for c in data["courts"])
    dj = data.get("datajud")
    n_dj = f"datajud={len(dj['tribunais'])} tribunais/{len(dj['fields'])} campos" if dj else "datajud=ausente"
    print(f"OK: {len(data['courts'])} tribunais | cjsg={n_cjsg} cjpg={n_cjpg} | {n_dj}")
    print(f"-> {out}")


if __name__ == "__main__":
    main()
