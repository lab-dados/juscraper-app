"""Glue Python que roda dentro do Pyodide (em um Web Worker).

Responsabilidades:
  1. bootstrap(): instalar o juscraper + dependencias disponiveis no Pyodide.
  2. Rotear TODO o HTTP do `requests` por um proxy CORS (ProxyAdapter), porque
     o navegador bloqueia chamadas diretas aos sites dos tribunais.
  3. count(): descobrir quantas paginas a busca tem (baixando so a 1a pagina),
     para a UI estimar o tempo e pedir confirmacao.
  4. run(): executar a busca completa emitindo progresso (via hook no tqdm) e
     devolver o resultado como JSON + CSV.

A aba "Processos (DataJud)" usa sigla="datajud": count() chama
``contar_processos`` e run() chama ``listar_processos``, achatando os campos
aninhados do CNJ numa tabela legivel (+ movimentacoes em formato longo).

Tudo aqui assume execucao em um Web Worker (XHR sincrono com responseType
"arraybuffer" so e permitido fora da main thread).
"""
from __future__ import annotations

import contextlib
import io
import json
import logging
import math
import sys
import traceback
import warnings
from urllib.parse import urlparse

# Preenchido por set_proxy_url() antes do primeiro request.
_PROXY_URL = ""
_DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# Cabecalhos que o XHR do navegador NAO deixa setar (relocados ou proibidos).
_FORBIDDEN_REQ_HEADERS = {
    "accept-charset", "accept-encoding", "connection", "content-length",
    "cookie", "date", "dnt", "expect", "host", "keep-alive", "origin",
    "referer", "te", "trailer", "transfer-encoding", "upgrade", "user-agent",
    "via",
}


def set_proxy_url(url: str) -> None:
    global _PROXY_URL
    _PROXY_URL = url.rstrip("/") if url else ""


# --------------------------------------------------------------------------
# Transporte: XHR sincrono -> proxy CORS
# --------------------------------------------------------------------------

def _xhr_sync(method: str, headers: dict, body, real_url: str, cookie: str, ua: str):
    """Faz uma requisicao SINCRONA via XHR roteada pelo proxy. Worker-only."""
    from js import XMLHttpRequest, Uint8Array

    if not _PROXY_URL:
        raise RuntimeError("Proxy URL nao configurada (set_proxy_url).")

    xhr = XMLHttpRequest.new()
    xhr.open(method, _PROXY_URL, False)  # async=False -> sincrono
    xhr.responseType = "arraybuffer"

    xhr.setRequestHeader("X-Target-URL", real_url)
    xhr.setRequestHeader("X-UA", ua or _DEFAULT_UA)
    if cookie:
        xhr.setRequestHeader("X-Cookie", cookie)
    for key, value in headers.items():
        if key.lower() in _FORBIDDEN_REQ_HEADERS:
            continue
        try:
            xhr.setRequestHeader(key, value)
        except Exception:  # noqa: BLE001 — header rejeitado pelo browser
            pass

    if body is None:
        xhr.send()
    elif isinstance(body, (bytes, bytearray)):
        arr = Uint8Array.new(len(body))
        arr.assign(body)
        xhr.send(arr)
    else:  # str
        xhr.send(body)

    status = int(xhr.status)
    buf = xhr.response
    content = bytes(Uint8Array.new(buf).to_py()) if buf is not None else b""
    set_cookie_b64 = xhr.getResponseHeader("X-Set-Cookie") or ""
    if set_cookie_b64:
        import base64
        set_cookie = base64.b64decode(set_cookie_b64).decode("utf-8", "replace")
    else:
        set_cookie = ""
    content_type = xhr.getResponseHeader("Content-Type") or ""
    final_url = xhr.getResponseHeader("X-Final-Url") or real_url
    return {
        "status": status,
        "content": content,
        "set_cookie": set_cookie,
        "content_type": content_type,
        "final_url": final_url,
    }


def _install_proxy_adapter():
    """Faz toda requests.Session rotear pelo proxy via um HTTPAdapter custom."""
    import requests
    from requests.adapters import HTTPAdapter
    from requests.models import Response
    from requests.structures import CaseInsensitiveDict
    from requests.utils import get_encoding_from_headers

    def _parse_set_cookie(raw: str) -> list[tuple[str, str]]:
        out = []
        if not raw:
            return out
        for line in raw.split("\n"):
            first = line.split(";")[0]
            if "=" in first:
                name, _, value = first.partition("=")
                name = name.strip()
                if name:
                    out.append((name, value.strip()))
        return out

    class ProxyAdapter(HTTPAdapter):
        """Encaminha cada request pro proxy; gerencia cookies por host."""

        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            self._cookies_by_host: dict[str, dict[str, str]] = {}

        def send(self, request, **kwargs):  # noqa: ARG002
            real_url = request.url
            host = urlparse(real_url).netloc
            headers = dict(request.headers)

            # Cookie: junta o que o requests calculou + o que guardamos por host.
            stored = self._cookies_by_host.get(host, {})
            stored_str = "; ".join(f"{k}={v}" for k, v in stored.items())
            existing = headers.pop("Cookie", None) or headers.pop("cookie", None)
            cookie = "; ".join(x for x in [existing, stored_str] if x)
            ua = headers.pop("User-Agent", None) or headers.pop("user-agent", None) or _DEFAULT_UA

            result = _xhr_sync(request.method, headers, request.body, real_url, cookie, ua)

            # Atualiza o cookie store do host.
            for name, value in _parse_set_cookie(result["set_cookie"]):
                self._cookies_by_host.setdefault(host, {})[name] = value

            resp = Response()
            resp.status_code = result["status"]
            resp._content = result["content"]
            resp._content_consumed = True
            resp.url = result["final_url"]
            resp.request = request
            resp.reason = ""
            resp.raw = None
            resp.headers = CaseInsensitiveDict()
            if result["content_type"]:
                resp.headers["Content-Type"] = result["content_type"]
            resp.encoding = get_encoding_from_headers(resp.headers)
            return resp

    # Re-mount em toda nova Session.
    _orig_init = requests.sessions.Session.__init__

    def _patched_init(self, *a, **k):
        _orig_init(self, *a, **k)
        adapter = ProxyAdapter()
        self.mount("https://", adapter)
        self.mount("http://", adapter)

    requests.sessions.Session.__init__ = _patched_init


# --------------------------------------------------------------------------
# Bootstrap
# --------------------------------------------------------------------------

_DEPS = [
    "pandas", "beautifulsoup4", "lxml", "requests", "pydantic",
    "tqdm", "Unidecode", "pyjwt", "python-dotenv", "nest-asyncio",
    "openpyxl",  # exportacao XLSX
]


async def bootstrap(proxy_url: str, juscraper_wheel_url: str):
    """Instala juscraper + deps e ativa o roteamento pelo proxy.

    `juscraper_wheel_url` aponta pro wheel vendorizado (web/public/wheels/...),
    servido pela propria origem do app — evita a busca no PyPI em runtime
    (mais rapido e funciona offline/atras de firewall).
    """
    import micropip

    set_proxy_url(proxy_url)
    await micropip.install(_DEPS)
    # juscraper sem deps: pyarrow/browser-cookie3 (so usados em aggregators/jusbr)
    # nao tem wheel no Pyodide e nao estao no caminho dos tribunais.
    await micropip.install(juscraper_wheel_url, deps=False)
    _isolate_aggregators()
    _install_proxy_adapter()
    import juscraper  # noqa: F401 — valida o import
    return juscraper.__version__


def _isolate_aggregators() -> bool:
    """Deixa importar um agregador (ex.: DataJud) sem importar todos.

    ``juscraper/aggregators/__init__.py`` importa TODOS os agregadores, e o do
    jusbr puxa dependencias que nao funcionam no Pyodide: ``browser_cookie3``
    (sem wheel; le cookies do Firefox local) e ``jwt``, cujo ``jwks_client``
    importa ``ssl`` (fora da biblioteca padrao do Pyodide). Sem isto,
    ``jus.scraper("datajud")`` quebra no navegador com ModuleNotFoundError.

    Registra o pacote ``juscraper.aggregators`` em ``sys.modules`` SEM executar
    o ``__init__``: os subpacotes (``juscraper.aggregators.datajud``) continuam
    importaveis pelo ``__path__`` e o jusbr so seria carregado se alguem o
    pedisse (o app nao pede). Devolve True se isolou, False se nao precisou.
    """
    import importlib.util

    if "juscraper.aggregators" in sys.modules:
        return False
    spec = importlib.util.find_spec("juscraper.aggregators")
    if spec is None or not spec.submodule_search_locations:
        return False
    pkg = importlib.util.module_from_spec(spec)
    sys.modules["juscraper.aggregators"] = pkg
    import juscraper
    juscraper.aggregators = pkg
    return True


# --------------------------------------------------------------------------
# Helpers de tqdm (captura de total + progresso)
# --------------------------------------------------------------------------

def _juscraper_download_modules():
    """Modulos do juscraper que importaram `tqdm` (para monkeypatch por-modulo)."""
    mods = []
    for name, mod in list(sys.modules.items()):
        if name.startswith("juscraper") and mod is not None and hasattr(mod, "tqdm"):
            mods.append(mod)
    return mods


class _CountReached(BaseException):
    """Aborta o download assim que o total de paginas e conhecido."""


def _patch_tqdm(factory):
    """Troca o simbolo `tqdm` em cada modulo de download. Retorna o restaurador."""
    originals = []
    # tambem cobre `from tqdm import tqdm` / `tqdm.auto`
    for modname in ("tqdm", "tqdm.auto"):
        m = sys.modules.get(modname)
        if m is not None and hasattr(m, "tqdm"):
            originals.append((m, m.tqdm))
            m.tqdm = factory
    for mod in _juscraper_download_modules():
        originals.append((mod, mod.tqdm))
        mod.tqdm = factory

    def restore():
        for mod, orig in originals:
            mod.tqdm = orig
    return restore


def _progress_tqdm(progress):
    """Classe tqdm-like que repassa (feito, total) para o callback JS."""

    class _ProgressTqdm:
        def __init__(self, iterable=None, *a, total=None, **k):
            self._it = iterable if iterable is not None else []
            self._total = total
            self._n = 0
            self._emit()

        def _emit(self):
            try:
                progress(self._n, self._total if self._total is not None else -1)
            except Exception:  # noqa: BLE001
                pass

        def __iter__(self):
            for item in self._it:
                yield item
                self._n += 1
                self._emit()

        def update(self, k=1):
            self._n += k
            self._emit()

        def set_description(self, *a, **k):
            pass

        def close(self):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    return _ProgressTqdm


# --------------------------------------------------------------------------
# Limpeza de parametros vindos do form (JS)
# --------------------------------------------------------------------------

def _clean_params(params: dict) -> dict:
    out = {}
    for key, value in params.items():
        if value is None:
            continue
        if isinstance(value, str) and value.strip() == "":
            continue
        if isinstance(value, (list, tuple)) and len(value) == 0:
            continue
        out[key] = value
    return out


def _to_scraper(sigla: str):
    import juscraper as jus
    return jus.scraper(sigla)


import base64
import re as _re

# Caracteres de controle invalidos no XML do XLSX.
_ILLEGAL_XLSX = _re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _df_to_xlsx_b64(df) -> str:
    """Serializa o DataFrame em XLSX (base64), sanitizando celulas de texto."""
    import pandas as pd

    safe = df.copy()
    for col in safe.columns:
        if safe[col].dtype == object:
            safe[col] = safe[col].map(
                lambda v: _ILLEGAL_XLSX.sub("", v)[:32000] if isinstance(v, str) else v
            )
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        safe.to_excel(writer, index=False, sheet_name="resultados")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _df_to_csv(df) -> str:
    buf = io.StringIO()
    df.to_csv(buf, index=False)
    return buf.getvalue()


# --------------------------------------------------------------------------
# DataJud (aba "Processos"): contar_processos / listar_processos
# --------------------------------------------------------------------------

DATAJUD = "datajud"

# Colunas da tabela achatada (uma linha por documento do DataJud). O mesmo
# numero CNJ pode aparecer mais de uma vez quando o tribunal manda um documento
# por grau (G1, G2, JE...); ``grau`` e ``id_datajud`` distinguem.
DATAJUD_COLS = [
    "numero_processo", "tribunal", "grau", "classe_codigo", "classe_nome",
    "assuntos_codigos", "assuntos_nomes", "orgao_julgador_codigo",
    "orgao_julgador_nome", "municipio_ibge", "data_ajuizamento", "sistema",
    "formato", "nivel_sigilo", "data_ultima_atualizacao",
]
DATAJUD_COLS_MOVS = [
    "n_movimentacoes", "data_primeira_movimentacao", "data_ultima_movimentacao",
]
DATAJUD_MOV_COLS = ["numero_processo", "grau", "data_hora", "codigo", "nome", "complementos"]
_DATAJUD_INT_COLS = [
    "classe_codigo", "orgao_julgador_codigo", "municipio_ibge", "nivel_sigilo",
    "n_movimentacoes", "codigo",
]


def _dj_vazio(v) -> bool:
    return v is None or (isinstance(v, float) and v != v)


def _dj_data(v) -> str | None:
    """Normaliza datas do DataJud para 'AAAA-MM-DD hh:mm:ss'.

    O CNJ mistura dois formatos: ISO ('2024-01-30T12:46:42.000Z') e compacto
    ('20240130123451'). Normalizar deixa a coluna ordenavel e facil de ler no
    pandas/Excel (``pd.to_datetime`` funciona direto).
    """
    if _dj_vazio(v):
        return None
    s = str(v).strip()
    if not s:
        return None
    if s.isdigit() and len(s) >= 8:
        s = s[:14].ljust(14, "0")
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]} {s[8:10]}:{s[10:12]}:{s[12:14]}"
    return s.replace("T", " ").rstrip("Z")[:19]


def _dj_cnj(v) -> str | None:
    """20 digitos -> NNNNNNN-DD.AAAA.J.TR.OOOO (evita notacao cientifica no Excel)."""
    if _dj_vazio(v):
        return None
    d = _re.sub(r"\D", "", str(v))
    if len(d) != 20:
        return str(v)
    return f"{d[0:7]}-{d[7:9]}.{d[9:13]}.{d[13]}.{d[14:16]}.{d[16:20]}"


def _dj_dict(v) -> dict:
    return v if isinstance(v, dict) else {}


def _dj_lista(v) -> list[dict]:
    """Lista de dicts, achatando aninhamentos (alguns tribunais mandam [[{...}]])."""
    out: list[dict] = []
    if isinstance(v, dict):
        return [v]
    if not isinstance(v, (list, tuple)):
        return out
    for item in v:
        if isinstance(item, dict):
            out.append(item)
        elif isinstance(item, (list, tuple)):
            out.extend(_dj_lista(item))
    return out


def _dj_complementos(mov: dict) -> str:
    partes = []
    for c in _dj_lista(mov.get("complementosTabelados")):
        desc = str(c.get("descricao") or "").replace("_", " ").strip()
        nome = str(c.get("nome") or c.get("valor") or "").strip()
        partes.append(f"{desc}: {nome}" if desc else nome)
    return "; ".join(p for p in partes if p)


def datajud_tabelas(df, mostrar_movs: bool):
    """Achata o DataFrame de ``listar_processos`` (camelCase aninhado do CNJ).

    Retorna ``(processos, movimentacoes)``: uma linha por documento e, quando
    ``mostrar_movs``, as movimentacoes em formato longo (uma linha por
    movimentacao, ordenadas por data). ``movimentacoes`` e ``None`` sem movs.
    """
    import pandas as pd

    processos: list[dict] = []
    movs: list[dict] = []
    registros = [] if df is None or df.empty else df.to_dict(orient="records")
    for rec in registros:
        numero = _dj_cnj(rec.get("numeroProcesso"))
        grau = None if _dj_vazio(rec.get("grau")) else rec.get("grau")
        classe = _dj_dict(rec.get("classe"))
        orgao = _dj_dict(rec.get("orgaoJulgador"))
        assuntos = _dj_lista(rec.get("assuntos"))
        linha = {
            "numero_processo": numero,
            "tribunal": None if _dj_vazio(rec.get("tribunal")) else rec.get("tribunal"),
            "grau": grau,
            "classe_codigo": classe.get("codigo"),
            "classe_nome": classe.get("nome"),
            "assuntos_codigos": "; ".join(
                str(a["codigo"]) for a in assuntos if a.get("codigo") is not None
            ),
            "assuntos_nomes": "; ".join(str(a["nome"]) for a in assuntos if a.get("nome")),
            "orgao_julgador_codigo": orgao.get("codigo"),
            "orgao_julgador_nome": orgao.get("nome"),
            "municipio_ibge": orgao.get("codigoMunicipioIBGE"),
            "data_ajuizamento": _dj_data(rec.get("dataAjuizamento")),
            "sistema": _dj_dict(rec.get("sistema")).get("nome"),
            "formato": _dj_dict(rec.get("formato")).get("nome"),
            "nivel_sigilo": None if _dj_vazio(rec.get("nivelSigilo")) else rec.get("nivelSigilo"),
            "data_ultima_atualizacao": _dj_data(rec.get("dataHoraUltimaAtualizacao")),
        }
        if mostrar_movs:
            proprias = [
                {
                    "numero_processo": numero,
                    "grau": grau,
                    "data_hora": _dj_data(m.get("dataHora")),
                    "codigo": m.get("codigo"),
                    "nome": m.get("nome"),
                    "complementos": _dj_complementos(m),
                }
                for m in _dj_lista(rec.get("movimentos"))
            ]
            proprias.sort(key=lambda x: x["data_hora"] or "")
            datas = [m["data_hora"] for m in proprias if m["data_hora"]]
            linha["n_movimentacoes"] = len(proprias)
            linha["data_primeira_movimentacao"] = datas[0] if datas else None
            linha["data_ultima_movimentacao"] = datas[-1] if datas else None
            movs.extend(proprias)
        linha["id_datajud"] = None if _dj_vazio(rec.get("id")) else rec.get("id")
        processos.append(linha)

    cols = DATAJUD_COLS + (DATAJUD_COLS_MOVS if mostrar_movs else []) + ["id_datajud"]
    df_proc = pd.DataFrame(processos, columns=cols)
    df_movs = pd.DataFrame(movs, columns=DATAJUD_MOV_COLS) if mostrar_movs else None
    # Inteiros com lacunas viram float no pandas ("49.0" no CSV); Int64 evita.
    for frame in (df_proc, df_movs):
        if frame is None:
            continue
        for col in _DATAJUD_INT_COLS:
            if col in frame.columns:
                frame[col] = pd.to_numeric(frame[col], errors="coerce").astype("Int64")
    return df_proc, df_movs


class _LogBuffer(logging.Handler):
    """Guarda os logs de erro do juscraper (o DataJud so loga a causa real)."""

    def __init__(self):
        super().__init__(level=logging.WARNING)
        self.msgs: list[str] = []

    def emit(self, record):
        try:
            self.msgs.append(record.getMessage()[:500])
        except Exception:  # noqa: BLE001
            pass


@contextlib.contextmanager
def _captura_logs():
    handler = _LogBuffer()
    logger = logging.getLogger("juscraper")
    logger.addHandler(handler)
    try:
        yield handler.msgs
    finally:
        logger.removeHandler(handler)


def _datajud_count(params: dict) -> dict:
    """Total de processos (``contar_processos``) + nº de requisicoes."""
    tamanho = int(params.pop("tamanho_pagina", 0) or 1000)
    # Parametros de paginacao nao existem na contagem (schema com extra=forbid).
    params.pop("mostrar_movs", None)
    scraper = _to_scraper(DATAJUD)
    with _captura_logs() as logs:
        df = scraper.contar_processos(**params)
    if df is None or df.empty:
        raise RuntimeError("O DataJud não devolveu contagem para esta busca.")
    falhas = df[df["count"].isna()] if "count" in df.columns else df
    if len(falhas):
        detalhe = " | ".join(logs[-3:]) or str(falhas.get("error", "").tolist())
        raise RuntimeError(f"Falha ao consultar a API pública do DataJud. {detalhe}".strip())
    total = int(df["count"].sum())
    relation = "gte" if (df.get("relation") == "gte").any() else "eq"
    return {
        "ok": True,
        "n_pags": math.ceil(total / tamanho) if total else 0,
        "n_itens": total,
        "relation": relation,
        "tamanho_pagina": tamanho,
        "sleep_time": float(getattr(scraper, "sleep_time", 0.5) or 0.5),
    }


def _datajud_run(params: dict, paginas, progress) -> dict:
    """Baixa com ``listar_processos`` e devolve as tabelas achatadas."""
    mostrar_movs = bool(params.get("mostrar_movs"))
    scraper = _to_scraper(DATAJUD)
    restore = _patch_tqdm(_progress_tqdm(progress))
    with warnings.catch_warnings(record=True) as caught, _captura_logs() as logs:
        warnings.simplefilter("always")
        try:
            df = scraper.listar_processos(paginas=paginas, **params)
        finally:
            restore()
    # Avisos que a pessoa precisa ver (ex.: "Resultados parciais retornados"
    # quando a API cai no meio da paginacao, ou retry com pagina menor).
    avisos = list(dict.fromkeys(
        str(w.message) for w in caught
        if issubclass(w.category, UserWarning) and "DataJud" in str(w.message)
    ))
    if avisos and logs:
        avisos.append("Detalhe: " + logs[-1])

    processos, movs = datajud_tabelas(df, mostrar_movs)
    extras = []
    if movs is not None:
        extras.append({
            "key": "movimentacoes",
            "label": "Movimentações (uma linha por movimentação)",
            "csv": _df_to_csv(movs),
            "n_rows": int(len(movs)),
        })
    return {
        "ok": True,
        "columns": [str(c) for c in processos.columns],
        "records": json.loads(processos.to_json(orient="records", force_ascii=False)),
        "csv": _df_to_csv(processos),
        "xlsx_b64": _df_to_xlsx_b64(processos),
        "n_rows": int(len(processos)),
        "extras": extras,
        "avisos": avisos,
    }


# --------------------------------------------------------------------------
# API publica chamada pelo worker
# --------------------------------------------------------------------------

def count(sigla: str, endpoint: str, params) -> str:
    """Baixa so a 1a pagina e captura o total de paginas (quando o tribunal expoe).

    Retorna JSON: {ok, n_pags|null, sleep_time, error?, traceback?}
    Para o DataJud tambem: {n_itens, relation, tamanho_pagina}.
    """
    try:
        params = _clean_params(params.to_py() if hasattr(params, "to_py") else dict(params))
        if sigla == DATAJUD:
            return json.dumps(_datajud_count(params))
        scraper = _to_scraper(sigla)
        sleep_time = float(getattr(scraper, "sleep_time", 1.0) or 1.0)
        captured: dict = {}

        def factory(iterable=None, *a, total=None, **k):
            captured["total"] = total
            raise _CountReached()

        restore = _patch_tqdm(factory)
        try:
            getattr(scraper, f"{endpoint}_download")(paginas=None, **params)
        except _CountReached:
            pass
        finally:
            restore()

        n_pags = captured.get("total")
        n_pags = int(n_pags) if isinstance(n_pags, (int, float)) else None
        return json.dumps({"ok": True, "n_pags": n_pags, "sleep_time": sleep_time})
    except BaseException as exc:  # noqa: BLE001 — empacota erro pra UI
        return json.dumps({
            "ok": False,
            "error": repr(exc),
            "traceback": traceback.format_exc(),
            "sigla": sigla, "endpoint": endpoint,
        })


def run(sigla: str, endpoint: str, params, paginas, progress) -> str:
    """Executa a busca completa, emitindo progresso, e retorna os resultados.

    `paginas`: None (todas) | int (1..N). `progress`: callback JS (feito, total).
    Retorna JSON: {ok, columns, records, csv, n_rows} ou {ok:false, error,...}.
    Para o DataJud tambem: {extras: [{key, label, csv, n_rows}], avisos: [...]}.
    """
    try:
        params = _clean_params(params.to_py() if hasattr(params, "to_py") else dict(params))
        if sigla == DATAJUD:
            return json.dumps(_datajud_run(params, paginas, progress))
        scraper = _to_scraper(sigla)

        restore = _patch_tqdm(_progress_tqdm(progress))
        try:
            df = getattr(scraper, endpoint)(paginas=paginas, **params)
        finally:
            restore()

        # Defesa: com ``count_only=True`` o juscraper devolve um int (total de
        # resultados) em vez de um DataFrame. O formulario nao expoe mais esse
        # campo, mas se chegar aqui vira uma tabela de uma linha em vez de
        # quebrar com AttributeError no to_json.
        if isinstance(df, (int, float)) and not isinstance(df, bool):
            import pandas as pd
            df = pd.DataFrame({"total_resultados": [int(df)]})

        # Serializacao robusta (datas viram ISO; nada de NaN cru no JSON).
        records = json.loads(df.to_json(orient="records", date_format="iso", force_ascii=False))
        csv_buf = io.StringIO()
        df.to_csv(csv_buf, index=False)
        xlsx_b64 = _df_to_xlsx_b64(df)
        return json.dumps({
            "ok": True,
            "columns": [str(c) for c in df.columns],
            "records": records,
            "csv": csv_buf.getvalue(),
            "xlsx_b64": xlsx_b64,
            "n_rows": int(len(df)),
        })
    except BaseException as exc:  # noqa: BLE001
        return json.dumps({
            "ok": False,
            "error": repr(exc),
            "traceback": traceback.format_exc(),
            "sigla": sigla, "endpoint": endpoint,
        })
