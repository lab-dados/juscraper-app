"""Glue Python que roda dentro do Pyodide (em um Web Worker).

Responsabilidades:
  1. bootstrap(): instalar o juscraper + dependencias disponiveis no Pyodide.
  2. Rotear TODO o HTTP do `requests` por um proxy CORS (ProxyAdapter), porque
     o navegador bloqueia chamadas diretas aos sites dos tribunais.
  3. count(): descobrir quantas paginas a busca tem (baixando so a 1a pagina),
     para a UI estimar o tempo e pedir confirmacao.
  4. run(): executar a busca completa emitindo progresso (via hook no tqdm) e
     devolver o resultado como JSON + CSV.

Tudo aqui assume execucao em um Web Worker (XHR sincrono com responseType
"arraybuffer" so e permitido fora da main thread).
"""
from __future__ import annotations

import io
import json
import sys
import traceback
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
    _install_proxy_adapter()
    import juscraper  # noqa: F401 — valida o import
    return juscraper.__version__


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


# --------------------------------------------------------------------------
# API publica chamada pelo worker
# --------------------------------------------------------------------------

def count(sigla: str, endpoint: str, params) -> str:
    """Baixa so a 1a pagina e captura o total de paginas (quando o tribunal expoe).

    Retorna JSON: {ok, n_pags|null, sleep_time, error?, traceback?}
    """
    try:
        params = _clean_params(params.to_py() if hasattr(params, "to_py") else dict(params))
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
    """
    try:
        params = _clean_params(params.to_py() if hasattr(params, "to_py") else dict(params))
        scraper = _to_scraper(sigla)

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

        restore = _patch_tqdm(_ProgressTqdm)
        try:
            df = getattr(scraper, endpoint)(paginas=paginas, **params)
        finally:
            restore()

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
