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
HIDDEN_FIELDS = {"paginas"}
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


def describe_field(name: str, field: Any, docs: dict[str, str]) -> dict[str, Any] | None:
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


def schema_to_fields(model: type[BaseModel], docs: dict[str, str]) -> list[dict[str, Any]]:
    fields: list[dict[str, Any]] = []
    for name, field in model.model_fields.items():
        d = describe_field(name, field, docs)
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


def build() -> dict[str, Any]:
    courts: list[dict[str, Any]] = []
    for sigla in sorted(_SCRAPERS):
        if not sigla.startswith("tj"):
            continue  # agregadores ficam de fora do v1 (sem cjsg/cjpg)
        cls = _court_scraper_cls(sigla)
        endpoints: dict[str, Any] = {}

        if hasattr(cls, "cjsg"):
            model = resolve_cjsg_schema(sigla, cls)
            if model is not None:
                docs = extract_param_docs(cls.cjsg)
                endpoints["cjsg"] = {"fields": schema_to_fields(model, docs)}

        if hasattr(cls, "cjpg"):
            model = resolve_cjpg_schema(sigla)
            if model is not None:
                docs = extract_param_docs(cls.cjpg)
                endpoints["cjpg"] = {"fields": schema_to_fields(model, docs)}

        support = SUPPORT.get(sigla, {"status": "supported", "reason": ""})
        courts.append({
            "sigla": sigla,
            "nome": sigla.upper(),
            "endpoints": endpoints,
            "support": support,
        })
    return {
        "juscraper_version": juscraper.__version__,
        "endpoint_labels": {
            "cjsg": "Jurisprudencia (2o grau)",
            "cjpg": "Banco de Sentencas (1o grau)",
        },
        "courts": courts,
    }


def main() -> None:
    data = build()
    out = Path(__file__).resolve().parent.parent / "web" / "src" / "data" / "courts_meta.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    n_cjsg = sum("cjsg" in c["endpoints"] for c in data["courts"])
    n_cjpg = sum("cjpg" in c["endpoints"] for c in data["courts"])
    print(f"OK: {len(data['courts'])} tribunais | cjsg={n_cjsg} cjpg={n_cjpg}")
    print(f"-> {out}")


if __name__ == "__main__":
    main()
